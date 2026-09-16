import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

class ToolMissingError extends Error {
  constructor(tool) {
    super(`${tool} was not found on PATH. Install ffmpeg, or set ${tool.toUpperCase()}_PATH.`);
    this.name = "ToolMissingError";
  }
}

function run(tool, args, { collect = "none" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: ["ignore", collect === "stdout" ? "pipe" : "ignore", "pipe"] });
    const out = [];
    let err = "";
    child.on("error", (error) => reject(error.code === "ENOENT" ? new ToolMissingError(tool) : error));
    child.stderr.on("data", (chunk) => { err += chunk; });
    if (collect === "stdout") child.stdout.on("data", (chunk) => out.push(chunk));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${tool} exited with ${code}\n${err.trim().split("\n").slice(-6).join("\n")}`));
      else resolve(Buffer.concat(out));
    });
  });
}

export async function probe(file) {
  const raw = await run(FFPROBE, [
    "-v", "error", "-print_format", "json",
    "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration",
    file,
  ], { collect: "stdout" });
  const payload = JSON.parse(raw.toString());
  const video = (payload.streams || []).find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`No video stream in ${file}`);
  const [num, den] = String(video.r_frame_rate || "30/1").split("/");
  return {
    width: video.width,
    height: video.height,
    fps: Number(num) / Number(den || 1),
    fpsExact: video.r_frame_rate || "30/1",
    duration: Number(payload.format?.duration || 0),
    hasAudio: (payload.streams || []).some((stream) => stream.codec_type === "audio"),
  };
}

/** Raw RGB24 frames of one region, as a single buffer the caller slices per frame. */
export async function readRegion(file, { start, duration, x, y, width, height }) {
  return run(FFMPEG, [
    "-v", "error", "-i", file, "-ss", String(start), "-t", String(duration),
    "-vf", `crop=${width}:${height}:${x}:${y}`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { collect: "stdout" });
}

export const ffmpeg = (args) => run(FFMPEG, args);
export { ToolMissingError };
