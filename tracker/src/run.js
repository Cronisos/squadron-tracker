// Une mise à jour complète : lancée à intervalles réguliers par GitHub Actions.

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
    saveState: (state) => call('/v1/state', { method: 'PUT', body: JSON.stringify(state) }),
    leaderboard: (since, until) => {
      const end = until ? `&until=${encodeURIComponent(until)}` : '';
      return call(`/v1/leaderboard?since=${encodeURIComponent(since)}${end}`);
    },
  };
}

const later = (a, b) => (Date.parse(a) > Date.parse(b) ? a : b);

async function weeklyReport(remote, route, model, step) {
  const since = later(step.from.at, route.since);
  const { leaderboard, total } = await remote.leaderboard(since, step.until);
  return pngFrom(reportSvg(model, {
    from: step.from,
    label: weekLabel(step.from.at, step.until),
    board: leaderboard,
    total,
    theme: route.theme,
  }));
}

export async function update(env, now = Date.now()) {
  const route = JSON.parse(env.ROUTE_JSON);
  const webhook = env.DISCORD_WEBHOOK_URL;
  const remote = api(env);
  const model = summarize(route, await fetchRoute(route), now);
  const { leaderboard } = await remote.leaderboard(route.since);
  const state = await remote.state();
  const gif = animatedCard(model, { board: leaderboard, theme: route.theme });
  const step = weeklyStep(state.report, model, now);

  const announcements = [];
  // Une bannière par étape franchie depuis la dernière mise à jour
  for (let k = state.index ?? model.index; k < model.index; k++) {
    announcements.push(pngFrom(bannerSvg(model.steps[k], model.steps[k + 1], { theme: route.theme })));
  }
  if (step.due) announcements.push(await weeklyReport(remote, route, model, step));

  let { messageId } = state;
  if (announcements.length) {
    for (const [k, image] of announcements.entries()) await postImage(webhook, image, `annonce-${k}.png`, PNG);
    // Annonces enregistrées avant de toucher à la carte : une panne ne les republiera pas
    await remote.saveState({ messageId, index: model.index, report: step.snapshot });
    // La carte repasse sous les annonces : d'abord la nouvelle, pour ne jamais laisser le salon sans carte
    const fresh = await postImage(webhook, gif, 'route.gif', GIF);
    if (messageId) await deleteMessage(webhook, messageId);
    messageId = fresh;
  } else {
    const edited = messageId && (await editImage(webhook, messageId, gif, 'route.gif', GIF));
    if (!edited) messageId = await postImage(webhook, gif, 'route.gif', GIF);
  }
  await remote.saveState({ messageId, index: model.index, report: step.snapshot });
  console.log(`Étape ${model.index} sur ${model.steps.length}, GIF de ${(gif.length / 1e6).toFixed(2)} Mo, ${announcements.length} annonce(s)`);
}

if (process.argv[1]?.endsWith('run.js')) {
  update(process.env).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
