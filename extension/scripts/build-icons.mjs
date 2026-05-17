/**
 * Generate Tartı extension icons in 16/48/128 px PNGs.
 *
 * Design — solid cerulean (#007ea7) rounded square with a centered
 * deep-space-blue "T" mark, mirroring the brand wordmark. Pure-JS via
 * `pngjs`; no native deps, no sharp install.
 *
 * Run: `npm run icons:build` (from extension/). Commits the resulting
 * PNGs to `public/icons/`. Re-run only when the design changes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "icons");
mkdirSync(OUT_DIR, { recursive: true });

// Brand palette (mirrors landing/extension)
const CERULEAN = { r: 0x00, g: 0x7e, b: 0xa7 }; // bg
const ALABASTER = { r: 0xcc, g: 0xdb, b: 0xdc }; // letter
const SIZES = [16, 32, 48, 128];

// Tiny 5x7 monospace bitmap for the letter "T". Rows top→bottom.
// 1 = letter pixel, 0 = background. Width is 5 px; height 7 px.
const GLYPH_T = [
  "11111",
  "11111",
  "00100",
  "00100",
  "00100",
  "00100",
  "00100",
];

function isInsideRoundedSquare(x, y, size) {
  // Solid square with rounded corners. Radius scales with size.
  const radius = Math.max(2, Math.floor(size * 0.18));
  if (x >= radius && x < size - radius) return true;
  if (y >= radius && y < size - radius) return true;
  // Corner test: check distance from nearest corner center.
  const cx = x < radius ? radius : size - radius - 1;
  const cy = y < radius ? radius : size - radius - 1;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function setPixel(png, x, y, color, alpha = 255) {
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = alpha;
}

function drawGlyph(png, size) {
  // Map 5x7 glyph into a square ~60% of icon size, centered.
  const glyphCols = GLYPH_T[0].length;
  const glyphRows = GLYPH_T.length;
  const targetH = Math.max(7, Math.floor(size * 0.6));
  const cellH = Math.max(1, Math.floor(targetH / glyphRows));
  const cellW = cellH;
  const glyphPxW = cellW * glyphCols;
  const glyphPxH = cellH * glyphRows;
  const x0 = Math.floor((size - glyphPxW) / 2);
  const y0 = Math.floor((size - glyphPxH) / 2);

  for (let gy = 0; gy < glyphRows; gy++) {
    for (let gx = 0; gx < glyphCols; gx++) {
      if (GLYPH_T[gy][gx] !== "1") continue;
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const px = x0 + gx * cellW + dx;
          const py = y0 + gy * cellH + dy;
          if (px < 0 || px >= size || py < 0 || py >= size) continue;
          setPixel(png, px, py, ALABASTER);
        }
      }
    }
  }
}

function renderIcon(size) {
  const png = new PNG({ width: size, height: size });
  // First pass: fill the rounded square, transparent outside.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isInsideRoundedSquare(x, y, size)) {
        setPixel(png, x, y, CERULEAN);
      } else {
        setPixel(png, x, y, CERULEAN, 0); // fully transparent
      }
    }
  }
  // Second pass: draw the "T".
  drawGlyph(png, size);
  return PNG.sync.write(png);
}

for (const size of SIZES) {
  const buf = renderIcon(size);
  const path = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, buf);
  console.log(`Wrote ${path} (${buf.length} bytes)`);
}
