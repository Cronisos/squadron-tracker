// Découpe des semaines Powerplay pour le rapport du jeudi.

// Le serveur s'arrête vers 7 h UTC le jeudi : le rapport part avec une marge.
export const REPORT_HOUR_UTC = 9;
const THURSDAY = 4;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Dernier jeudi à l'heure du rapport, à la date donnée ou avant. */
export function weekBoundary(now) {
  const date = new Date(now);
  const back = (date.getUTCDay() - THURSDAY + 7) % 7;
  const boundary = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back, REPORT_HOUR_UTC);
  return boundary > now ? boundary - WEEK_MS : boundary;
}

/**
 * Le relevé de début de semaine sert de point de comparaison au rapport suivant.
 * Sans relevé précédent, on en crée un, sans rien publier.
 */
export function weeklyStep(previous, model, now) {
  const boundary = weekBoundary(now);
  const week = iso(boundary).slice(0, 10);
  const next = { week, at: iso(boundary), index: model.index, done: Math.round(model.done) };
  if (previous?.week === week) return { snapshot: previous, due: false };
  return { snapshot: next, due: Boolean(previous), from: previous, until: next.at };
}

export function weekLabel(fromIso, untilIso) {
  const day = (value) => new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `Du ${day(fromIso)} au ${day(untilIso)}`;
}
