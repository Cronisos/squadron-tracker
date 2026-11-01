// Lit la fiche publique de chaque système sur Spansh.

const USER_AGENT = 'squadron-tracker (suivi de route Powerplay)';

export async function fetchSystem(name, fetcher = fetch) {
  const response = await fetcher(`https://spansh.co.uk/api/search?q=${encodeURIComponent(name)}`, {
    headers: { 'user-agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Spansh a répondu ${response.status} pour ${name}`);
  const data = await response.json();
  const record = data.results?.find((r) => r.record?.name === name)?.record;
  if (!record) throw new Error(`Système absent de Spansh : ${name}`);
  return record;
}

/** Un seul échec annule tout : mieux vaut sauter une mise à jour que faire reculer le vaisseau. */
export async function fetchRoute(route, fetcher = fetch) {
  const records = [];
  for (const stop of route.stops) records.push(await fetchSystem(stop.name, fetcher));
  return records;
}
