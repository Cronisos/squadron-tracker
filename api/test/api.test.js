// Tests de l'API sur une vraie base SQLite, avec le même schéma qu'en production.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, validMerits } from '../src/index.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const AT = '2026-11-01T11:00:00Z';

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => sqlite.prepare(sql).run(...args),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

let env;
const call = (path, { method = 'GET', token, body } = {}) =>
  handle(
    new Request(`https://api.test${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    NOW
  );

async function member(cmdr = 'Alpha') {
  const res = await call('/admin/members', { method: 'POST', token: 'admin', body: { cmdr } });
  return (await res.json()).token;
}
const send = (token, extra = {}) =>
  call('/v1/merits', { method: 'POST', token, body: { cmdr: 'Alpha', system: 'Sol', merits: 100, at: AT, ...extra } });
const board = async () =>
  (await (await call('/v1/leaderboard', { token: 'tracker' })).json()).leaderboard;

beforeEach(() => {
  env = { DB: fakeD1(), ADMIN_TOKEN: 'admin', TRACKER_TOKEN: 'tracker' };
});

test('des mérites valides arrivent au classement', async () => {
  const token = await member();
  assert.equal((await send(token)).status, 200);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 100 }]);
});

test('un jeton fait 43 caractères et seule son empreinte est stockée', async () => {
  const token = await member();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = await env.DB.prepare('SELECT token_hash FROM members').first();
  assert.notEqual(row.token_hash, token);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
});

test('un renvoi du même événement ne compte qu\'une fois', async () => {
  const token = await member();
  await send(token);
  await send(token);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 100 }]);
});

test('sans jeton ou avec un mauvais jeton : refus', async () => {
  await member();
  assert.equal((await send(undefined)).status, 401);
  assert.equal((await send('faux')).status, 401);
});

test('un jeton ne peut pas créditer un autre commandant', async () => {
  const token = await member();
  assert.equal((await send(token, { cmdr: 'Bravo' })).status, 403);
  assert.deepEqual(await board(), []);
});

test('les valeurs hors limites sont refusées', async () => {
  const token = await member();
  for (const extra of [{ merits: 0 }, { merits: -5 }, { merits: 1.5 }, { merits: '10' }, { merits: 1_000_001 }, { at: 'hier' }, { at: '2026-11-02T12:00:00Z' }, { at: '2026-09-01T12:00:00Z' }, { system: 'x'.repeat(65) }]) {
    assert.equal((await send(token, extra)).status, 400, JSON.stringify(extra));
  }
});

test('du JSON invalide ou trop gros est refusé', async () => {
  const token = await member();
  assert.equal((await call('/v1/merits', { method: 'POST', token, body: '{oups' })).status, 400);
  assert.equal((await call('/v1/merits', { method: 'POST', token, body: 'x'.repeat(2000) })).status, 413);
});

test('le nombre de requêtes par minute est limité', async () => {
  const token = await member();
  let last;
  for (let i = 0; i < 121; i++) last = await send(token);
  assert.equal(last.status, 429);
});

test('révoquer un membre coupe son jeton et efface ses mérites', async () => {
  const token = await member();
  await send(token);
  await call('/admin/members/Alpha', { method: 'DELETE', token: 'admin' });
  assert.equal((await send(token)).status, 401);
  assert.deepEqual(await board(), []);
});

test('un nouveau jeton remplace l\'ancien sans perdre les mérites', async () => {
  const old = await member();
  await send(old);
  const fresh = await member();
  assert.equal((await send(old)).status, 401);
  assert.equal((await send(fresh, { at: '2026-11-01T11:30:00Z' })).status, 200);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 200 }]);
});

test('classement et administration exigent le bon secret', async () => {
  assert.equal((await call('/v1/leaderboard', { token: 'admin' })).status, 401);
  assert.equal((await call('/admin/members', { method: 'POST', token: 'tracker', body: { cmdr: 'A' } })).status, 401);
  assert.equal((await call('/admin/members/Alpha', { method: 'DELETE' })).status, 401);
});

test('un membre ne peut pas lire le classement avec son jeton', async () => {
  assert.equal((await call('/v1/leaderboard', { token: await member() })).status, 401);
});

test('le classement respecte la date de départ', async () => {
  const token = await member();
  await send(token);
  const res = await call('/v1/leaderboard?since=2026-11-01T11:30:00Z', { token: 'tracker' });
  assert.deepEqual((await res.json()).leaderboard, []);
});

test('l\'état du suivi est gardé et validé', async () => {
  const put = (body) => call('/v1/state', { method: 'PUT', token: 'tracker', body });
  assert.equal((await put({ messageId: 'abc', index: 1 })).status, 400);
  assert.equal((await put({ messageId: '123', index: 2 })).status, 200);
  const res = await call('/v1/state', { token: 'tracker' });
  assert.deepEqual(await res.json(), { messageId: '123', index: 2 });
});

test('les adresses inconnues répondent 404', async () => {
  assert.equal((await call('/')).status, 404);
  assert.equal((await call('/v1/merits')).status, 404);
});

test('une panne de base ne révèle aucun détail', async () => {
  env.DB = { prepare() { throw new Error('secret interne'); } };
  const res = await send('x');
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 500 });
});

test('validMerits retire les champs non prévus', () => {
  const entry = validMerits({ cmdr: 'A', system: 'S', merits: 1, at: AT, extra: 'non' }, NOW);
  assert.deepEqual(Object.keys(entry), ['cmdr', 'system', 'merits', 'at']);
});
