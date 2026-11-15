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

test('le classement d\'une semaine exclut ce qui suit sa fin et donne le total', async () => {
  const token = await member();
  await send(token, { at: '2026-11-01T10:00:00Z', merits: 100 });
  await send(token, { at: '2026-11-01T11:30:00Z', merits: 50 });
  const res = await call('/v1/leaderboard?since=2026-11-01T09:00:00Z&until=2026-11-01T11:00:00Z', { token: 'tracker' });
  assert.deepEqual(await res.json(), { leaderboard: [{ cmdr: 'Alpha', merits: 100 }], total: 100 });
});

test('le relevé du rapport hebdomadaire est gardé et validé', async () => {
  const put = (report) => call('/v1/state', { method: 'PUT', token: 'tracker', body: { messageId: '1', index: 2, report } });
  const report = { week: '2026-10-29', at: '2026-10-29T09:00:00Z', index: 2, done: 1500 };
  assert.equal((await put({ ...report, week: 'jeudi' })).status, 400);
  assert.equal((await put({ ...report, done: 'x' })).status, 400);
  assert.equal((await put({ ...report, extra: 'non' })).status, 200);
  const res = await call('/v1/state', { token: 'tracker' });
  assert.deepEqual((await res.json()).report, report);
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

// --- Inscription avec le mot de passe de l'escadron ---
const join = (body, ip = '203.0.113.1') =>
  handle(
    new Request('https://api.test/v1/join', {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
    NOW
  );

test('avec le bon mot de passe, un commandant s\'inscrit et reçoit un jeton qui marche', async () => {
  env.JOIN_PASSWORD = 'mot de passe du chef';
  const res = await join({ cmdr: 'Alpha', password: 'mot de passe du chef' });
  assert.equal(res.status, 200);
  const { cmdr, token } = await res.json();
  assert.equal(cmdr, 'Alpha');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await send(token)).status, 200);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 100 }]);
});

test('mauvais mot de passe, ou inscriptions fermées : refus', async () => {
  assert.equal((await join({ cmdr: 'Alpha', password: 'x' })).status, 404);
  env.JOIN_PASSWORD = 'bon';
  assert.equal((await join({ cmdr: 'Alpha', password: 'mauvais' })).status, 401);
  assert.equal((await join({ cmdr: 'Alpha' })).status, 400);
  assert.equal((await join({ cmdr: '', password: 'bon' })).status, 400);
  assert.equal((await join('pas du json')).status, 400);
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first().then((r) => r.n), 0);
});

test('les essais de mot de passe sont limités par adresse', async () => {
  env.JOIN_PASSWORD = 'bon';
  for (let i = 0; i < 10; i++) assert.equal((await join({ cmdr: 'A', password: `faux${i}` })).status, 401);
  assert.equal((await join({ cmdr: 'A', password: 'bon' })).status, 429);
  assert.equal((await join({ cmdr: 'A', password: 'bon' }, '203.0.113.2')).status, 200);
});

test('le chef liste les membres inscrits', async () => {
  await member('Bravo');
  await member('Alpha');
  assert.equal((await call('/admin/members', { token: 'faux' })).status, 401);
  const res = await call('/admin/members', { token: 'admin' });
  assert.deepEqual((await res.json()).members.map((m) => m.cmdr), ['Alpha', 'Bravo']);
});

test('le même nom rejoint plusieurs fois (app, plugin, PC réinstallé) : chaque jeton marche, un seul membre', async () => {
  env.JOIN_PASSWORD = 'bon';
  const a = (await (await join({ cmdr: 'Alpha', password: 'bon' })).json()).token;
  const res = await join({ cmdr: 'alpha', password: 'bon' }, '203.0.113.9');
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.cmdr, 'Alpha'); // le nom tel qu'inscrit la première fois
  assert.notEqual(a, b.token);
  assert.equal((await send(a)).status, 200);
  assert.equal((await send(b.token, { at: '2026-11-01T11:30:00Z' })).status, 200);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 200 }]);
  const list = await (await call('/admin/members', { token: 'admin' })).json();
  assert.deepEqual(list.members.map((m) => [m.cmdr, m.installations]), [['Alpha', 2]]);
});

test('au plus 10 installations par commandant : la 11e est refusée, personne ne purge les jetons d\'un membre', async () => {
  env.JOIN_PASSWORD = 'bon';
  const tokens = [];
  for (let i = 0; i < 10; i++) tokens.push((await (await join({ cmdr: 'Alpha', password: 'bon' }, `203.0.113.${i + 20}`)).json()).token);
  assert.equal((await join({ cmdr: 'Alpha', password: 'bon' }, '203.0.113.99')).status, 429);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM tokens').first()).n, 10);
  assert.equal((await send(tokens[0])).status, 200, 'le premier jeton marche toujours');
  // Le chef coupe les installations : les mérites restent, on peut rejoindre de nouveau
  assert.equal((await call('/admin/members/Alpha/tokens', { method: 'DELETE', token: 'admin' })).status, 200);
  assert.equal((await send(tokens[0], { at: '2026-11-01T11:40:00Z' })).status, 401);
  assert.deepEqual(await board(), [{ cmdr: 'Alpha', merits: 100 }]);
  assert.equal((await join({ cmdr: 'Alpha', password: 'bon' }, '203.0.113.98')).status, 200);
});

test('noms filtrés à l\'inscription : ni @, ni retour à la ligne, ni caractère de contrôle', async () => {
  env.JOIN_PASSWORD = 'bon';
  for (const bad of ['@everyone', 'Alpha\nBravo', '\u202eAlpha', ' Alpha', 'a'.repeat(41), '']) {
    assert.equal((await join({ cmdr: bad, password: 'bon' }, '203.0.113.50')).status, 400, JSON.stringify(bad));
  }
  for (const ok of ['Alpha', 'Jean-Luc Picard', "O'Neil", 'CMDR_42', 'Élodie.B']) {
    assert.equal((await join({ cmdr: ok, password: 'bon' }, '203.0.113.51')).status, 200, ok);
  }
});

test('le chef ferme et rouvre les inscriptions', async () => {
  env.JOIN_PASSWORD = 'bon';
  assert.deepEqual(await (await call('/admin/join', { token: 'admin' })).json(), { open: true });
  assert.equal((await call('/admin/join', { method: 'PUT', token: 'tracker', body: { open: false } })).status, 401);
  assert.equal((await call('/admin/join', { method: 'PUT', token: 'admin', body: { open: false } })).status, 200);
  assert.equal((await join({ cmdr: 'Alpha', password: 'bon' })).status, 403);
  await call('/admin/join', { method: 'PUT', token: 'admin', body: { open: true } });
  assert.equal((await join({ cmdr: 'Alpha', password: 'bon' }, '203.0.113.3')).status, 200);
});

test('retirer un membre coupe tous ses jetons', async () => {
  env.JOIN_PASSWORD = 'bon';
  const t = (await (await join({ cmdr: 'Alpha', password: 'bon' })).json()).token;
  assert.equal((await call('/admin/members/Alpha', { method: 'DELETE', token: 'admin' })).status, 200);
  assert.equal((await send(t)).status, 401);
});

// --- Route de l'escadron, sur le serveur ---
const ROUTE = {
  title: 'ROUTE TEST', power: 'Aisling Duval', since: '2026-11-01T00:00:00Z', meritsPerPoint: 4,
  stops: [{ name: 'Sol', goal: 'Consolidé', merits: 1880000 }, { name: 'Wolf 359', goal: 'Prise', merits: 480000, extra: 'non' }],
};

test('le chef publie la route ; le suivi, le chef et les membres la lisent ; versions successives', async () => {
  assert.deepEqual(await (await call('/v1/route', { token: 'tracker' })).json(), {});
  assert.equal((await call('/admin/route', { method: 'PUT', token: 'tracker', body: ROUTE })).status, 401);
  const put = await call('/admin/route', { method: 'PUT', token: 'admin', body: ROUTE });
  assert.equal(put.status, 200);
  const v1 = await put.json();
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.route.stops[1], { name: 'Wolf 359', goal: 'Prise', merits: 480000 });
  const token = await member();
  for (const t of ['tracker', 'admin', token]) assert.equal((await (await call('/v1/route', { token: t })).json()).version, 1);
  assert.equal((await call('/v1/route', { token: 'faux' })).status, 401);
  assert.equal((await call('/v1/route')).status, 401);
  const v2 = await (await call('/admin/route', { method: 'PUT', token: 'admin', body: { ...ROUTE, stops: [ROUTE.stops[0]] } })).json();
  assert.equal(v2.version, 2);
});

test('route invalide refusée', async () => {
  for (const bad of [{}, { ...ROUTE, stops: [] }, { ...ROUTE, stops: [{ name: 'X', goal: 'Domination', merits: 1 }] }, { ...ROUTE, since: 'jeudi' }]) {
    assert.equal((await call('/admin/route', { method: 'PUT', token: 'admin', body: bad })).status, 400);
  }
});

test('l\'état du suivi garde la clé de route et la date de recalage du relevé', async () => {
  const body = { messageId: '1', index: 0, routeKey: 'abcdef0123456789', report: { week: '2026-10-29', at: '2026-10-29T09:00:00Z', index: 0, done: 5, rebasedAt: '2026-10-30T10:00:00Z' } };
  assert.equal((await call('/v1/state', { method: 'PUT', token: 'tracker', body })).status, 200);
  assert.deepEqual(await (await call('/v1/state', { token: 'tracker' })).json(), body);
  assert.equal((await call('/v1/state', { method: 'PUT', token: 'tracker', body: { ...body, routeKey: 'pas une clé' } })).status, 400);
});
