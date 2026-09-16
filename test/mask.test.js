import assert from "node:assert/strict";
import test from "node:test";
import { buildAlpha, coverage, detectOutlineColor, enclosed, toRgba } from "../src/mask.js";

const OUTLINE = { r: 120, g: 80, b: 245 };

/**
 * A strip that looks like a captioned frame: noisy footage, one outlined letter drawn on
 * top of it (purple ring, white body), and a bright near-neutral blob in the footage that
 * a plain brightness threshold would mistake for text.
 */
function strip(width = 60, height = 24) {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      rgb[i] = 90 + ((x * 7 + y * 3) % 40);
      rgb[i + 1] = 70 + ((x * 5) % 30);
      rgb[i + 2] = 50 + ((y * 11) % 25);
    }
  }
  const put = (x, y, [r, g, b]) => {
    const i = (y * width + x) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  };
  // Letter: 10x12 box of outline with a white interior.
  for (let y = 6; y < 18; y += 1) {
    for (let x = 10; x < 20; x += 1) {
      const edge = y === 6 || y === 17 || x === 10 || x === 19;
      put(x, y, edge ? [OUTLINE.r, OUTLINE.g, OUTLINE.b] : [246, 247, 250]);
    }
  }
  // Decoy highlight in the footage, same neutral brightness as the letter body.
  for (let y = 2; y < 6; y += 1) for (let x = 40; x < 50; x += 1) put(x, y, [240, 244, 246]);
  return { rgb, width, height };
}

test("detectOutlineColor finds the caption outline and ignores neutral footage", () => {
  const { rgb, width, height } = strip();
  const found = detectOutlineColor([rgb], { width, height });
  assert.ok(found, "expected an outline colour");
  assert.ok(Math.abs(found.r - OUTLINE.r) <= 16 && Math.abs(found.g - OUTLINE.g) <= 16 && Math.abs(found.b - OUTLINE.b) <= 16,
    `found ${JSON.stringify(found)}`);
});

test("detectOutlineColor returns null for a strip with no saturated colour", () => {
  const grey = new Uint8Array(30 * 10 * 3).fill(128);
  assert.equal(detectOutlineColor([grey], { width: 30, height: 10 }), null);
});

test("buildAlpha keeps the letter and drops the footage highlight", () => {
  const { rgb, width, height } = strip();
  const alpha = buildAlpha(rgb, width, height, { outline: OUTLINE });
  const at = (x, y) => alpha[y * width + x];

  assert.equal(at(10, 6), 255, "outline pixel kept");
  assert.equal(at(15, 12), 255, "letter body kept");
  assert.equal(at(45, 3), 0, "bright footage dropped");
  assert.equal(at(2, 20), 0, "plain footage dropped");
});

test("buildAlpha without an outline falls back to the neutral fill only", () => {
  const { rgb, width, height } = strip();
  const alpha = buildAlpha(rgb, width, height, { outline: null });
  assert.equal(alpha[12 * width + 15], 255, "letter body kept");
  assert.equal(alpha[6 * width + 10], 0, "outline is not neutral, so it is dropped");
});

test("enclosed marks what a ring surrounds and nothing outside it", () => {
  const width = 9, height = 9;
  const mask = new Uint8Array(width * height);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) {
      if (y === 2 || y === 6 || x === 2 || x === 6) mask[y * width + x] = 255;
    }
  }
  const inside = enclosed(mask, width, height, 4);
  assert.equal(inside[4 * width + 4], 255, "centre is enclosed");
  assert.equal(inside[0], 0, "corner is not");
  assert.equal(inside[8 * width + 8], 0, "opposite corner is not");
  assert.equal(inside[0 * width + 4], 0, "above the ring is not");
});

test("toRgba interleaves colour and alpha, and coverage reports the kept share", () => {
  const rgb = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  const alpha = Uint8Array.from([255, 0]);
  assert.deepEqual([...toRgba(rgb, alpha)], [1, 2, 3, 255, 4, 5, 6, 0]);
  assert.equal(coverage(alpha), 0.5);
});
