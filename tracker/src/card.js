// Dessine la carte de suivi et la bannière de validation en SVG.

import { ageLabel } from './progress.js';

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

const curve = (t) => [75 + 1050 * t, 232 + 62 * Math.sin(t * 7.4 + 0.5)];
const slope = (t) => (Math.atan2(62 * 7.4 * Math.cos(t * 7.4 + 0.5), 1050) * 180) / Math.PI;

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
  return `<g ${done || current ? 'filter="url(#glow)"' : ''}>${shape}</g>${ring}
    <text x="${x}" y="${y + (current ? 50 : 38)}" text-anchor="middle" ${LABEL} font-size="${current ? 21 : 17}" fill="${color}" stroke="${c.bg}" stroke-width="4" paint-order="stroke">${escapeXml(step.short ?? step.name)}</text>`;
}

function shipPosition(model) {
  const last = model.steps.length - 1;
  if (model.index === 0) return 0;
  return model.current ? (model.index - 1 + model.frac) / last : 1;
}

/** phase va de 0 à 1 et boucle : le vaisseau flotte et sa flamme vacille. */
function ship(t, phase, c) {
  const [x, y] = curve(t);
  const hover = 5 * Math.sin(2 * Math.PI * phase);
  const tail = 66 + 16 * Math.sin(8 * Math.PI * phase);
  return `<g transform="translate(${x.toFixed(1)} ${(y - 36).toFixed(1)}) rotate(${slope(t).toFixed(1)}) scale(1.25)" filter="url(#glow)">
    <g transform="translate(0 ${hover.toFixed(2)})">
    <path d="M-${tail.toFixed(1)} -4 L-24 -3 L-24 3 L-${tail.toFixed(1)} 4 Z" fill="url(#flame)"/>
    <path d="M30 0 L4 -7 L-10 -19 L-24 -19 L-17 -6 L-25 -3 L-25 3 L-17 6 L-24 19 L-10 19 L4 7 Z" fill="#f3f0f7" stroke="${c.a}" stroke-width="1.5"/>
    <path d="M18 0 L2 -3.5 L-8 0 L2 3.5 Z" fill="${c.a}"/></g></g>`;
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
    ${model.steps.map((step, k) => node(step, k, model, c)).join('')}${ship(t, phase, c)}
    ${currentPanel(model, c)}${routePanel(model, c)}${boardPanel(board, boardTitle, c)}</svg>`;
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
