import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg, probe, readRegion } from "./ffmpeg.js";
import { buildAlpha, coverage, detectOutlineColor, toRgba } from "./mask.js";

/** Captions from social apps sit in the lower third; this covers every style I've measured. */
export function defaultBand({ width, height }) {
  return { x: 0, width, y: Math.round(height * 0.55), height: Math.round(height * 0.22) };
}

export function parseBand(value, size) {
  if (!value) return defaultBand(size);
  const parts = String(value).split(":").map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`--band expects <y>:<height> in pixels, got "${value}"`);
  }
  const [y, height] = parts;
  if (y < 0 || height <= 0 || y + height > size.height) {
    throw new Error(`--band ${value} does not fit inside a ${size.width}x${size.height} video`);
  }
  return { x: 0, width: size.width, y, height };
}

export function parseInsert(value) {
  const [at, duration, ...rest] = String(value).split(",");
  const file = rest.join(",");
  if (!file || Number.isNaN(Number(at)) || Number.isNaN(Number(duration))) {
    throw new Error(`--insert expects <seconds>,<duration>,<file>, got "${value}"`);
  }
  return { at: Number(at), duration: Number(duration), file };
}

/**
 * Cut the caption out of the strip for one insert and write it as a raw RGBA stream that
 * ffmpeg can overlay back on top of the still.
 */
async function renderCaptionStrip(video, band, insert, options, tmp, index) {
  const raw = await readRegion(video.file, { start: insert.at, duration: insert.duration, ...band });
  const frameSize = band.width * band.height * 3;
  const frames = Math.floor(raw.length / frameSize);
  if (frames === 0) throw new Error(`No frames read at ${insert.at}s — is the insert past the end of the video?`);

  const sampleStep = Math.max(1, Math.floor(frames / 8));
  const samples = [];
  for (let f = 0; f < frames; f += sampleStep) samples.push(raw.subarray(f * frameSize, (f + 1) * frameSize));
  const outline = options.outline === null
    ? null
    : options.outline || detectOutlineColor(samples, { width: band.width, height: band.height });

  const out = path.join(tmp, `strip-${index}.rgba`);
  const handle = await fs.open(out, "w");
  let keptTotal = 0;
  try {
    for (let f = 0; f < frames; f += 1) {
      const rgb = raw.subarray(f * frameSize, (f + 1) * frameSize);
      const alpha = buildAlpha(rgb, band.width, band.height, { outline, fill: options.fill });
      keptTotal += coverage(alpha);
      await handle.write(Buffer.from(toRgba(rgb, alpha)));
    }
  } finally {
    await handle.close();
  }
  return { file: out, frames, outline, coverage: keptTotal / frames };
}

function fadeFilters(duration, fade) {
  if (!fade) return "";
  return `,fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade}:alpha=1`;
}

/**
 * Overlay each still on the video and put the caption strip back on top of it, so the
 * burned-in captions keep running while the still is on screen. Audio and timing are
 * untouched: nothing is inserted into the timeline, the stills cover it.
 */
export async function insertStills({ input, output, inserts, band: bandOption, fade = 0.35, fill = 0, outline, keepTemp = false, onProgress = () => {} }) {
  const meta = await probe(input);
  const video = { file: input, ...meta };
  const band = parseBand(bandOption, meta);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "captionsafe-"));

  try {
    const strips = [];
    for (const [index, insert] of inserts.entries()) {
      if (insert.at + insert.duration > meta.duration + 0.05) {
        throw new Error(`Insert at ${insert.at}s for ${insert.duration}s runs past the ${meta.duration.toFixed(1)}s video`);
      }
      onProgress(`caption strip ${index + 1}/${inserts.length} (${insert.file})`);
      const strip = await renderCaptionStrip(video, band, insert, { fill, outline }, tmp, index);
      strips.push(strip);
    }

    const args = ["-v", "error", "-y", "-i", input];
    for (const insert of inserts) args.push("-loop", "1", "-t", String(insert.duration), "-i", insert.file);
    for (const strip of strips) {
      args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${band.width}x${band.height}`, "-framerate", meta.fpsExact, "-i", strip.file);
    }

    const chain = ["[0:v]setpts=PTS-STARTPTS[base0]"];
    inserts.forEach((insert, k) => {
      const still = 1 + k;
      const strip = 1 + inserts.length + k;
      const end = (insert.at + insert.duration).toFixed(3);
      chain.push(
        `[${still}:v]scale=${meta.width}:${meta.height}:force_original_aspect_ratio=increase,crop=${meta.width}:${meta.height},format=rgba${fadeFilters(insert.duration, fade)},setpts=PTS-STARTPTS+${insert.at}/TB[still${k}]`,
        `[${strip}:v]format=rgba,setpts=PTS-STARTPTS+${insert.at}/TB[strip${k}]`,
        `[base${k}][still${k}]overlay=0:0:eof_action=pass:enable='between(t,${insert.at},${end})'[covered${k}]`,
        `[covered${k}][strip${k}]overlay=0:${band.y}:eof_action=pass:enable='between(t,${insert.at},${end})'[base${k + 1}]`,
      );
    });
    chain.push(`[base${inserts.length}]format=yuv420p[out]`);

    args.push("-filter_complex", chain.join(";"), "-map", "[out]");
    if (meta.hasAudio) args.push("-map", "0:a", "-c:a", "copy");
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", meta.fpsExact, "-movflags", "+faststart", output);

    onProgress("encoding");
    await ffmpeg(args);
    return { output, band, strips, video: meta };
  } finally {
    if (!keepTemp) await fs.rm(tmp, { recursive: true, force: true });
  }
}
