// Une mise à jour complète : lancée à intervalles réguliers par GitHub Actions.

import { createHash } from 'node:crypto';
import { animatedCard } from './animation.js';
import { bannerSvg, reportSvg } from './card.js';
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
    leaderboard: (since, until) => {
      const end = until ? `&until=${encodeURIComponent(until)}` : '';
      return call(`/v1/leaderboard?since=${encodeURIComponent(since)}${end}`);
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
    announcements.push(pngFrom(bannerSvg(model.steps[k], model.steps[k + 1], { theme: route.theme })));
  }
  if (step.due) announcements.push(await weeklyReport(remote, route, model, step));

  let { messageId } = state;
  if (announcements.length) {
    for (const [k, image] of announcements.entries()) await postImage(webhook, image, `annonce-${k}.png`, PNG);
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
