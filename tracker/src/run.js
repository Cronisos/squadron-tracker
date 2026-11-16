// Une mise à jour complète : lancée à intervalles réguliers par GitHub Actions.

import { createHash } from 'node:crypto';
import { animatedCard } from './animation.js';
import { bannerSvg, reportSvg, stepReportSvg, stepReportText } from './card.js';
import { deleteMessage, editImage, postImage } from './discord.js';
import { pngFrom } from './render.js';
import { summarize } from './progress.js';
import { fetchRoute } from './spansh.js';
import { weekLabel, weeklyStep } from './weekly.js';

const GIF = 'image/gif';
const PNG = 'image/png';

function api(env) {
  const headers = { authorization: `Bearer ${env.TRACKER_TOKEN}`, 'content-type': 'application/json' };
  const call = async (path, init) => {
    const response = await fetch(`${env.API_URL}${path}`, { headers, ...init });
    if (!response.ok) throw new Error(`API : erreur ${response.status} sur ${path}`);
    return response.json();
  };
  return {
    state: () => call('/v1/state'),
    route: () => call('/v1/route'),
    saveState: (state) => call('/v1/state', { method: 'PUT', body: JSON.stringify(state) }),
    leaderboard: (since, until, { system, limit } = {}) => {
      const end = until ? `&until=${encodeURIComponent(until)}` : '';
      const only = system ? `&system=${encodeURIComponent(system)}` : '';
      const max = limit ? `&limit=${limit}` : '';
      return call(`/v1/leaderboard?since=${encodeURIComponent(since)}${end}${only}${max}`);
    },
  };
}

const later = (a, b) => (Date.parse(a) > Date.parse(b) ? a : b);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Empreinte de ce qui fait la route (puissance, systèmes, objectifs) : un titre changé n'est pas une nouvelle route. */
export function routeKey(route) {
  const parts = [route.power, route.stops.map((s) => [s.name, s.goal, s.merits])];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/**
 * La route en service : celle du serveur (mise à jour par le chef depuis l'app), sinon le secret ROUTE_JSON (installations
 * d'avant, ou serveur sans route).
 */
export async function loadRoute(remote, env) {
  try {
    const remoteRoute = await remote.route();
    if (remoteRoute?.route) return remoteRoute.route;
  } catch (error) {
    if (!env.ROUTE_JSON) throw error;
  }
  if (!env.ROUTE_JSON) throw new Error('Aucune route : ni sur le serveur, ni dans le secret ROUTE_JSON');
  return JSON.parse(env.ROUTE_JSON);
}

async function weeklyReport(remote, route, model, step) {
  const since = later(step.from.at, route.since);
  const { leaderboard, total } = await remote.leaderboard(since, step.until);
  // Route changée en cours de semaine : l'avancement part du changement (le classement, lui, couvre toute la semaine)
  const rebased = step.from.rebasedAt
    ? ` · route modifiée le ${new Date(step.from.rebasedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
    : '';
  return pngFrom(reportSvg(model, {
    from: step.from,
    label: weekLabel(step.from.at, step.until) + rebased,
    board: leaderboard,
    total,
    theme: route.theme,
  }));
}

/**
 * Annonce d'un système validé : le rapport d'étape, avec le classement définitif des mérites gagnés dans ce système
 * depuis le départ de la route (image, et liste complète en texte : c'est elle qui sert à récompenser). Serveur
 * d'avant cette version (il ne sait pas classer par système) : la simple bannière, plutôt qu'un classement faux.
 */
async function stepAnnouncement(remote, route, model, k) {
  const step = model.steps[k];
  const next = model.steps[k + 1];
  let ranking = null;
  try {
    ranking = await remote.leaderboard(route.since, undefined, { system: step.name, limit: 100 });
  } catch {
    ranking = null;
  }
  if (!ranking || ranking.system !== step.name) return { image: pngFrom(bannerSvg(step, next, { theme: route.theme })) };
  const options = { board: ranking.leaderboard, total: ranking.total, cmdrs: ranking.cmdrs, theme: route.theme, number: k + 1, count: model.steps.length };
  return { image: pngFrom(stepReportSvg(step, next, options)), content: stepReportText(step, options) };
}

export async function update(env, now = Date.now()) {
  const webhook = env.DISCORD_WEBHOOK_URL;
  const remote = api(env);
  const route = await loadRoute(remote, env);
  const key = routeKey(route);
  const model = summarize(route, await fetchRoute(route), now);
  const { leaderboard } = await remote.leaderboard(route.since);
  const state = await remote.state();
  const gif = animatedCard(model, { board: leaderboard, theme: route.theme });
  // Route modifiée depuis le dernier passage (un système remplacé, ajouté, retiré) : les positions d'avant ne veulent
  // plus rien dire. Pas de bannière pour ce saut, et le relevé de la semaine repart d'ici, daté du changement.
  const changed = state.routeKey !== undefined && state.routeKey !== key;
  const previous = changed && state.report
    ? { ...state.report, index: model.index, done: Math.round(model.done), rebasedAt: iso(now) }
    : state.report;
  const step = weeklyStep(previous, model, now);

  const announcements = [];
  // Une bannière par étape franchie depuis la dernière mise à jour
  for (let k = changed ? model.index : state.index ?? model.index; k < model.index; k++) {
    announcements.push(await stepAnnouncement(remote, route, model, k));
  }
  if (step.due) announcements.push({ image: await weeklyReport(remote, route, model, step) });

  let { messageId } = state;
  if (announcements.length) {
    for (const [k, a] of announcements.entries()) await postImage(webhook, a.image, `annonce-${k}.png`, PNG, fetch, a.content);
    // Annonces enregistrées avant de toucher à la carte : une panne ne les republiera pas
    await remote.saveState({ messageId, index: model.index, routeKey: key, report: step.snapshot });
    // La carte repasse sous les annonces : d'abord la nouvelle, pour ne jamais laisser le salon sans carte
    const fresh = await postImage(webhook, gif, 'route.gif', GIF);
    if (messageId) await deleteMessage(webhook, messageId);
    messageId = fresh;
  } else {
    const edited = messageId && (await editImage(webhook, messageId, gif, 'route.gif', GIF));
    if (!edited) messageId = await postImage(webhook, gif, 'route.gif', GIF);
  }
  await remote.saveState({ messageId, index: model.index, routeKey: key, report: step.snapshot });
  console.log(`Étape ${model.index} sur ${model.steps.length}, GIF de ${(gif.length / 1e6).toFixed(2)} Mo, ${announcements.length} annonce(s)${changed ? ', route modifiée' : ''}`);
}

if (process.argv[1]?.endsWith('run.js')) {
  update(process.env).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
