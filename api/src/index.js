// API du tableau de squadron : reçoit les mérites des plugins et sert le classement au générateur.

const MAX_BODY = 1024;
const MAX_STATE = 4096;
const MAX_MERITS = 1_000_000; // un seul gain de mérites, largement au-dessus des ventes observées
const MAX_PER_MINUTE = 120;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_AHEAD_MS = 5 * 60 * 1000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const reply = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  });
const fail = (status) => reply(status, { error: status });

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison à durée constante, sur les empreintes pour masquer aussi la longueur. */
async function sameSecret(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(request, limit) {
  const text = await request.text();
  if (text.length > limit) return { tooLarge: true };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return {};
  }
}

const isName = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Renvoie le message nettoyé, ou null s'il ne respecte pas le format attendu. */
export function validMerits(body, now) {
  if (!body || typeof body !== 'object') return null;
  const { cmdr, system, merits, at } = body;
  if (!isName(cmdr, 64) || typeof system !== 'string' || system.length > 64) return null;
  if (!Number.isInteger(merits) || merits < 1 || merits > MAX_MERITS) return null;
  if (typeof at !== 'string' || !TIMESTAMP.test(at)) return null;
  const time = Date.parse(at);
  if (Number.isNaN(time) || time > now + MAX_AHEAD_MS || time < now - MAX_AGE_MS) return null;
  return { cmdr, system, merits, at };
}

async function underRateLimit(env, tokenHash, now) {
  const minute = Math.floor(now / 60000);
  await env.DB.prepare('DELETE FROM rate WHERE minute < ?').bind(minute - 1).run();
  const row = await env.DB.prepare(
    `INSERT INTO rate (token_hash, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (token_hash, minute) DO UPDATE SET count = count + 1 RETURNING count`
  ).bind(tokenHash, minute).first();
  return row.count <= MAX_PER_MINUTE;
}

async function postMerits(request, env, now) {
  const tokenHash = await sha256(bearer(request));
  const member = await env.DB.prepare('SELECT cmdr FROM members WHERE token_hash = ?').bind(tokenHash).first();
  if (!member) return fail(401);
  if (!(await underRateLimit(env, tokenHash, now))) return fail(429);
  const { body, tooLarge } = await readJson(request, MAX_BODY);
  if (tooLarge) return fail(413);
  const entry = validMerits(body, now);
  if (!entry) return fail(400);
  // Le jeton appartient à un seul commandant : il ne peut pas créditer quelqu'un d'autre
  if (entry.cmdr.toLowerCase() !== member.cmdr.toLowerCase()) return fail(403);
  const id = await sha256(`${member.cmdr}|${entry.at}|${entry.merits}`);
  await env.DB.prepare('INSERT OR IGNORE INTO merits (id, cmdr, system, merits, at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, member.cmdr, entry.system, entry.merits, entry.at)
    .run();
  return reply(200, { ok: true });
}

async function getLeaderboard(url, env) {
  const since = url.searchParams.get('since') || '1970-01-01T00:00:00Z';
  const until = url.searchParams.get('until') || '9999-12-31T23:59:59Z';
  if (!TIMESTAMP.test(since) || !TIMESTAMP.test(until)) return fail(400);
  const { results } = await env.DB.prepare(
    `SELECT cmdr, SUM(merits) AS merits FROM merits WHERE at >= ? AND at < ?
     GROUP BY cmdr ORDER BY merits DESC, cmdr ASC LIMIT 10`
  ).bind(since, until).all();
  const sum = await env.DB.prepare('SELECT COALESCE(SUM(merits), 0) AS total FROM merits WHERE at >= ? AND at < ?')
    .bind(since, until)
    .first();
  return reply(200, { leaderboard: results, total: sum.total });
}

function validReport(report) {
  if (report === undefined) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(report?.week) && TIMESTAMP.test(report.at)
    && Number.isInteger(report.index) && Number.isFinite(report.done);
}

async function getState(env) {
  const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'tracker'").first();
  return reply(200, row ? JSON.parse(row.value) : {});
}

async function putState(request, env) {
  const { body, tooLarge } = await readJson(request, MAX_STATE);
  if (tooLarge) return fail(413);
  const validId = body?.messageId === undefined || /^\d{1,32}$/.test(body.messageId);
  if (!body || !validId || !Number.isInteger(body.index) || !validReport(body.report)) return fail(400);
  const { week, at, index, done } = body.report ?? {};
  const report = body.report ? { week, at, index, done } : undefined;
  const value = JSON.stringify({ messageId: body.messageId, index: body.index, report });
  await env.DB.prepare(
    "INSERT INTO state (key, value) VALUES ('tracker', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  ).bind(value).run();
  return reply(200, { ok: true });
}

async function addMember(request, env) {
  const { body, tooLarge } = await readJson(request, MAX_BODY);
  if (tooLarge) return fail(413);
  if (!isName(body?.cmdr, 64)) return fail(400);
  const token = newToken();
  // Un nouveau jeton remplace l'ancien : le commandant garde ses mérites
  await env.DB.prepare(
    `INSERT INTO members (cmdr, token_hash, created_at) VALUES (?, ?, ?)
     ON CONFLICT (cmdr) DO UPDATE SET token_hash = excluded.token_hash`
  ).bind(body.cmdr, await sha256(token), new Date().toISOString()).run();
  return reply(200, { cmdr: body.cmdr, token });
}

async function removeMember(cmdr, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM members WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM merits WHERE cmdr = ?').bind(cmdr),
  ]);
  return reply(200, { ok: true });
}

export async function handle(request, env, now = Date.now()) {
  try {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;
    if (path === '/v1/merits' && method === 'POST') return await postMerits(request, env, now);
    if (path === '/v1/leaderboard' || path === '/v1/state') {
      if (!(await sameSecret(bearer(request), env.TRACKER_TOKEN))) return fail(401);
      if (path === '/v1/leaderboard' && method === 'GET') return await getLeaderboard(url, env);
      if (path === '/v1/state' && method === 'GET') return await getState(env);
      if (path === '/v1/state' && method === 'PUT') return await putState(request, env);
      return fail(405);
    }
    if (path === '/admin/members' || path.startsWith('/admin/members/')) {
      if (!(await sameSecret(bearer(request), env.ADMIN_TOKEN))) return fail(401);
      if (path === '/admin/members' && method === 'POST') return await addMember(request, env);
      if (method === 'DELETE') return await removeMember(decodeURIComponent(path.slice(15)), env);
      return fail(405);
    }
    return fail(404);
  } catch {
    return fail(500); // aucun détail interne dans la réponse
  }
}

export default { fetch: (request, env) => handle(request, env) };
