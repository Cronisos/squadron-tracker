// Dessine la carte de suivi et la bannière de validation en SVG.

import { readFileSync } from 'node:fs';
import { ageLabel } from './progress.js';

// Vaisseau de la carte (assets/vaisseau.png, 480 × 313, fond transparent) : le même que le rapport d'Elite Compagnon.
// Vue de trois quarts, le nez vers le bas à droite, à environ 32° sous l'horizontale.
const SHIP_PNG = `data:image/png;base64,${readFileSync(new URL('../assets/vaisseau.png', import.meta.url)).toString('base64')}`;
const SHIP_W = 112;
const SHIP_H = (SHIP_W * 313) / 480;
const SHIP_NOSE_DEG = 32;
// Propulseurs dans le repère du vaisseau redressé (nez à droite), pour une largeur de 90 : x, y, longueur, demi-épaisseur
const THRUSTERS = [
  { x: -24.6, y: -1.5, n: 34, h: 3.2 },
  { x: -37.7, y: 11.5, n: 22, h: 2 },
  { x: -12.2, y: -18.8, n: 22, h: 2 },
];

export const WIDTH = 1200;
export const HEIGHT = 675;
export const BANNER_HEIGHT = 170;

export const THEMES = {
  orange: { a: '#ff8a1f', b: '#ffd08a', neb1: '#7a2f0b', neb2: '#231447', bg: '#07060b', flame: '#7fd8ff' },
  prism: { a: '#39d0ff', b: '#e0b3ff', neb1: '#0f4470', neb2: '#561f7d', bg: '#05060f', flame: '#ff9df0' },
};

const HUD = 'font-family="Chakra Petch" font-weight="700"';
const LABEL = 'font-family="Barlow Condensed" font-weight="600"';
const LABEL_BOLD = 'font-family="Barlow Condensed" font-weight="700"';

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const merits = (m) =>
  m >= 1_000_000
    ? `${(m / 1_000_000).toFixed(2).replace('.', ',')} M`
    : `${Math.round(m / 1000)} k`;

// Vague ample : deux systèmes voisins ne sont jamais à la même hauteur, leurs noms ne se touchent pas
const AMPLITUDE = 76;
const curve = (t) => [75 + 1050 * t, 244 + AMPLITUDE * Math.sin(t * 7.4 + 0.5)];
const slope = (t) => (Math.atan2(AMPLITUDE * 7.4 * Math.cos(t * 7.4 + 0.5), 1050) * 180) / Math.PI;

/**
 * Nom complet en deux lignes, pour qu'il tienne entre deux systèmes : « Synuefe OU-E c28-2 » → [« Synuefe »,
 * « OU-E c28-2 »] ; « HIP 73834 » reste sur une ligne. Jamais abrégé : la carte de la galaxie du jeu ne trouve un
 * système qu'à son nom complet.
 */
export function nameLines(name) {
  const m = /^(.+?) ([A-Z]{2}-[A-Z] [a-h]\d+(?:-\d+)?)$/.exec(String(name));
  return m ? [m[1], m[2]] : [String(name)];
}

function trail(a, b) {
  const points = [];
  for (let k = 0; k <= 60; k++) points.push(curve(a + ((b - a) * k) / 60).map((n) => n.toFixed(1)).join(','));
  return points.join(' ');
}

function background(c, height) {
  let stars = '';
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 190; k++) {
    stars += `<circle cx="${(rnd() * WIDTH).toFixed(0)}" cy="${(rnd() * height).toFixed(0)}" r="${(rnd() * 1.3 + 0.3).toFixed(1)}" fill="#fff" opacity="${(rnd() * 0.55 + 0.1).toFixed(2)}"/>`;
  }
  return `<defs>
    <radialGradient id="n1" cx="18%" cy="28%" r="60%"><stop offset="0" stop-color="${c.neb1}" stop-opacity=".95"/><stop offset="1" stop-color="${c.neb1}" stop-opacity="0"/></radialGradient>
    <radialGradient id="n2" cx="85%" cy="65%" r="65%"><stop offset="0" stop-color="${c.neb2}" stop-opacity=".95"/><stop offset="1" stop-color="${c.neb2}" stop-opacity="0"/></radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="done" cx="35%" cy="30%"><stop offset="0" stop-color="${c.b}"/><stop offset="1" stop-color="${c.a}"/></radialGradient>
    <radialGradient id="idle" cx="35%" cy="30%"><stop offset="0" stop-color="#3a3744"/><stop offset="1" stop-color="#121018"/></radialGradient>
    <linearGradient id="flame"><stop offset="0" stop-color="${c.flame}" stop-opacity="0"/><stop offset="1" stop-color="${c.flame}"/></linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="${c.bg}"/><rect width="${WIDTH}" height="${height}" fill="url(#n1)"/><rect width="${WIDTH}" height="${height}" fill="url(#n2)"/>${stars}`;
}

const chamfer = (x, y, w, h, n = 18) =>
  `${x + n},${y} ${x + w},${y} ${x + w},${y + h - n} ${x + w - n},${y + h} ${x},${y + h} ${x},${y + n}`;
const panel = (x, y, w, h, c, title) =>
  `<polygon points="${chamfer(x, y, w, h)}" fill="#0a0910" fill-opacity=".72" stroke="${c.a}" stroke-opacity=".55" stroke-width="1.5"/>
  <text x="${x + 22}" y="${y + 31}" ${LABEL} font-size="18" letter-spacing="2.5" fill="${c.a}">${title}</text>`;

function hexagon(x, y, r) {
  const points = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 3) * k + Math.PI / 6;
    points.push(`${(x + r * Math.cos(angle)).toFixed(1)},${(y + r * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(' ');
}

function node(step, k, model, c) {
  const last = model.steps.length - 1;
  const [x, y] = curve(k / last);
  const done = k < model.index;
  const current = k === model.index;
  const fort = step.goal === 'Forteresse';
  const r = fort ? 17 : 12;
  const fill = done ? 'url(#done)' : 'url(#idle)';
  const stroke = done || current ? c.a : '#5d586a';
  const shape = fort
    ? `<polygon points="${hexagon(x, y, r)}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
    : `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const length = 2 * Math.PI * 25;
  const ring = current
    ? `<circle cx="${x}" cy="${y}" r="25" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="4"/>
       <circle cx="${x}" cy="${y}" r="25" fill="none" stroke="${c.b}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(length * model.frac).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 ${x} ${y})"/>`
    : '';
  const color = current ? '#fff' : done ? c.b : '#a8a2b2';
  const lines = step.short ? [step.short] : nameLines(step.name);
  const top = y + (current ? 48 : 36);
  const outline = `stroke="${c.bg}" stroke-width="4" paint-order="stroke"`;
  const first = lines.length > 1
    ? `<text x="${x}" y="${top}" text-anchor="middle" ${LABEL} font-size="${current ? 17 : 14}" fill="${color}" ${outline}>${escapeXml(lines[0])}</text>`
    : '';
  const second = `<text x="${x}" y="${top + (lines.length > 1 ? (current ? 21 : 17) : 4)}" text-anchor="middle" ${LABEL} font-size="${current ? 21 : 17}" fill="${color}" ${outline}>${escapeXml(lines.at(-1))}</text>`;
  return `<g ${done || current ? 'filter="url(#glow)"' : ''}>${shape}</g>${ring}${first}${second}`;
}

/**
 * Chaque tronçon entre deux systèmes se parcourt en deux temps : sa première part (TRANSIT) pendant l'attente du
 * jeudi, une fois le système d'avant complet ; le reste au rythme des mérites du système visé. Le vaisseau n'est donc
 * jamais « déjà arrivé » sur un système où l'on ne peut pas encore travailler, et il ne recule jamais.
 */
const TRANSIT = 0.6;

function shipPosition(model) {
  const last = model.steps.length - 1;
  if (!model.current) return 1;
  if (last < 1) return 0;
  // En attente du jeudi : parti du système complet, en route vers le suivant (s'il y en a un)
  if (model.pending) return Math.min(1, (model.index + (model.index < last ? TRANSIT * model.transit : 0)) / last);
  if (model.index === 0) return 0;
  return (model.index - 1 + TRANSIT + (1 - TRANSIT) * model.frac) / last;
}

const CHEVRON_BLUE = '#4fb4ff';
/**
 * Flèches sans queue, bleues, le long de la route entre le vaisseau et le système suivant, qui s'illuminent en vague
 * vers l'avant : le vaisseau fait route, le système suivant n'est pas encore ouvert. Seulement en attente du jeudi.
 */
function chevrons(model, phase) {
  const last = model.steps.length - 1;
  if (!model.pending || model.index >= last) return '';
  // Sur tout le tronçon, du système complet au suivant : le vaisseau les survole en avançant
  const from = model.index / last;
  const to = (model.index + 1) / last;
  const count = 6;
  let out = '';
  for (let k = 0; k < count; k++) {
    const t = from + (to - from) * (0.16 + (0.7 * k) / (count - 1));
    const [x, y] = curve(t);
    // La vague part du vaisseau et court vers le système suivant
    const wave = Math.max(0, Math.cos(2 * Math.PI * (phase - k / count)));
    const opacity = (0.22 + 0.78 * wave ** 3).toFixed(2);
    out += `<path d="M-6 -9 L5 0 L-6 9" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${slope(t).toFixed(1)})" fill="none" stroke="${CHEVRON_BLUE}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  }
  return `<g filter="url(#glow)">${out}</g>`;
}

/** phase va de 0 à 1 et boucle : le vaisseau flotte et sa flamme vacille. */
function ship(t, phase, c) {
  const [x, y] = curve(t);
  const hover = 4 * Math.sin(2 * Math.PI * phase);
  const flicker = 1 + 0.18 * Math.sin(8 * Math.PI * phase);
  const k = SHIP_W / 90;
  const flames = THRUSTERS.map(({ x: fx, y: fy, n, h }) => {
    const [ax, ay, len, half] = [fx * k, fy * k, n * k * flicker, h * k];
    return `<path d="M${(ax - len).toFixed(1)} ${(ay - half).toFixed(1)} L${ax.toFixed(1)} ${(ay - half * 0.8).toFixed(1)} L${ax.toFixed(1)} ${(ay + half * 0.8).toFixed(1)} L${(ax - len).toFixed(1)} ${(ay + half).toFixed(1)} Z" fill="url(#flame)"/>`;
  }).join('');
  return `<g transform="translate(${x.toFixed(1)} ${(y - 42).toFixed(1)}) rotate(${slope(t).toFixed(1)})">
    <g transform="translate(0 ${hover.toFixed(2)})">${flames}
    <g transform="rotate(${-SHIP_NOSE_DEG})"><image href="${SHIP_PNG}" x="${(-SHIP_W / 2).toFixed(1)}" y="${(-SHIP_H / 2).toFixed(1)}" width="${SHIP_W}" height="${SHIP_H.toFixed(1)}"/></g></g></g>`;
}

function gauge(x, y, r, pct, c) {
  const length = 2 * Math.PI * r;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="12"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c.a}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${((length * pct) / 100).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 ${x} ${y})"/>
    <text x="${x}" y="${y + 13}" text-anchor="middle" ${HUD} font-size="38" fill="#fff">${pct}<tspan font-size="20" dx="2">%</tspan></text>`;
}

function currentPanel(model, c) {
  const x = 36;
  const y = 408;
  const head = panel(x, y, 420, 232, c, 'OBJECTIF EN COURS');
  const step = model.current;
  if (!step) {
    return `${head}${gauge(x + 104, y + 130, 66, 100, c)}<text x="${x + 196}" y="${y + 122}" ${LABEL_BOLD} font-size="34" fill="#fff">Route terminée</text>`;
  }
  if (model.pending) {
    // Palier atteint, pas encore validé par le jeu : rien à faire ici, et le système suivant n'est pas encore à portée
    const next = model.steps[model.index + 1];
    return `${panel(x, y, 420, 232, c, 'EN ATTENTE DU JEUDI')}${gauge(x + 104, y + 130, 66, 100, c)}
    <text x="${x + 196}" y="${y + 92}" ${LABEL_BOLD} font-size="33" fill="#fff">${escapeXml(step.name)}</text>
    <text x="${x + 196}" y="${y + 126}" ${LABEL} font-size="23" fill="${c.b}">Palier ${escapeXml(step.goal)} atteint</text>
    <text x="${x + 196}" y="${y + 158}" ${LABEL} font-size="21" fill="#c8c3d0">Validé jeudi, au passage du jeu</text>
    <text x="${x + 196}" y="${y + 190}" ${LABEL} font-size="21" fill="${CHEVRON_BLUE}">${escapeXml(next ? `En route vers ${next.name}` : 'Dernière étape')}</text>`;
  }
  const warning = step.noLarge
    ? `<path d="M${x + 196} ${y + 196} l9 -16 l9 16 Z" fill="#ffc94d"/><text x="${x + 220}" y="${y + 196}" ${LABEL} font-size="19" fill="#ffc94d">Pas de grand pad</text>`
    : '';
  return `${head}${gauge(x + 104, y + 130, 66, Math.floor(model.frac * 100), c)}
    <text x="${x + 196}" y="${y + 92}" ${LABEL_BOLD} font-size="33" fill="#fff">${escapeXml(step.name)}</text>
    <text x="${x + 196}" y="${y + 126}" ${LABEL} font-size="23" fill="${c.b}">Objectif : ${escapeXml(step.goal)}</text>
    <text x="${x + 196}" y="${y + 158}" ${LABEL} font-size="21" fill="#c8c3d0">Reste ${merits(step.left)} de mérites</text>${warning}`;
}

function routePanel(model, c) {
  const x = 476;
  const y = 408;
  const w = 330;
  const count = model.steps.length;
  const gap = 4;
  const cell = (w - 44 - gap * (count - 1)) / count;
  const next = model.current ? model.steps[model.index + 1] : null;
  const pct = Math.floor((model.done / model.total) * 100);
  const bars = model.steps.map((_, k) => {
    const fill = k < model.index ? 1 : k === model.index ? model.frac : 0;
    const bx = (x + 22 + k * (cell + gap)).toFixed(1);
    return `<rect x="${bx}" y="${y + 116}" width="${cell.toFixed(1)}" height="14" fill="#fff" fill-opacity=".1"/><rect x="${bx}" y="${y + 116}" width="${(cell * fill).toFixed(1)}" height="14" fill="${c.a}"/>`;
  }).join('');
  const after = next ? `Ensuite : ${next.name}` : model.current ? 'Dernière étape' : 'Objectif atteint';
  return `${panel(x, y, w, 232, c, 'ROUTE COMPLÈTE')}
    <text x="${x + 22}" y="${y + 90}" ${HUD} font-size="46" fill="#fff">${pct}<tspan font-size="24" dx="2">%</tspan></text>
    <text x="${x + w - 22}" y="${y + 74}" text-anchor="end" ${LABEL} font-size="23" fill="#fff">${merits(model.done)}</text>
    <text x="${x + w - 22}" y="${y + 97}" text-anchor="end" ${LABEL} font-size="18" fill="#a8a2b2">sur ${merits(model.total)}</text>
    ${bars}
    <text x="${x + 22}" y="${y + 162}" ${LABEL} font-size="20" fill="#c8c3d0">${model.index} étapes validées sur ${count}</text>
    <text x="${x + 22}" y="${y + 196}" ${LABEL} font-size="20" fill="${c.b}">${escapeXml(after)}</text>`;
}

function boardPanel(board, boardTitle, c) {
  const x = 826;
  const y = 408;
  const w = 338;
  const rows = board.slice(0, 4);
  const top = rows[0]?.merits || 1;
  const content = rows.map((row, k) => {
    const ry = y + 56 + k * 41;
    return `<text x="${x + 22}" y="${ry + 15}" ${HUD} font-size="17" fill="${k ? '#a8a2b2' : c.b}">${k + 1}</text>
      <text x="${x + 46}" y="${ry + 15}" ${LABEL} font-size="21" fill="#fff">${escapeXml(row.cmdr.slice(0, 22))}</text>
      <text x="${x + w - 22}" y="${ry + 15}" text-anchor="end" ${LABEL} font-size="20" fill="#fff">${merits(row.merits)}</text>
      <rect x="${x + 46}" y="${ry + 23}" width="${w - 68}" height="4" fill="#fff" fill-opacity=".1"/>
      <rect x="${x + 46}" y="${ry + 23}" width="${(((w - 68) * row.merits) / top).toFixed(1)}" height="4" fill="${c.a}"/>`;
  }).join('');
  const empty = rows.length ? '' : `<text x="${x + 22}" y="${y + 110}" ${LABEL} font-size="21" fill="#a8a2b2">Aucun mérite reçu pour l'instant</text>`;
  return `${panel(x, y, w, 232, c, boardTitle)}${content}${empty}`;
}

/** Une image de la carte complète. */
export function cardSvg(model, { board = [], boardTitle = 'CLASSEMENT', theme = 'orange', phase = 0, sourceNote = '' } = {}) {
  const c = THEMES[theme];
  const t = shipPosition(model);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">${background(c, HEIGHT)}
    <text x="38" y="62" ${HUD} font-size="38" fill="#fff" letter-spacing="1">${escapeXml(model.title)}</text>
    <text x="40" y="92" ${LABEL} font-size="20" letter-spacing="2" fill="${c.b}">${escapeXml(model.subtitle)}</text>
    <text x="${WIDTH - 38}" y="58" text-anchor="end" ${LABEL} font-size="19" fill="#c8c3d0">Données Spansh</text>
    <text x="${WIDTH - 38}" y="82" text-anchor="end" ${LABEL} font-size="19" fill="#c8c3d0">${escapeXml(sourceNote || ageLabel(model.ageMs))}</text>
    <polyline points="${trail(0, 1)}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>
    ${t > 0 ? `<polyline points="${trail(0, t)}" fill="none" stroke="${c.a}" stroke-width="4" filter="url(#glow)"/>` : ''}
    ${chevrons(model, phase)}${model.steps.map((step, k) => node(step, k, model, c)).join('')}${ship(t, phase, c)}
    ${currentPanel(model, c)}${routePanel(model, c)}${boardPanel(board, boardTitle, c)}</svg>`;
}

function stepPosition(model, index) {
  return Math.min(index, model.steps.length - 1) / (model.steps.length - 1);
}

function validatedPanel(model, from, c) {
  const x = 36;
  const y = 408;
  const validated = model.steps.slice(from.index, model.index);
  const shown = validated.slice(0, 4);
  const lines = shown.map((step, k) => {
    const ly = y + 72 + k * 38;
    return `<polygon points="${hexagon(x + 34, ly - 7, 10)}" fill="url(#done)"/>
      <text x="${x + 56}" y="${ly}" ${LABEL} font-size="24" fill="#fff">${escapeXml(step.name)}</text>
      <text x="${x + 398}" y="${ly}" text-anchor="end" ${LABEL} font-size="20" fill="${c.b}">${escapeXml(step.goal)}</text>`;
  }).join('');
  const more = validated.length > 4 ? `<text x="${x + 22}" y="${y + 216}" ${LABEL} font-size="19" fill="#a8a2b2">et ${validated.length - 4} de plus</text>` : '';
  const empty = validated.length ? '' : `<text x="${x + 22}" y="${y + 92}" ${LABEL} font-size="24" fill="#c8c3d0">Aucun cette semaine</text>
    <text x="${x + 22}" y="${y + 126}" ${LABEL} font-size="21" fill="#a8a2b2">${model.current ? `Toujours sur ${escapeXml(model.current.name)}` : ''}</text>`;
  return `${panel(x, y, 420, 232, c, `SYSTÈMES VALIDÉS : ${validated.length}`)}${lines}${more}${empty}`;
}

function summaryPanel(model, from, squadronTotal, c) {
  const x = 476;
  const y = 408;
  const w = 330;
  const gain = Math.max(0, model.done - from.done);
  const pct = Math.floor((model.done / model.total) * 100);
  const row = (k, label, value) => `<text x="${x + 22}" y="${y + 66 + k * 36}" ${LABEL} font-size="21" fill="#c8c3d0">${label}</text>
    <text x="${x + w - 22}" y="${y + 66 + k * 36}" text-anchor="end" ${LABEL_BOLD} font-size="23" fill="#fff">${value}</text>`;
  const next = model.current ? `Objectif : ${model.current.name}` : 'Route terminée';
  return `${panel(x, y, w, 232, c, 'BILAN DE LA SEMAINE')}
    ${row(0, 'Avancée de la route', `+${merits(gain)}`)}
    ${row(1, 'Mérites du classement', merits(squadronTotal))}
    ${row(2, 'Route complète', `${pct} %`)}
    ${row(3, 'Cumul', `${merits(model.done)} / ${merits(model.total)}`)}
    <text x="${x + 22}" y="${y + 212}" ${LABEL} font-size="20" fill="${c.b}">${escapeXml(next)}</text>`;
}

/** Rapport figé de la semaine écoulée. */
export function reportSvg(model, { from, label, board = [], total = 0, theme = 'orange', boardTitle = 'TOP DE LA SEMAINE' }) {
  const c = THEMES[theme];
  const start = stepPosition(model, from.index);
  const end = shipPosition(model);
  const [mx, my] = curve(start);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">${background(c, HEIGHT)}
    <text x="38" y="62" ${HUD} font-size="38" fill="#fff" letter-spacing="1">RAPPORT DE LA SEMAINE</text>
    <text x="40" y="92" ${LABEL} font-size="20" letter-spacing="2" fill="${c.b}">${escapeXml(`${label} · ${model.title}`.toUpperCase())}</text>
    <polyline points="${trail(0, 1)}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>
    ${end > 0 ? `<polyline points="${trail(0, end)}" fill="none" stroke="${c.a}" stroke-width="4" stroke-opacity=".45"/>` : ''}
    ${end > start ? `<polyline points="${trail(start, end)}" fill="none" stroke="${c.b}" stroke-width="6" filter="url(#glow)"/>` : ''}
    ${model.steps.map((step, k) => node(step, k, model, c)).join('')}
    <path d="M${mx.toFixed(1)} ${(my - 20).toFixed(1)} l-7 -12 h14 Z" fill="${c.b}"/>
    ${ship(end, 0, c)}
    ${validatedPanel(model, from, c)}${summaryPanel(model, from, total, c)}${boardPanel(board, boardTitle, c)}</svg>`;
}

/** La bannière publiée quand un système est validé. */
export function bannerSvg(step, next, { theme = 'orange' } = {}) {
  const c = THEMES[theme];
  const line = next ? `Prochaine étape : ${next.name} · ${next.goal}` : 'Route terminée';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${BANNER_HEIGHT}" width="${WIDTH}" height="${BANNER_HEIGHT}">${background(c, BANNER_HEIGHT)}
    <polygon points="${hexagon(100, 85, 44)}" fill="url(#done)" filter="url(#glow)"/>
    <path d="M80 86 L94 101 L122 70" fill="none" stroke="#17100a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="180" y="58" ${LABEL} font-size="22" letter-spacing="3" fill="${c.a}">SYSTÈME VALIDÉ · ${escapeXml(step.goal.toUpperCase())}</text>
    <text x="180" y="108" ${HUD} font-size="44" fill="#fff">${escapeXml(step.name)}</text>
    <text x="180" y="142" ${LABEL} font-size="22" fill="#c8c3d0">${escapeXml(line)}</text></svg>`;
}

// --- Rapport d'étape : un système validé, son classement définitif ---

/** Mérites au chiffre près, milliers séparés par une espace : « 1 234 567 ». */
const exact = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const MEDALS = ['#ffd24a', '#cfd6e4', '#d98a4a']; // or, argent, bronze
const PODIUM = 3;
const LISTED = 20; // rangs 4 à 23 sur l'image, en deux colonnes ; la liste complète est dans le texte du message

/** Confettis tirés une fois pour toutes (même image à chaque passage), surtout en haut et sur les côtés. */
function confetti(c) {
  let seed = 23;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const colors = [c.a, c.b, '#fff', '#ffd24a', c.flame];
  let out = '';
  for (let k = 0; k < 110; k++) {
    const x = rnd() * WIDTH;
    const y = rnd() * rnd() * 300;
    const w = 5 + rnd() * 9;
    const h = 3 + rnd() * 5;
    const color = colors[Math.floor(rnd() * colors.length)];
    out += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="${(0.35 + rnd() * 0.55).toFixed(2)}" transform="rotate(${(rnd() * 180).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
  }
  return out;
}

/**
 * Rapport d'étape, publié quand un système est validé : plus festif que la carte, avec le podium et le classement
 * définitif des mérites gagnés dans ce système. `board` : [{ cmdr, merits }] déjà trié ; `total` et `cmdrs` : somme et
 * nombre de commandants pour tout le système (au-delà de ce que l'image montre).
 */
export function stepReportSvg(step, next, { board = [], total = 0, cmdrs = board.length, theme = 'orange', number = null, count = null } = {}) {
  const c = THEMES[theme];
  const place = number && count ? `ÉTAPE ${number} SUR ${count} · ` : '';
  const after = next ? `Prochaine étape : ${next.name} · ${next.goal}` : 'Route terminée';
  const podium = board.slice(0, PODIUM).map((row, k) => {
    const y = 262 + k * 104;
    return `<circle cx="92" cy="${y + 34}" r="${k ? 30 : 34}" fill="${MEDALS[k]}" filter="url(#glow)"/>
      <text x="92" y="${y + 45}" text-anchor="middle" ${HUD} font-size="${k ? 28 : 32}" fill="#17100a">${k + 1}</text>
      <text x="146" y="${y + 30}" ${LABEL_BOLD} font-size="${k ? 28 : 34}" fill="#fff">${escapeXml(row.cmdr.slice(0, 22))}</text>
      <text x="146" y="${y + 62}" ${LABEL} font-size="24" fill="${MEDALS[k]}">${exact(row.merits)} mérites</text>`;
  }).join('');
  const rest = board.slice(PODIUM, PODIUM + LISTED);
  const rows = rest.map((row, k) => {
    const col = k < LISTED / 2 ? 0 : 1;
    const x = 592 + col * 288;
    const y = 262 + (k % (LISTED / 2)) * 33;
    return `<text x="${x}" y="${y}" ${HUD} font-size="15" fill="#a8a2b2">${k + PODIUM + 1}</text>
      <text x="${x + 30}" y="${y}" ${LABEL} font-size="20" fill="#fff">${escapeXml(row.cmdr.slice(0, 16))}</text>
      <text x="${x + 262}" y="${y}" text-anchor="end" ${LABEL} font-size="19" fill="${c.b}">${exact(row.merits)}</text>`;
  }).join('');
  const hidden = Math.max(0, cmdrs - PODIUM - rest.length);
  const more = hidden ? `<text x="1146" y="622" text-anchor="end" ${LABEL} font-size="18" fill="#a8a2b2">+ ${hidden} autre${hidden > 1 ? 's' : ''} : liste complète dans le message</text>` : '';
  const empty = board.length ? '' : `<text x="62" y="320" ${LABEL} font-size="24" fill="#c8c3d0">Aucun mérite enregistré dans ce système.</text>`;
  const alone = board.length && !rest.length ? `<text x="592" y="290" ${LABEL} font-size="21" fill="#a8a2b2">Tout le monde est sur le podium.</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">${background(c, HEIGHT)}${confetti(c)}
    <polygon points="${hexagon(96, 96, 54)}" fill="url(#done)" filter="url(#glow)"/>
    <path d="M72 98 L89 116 L123 78" fill="none" stroke="#17100a" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="180" y="62" ${LABEL} font-size="24" letter-spacing="3" fill="${c.a}" stroke="${c.bg}" stroke-width="5" paint-order="stroke">${escapeXml(`${place}SYSTÈME VALIDÉ · ${step.goal}`.toUpperCase())}</text>
    <text x="180" y="120" ${HUD} font-size="54" fill="#fff" stroke="${c.bg}" stroke-width="6" paint-order="stroke">${escapeXml(step.name)}</text>
    <text x="180" y="158" ${LABEL} font-size="23" fill="#c8c3d0" stroke="${c.bg}" stroke-width="5" paint-order="stroke">${escapeXml(after)}</text>
    <g transform="translate(1070 96) rotate(-12)"><g transform="rotate(${-SHIP_NOSE_DEG})"><image href="${SHIP_PNG}" x="${-SHIP_W * 0.7}" y="${(-SHIP_H * 0.7).toFixed(1)}" width="${SHIP_W * 1.4}" height="${(SHIP_H * 1.4).toFixed(1)}"/></g></g>
    ${panel(36, 196, 500, 448, c, 'PODIUM')}${podium}${empty}
    <text x="62" y="604" ${LABEL} font-size="21" fill="#c8c3d0">Total du système</text>
    <text x="62" y="630" ${LABEL_BOLD} font-size="25" fill="#fff">${exact(total)} mérites · ${cmdrs} commandant${cmdrs > 1 ? 's' : ''}</text>
    ${panel(560, 196, 604, 448, c, 'CLASSEMENT DÉFINITIF')}${rows}${alone}${more}</svg>`;
}

/**
 * Le même classement en texte, sous l'image : tous les commandants reçus (100 au plus), au mérite près. Les noms sont
 * écrits tels quels, sans mise en forme possible (caractères de Discord neutralisés), et le tout tient en 2 000
 * caractères : au-delà, les derniers sont comptés, pas listés.
 */
export function stepReportText(step, { board = [], total = 0, cmdrs = board.length } = {}) {
  const plain = (s) => String(s).replace(/[\\*_~`|>@#:[\]()]/g, (ch) => `\\${ch}`);
  const head = `**Classement définitif · ${plain(step.name)} (${plain(step.goal)})**`;
  const foot = `Total : ${exact(total)} mérites · ${cmdrs} commandant${cmdrs > 1 ? 's' : ''}`;
  if (!board.length) return `${head}\nAucun mérite enregistré dans ce système.`;
  const lines = [];
  let size = head.length + foot.length + 60;
  for (const [k, row] of board.entries()) {
    const line = `${k + 1}. ${plain(row.cmdr)} : ${exact(row.merits)}`;
    if (size + line.length + 1 > 1900) break;
    lines.push(line);
    size += line.length + 1;
  }
  const left = cmdrs - lines.length;
  return [head, ...lines, ...(left > 0 ? [`… et ${left} autre${left > 1 ? 's' : ''}`] : []), foot].join('\n');
}
