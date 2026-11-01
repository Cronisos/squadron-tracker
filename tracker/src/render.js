// Transforme les SVG en PNG et en GIF animé.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const FONT_DIR = fileURLToPath(new URL('../fonts', import.meta.url));
const FONTS = readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).map((f) => join(FONT_DIR, f));

const resvgOptions = {
  background: '#000',
  font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Barlow Condensed' },
};

function rasterize(svg) {
  const image = new Resvg(svg, resvgOptions).render();
  return { rgba: image.pixels, width: image.width, height: image.height };
}

const BAYER = [
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
];
const DITHER_STRENGTH = 14;

/** Trame fixe : elle lisse les dégradés, et reste identique d'une image à l'autre pour garder le fichier léger. */
function dither(rgba, width) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const p = i / 4;
    const x = p % width;
    const y = (p - x) / width;
    const shift = (BAYER[(y % 8) * 8 + (x % 8)] / 64 - 0.5) * DITHER_STRENGTH;
    out[i] += shift;
    out[i + 1] += shift;
    out[i + 2] += shift;
  }
  return out;
}

export function pngFrom(svg) {
  return new Resvg(svg, resvgOptions).render().asPng();
}

/**
 * Encode les images en GIF en boucle. Seuls les pixels qui changent sont réécrits :
 * le reste de la carte reste transparent d'une image à l'autre, ce qui allège beaucoup le fichier.
 */
export function gifFrom(svgs, { delayMs = 120 } = {}) {
  const frames = svgs.map(rasterize);
  const { width, height } = frames[0];
  for (const frame of frames) frame.rgba = dither(frame.rgba, width);
  const count = width * height;
  // Une couleur est réservée à la transparence, à la fin de la palette
  const palette = quantize(frames[0].rgba, 255, { format: 'rgb565' });
  const transparent = palette.length;
  const fullPalette = [...palette, [0, 0, 0]];
  const gif = GIFEncoder();
  const base = applyPalette(frames[0].rgba, palette, 'rgb565');
  let previous = base;
  gif.writeFrame(base, width, height, { palette: fullPalette, delay: delayMs, repeat: 0, dispose: 1 });
  for (let f = 1; f < frames.length; f++) {
    const index = applyPalette(frames[f].rgba, palette, 'rgb565');
    const delta = new Uint8Array(count);
    for (let p = 0; p < count; p++) delta[p] = index[p] === previous[p] ? transparent : index[p];
    gif.writeFrame(delta, width, height, { delay: delayMs, transparent: true, transparentIndex: transparent, dispose: 1 });
    previous = index;
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
