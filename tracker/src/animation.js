// Assemble les images de la carte animée.

import { cardSvg } from './card.js';
import { gifFrom } from './render.js';

export const FRAMES = 16;

export function animatedCard(model, options) {
  const svgs = [];
  for (let k = 0; k < FRAMES; k++) svgs.push(cardSvg(model, { ...options, phase: k / FRAMES }));
  return gifFrom(svgs);
}
