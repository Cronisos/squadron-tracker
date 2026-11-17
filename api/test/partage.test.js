// Partage entre membres : rôles, installations à confirmer, partages adressés. Vraie base SQLite, schéma de production.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../src/index.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');

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
let ip = 0;
const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await handle(
    new Request(`https://api.test${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'cf-connecting-ip': `203.0.113.${(ip += 1) % 250}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    NOW
  );
  return { status: res.status, json: await res.json() };
};
const admin = (path, options = {}) => call(path, { ...options, token: 'admin' });
/** Un membre inscrit avec le code de l'escadron : son jeton. */
const join = async (cmdr) => (await call('/v1/join', { method: 'POST', body: { cmdr, password: 'code' } })).json;
const REPERE = { kind: 'repere-rhino', ref: 'r1', title: 'Filon de platine', data: { system: 'Système Test', lat: 1.5, lon: -2 } };
const share = (token, to, extra = {}) => call('/v1/shares', { method: 'PUT', token, body: { ...REPERE, to, ...extra } });
const seen = async (token) => (await call('/v1/shares', { token })).json.shares.map((s) => `${s.cmdr}:${s.ref}`).sort();

const ROLES = [{ id: 'recrue', name: 'Recrue', rank: 10 }, { id: 'lieutenant', name: 'Lieutenant', rank: 50 }, { id: 'amiral', name: 'Amiral', rank: 90 }];

beforeEach(() => {
  env = { DB: fakeD1(), ADMIN_TOKEN: 'admin', TRACKER_TOKEN: 'tracker', JOIN_PASSWORD: 'code' };
});

test('partage à tout l’escadron : lu par les autres membres, pas sans jeton', async () => {
  const a = (await join('Alpha')).token;
  const b = (await join('Bravo')).token;
  assert.equal((await share(a, { all: true })).status, 200);
  assert.deepEqual(await seen(b), ['Alpha:r1']);
  const lu = (await call('/v1/shares', { token: b })).json.shares[0];
  assert.deepEqual(lu.data, REPERE.data);
  assert.equal(lu.mine, false);
  assert.equal((await call('/v1/shares')).status, 401);
  assert.equal((await call('/v1/shares', { token: 'faux' })).status, 401);
});

test('le même (kind, ref) remplace le partage au lieu d’en créer un second', async () => {
  const a = (await join('Alpha')).token;
  await share(a, { all: true });
  await share(a, { all: true }, { title: 'Filon corrigé' });
  const { shares } = (await call('/v1/shares', { token: a })).json;
  assert.equal(shares.length, 1);
  assert.equal(shares[0].title, 'Filon corrigé');
  assert.equal(shares[0].mine, true);
});

test('partage par rôle : ce rôle et au-dessus seulement', async () => {
  const [alpha, recrue, lieutenant, amiral, sansRole] = await Promise.all(['Alpha', 'Recrue1', 'Lieut1', 'Amiral1', 'Libre'].map(async (n) => (await join(n)).token));
  assert.equal((await admin('/admin/roles', { method: 'PUT', body: { roles: ROLES } })).status, 200);
  for (const [cmdr, role] of [['Recrue1', 'recrue'], ['Lieut1', 'lieutenant'], ['Amiral1', 'amiral']]) {
    assert.equal((await admin(`/admin/members/${cmdr}/role`, { method: 'PUT', body: { role } })).status, 200);
  }
  assert.equal((await share(alpha, { role: 'lieutenant' })).status, 200);
  assert.deepEqual(await seen(recrue), []);
  assert.deepEqual(await seen(sansRole), []);
  assert.deepEqual(await seen(lieutenant), ['Alpha:r1']);
  assert.deepEqual(await seen(amiral), ['Alpha:r1']);
  assert.deepEqual(await seen(alpha), ['Alpha:r1']); // l'auteur garde le sien, même sans le rôle
  // Rôle inconnu : refusé
  assert.equal((await share(alpha, { role: 'inconnu' })).status, 400);
  // Rôle retiré à un membre : il ne lit plus
  await admin('/admin/members/Lieut1/role', { method: 'PUT', body: { role: null } });
  assert.deepEqual(await seen(lieutenant), []);
});

test('partage à des personnes précises : elles seules, et la liste des destinataires reste à l’auteur', async () => {
  const a = (await join('Alpha')).token;
  const b = (await join('Bravo')).token;
  const c = (await join('Charlie')).token;
  assert.equal((await share(a, { cmdrs: ['bravo'] })).status, 200); // la casse ne compte pas
  assert.deepEqual(await seen(b), ['Alpha:r1']);
  assert.deepEqual(await seen(c), []);
  assert.equal((await call('/v1/shares', { token: b })).json.shares[0].to, undefined);
  assert.deepEqual((await call('/v1/shares', { token: a })).json.shares[0].to, ['Bravo']);
  // Quelqu'un qui n'est pas membre : refusé
  assert.equal((await share(a, { cmdrs: ['Inconnu'] })).status, 400);
  assert.equal((await share(a, { cmdrs: [] })).status, 400);
  // Changer de destinataires : l'ancien ne lit plus
  await share(a, { cmdrs: ['Charlie'] });
  assert.deepEqual(await seen(b), []);
  assert.deepEqual(await seen(c), ['Alpha:r1']);
});

test('la clé du chef ne lit aucun partage', async () => {
  const a = (await join('Alpha')).token;
  await join('Bravo');
  await share(a, { cmdrs: ['Bravo'] });
  assert.equal((await admin('/v1/shares')).status, 401);
  assert.equal((await call('/v1/shares', { token: 'tracker' })).status, 401);
  assert.equal((await admin('/admin/shares')).status, 404);
  const membres = (await admin('/admin/members')).json.members;
  assert.ok(membres.every((m) => !('shares' in m)));
});

test('seul l’auteur retire son partage ; le chef peut en retirer un par son identifiant', async () => {
  const a = (await join('Alpha')).token;
  const b = (await join('Bravo')).token;
  const { id } = (await share(a, { all: true })).json;
  assert.equal((await call(`/v1/shares/${id}`, { method: 'DELETE', token: b })).status, 404);
  assert.deepEqual(await seen(b), ['Alpha:r1']);
  assert.equal((await call(`/v1/shares/${id}`, { method: 'DELETE', token: a })).status, 200);
  assert.deepEqual(await seen(b), []);
  const autre = (await share(a, { all: true })).json.id;
  assert.equal((await admin(`/admin/shares/${autre}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await seen(a), []);
  assert.equal((await call('/v1/shares/pas-un-id', { method: 'DELETE', token: a })).status, 400);
});

test('une installation de plus sous un nom déjà inscrit ne lit rien avant d’être confirmée', async () => {
  const premier = await join('Alpha');
  assert.equal(premier.pending, false);
  const b = (await join('Bravo')).token;
  await share(b, { cmdrs: ['Alpha'] });
  // Quelqu'un qui a le code de l'escadron se réinscrit « Alpha »
  const second = await join('Alpha');
  assert.equal(second.pending, true);
  const refus = await call('/v1/shares', { token: second.token });
  assert.equal(refus.status, 403);
  assert.equal(refus.json.pending, true);
  assert.equal((await call('/v1/members', { token: second.token })).status, 403);
  assert.equal((await share(second.token, { all: true })).status, 403);
  // Ses mérites, eux, partent toujours
  const merites = await call('/v1/merits', { method: 'POST', token: second.token, body: { cmdr: 'Alpha', system: 'Sol', merits: 10, at: '2026-11-16T11:00:00Z' } });
  assert.equal(merites.status, 200);
  // Elle ne peut pas se confirmer elle-même ; la première installation le peut
  const moi = (await call('/v1/me', { token: premier.token })).json;
  const attente = moi.installations.find((i) => i.pending);
  assert.equal(moi.installations.length, 2);
  assert.equal((await call(`/v1/installations/${attente.id}/approve`, { method: 'POST', token: second.token })).status, 403);
  assert.equal((await call(`/v1/installations/${attente.id}/approve`, { method: 'POST', token: premier.token })).status, 200);
  assert.deepEqual(await seen(second.token), ['Bravo:r1']);
});

test('le chef confirme les installations en attente d’un membre, et les voit dans sa liste', async () => {
  await join('Alpha');
  const second = await join('Alpha');
  let alpha = (await admin('/admin/members')).json.members.find((m) => m.cmdr === 'Alpha');
  assert.equal(alpha.pending, 1);
  assert.equal((await admin('/admin/members/Alpha/approve', { method: 'POST' })).status, 200);
  alpha = (await admin('/admin/members')).json.members.find((m) => m.cmdr === 'Alpha');
  assert.equal(alpha.pending, 0);
  assert.equal((await call('/v1/shares', { token: second.token })).status, 200);
});

test('un nom déjà inscrit par le chef : l’inscription par le code attend aussi', async () => {
  await admin('/admin/members', { method: 'POST', body: { cmdr: 'Alpha' } });
  assert.equal((await join('Alpha')).pending, true);
});

test('rôles : le chef seul, liste vérifiée, un rôle retiré quitte ses membres', async () => {
  const a = (await join('Alpha')).token;
  assert.equal((await call('/admin/roles', { method: 'PUT', token: a, body: { roles: ROLES } })).status, 401);
  for (const roles of [[{ id: 'A B', name: 'x', rank: 1 }], [{ id: 'a', name: '', rank: 1 }], [{ id: 'a', name: 'x', rank: -1 }], [{ id: 'a', name: 'x', rank: 1 }, { id: 'a', name: 'y', rank: 2 }], 'non']) {
    assert.equal((await admin('/admin/roles', { method: 'PUT', body: { roles } })).status, 400, JSON.stringify(roles));
  }
  await admin('/admin/roles', { method: 'PUT', body: { roles: ROLES } });
  await admin('/admin/members/Alpha/role', { method: 'PUT', body: { role: 'amiral' } });
  assert.equal((await admin('/admin/members/Inconnu/role', { method: 'PUT', body: { role: 'amiral' } })).status, 404);
  assert.equal((await admin('/admin/members/Alpha/role', { method: 'PUT', body: { role: 'inconnu' } })).status, 400);
  const liste = (await call('/v1/members', { token: a })).json;
  assert.deepEqual(liste.members, [{ cmdr: 'Alpha', role: 'amiral', keys: [] }]);
  assert.deepEqual(liste.roles.map((r) => r.id), ['amiral', 'lieutenant', 'recrue']); // du plus haut au plus bas
  assert.equal((await call('/v1/me', { token: a })).json.role.id, 'amiral');
  await admin('/admin/roles', { method: 'PUT', body: { roles: ROLES.slice(0, 2) } });
  assert.equal((await call('/v1/me', { token: a })).json.role, null);
});

test('partage mal formé ou trop gros : refusé', async () => {
  const a = (await join('Alpha')).token;
  assert.equal((await share(a, { all: true }, { kind: 'Pas Bon' })).status, 400);
  assert.equal((await share(a, { all: true }, { ref: '' })).status, 400);
  assert.equal((await share(a, { all: true }, { title: 'x'.repeat(81) })).status, 400);
  assert.equal((await share(a, { all: true }, { data: [1] })).status, 400);
  assert.equal((await share(a, {})).status, 400);
  assert.equal((await share(a, { all: true }, { data: { gros: 'x'.repeat(9000) } })).status, 413);
});

test('un membre retiré : ses partages et ce qui lui était adressé partent avec lui', async () => {
  const a = (await join('Alpha')).token;
  const b = (await join('Bravo')).token;
  await share(a, { all: true });
  await share(b, { cmdrs: ['Alpha'] }, { ref: 'r2' });
  assert.equal((await admin('/admin/members/Alpha', { method: 'DELETE' })).status, 200);
  assert.deepEqual(await seen(b), ['Bravo:r2']);
  const reste = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_targets').first();
  assert.equal(reste.n, 0);
  assert.equal((await call('/v1/shares', { token: a })).status, 401);
});

test('clés publiques : chaque installation publie la sienne, les membres les voient ; partage chiffré jusqu’à 24 Ko', async () => {
  const cle = (n) => `${String(n).repeat(43)}=`;
  const alpha = (await join('Alpha')).token;
  const bravo = (await join('Bravo')).token;
  assert.equal((await call('/v1/key', { method: 'PUT', token: alpha, body: { key: cle('A') } })).status, 200);
  assert.equal((await call('/v1/key', { method: 'PUT', token: alpha, body: { key: cle('B') } })).status, 200, 'remplace la précédente');
  assert.equal((await call('/v1/key', { method: 'PUT', token: bravo, body: { key: cle('C') } })).status, 200);
  for (const mauvais of [{}, { key: 'courte' }, { key: `${'A'.repeat(44)}` }, { key: 42 }]) {
    assert.equal((await call('/v1/key', { method: 'PUT', token: alpha, body: mauvais })).status, 400, JSON.stringify(mauvais));
  }
  assert.equal((await call('/v1/key', { method: 'PUT', body: { key: cle('A') } })).status, 401, 'sans jeton');
  assert.equal((await call('/v1/key', { token: alpha })).status, 405);
  const { members } = (await call('/v1/members', { token: bravo })).json;
  assert.deepEqual(members.find((m) => m.cmdr === 'Alpha').keys, [cle('B')]);
  assert.deepEqual(members.find((m) => m.cmdr === 'Bravo').keys, [cle('C')]);
  // Une seconde installation au même nom attend sa confirmation : sa clé n'est pas distribuée, elle ne peut pas en publier
  const second = (await join('Alpha')).token;
  assert.equal((await call('/v1/key', { method: 'PUT', token: second, body: { key: cle('D') } })).status, 403);
  // Partage chiffré : le serveur range l'enveloppe telle quelle, et accepte plus gros qu'un partage en clair
  const enveloppe = { e2e: 1, eph: cle('E'), iv: 'aXY=', ct: 'x'.repeat(12_000), cles: [{ a: '0123456789abcdef', iv: 'aXY=', w: 'dw==' }] };
  assert.equal((await share(alpha, { cmdrs: ['Bravo'] }, { title: 'Partage chiffré', data: enveloppe })).status, 200);
  const recu = (await call('/v1/shares', { token: bravo })).json.shares.find((s) => s.ref === 'r1');
  assert.deepEqual(recu.data, enveloppe);
  assert.equal((await share(alpha, { cmdrs: ['Bravo'] }, { data: { ...enveloppe, ct: 'x'.repeat(25_000) } })).status, 413);
  assert.equal((await share(alpha, { cmdrs: ['Bravo'] }, { data: { texte: 'x'.repeat(12_000) } })).status, 413, 'en clair : toujours 8 Ko');
  // Membre retiré : ses clés ne sont plus distribuées
  await admin('/admin/members/Bravo', { method: 'DELETE' });
  assert.ok(!(await call('/v1/members', { token: alpha })).json.members.some((m) => m.cmdr === 'Bravo'));
});
