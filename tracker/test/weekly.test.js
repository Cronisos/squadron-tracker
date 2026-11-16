// Tests du rapport du jeudi et de la carte gardée sous les annonces.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { weekBoundary, weekLabel, weeklyStep } from '../src/weekly.js';
import { reportSvg } from '../src/card.js';
import { pngFrom } from '../src/render.js';
import { summarize } from '../src/progress.js';
import { update } from '../src/run.js';

const power = 'Aisling Duval';
const route = {
  title: 'ROUTE TEST', subtitle: 'A VERS C', power, meritsPerPoint: 4, since: '2026-10-01T00:00:00Z', theme: 'orange',
  stops: [
    { name: 'A', goal: 'Consolidé', merits: 1_880_000 },
    { name: 'B', goal: 'Forteresse', merits: 4_480_000 },
    { name: 'C', goal: 'Prise', merits: 480_000 },
  ],
};
const at = { updated_at: '2026-11-05T08:00:00Z' };
const captured = { ...at, controlling_power: power, power_state: 'Fortified' };
const modelWith = (...records) => summarize(route, records, Date.parse('2026-11-05T10:00:00Z'));

test('la semaine commence le jeudi à 9 h UTC', () => {
  const key = (value) => new Date(weekBoundary(Date.parse(value))).toISOString();
  assert.equal(key('2026-11-05T09:00:00Z'), '2026-11-05T09:00:00.000Z');
  assert.equal(key('2026-11-05T08:59:00Z'), '2026-10-29T09:00:00.000Z');
  assert.equal(key('2026-11-01T12:00:00Z'), '2026-10-29T09:00:00.000Z');
  assert.equal(key('2026-11-11T23:00:00Z'), '2026-11-05T09:00:00.000Z');
});

test('premier passage : un relevé de départ, sans rapport', () => {
  const step = weeklyStep(undefined, modelWith(at, at, at), Date.parse('2026-11-01T12:00:00Z'));
  assert.equal(step.due, false);
  assert.equal(step.snapshot.week, '2026-10-29');
});

test('nouvelle semaine : un seul rapport, comparé au relevé précédent', () => {
  const previous = { week: '2026-10-29', at: '2026-10-29T09:00:00Z', index: 0, done: 10 };
  const now = Date.parse('2026-11-05T10:00:00Z');
  const step = weeklyStep(previous, modelWith(captured, at, at), now);
  assert.equal(step.due, true);
  assert.equal(step.from, previous);
  assert.equal(step.snapshot.index, 1);
  assert.equal(weeklyStep(step.snapshot, modelWith(captured, at, at), now + 900_000).due, false);
});

test('le libellé couvre la semaine', () => {
  assert.equal(weekLabel('2026-10-29T09:00:00Z', '2026-11-05T09:00:00Z'), 'Du 29 octobre au 5 novembre');
});

test('le rapport liste les systèmes validés, ou le dit s\'il n\'y en a aucun', () => {
  const from = { index: 0, done: 0 };
  const options = { from, label: 'Du 1 au 8', board: [{ cmdr: '<x>', merits: 5000 }], total: 5000 };
  const svg = reportSvg(modelWith(captured, at, at), options);
  assert.match(svg, /SYSTÈMES VALIDÉS : 1/);
  assert.ok(!svg.includes('<x>'));
  assert.ok(pngFrom(svg).length > 1000);
  assert.match(reportSvg(modelWith(at, at, at), options), /Aucun cette semaine/);
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Simule Spansh, l'API et Discord, et note les appels Discord dans l'ordre. */
function fakeServices(records, state, { serverRoute = null, parSysteme = false, contenus = [] } = {}) {
  const log = [];
  let nextId = 100;
  globalThis.fetch = async (url, init = {}) => {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const text = String(url);
    if (text.includes('spansh')) {
      const name = decodeURIComponent(text.split('q=')[1]);
      const stops = (serverRoute?.route ?? route).stops;
      const k = stops.findIndex((s) => s.name === name);
      return json({ results: [{ record: { name, ...records[k] } }] });
    }
    if (text.includes('/v1/route')) return serverRoute ? json(serverRoute) : json({ error: 404 }, 404);
    if (text.includes('/v1/leaderboard')) {
      // Serveur à jour : il classe par système et le redit ; serveur d'avant : il ignore la demande
      const system = new URL(text).searchParams.get('system');
      return json({ leaderboard: [{ cmdr: 'Alpha', merits: 900 }], total: 900, ...(system && parSysteme ? { cmdrs: 1, system } : {}) });
    }
    if (text.includes('/v1/state')) {
      if (init.method === 'PUT') { Object.assign(state, JSON.parse(init.body)); return json({ ok: true }); }
      return json(state);
    }
    log.push(init.method === 'POST' ? `POST ${init.body.get('files[0]').name}` : `${init.method} ${text.split('/').pop()}`);
    if (init.method === 'POST') contenus.push(JSON.parse(init.body.get('payload_json')).content ?? null);
    return init.method === 'POST' ? json({ id: String(nextId++) }) : new Response(null, { status: init.method === 'DELETE' ? 204 : 200 });
  };
  return log;
}
const env = { ROUTE_JSON: JSON.stringify(route), DISCORD_WEBHOOK_URL: 'https://hook', API_URL: 'https://api', TRACKER_TOKEN: 't' };
const NOW = Date.parse('2026-11-05T10:00:00Z');

test('sans annonce : la carte est modifiée sur place, sans nouveau message', async () => {
  const report = { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 };
  const state = { messageId: '7', index: 0, report };
  const log = fakeServices([at, at, at], state);
  await update(env, NOW);
  assert.deepEqual(log, ['PATCH 7']);
  assert.equal(state.messageId, '7');
});

test('système validé et rapport : la carte finit sous les annonces', async () => {
  const state = { messageId: '7', index: 0, report: { week: '2026-10-29', at: '2026-10-29T09:00:00Z', index: 0, done: 0 } };
  const log = fakeServices([captured, at, at], state);
  await update(env, NOW);
  assert.deepEqual(log, ['POST annonce-0.png', 'POST annonce-1.png', 'POST route.gif', 'DELETE 7']);
  assert.equal(state.messageId, '102');
  assert.equal(state.index, 1);
  assert.equal(state.report.week, '2026-11-05');
});

test('un second passage ne republie ni bannière ni rapport', async () => {
  const state = { messageId: '7', index: 0, report: { week: '2026-10-29', at: '2026-10-29T09:00:00Z', index: 0, done: 0 } };
  const log = fakeServices([captured, at, at], state);
  await update(env, NOW);
  log.length = 0;
  await update(env, NOW + 900_000);
  assert.deepEqual(log, ['PATCH 102']);
});

test('premier passage après la mise en place : relevé enregistré, aucun rapport', async () => {
  const state = { messageId: '7', index: 0 };
  const log = fakeServices([at, at, at], state);
  await update(env, NOW);
  assert.deepEqual(log, ['PATCH 7']);
  assert.equal(state.report.week, '2026-11-05');
});

// --- Route lue sur le serveur, et changement de route en cours de semaine ---
const { routeKey } = await import('../src/run.js');

test('la route du serveur passe avant le secret ROUTE_JSON', async () => {
  const other = { ...route, stops: [route.stops[0], { name: 'D', goal: 'Prise', merits: 480_000 }] };
  const report = { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 };
  const state = { messageId: '7', index: 0, routeKey: routeKey(other), report };
  const log = fakeServices([at, at], state, { serverRoute: { route: other, version: 3 } });
  await update(env, NOW);
  assert.deepEqual(log, ['PATCH 7']);
  assert.equal(state.routeKey, routeKey(other));
});

test('route changée (système remplacé) : pas de fausse bannière, relevé de la semaine recalé', async () => {
  // Avant : A (en cours), B, C. Après : le système 2 remplacé par D, déjà tenu : l'index saute à 2 sans rien valider
  const before = { messageId: '7', index: 0, routeKey: routeKey(route), report: { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 } };
  const changed = { ...route, stops: [route.stops[0], { name: 'D', goal: 'Prise', merits: 480_000 }, route.stops[2]] };
  const log = fakeServices([captured, captured, at], before, { serverRoute: { route: changed, version: 2 } });
  await update(env, NOW);
  assert.deepEqual(log, ['PATCH 7'], 'aucune bannière ni rapport');
  assert.equal(before.index, 2);
  assert.equal(before.routeKey, routeKey(changed));
  assert.equal(before.report.index, 2);
  assert.equal(before.report.rebasedAt, '2026-11-05T10:00:00Z');
  assert.equal(before.report.week, '2026-11-05');
});

test('ancien état sans clé de route : adopté sans recalage', async () => {
  const state = { messageId: '7', index: 0, report: { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 } };
  const log = fakeServices([at, at, at], state);
  await update(env, NOW);
  assert.deepEqual(log, ['PATCH 7']);
  assert.equal(state.routeKey, routeKey(route));
  assert.equal(state.report.rebasedAt, undefined);
});

test('le titre seul ne change pas la clé de route', () => {
  assert.equal(routeKey({ ...route, title: 'AUTRE' }), routeKey(route));
  assert.notEqual(routeKey({ ...route, stops: route.stops.slice(1) }), routeKey(route));
});

test('système validé, serveur à jour : rapport d\'étape avec le classement définitif en texte', async () => {
  const state = { messageId: '7', index: 0, report: { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 } };
  const contenus = [];
  const log = fakeServices([captured, at, at], state, { parSysteme: true, contenus });
  await update(env, NOW);
  assert.deepEqual(log, ['POST annonce-0.png', 'POST route.gif', 'DELETE 7']);
  assert.match(contenus[0], /Classement définitif/);
  assert.match(contenus[0], /1\. Alpha : 900/);
  assert.match(contenus[0], /Total : 900 mérites · 1 commandant$/);
  assert.equal(contenus[1], null, 'la carte, elle, n\'a pas de texte');
});

test('système validé, serveur d\'avant : la simple bannière, sans classement', async () => {
  const state = { messageId: '7', index: 0, report: { week: '2026-11-05', at: '2026-11-05T09:00:00Z', index: 0, done: 0 } };
  const contenus = [];
  fakeServices([captured, at, at], state, { contenus });
  await update(env, NOW);
  assert.equal(contenus[0], null);
});
