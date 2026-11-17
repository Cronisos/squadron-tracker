// API du tableau de squadron : reçoit les mérites des plugins et sert le classement au générateur.

const MAX_BODY = 1024;
const MAX_STATE = 4096;
const MAX_MERITS = 1_000_000; // un seul gain de mérites, largement au-dessus des ventes observées
const MAX_PER_MINUTE = 120;
const MAX_JOINS_PER_MINUTE = 10; // essais de mot de passe par adresse et par minute
const MAX_TOKENS_PER_CMDR = 10; // installations par commandant ; au-delà, refus (jamais d'éviction : personne ne purge un membre)
// Nom de commandant inscrit par le code : lettres, chiffres, espace et . _ ' - (ni @, ni retour à la ligne, ni contrôle)
const CMDR_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._'-]{0,38}[\p{L}\p{N}._'-])?$/u;
const MAX_ROUTE = 16 * 1024;
const GOALS = new Set(['Prise', 'Consolidé', 'Forteresse']);
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

/** Le commandant d'un jeton (celui donné par le chef, ou un de ceux obtenus avec le code), ou null. */
async function memberOf(env, tokenHash) {
  return env.DB.prepare(
    'SELECT cmdr FROM members WHERE token_hash = ? UNION SELECT cmdr FROM tokens WHERE token_hash = ? LIMIT 1'
  ).bind(tokenHash, tokenHash).first();
}

async function underRateLimit(env, tokenHash, now, max = MAX_PER_MINUTE) {
  const minute = Math.floor(now / 60000);
  await env.DB.prepare('DELETE FROM rate WHERE minute < ?').bind(minute - 1).run();
  const row = await env.DB.prepare(
    `INSERT INTO rate (token_hash, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (token_hash, minute) DO UPDATE SET count = count + 1 RETURNING count`
  ).bind(tokenHash, minute).first();
  return row.count <= max;
}

async function postMerits(request, env, now) {
  const tokenHash = await sha256(bearer(request));
  const member = await memberOf(env, tokenHash);
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
  // system : seulement les mérites gagnés dans ce système (rapport d'étape, classement définitif). limit : 10 par
  // défaut, 100 au plus. La réponse redit le système : le suivi sait ainsi que le serveur a bien filtré.
  const system = url.searchParams.get('system');
  if (system !== null && (system.length < 1 || system.length > 120)) return fail(400);
  const asked = url.searchParams.get('limit');
  const limit = asked === null ? 10 : Number(asked);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(400);
  const where = `at >= ? AND at < ?${system !== null ? ' AND system = ? COLLATE NOCASE' : ''}`;
  const args = system !== null ? [since, until, system] : [since, until];
  const { results } = await env.DB.prepare(
    `SELECT cmdr, SUM(merits) AS merits FROM merits WHERE ${where}
     GROUP BY cmdr ORDER BY merits DESC, cmdr ASC LIMIT ${limit}`
  ).bind(...args).all();
  const sum = await env.DB.prepare(`SELECT COALESCE(SUM(merits), 0) AS total, COUNT(DISTINCT cmdr) AS cmdrs FROM merits WHERE ${where}`)
    .bind(...args)
    .first();
  return reply(200, { leaderboard: results, total: sum.total, cmdrs: sum.cmdrs, ...(system !== null ? { system } : {}) });
}

function validReport(report) {
  if (report === undefined) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(report?.week) && TIMESTAMP.test(report.at)
    && Number.isInteger(report.index) && Number.isFinite(report.done)
    && (report.rebasedAt === undefined || TIMESTAMP.test(report.rebasedAt));
}

async function getState(env) {
  const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'tracker'").first();
  return reply(200, row ? JSON.parse(row.value) : {});
}

async function putState(request, env) {
  const { body, tooLarge } = await readJson(request, MAX_STATE);
  if (tooLarge) return fail(413);
  const validId = body?.messageId === undefined || /^\d{1,32}$/.test(body.messageId);
  const validKey = body?.routeKey === undefined || /^[0-9a-f]{8,64}$/.test(body.routeKey);
  if (!body || !validId || !validKey || !Number.isInteger(body.index) || !validReport(body.report)) return fail(400);
  const { week, at, index, done, rebasedAt } = body.report ?? {};
  const report = body.report ? { week, at, index, done, rebasedAt } : undefined;
  const value = JSON.stringify({ messageId: body.messageId, index: body.index, routeKey: body.routeKey, report });
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

/**
 * Inscription avec le code de l'escadron (secret JOIN_PASSWORD), le même pour tous : renvoie un jeton pour ce nom de
 * commandant. Le même nom peut rejoindre plusieurs fois (app et plugin, PC réinstallé) : chaque installation a son
 * jeton, au plus MAX_TOKENS_PER_CMDR. Sans code configuré, les inscriptions sont fermées (404). Le code ne prouve
 * pas qu'on est ce commandant : c'est le choix de l'escadron (un code partagé sur Discord), dit dans SECURITY.md.
 */
async function joinSquadron(request, env, now) {
  if (!env.JOIN_PASSWORD) return fail(404);
  const ip = request.headers.get('cf-connecting-ip') || 'inconnue';
  if (!(await underRateLimit(env, await sha256(`join|${ip}`), now, MAX_JOINS_PER_MINUTE))) return fail(429);
  const { body, tooLarge } = await readJson(request, MAX_BODY);
  if (tooLarge) return fail(413);
  if (!isName(body?.cmdr, 64) || !CMDR_NAME.test(body.cmdr) || typeof body?.password !== 'string') return fail(400);
  if (!(await sameSecret(body.password, env.JOIN_PASSWORD))) return fail(401);
  // Inscriptions fermées par le chef (les membres déjà inscrits continuent d'envoyer)
  const closed = await env.DB.prepare("SELECT value FROM state WHERE key = 'join'").first();
  if (closed && JSON.parse(closed.value).open === false) return fail(403);
  const token = newToken();
  const hash = await sha256(token);
  const at = new Date(now).toISOString();
  // Le nom existait-il déjà (jeton du chef, ou une installation) ? Alors celle-ci devra être confirmée pour les partages
  const before = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM tokens WHERE cmdr = ?1) AS installs,
            (SELECT COUNT(*) FROM members WHERE cmdr = ?1 AND token_hash NOT LIKE 'code:%') AS given`
  ).bind(body.cmdr).first();
  const pending = before.installs > 0 || before.given > 0;
  // members.token_hash ne sert qu'au jeton donné par le chef : une inscription par le code n'y met qu'une valeur inutilisable
  await env.DB.prepare('INSERT INTO members (cmdr, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (cmdr) DO NOTHING')
    .bind(body.cmdr, `code:${newToken()}`, at).run();
  // Le nom tel qu'il a été inscrit la première fois (la casse ne crée pas un second membre)
  const member = await env.DB.prepare('SELECT cmdr FROM members WHERE cmdr = ?').bind(body.cmdr).first();
  // Au plus MAX_TOKENS_PER_CMDR installations : au-delà, refus (le chef coupe les anciennes depuis sa page)
  const row = await env.DB.prepare(
    `INSERT INTO tokens (token_hash, cmdr, created_at)
     SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM tokens WHERE cmdr = ?) < ${MAX_TOKENS_PER_CMDR} RETURNING cmdr`
  ).bind(hash, member.cmdr, at, member.cmdr).first();
  if (!row) return fail(429);
  if (pending) {
    await env.DB.prepare('INSERT OR IGNORE INTO pending (token_hash, cmdr, created_at) VALUES (?, ?, ?)').bind(hash, member.cmdr, at).run();
  }
  return reply(200, { cmdr: member.cmdr, token, pending });
}

async function listMembers(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.cmdr, m.created_at, (SELECT COUNT(*) FROM tokens t WHERE t.cmdr = m.cmdr) AS installations,
       (SELECT COUNT(*) FROM pending p WHERE p.cmdr = m.cmdr) AS pending,
       (SELECT role FROM member_roles r WHERE r.cmdr = m.cmdr) AS role,
       (SELECT MAX(x.at) FROM merits x WHERE x.cmdr = m.cmdr) AS last_merit_at
     FROM members m ORDER BY m.cmdr`
  ).all();
  return reply(200, { members: results });
}

/** Route de l'escadron, vérifiée ; null si elle ne respecte pas le format (celui de config/route.example.json). */
export function validRoute(r) {
  const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!r || typeof r !== 'object' || !text(r.power, 64) || !TIMESTAMP.test(r.since ?? '')) return null;
  if (!Array.isArray(r.stops) || r.stops.length < 1 || r.stops.length > 80) return null;
  const stops = [];
  for (const s of r.stops) {
    if (!text(s?.name, 64) || !GOALS.has(s.goal) || !Number.isInteger(s.merits) || s.merits < 1 || s.merits > 50_000_000) return null;
    stops.push({ name: s.name, goal: s.goal, merits: s.merits, ...(text(s.short, 32) ? { short: s.short } : {}), ...(s.noLarge === true ? { noLarge: true } : {}) });
  }
  const ratio = Number.isInteger(r.meritsPerPoint) && r.meritsPerPoint >= 1 && r.meritsPerPoint <= 100 ? r.meritsPerPoint : 4;
  return {
    title: text(r.title, 60) ? r.title : 'ROUTE DE L’ESCADRON', subtitle: text(r.subtitle, 80) ? r.subtitle : '',
    power: r.power, meritsPerPoint: ratio, since: r.since, theme: r.theme === 'prism' ? 'prism' : 'orange', stops,
  };
}

/** La route en service : { route, version, updatedAt }, ou {} s'il n'y en a pas encore. */
async function getRoute(env) {
  const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'route'").first();
  return reply(200, row ? JSON.parse(row.value) : {});
}

/** Nouvelle route (le chef) : version + 1 ; le suivi la prend au passage suivant et se recale sans fausse annonce. */
async function putRoute(request, env, now) {
  const { body, tooLarge } = await readJson(request, MAX_ROUTE);
  if (tooLarge) return fail(413);
  const route = validRoute(body);
  if (!route) return fail(400);
  const old = await env.DB.prepare("SELECT value FROM state WHERE key = 'route'").first();
  const version = (old ? JSON.parse(old.value).version ?? 0 : 0) + 1;
  const value = JSON.stringify({ route, version, updatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z') });
  await env.DB.prepare(
    "INSERT INTO state (key, value) VALUES ('route', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  ).bind(value).run();
  return reply(200, JSON.parse(value));
}

/** Couper toutes les installations d'un membre (jetons obtenus avec le code), sans toucher à ses mérites. */
async function cutTokens(cmdr, env) {
  await env.DB.prepare('DELETE FROM tokens WHERE cmdr = ?').bind(cmdr).run();
  await env.DB.prepare('DELETE FROM pending WHERE cmdr = ?').bind(cmdr).run();
  return reply(200, { ok: true });
}

/** Inscriptions ouvertes ou fermées : { open } (ouvertes par défaut). */
async function getJoin(env) {
  const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'join'").first();
  return reply(200, { open: row ? JSON.parse(row.value).open !== false : true });
}

async function putJoin(request, env) {
  const { body, tooLarge } = await readJson(request, MAX_BODY);
  if (tooLarge) return fail(413);
  if (typeof body?.open !== 'boolean') return fail(400);
  await env.DB.prepare(
    "INSERT INTO state (key, value) VALUES ('join', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  ).bind(JSON.stringify({ open: body.open })).run();
  return reply(200, { open: body.open });
}

async function removeMember(cmdr, env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM members WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM tokens WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM merits WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM pending WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM member_roles WHERE cmdr = ?').bind(cmdr),
    env.DB.prepare('DELETE FROM share_targets WHERE cmdr = ? OR share_id IN (SELECT id FROM shares WHERE cmdr = ?)').bind(cmdr, cmdr),
    env.DB.prepare('DELETE FROM shares WHERE cmdr = ?').bind(cmdr),
  ]);
  return reply(200, { ok: true });
}

// --- Partage entre membres : rôles (hiérarchie du chef), installations à confirmer, partages adressés ---
//
// Vie privée : un partage n'est lisible que par son auteur et ses destinataires. La clé du chef ne donne aucune
// lecture des partages (elle peut seulement en retirer un par son identifiant). Le code de l'escadron ne prouvant
// pas l'identité, une installation de plus sous un nom déjà inscrit reste « à confirmer » : elle envoie ses mérites,
// mais ne lit ni n'écrit aucun partage tant qu'une installation déjà confirmée du même commandant, ou le chef, ne
// l'a pas acceptée.

const MAX_SHARE = 8 * 1024; // un partage (repère, build, route), en JSON
const MAX_SHARES_PER_CMDR = 300;
const MAX_TARGETS = 30;
const MAX_ROLES = 20;
const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const SHARE_KIND = /^[a-z][a-z0-9-]{0,23}$/;
const INSTALL_ID = /^[0-9a-f]{12}$/;
const SHARE_ID = /^[0-9a-f]{32}$/;

/** Le membre d'un jeton, avec l'état de son installation : { cmdr, hash, pending }, ou null. */
async function installOf(env, request) {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const member = await memberOf(env, hash);
  if (!member) return null;
  const pending = await env.DB.prepare('SELECT 1 AS p FROM pending WHERE token_hash = ?').bind(hash).first();
  return { cmdr: member.cmdr, hash, pending: Boolean(pending) };
}

async function roleOf(env, cmdr) {
  return env.DB.prepare(
    'SELECT r.id, r.name, r.rank FROM member_roles m JOIN roles r ON r.id = m.role WHERE m.cmdr = ?'
  ).bind(cmdr).first();
}

async function allRoles(env) {
  const { results } = await env.DB.prepare('SELECT id, name, rank FROM roles ORDER BY rank DESC, name').all();
  return results;
}

/** Moi : mon nom, mon rôle, et mes installations (pour confirmer la nouvelle depuis l'ancienne). */
async function getMe(env, me) {
  const { results } = await env.DB.prepare(
    `SELECT t.token_hash AS hash, t.created_at, (SELECT 1 FROM pending p WHERE p.token_hash = t.token_hash) AS pending
     FROM tokens t WHERE t.cmdr = ? ORDER BY t.created_at`
  ).bind(me.cmdr).all();
  const role = await roleOf(env, me.cmdr);
  return reply(200, {
    cmdr: me.cmdr, pending: me.pending, role: role ?? null,
    installations: results.map((r) => ({ id: r.hash.slice(0, 12), created_at: r.created_at, pending: Boolean(r.pending), current: r.hash === me.hash })),
  });
}

/** Confirmer une de mes installations en attente, depuis une installation déjà confirmée. */
async function approveInstall(env, me, id) {
  if (!INSTALL_ID.test(id)) return fail(400);
  const row = await env.DB.prepare(
    "DELETE FROM pending WHERE cmdr = ? AND substr(token_hash, 1, 12) = ? RETURNING token_hash"
  ).bind(me.cmdr, id).first();
  return row ? reply(200, { ok: true }) : fail(404);
}

/** Les membres et les rôles : visibles de tout membre confirmé (pour choisir à qui partager). */
async function getMembers(env) {
  const { results } = await env.DB.prepare(
    'SELECT m.cmdr, (SELECT role FROM member_roles r WHERE r.cmdr = m.cmdr) AS role FROM members m ORDER BY m.cmdr'
  ).all();
  return reply(200, { members: results, roles: await allRoles(env) });
}

/** Destinataires vérifiés : { audience, role, cmdrs }, ou null. */
async function validAudience(env, to, sender) {
  if (!to || typeof to !== 'object') return null;
  if (to.all === true) return { audience: 'all', role: null, cmdrs: [] };
  if (typeof to.role === 'string') {
    if (!ROLE_ID.test(to.role)) return null;
    const role = await env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(to.role).first();
    return role ? { audience: 'role', role: role.id, cmdrs: [] } : null;
  }
  if (Array.isArray(to.cmdrs) && to.cmdrs.length >= 1 && to.cmdrs.length <= MAX_TARGETS) {
    const cmdrs = [];
    for (const name of to.cmdrs) {
      if (!isName(name, 64)) return null;
      const m = await env.DB.prepare('SELECT cmdr FROM members WHERE cmdr = ?').bind(name).first();
      if (!m) return null; // seulement des membres de l'escadron
      if (m.cmdr.toLowerCase() !== sender.toLowerCase() && !cmdrs.includes(m.cmdr)) cmdrs.push(m.cmdr);
    }
    return cmdrs.length ? { audience: 'cmdrs', role: null, cmdrs } : null;
  }
  return null;
}

/** Créer ou remplacer un de mes partages : { kind, ref, title, data, to }. Même (kind, ref) : même partage. */
async function putShare(request, env, me, now) {
  const { body, tooLarge } = await readJson(request, MAX_SHARE + 2048);
  if (tooLarge) return fail(413);
  if (!body || typeof body !== 'object' || !SHARE_KIND.test(body.kind ?? '') || !isName(body.ref, 80) || !isName(body.title, 80)) return fail(400);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return fail(400);
  const data = JSON.stringify(body.data);
  if (data.length > MAX_SHARE) return fail(413);
  const to = await validAudience(env, body.to, me.cmdr);
  if (!to) return fail(400);
  const id = (await sha256(`share|${me.cmdr.toLowerCase()}|${body.kind}|${body.ref}`)).slice(0, 32);
  const at = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const known = await env.DB.prepare('SELECT id FROM shares WHERE id = ?').bind(id).first();
  if (!known) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE cmdr = ?').bind(me.cmdr).first();
    if (count.n >= MAX_SHARES_PER_CMDR) return fail(429);
  }
  await env.DB.prepare(
    `INSERT INTO shares (id, cmdr, kind, ref, title, data, audience, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, data = excluded.data, audience = excluded.audience,
       role = excluded.role, updated_at = excluded.updated_at`
  ).bind(id, me.cmdr, body.kind, body.ref, body.title, data, to.audience, to.role, at, at).run();
  await env.DB.prepare('DELETE FROM share_targets WHERE share_id = ?').bind(id).run();
  for (const cmdr of to.cmdrs) {
    await env.DB.prepare('INSERT OR IGNORE INTO share_targets (share_id, cmdr) VALUES (?, ?)').bind(id, cmdr).run();
  }
  return reply(200, { id, updated_at: at });
}

/**
 * Ce que je peux lire : mes partages, ceux pour tout l'escadron, ceux pour un rôle au niveau du mien ou en dessous,
 * et ceux qui me sont adressés. Les destinataires nommés ne sont donnés qu'à l'auteur.
 */
async function getShares(env, me) {
  const role = await roleOf(env, me.cmdr);
  const rank = role ? role.rank : -1;
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.cmdr, s.kind, s.ref, s.title, s.data, s.audience, s.role, s.created_at, s.updated_at
     FROM shares s
     WHERE s.cmdr = ?1
        OR s.audience = 'all'
        OR (s.audience = 'role' AND EXISTS (SELECT 1 FROM roles r WHERE r.id = s.role AND r.rank <= ?2))
        OR (s.audience = 'cmdrs' AND EXISTS (SELECT 1 FROM share_targets t WHERE t.share_id = s.id AND t.cmdr = ?1))
     ORDER BY s.updated_at DESC LIMIT 2000`
  ).bind(me.cmdr, rank).all();
  const shares = [];
  for (const s of results) {
    const mine = s.cmdr.toLowerCase() === me.cmdr.toLowerCase();
    let to;
    if (mine && s.audience === 'cmdrs') {
      const t = await env.DB.prepare('SELECT cmdr FROM share_targets WHERE share_id = ? ORDER BY cmdr').bind(s.id).all();
      to = t.results.map((r) => r.cmdr);
    }
    let data = {};
    try {
      data = JSON.parse(s.data);
    } catch { /* partage illisible : donné vide */ }
    shares.push({ ...s, data, mine, ...(to ? { to } : {}) });
  }
  return reply(200, { shares, roles: await allRoles(env), role: role ?? null });
}

async function deleteShare(env, id, cmdr) {
  if (!SHARE_ID.test(id)) return fail(400);
  const row = cmdr === null
    ? await env.DB.prepare('DELETE FROM shares WHERE id = ? RETURNING id').bind(id).first()
    : await env.DB.prepare('DELETE FROM shares WHERE id = ? AND cmdr = ? RETURNING id').bind(id, cmdr).first();
  if (!row) return fail(404);
  await env.DB.prepare('DELETE FROM share_targets WHERE share_id = ?').bind(id).run();
  return reply(200, { ok: true });
}

/** Les rôles de l'escadron (le chef) : la liste entière, remplacée. rank : plus grand = plus haut dans la hiérarchie. */
async function putRoles(request, env) {
  const { body, tooLarge } = await readJson(request, MAX_STATE);
  if (tooLarge) return fail(413);
  if (!Array.isArray(body?.roles) || body.roles.length > MAX_ROLES) return fail(400);
  const ids = new Set();
  for (const r of body.roles) {
    if (!ROLE_ID.test(r?.id ?? '') || ids.has(r.id) || !isName(r.name, 40) || !Number.isInteger(r.rank) || r.rank < 0 || r.rank > 1000) return fail(400);
    ids.add(r.id);
  }
  await env.DB.prepare('DELETE FROM roles').run();
  for (const r of body.roles) {
    await env.DB.prepare('INSERT INTO roles (id, name, rank) VALUES (?, ?, ?)').bind(r.id, r.name.trim(), r.rank).run();
  }
  // Un rôle retiré : ses membres n'en ont plus (les partages qui le visaient ne sont plus lus que par leur auteur)
  await env.DB.prepare('DELETE FROM member_roles WHERE role NOT IN (SELECT id FROM roles)').run();
  return reply(200, { roles: await allRoles(env) });
}

/** Le rôle d'un membre (le chef) : { role } (identifiant), ou null pour le retirer. */
async function putMemberRole(request, env, cmdr) {
  const { body, tooLarge } = await readJson(request, MAX_BODY);
  if (tooLarge) return fail(413);
  const member = await env.DB.prepare('SELECT cmdr FROM members WHERE cmdr = ?').bind(cmdr).first();
  if (!member) return fail(404);
  if (body?.role === null) {
    await env.DB.prepare('DELETE FROM member_roles WHERE cmdr = ?').bind(member.cmdr).run();
    return reply(200, { cmdr: member.cmdr, role: null });
  }
  if (typeof body?.role !== 'string' || !ROLE_ID.test(body.role)) return fail(400);
  const role = await env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(body.role).first();
  if (!role) return fail(400);
  await env.DB.prepare(
    'INSERT INTO member_roles (cmdr, role) VALUES (?, ?) ON CONFLICT (cmdr) DO UPDATE SET role = excluded.role'
  ).bind(member.cmdr, role.id).run();
  return reply(200, { cmdr: member.cmdr, role: role.id });
}

/** Confirmer les installations en attente d'un membre (le chef). */
async function approveMember(env, cmdr) {
  await env.DB.prepare('DELETE FROM pending WHERE cmdr = ?').bind(cmdr).run();
  return reply(200, { ok: true });
}

/** Les routes du partage ; null si le chemin n'en est pas une. */
async function sharing(request, env, url, now) {
  const { method } = request;
  const path = url.pathname;
  if (path === '/admin/roles' || path.startsWith('/admin/shares/')) {
    if (!(await sameSecret(bearer(request), env.ADMIN_TOKEN))) return fail(401);
    if (path === '/admin/roles') {
      if (method === 'GET') return reply(200, { roles: await allRoles(env) });
      return method === 'PUT' ? putRoles(request, env) : fail(405);
    }
    return method === 'DELETE' ? deleteShare(env, path.slice(14), null) : fail(405);
  }
  const member = path === '/v1/me' || path === '/v1/members' || path === '/v1/shares' || path.startsWith('/v1/shares/')
    || path.startsWith('/v1/installations/');
  if (!member) return null;
  const me = await installOf(env, request);
  if (!me) return fail(401);
  if (!(await underRateLimit(env, me.hash, now))) return fail(429);
  if (path === '/v1/me') return method === 'GET' ? getMe(env, me) : fail(405);
  // Installation à confirmer : aucun accès aux membres ni aux partages
  if (me.pending) return reply(403, { error: 403, pending: true });
  if (path === '/v1/members') return method === 'GET' ? getMembers(env) : fail(405);
  if (path === '/v1/shares') {
    if (method === 'GET') return getShares(env, me);
    return method === 'PUT' ? putShare(request, env, me, now) : fail(405);
  }
  if (path.startsWith('/v1/shares/')) return method === 'DELETE' ? deleteShare(env, path.slice(11), me.cmdr) : fail(405);
  const approve = /^\/v1\/installations\/([^/]+)\/approve$/.exec(path);
  if (approve) return method === 'POST' ? approveInstall(env, me, approve[1]) : fail(405);
  return fail(404);
}

export async function handle(request, env, now = Date.now()) {
  try {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;
    if (path === '/v1/merits' && method === 'POST') return await postMerits(request, env, now);
    if (path === '/v1/join' && method === 'POST') return await joinSquadron(request, env, now);
    const shared = await sharing(request, env, url, now);
    if (shared) return shared;
    // La route : lisible par le suivi, le chef et les membres inscrits ; modifiable par le chef seul
    if (path === '/v1/route' && method === 'GET') {
      const token = bearer(request);
      const ok = (await sameSecret(token, env.TRACKER_TOKEN)) || (await sameSecret(token, env.ADMIN_TOKEN))
        || (token && (await memberOf(env, await sha256(token))));
      return ok ? await getRoute(env) : fail(401);
    }
    if (path === '/admin/join') {
      if (!(await sameSecret(bearer(request), env.ADMIN_TOKEN))) return fail(401);
      if (method === 'GET') return await getJoin(env);
      if (method === 'PUT') return await putJoin(request, env);
      return fail(405);
    }
    if (path === '/admin/route') {
      if (!(await sameSecret(bearer(request), env.ADMIN_TOKEN))) return fail(401);
      return method === 'PUT' ? await putRoute(request, env, now) : fail(405);
    }
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
      if (path === '/admin/members' && method === 'GET') return await listMembers(env);
      if (method === 'PUT' && path.endsWith('/role')) return await putMemberRole(request, env, decodeURIComponent(path.slice(15, -5)));
      if (method === 'POST' && path.endsWith('/approve')) return await approveMember(env, decodeURIComponent(path.slice(15, -8)));
      if (method === 'DELETE' && path.endsWith('/tokens')) return await cutTokens(decodeURIComponent(path.slice(15, -7)), env);
      if (method === 'DELETE') return await removeMember(decodeURIComponent(path.slice(15)), env);
      return fail(405);
    }
    return fail(404);
  } catch {
    return fail(500); // aucun détail interne dans la réponse
  }
}

export default { fetch: (request, env) => handle(request, env) };
