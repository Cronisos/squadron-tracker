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
function fakeServices(records, state) {
  const log = [];
  let nextId = 100;
  globalThis.fetch = async (url, init = {}) => {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    const text = String(url);
    if (text.includes('spansh')) {
      const name = decodeURIComponent(text.split('q=')[1]);
      const k = route.stops.findIndex((s) => s.name === name);
      return json({ results: [{ record: { name, ...records[k] } }] });
    }
    if (text.includes('/v1/leaderboard')) return json({ leaderboard: [{ cmdr: 'Alpha', merits: 900 }], total: 900 });
    if (text.includes('/v1/state')) {
      if (init.method === 'PUT') { Object.assign(state, JSON.parse(init.body)); return json({ ok: true }); }
      return json(state);
    }
    log.push(init.method === 'POST' ? `POST ${init.body.get('files[0]').name}` : `${init.method} ${text.split('/').pop()}`);
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
