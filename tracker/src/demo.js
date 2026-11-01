// Essai local avec des données simulées : crée les images dans out/, et les publie si un webhook est donné.
// Usage : npm run demo            (route d'exemple)
//         ROUTE_FILE=config/route.local.json npm run demo
//         DISCORD_WEBHOOK_URL=... npm run demo

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { animatedCard } from './animation.js';
import { bannerSvg, cardSvg } from './card.js';
import { postImage } from './discord.js';
import { GOALS, summarize } from './progress.js';
import { pngFrom } from './render.js';

const OUT = new URL('../../out/', import.meta.url);
const ROUTE = process.env.ROUTE_FILE ? pathToFileURL(resolve(process.env.ROUTE_FILE)) : new URL('../../config/route.example.json', import.meta.url);
const route = JSON.parse(readFileSync(ROUTE, 'utf8'));
const CURRENT = Number(process.env.DEMO_STEP ?? Math.floor(route.stops.length / 2) - 1);
const THEME = process.env.DEMO_THEME || route.theme;

const STATE = { 1: 'Exploited', 2: 'Fortified', 3: 'Stronghold' };
const records = route.stops.map((stop, k) => {
  const updated_at = new Date(Date.now() - 12 * 60000).toISOString();
  if (k < CURRENT) return { controlling_power: route.power, power_state: STATE[GOALS[stop.goal].rank], updated_at };
  if (k === CURRENT) return { controlling_power: route.power, power_state: 'Exploited', power_state_control_progress: 0.5, updated_at };
  return { updated_at };
});
const model = summarize(route, records);
const board = [
  { cmdr: 'CMDR Alpha', merits: Math.round(model.done * 0.34) },
  { cmdr: 'CMDR Bravo', merits: Math.round(model.done * 0.27) },
  { cmdr: 'CMDR Charlie', merits: Math.round(model.done * 0.21) },
  { cmdr: 'CMDR Delta', merits: Math.round(model.done * 0.18) },
];
const options = { board, boardTitle: 'CLASSEMENT (EXEMPLE)', theme: THEME, sourceNote: 'simulation' };

mkdirSync(OUT, { recursive: true });
const started = Date.now();
const gif = animatedCard(model, options);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const png = pngFrom(cardSvg(model, options));
const validated = model.steps[Math.max(0, model.index - 1)];
const banner = pngFrom(bannerSvg(validated, model.current, { theme: THEME }));
writeFileSync(new URL('route.gif', OUT), gif);
writeFileSync(new URL('route.png', OUT), png);
writeFileSync(new URL('valide.png', OUT), banner);
console.log(`GIF : ${(gif.length / 1e6).toFixed(2)} Mo en ${seconds} s · PNG : ${(png.length / 1e6).toFixed(2)} Mo`);

if (process.env.DISCORD_WEBHOOK_URL) {
  await postImage(process.env.DISCORD_WEBHOOK_URL, gif, 'route.gif', 'image/gif');
  await postImage(process.env.DISCORD_WEBHOOK_URL, banner, 'valide.png', 'image/png');
  console.log('Publié dans Discord.');
}
