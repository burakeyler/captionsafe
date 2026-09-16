#!/usr/bin/env node
import { parseArgs } from "node:util";
import { insertStills, parseInsert } from "../src/insert.js";
import { ToolMissingError } from "../src/ffmpeg.js";

const USAGE = `captionsafe — drop stills into a video without covering its burned-in captions

  captionsafe -i clip.mp4 -o out.mp4 --insert 7.6,3.4,photo.jpg [--insert ...]

Options
  -i, --input <file>        source video (captions already burned in)
  -o, --output <file>       file to write
      --insert <t,dur,img>  still to show: start seconds, duration seconds, image path
                            repeat for several stills
      --band <y:height>     caption strip in pixels (default: lower third)
      --fade <seconds>      cross-fade on each still (default 0.35, 0 disables)
      --fill <pixels>       max letter size to fill, in pixels (default: 75% of band)
      --outline <r,g,b>     caption outline colour; "none" for captions without one
      --keep-temp           leave the extracted caption strips on disk
  -h, --help                this text

The video's length, audio and caption timing are never changed: stills are laid over the
footage and the captions are cut out of those frames and drawn back on top.`;

function parseOutline(value) {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  const parts = String(value).split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    throw new Error(`--outline expects r,g,b (0-255) or "none", got "${value}"`);
  }
  return { r: parts[0], g: parts[1], b: parts[2] };
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      insert: { type: "string", multiple: true, default: [] },
      band: { type: "string" },
      fade: { type: "string", default: "0.35" },
      fill: { type: "string", default: "0" },
      outline: { type: "string" },
      "keep-temp": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || !values.input || !values.output || values.insert.length === 0) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const result = await insertStills({
    input: values.input,
    output: values.output,
    inserts: values.insert.map(parseInsert),
    band: values.band,
    fade: Number(values.fade),
    fill: Number(values.fill),
    outline: parseOutline(values.outline),
    keepTemp: values["keep-temp"],
    onProgress: (step) => process.stderr.write(`… ${step}\n`),
  });

  const { band } = result;
  console.log(`wrote ${result.output}`);
  console.log(`caption strip: y=${band.y} height=${band.height}`);
  result.strips.forEach((strip, index) => {
    const colour = strip.outline ? `rgb(${strip.outline.r},${strip.outline.g},${strip.outline.b})` : "none";
    const kept = (strip.coverage * 100).toFixed(1);
    console.log(`  still ${index + 1}: ${strip.frames} frames, outline ${colour}, ${kept}% of the strip kept`);
    if (strip.coverage < 0.005) {
      console.warn(`  ! almost nothing was kept — check --band, or pass --outline if the captions have no outline`);
    } else if (strip.coverage > 0.6) {
      console.warn(`  ! most of the strip was kept — the outline colour probably matches the footage; try --outline`);
    }
  });
}

main().catch((error) => {
  console.error(error instanceof ToolMissingError ? error.message : `captionsafe: ${error.message}`);
  process.exit(1);
});
