/**
 * Turning a strip of video into a caption cut-out.
 *
 * Burned-in captions are drawn on top of the footage, so the pixels that belong to the
 * caption are the ones we want to keep and everything else has to become transparent.
 * Two signals do that reliably for the caption styles social apps produce:
 *
 *   1. the outline / highlight colour, which is a single saturated colour repeated in
 *      every frame (CapCut, Instagram, Submagic and friends all draw one), and
 *   2. the near-neutral fill inside the letters, which is only trustworthy when it sits
 *      inside that outline — hair, skin and sky are near-neutral too.
 */

/**
 * Square structuring element, applied separably: O(w*h) per pass instead of O(w*h*r²).
 * Pixels outside the strip count as background, so a closing can never leak out of it.
 */
function morph(mask, width, height, radius, pick) {
  if (radius <= 0) return mask;
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = mask[row + x];
      for (let d = 1; d <= radius; d += 1) {
        value = pick(value, x - d >= 0 ? mask[row + x - d] : 0);
        value = pick(value, x + d < width ? mask[row + x + d] : 0);
      }
      horizontal[row + x] = value;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = horizontal[y * width + x];
      for (let d = 1; d <= radius; d += 1) {
        value = pick(value, y - d >= 0 ? horizontal[(y - d) * width + x] : 0);
        value = pick(value, y + d < height ? horizontal[(y + d) * width + x] : 0);
      }
      out[y * width + x] = value;
    }
  }
  return out;
}

const dilate = (mask, w, h, r) => morph(mask, w, h, r, Math.max);
const erode = (mask, w, h, r) => morph(mask, w, h, r, Math.min);

/**
 * Pixels enclosed by the mask: an outline pixel within `span` to the left and the right,
 * and another above and below. Letter bodies pass, footage outside the letters does not.
 *
 * A morphological closing would do the same job only while its radius is larger than half
 * a letter — and a radius that large starts swallowing the gaps between words.
 */
export function enclosed(mask, width, height, span) {
  const left = new Uint8Array(width * height);
  const right = new Uint8Array(width * height);
  const up = new Uint8Array(width * height);
  const down = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let since = Infinity;
    for (let x = 0; x < width; x += 1) {
      since = mask[row + x] ? 0 : since + 1;
      left[row + x] = since <= span ? 255 : 0;
    }
    since = Infinity;
    for (let x = width - 1; x >= 0; x -= 1) {
      since = mask[row + x] ? 0 : since + 1;
      right[row + x] = since <= span ? 255 : 0;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let since = Infinity;
    for (let y = 0; y < height; y += 1) {
      since = mask[y * width + x] ? 0 : since + 1;
      up[y * width + x] = since <= span ? 255 : 0;
    }
    since = Infinity;
    for (let y = height - 1; y >= 0; y -= 1) {
      since = mask[y * width + x] ? 0 : since + 1;
      down[y * width + x] = since <= span ? 255 : 0;
    }
  }

  const out = new Uint8Array(width * height);
  for (let p = 0; p < out.length; p += 1) {
    out[p] = left[p] && right[p] && up[p] && down[p] ? 255 : 0;
  }
  return out;
}

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * The colour a caption is outlined with.
 *
 * Saturated pixels alone are a bad signal — footage is saturated too — so only the
 * saturated pixels that sit next to the caption's near-neutral fill are histogrammed.
 * That is exactly what an outline is: the ring drawn around the letter bodies.
 *
 * Returns null when nothing qualifies: a caption with no outline, or no caption at all.
 */
export function detectOutlineColor(frames, {
  width,
  height,
  minSaturation = 0.35,
  minValue = 0.25,
  neutralMin = 200,
  neutralSpread = 60,
  ringRadius = 3,
  minContrast = 90,
  minCount = 12,
} = {}) {
  const bins = new Map();
  for (const frame of frames) {
    const pixels = frame.length / 3;
    const w = width || Math.round(Math.sqrt(pixels * 2.5));
    const h = height || Math.round(pixels / w);
    if (w * h !== pixels) continue;

    const neutral = new Uint8Array(pixels);
    for (let p = 0, i = 0; p < pixels; p += 1, i += 3) {
      const max = Math.max(frame[i], frame[i + 1], frame[i + 2]);
      const min = Math.min(frame[i], frame[i + 1], frame[i + 2]);
      if (min >= neutralMin && max - min <= neutralSpread) neutral[p] = 255;
    }
    const nearNeutral = dilate(neutral, w, h, ringRadius);

    // Footage sits next to the caption as well, so the average colour of everything that
    // is not caption fill gives us something to reject: an outline has to stand out from it.
    let sumR = 0, sumG = 0, sumB = 0, counted = 0;
    for (let p = 0, i = 0; p < pixels; p += 1, i += 3) {
      if (neutral[p]) continue;
      sumR += frame[i]; sumG += frame[i + 1]; sumB += frame[i + 2]; counted += 1;
    }
    const background = counted
      ? { r: sumR / counted, g: sumG / counted, b: sumB / counted }
      : { r: 0, g: 0, b: 0 };

    for (let p = 0, i = 0; p < pixels; p += 1, i += 3) {
      if (!nearNeutral[p] || neutral[p]) continue;
      const r = frame[i], g = frame[i + 1], b = frame[i + 2];
      const fromBackground = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      if (fromBackground < minContrast) continue;
      if (Math.max(r, g, b) < minValue * 255) continue;
      if (saturation(r, g, b) < minSaturation) continue;
      // 32-level bins: tolerant of compression noise, still separates neighbouring hues.
      const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
      const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bin.count += 1; bin.r += r; bin.g += g; bin.b += b;
      bins.set(key, bin);
    }
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.count > best.count) best = bin;
  if (!best || best.count < minCount) return null;
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };
}

/**
 * Alpha channel for one strip: 255 where the caption is, 0 where the footage shows through.
 *
 * `fill` closes over the letter bodies, so raising it helps thick fonts and hurts nothing
 * except captions whose letters are further apart than the radius.
 */
export function buildAlpha(rgb, width, height, { outline, tolerance = 120, fill = 0, neutralMin = 175, neutralSpread = 70 } = {}) {
  const span = fill > 0 ? fill : Math.round(height * 0.75);
  const pixels = width * height;
  const outlineMask = new Uint8Array(pixels);
  const neutralMask = new Uint8Array(pixels);
  for (let p = 0, i = 0; p < pixels; p += 1, i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    if (outline) {
      const distance = Math.abs(r - outline.r) + Math.abs(g - outline.g) + Math.abs(b - outline.b);
      if (distance <= tolerance) outlineMask[p] = 255;
    }
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (min >= neutralMin && max - min <= neutralSpread) neutralMask[p] = 255;
  }

  if (!outline) return neutralMask; // No outline to lean on: caption fill only.

  const filled = enclosed(outlineMask, width, height, span);
  const alpha = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p += 1) {
    alpha[p] = outlineMask[p] || (neutralMask[p] && filled[p]) ? 255 : 0;
  }
  return alpha;
}

/** RGB strip + alpha -> RGBA strip, ready to hand back to ffmpeg. */
export function toRgba(rgb, alpha) {
  const out = new Uint8Array(alpha.length * 4);
  for (let p = 0, i = 0, o = 0; p < alpha.length; p += 1, i += 3, o += 4) {
    out[o] = rgb[i]; out[o + 1] = rgb[i + 1]; out[o + 2] = rgb[i + 2]; out[o + 3] = alpha[p];
  }
  return out;
}

/** Share of pixels the mask keeps; the CLI warns when a strip looks empty or solid. */
export function coverage(alpha) {
  let kept = 0;
  for (let p = 0; p < alpha.length; p += 1) if (alpha[p]) kept += 1;
  return kept / alpha.length;
}
