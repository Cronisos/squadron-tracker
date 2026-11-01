// Tests du calcul d'avancement, du rendu et de la publication.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, summarize } from '../src/progress.js';
import { bannerSvg, cardSvg } from '../src/card.js';
import { animatedCard } from '../src/animation.js';
import { pngFrom } from '../src/render.js';
import { editImage, postImage } from '../src/discord.js';
import { fetchRoute } from '../src/spansh.js';

const route = {
  title: 'ROUTE TEST', subtitle: 'A VERS C', power: 'Aisling Duval', meritsPerPoint: 4,
  stops: [
    { name: 'A', goal: 'Consolidé', merits: 1_130_000 },
    { name: 'B', goal: 'Forteresse', merits: 4_480_000, noLarge: true },
    { name: 'C', goal: 'Prise', merits: 480_000 },
  ],
};
const power = 'Aisling Duval';
const NOW = Date.parse('2026-11-01T12:00:00Z');
const at = (updated_at = '2026-11-01T11:48:00Z') => ({ updated_at });

test('le relevé réel du départ redonne le coût calculé pour la route', () => {
  const records = [{ ...at(), controlling_power: power, power_state: 'Exploited', power_state_control_progress: 0.189712 }, at(), at()];
  const uncapped = { ...route, stops: route.stops.map((s, k) => (k ? s : { ...s, merits: 2_000_000 })) };
  const model = summarize(uncapped, records, NOW);
  assert.equal(model.index, 0);
  assert.ok(Math.abs(model.current.left - 1_134_000) < 2_000, String(model.current.left));
});

test('un palier atteint valide l\'étape et passe à la suivante', () => {
  const records = [{ ...at(), controlling_power: power, power_state: 'Fortified' }, at(), at()];
  const model = summarize(route, records, NOW);
  assert.equal(model.index, 1);
  assert.equal(model.current.name, 'B');
  assert.equal(model.current.left, 4_480_000);
});

test('un niveau supérieur valide aussi un objectif plus bas', () => {
  const records = [{ ...at(), controlling_power: power, power_state: 'Stronghold' }, at(), at()];
  assert.equal(summarize(route, records, NOW).index, 1);
});

test('un système tenu par une autre puissance ne valide rien', () => {
  const records = [{ ...at(), controlling_power: 'Zemina Torval', power_state: 'Stronghold' }, at(), at()];
  assert.equal(summarize(route, records, NOW).index, 0);
});

test('une prise en cours utilise la progression de conflit de notre puissance', () => {
  const records = [
    { ...at(), controlling_power: power, power_state: 'Fortified' },
    { ...at(), controlling_power: power, power_state: 'Stronghold' },
    { ...at(), power_conflict_progress: [{ power: 'Edmund Mahon', progress: 0.9 }, { power, progress: 0.25 }] },
  ];
  const model = summarize(route, records, NOW);
  assert.equal(model.index, 2);
  assert.equal(model.frac, 0.25);
  assert.equal(model.current.left, 360_000);
});

test('une progression au-delà de 1 ou négative reste bornée', () => {
  const high = summarize(route, [{ ...at(), power_conflict_progress: [{ power, progress: 2.77 }] }, at(), at()], NOW);
  assert.ok(high.frac <= 1);
  const low = summarize(route, [{ ...at(), controlling_power: power, power_state: 'Exploited', power_state_control_progress: -1 }, at(), at()], NOW);
  assert.ok(low.frac >= 0);
});

test('route terminée', () => {
  const records = [
    { ...at(), controlling_power: power, power_state: 'Fortified' },
    { ...at(), controlling_power: power, power_state: 'Stronghold' },
    { ...at(), controlling_power: power, power_state: 'Exploited' },
  ];
  const model = summarize(route, records, NOW);
  assert.equal(model.index, 3);
  assert.equal(model.current, null);
  assert.equal(model.done, model.total);
  assert.match(cardSvg(model), /Route terminée/);
});

test('un objectif inconnu est signalé', () => {
  assert.throws(() => summarize({ ...route, stops: [{ name: 'A', goal: 'Autre', merits: 1 }] }, [at()], NOW), /Objectif inconnu/);
});

test('âge des données', () => {
  assert.equal(ageLabel(12 * 60000), 'il y a 12 min');
  assert.equal(ageLabel(5 * 3600000), 'il y a 5 h');
  assert.equal(ageLabel(6 * 86400000), 'il y a 6 j');
  assert.equal(ageLabel(null), 'date inconnue');
});

test('les noms venus de l\'extérieur sont échappés dans la carte', () => {
  const model = summarize(route, [at(), at(), at()], NOW);
  const svg = cardSvg(model, { board: [{ cmdr: '<script>&', merits: 5 }] });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;&amp;'));
});

test('le GIF est animé, valide et léger', () => {
  const gif = animatedCard(summarize(route, [at(), at(), at()], NOW), {});
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.ok(gif.length < 10_000_000, String(gif.length));
});

test('la bannière annonce l\'étape suivante', () => {
  const svg = bannerSvg(route.stops[0], route.stops[1]);
  assert.match(svg, /Prochaine étape : B/);
  assert.match(bannerSvg(route.stops[2], undefined), /Route terminée/);
});

test('Spansh : une panne annule la mise à jour au lieu de donner une route fausse', async () => {
  const down = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchRoute(route, down), /503/);
  const empty = async () => ({ ok: true, json: async () => ({ results: [] }) });
  await assert.rejects(fetchRoute(route, empty), /absent/);
});

test('Spansh : seul le système au nom exact est retenu', async () => {
  const seen = async () => ({ ok: true, json: async () => ({ results: [{ record: { name: 'A 2' } }, { record: { name: 'A', id64: 1 } }, { record: { name: 'B', id64: 2 } }, { record: { name: 'C', id64: 3 } }] }) });
  assert.deepEqual((await fetchRoute(route, seen)).map((r) => r.id64), [1, 2, 3]);
});

test('Discord : le webhook secret n\'apparaît jamais dans une erreur', async () => {
  const secret = 'https://discord.com/api/webhooks/1/SECRET';
  const refused = async () => ({ ok: false, status: 403 });
  await assert.rejects(postImage(secret, Buffer.from('x'), 'a.gif', 'image/gif', refused), (error) => !error.message.includes('SECRET'));
});

test('Discord : aucune mention n\'est autorisée', async () => {
  let sent;
  const accepted = async (_url, init) => { sent = init; return { ok: true, json: async () => ({ id: '42' }) }; };
  assert.equal(await postImage('https://hook', Buffer.from('x'), 'a.gif', 'image/gif', accepted), '42');
  assert.deepEqual(JSON.parse(sent.body.get('payload_json')).allowed_mentions, { parse: [] });
});

test('Discord : un message supprimé est signalé pour être recréé', async () => {
  const missing = async () => ({ ok: false, status: 404 });
  assert.equal(await editImage('https://hook', '1', Buffer.from('x'), 'a.gif', 'image/gif', missing), false);
});
