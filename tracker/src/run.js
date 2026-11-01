// Une mise à jour complète : lancée à intervalles réguliers par GitHub Actions.

import { animatedCard } from './animation.js';
import { bannerSvg } from './card.js';
import { editImage, postImage } from './discord.js';
import { pngFrom } from './render.js';
import { summarize } from './progress.js';
import { fetchRoute } from './spansh.js';

const GIF = 'image/gif';

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
    leaderboard: (since) => call(`/v1/leaderboard?since=${encodeURIComponent(since)}`),
  };
}

export async function update(env) {
  const route = JSON.parse(env.ROUTE_JSON);
  const remote = api(env);
  const model = summarize(route, await fetchRoute(route));
  const { leaderboard } = await remote.leaderboard(route.since);
  const state = await remote.state();
  const gif = animatedCard(model, { board: leaderboard, theme: route.theme });

  let { messageId } = state;
  const edited = messageId && (await editImage(env.DISCORD_WEBHOOK_URL, messageId, gif, 'route.gif', GIF));
  if (!edited) messageId = await postImage(env.DISCORD_WEBHOOK_URL, gif, 'route.gif', GIF);

  // Une bannière par étape franchie depuis la dernière mise à jour
  const from = state.index ?? model.index;
  for (let k = from; k < model.index; k++) {
    const banner = pngFrom(bannerSvg(model.steps[k], model.steps[k + 1], { theme: route.theme }));
    await postImage(env.DISCORD_WEBHOOK_URL, banner, 'valide.png', 'image/png');
  }
  await remote.saveState({ messageId, index: model.index });
  console.log(`Étape ${model.index} sur ${model.steps.length}, GIF de ${(gif.length / 1e6).toFixed(2)} Mo`);
}

if (process.argv[1]?.endsWith('run.js')) {
  update(process.env).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
