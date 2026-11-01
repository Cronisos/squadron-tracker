// Calcule l'avancement de la route à partir des fiches Spansh.

// Points cumulés pour atteindre chaque palier : 120 000 + 350 000 + 650 000
export const GOALS = {
  Prise: { rank: 1, points: 120_000 },
  'Consolidé': { rank: 2, points: 470_000 },
  Forteresse: { rank: 3, points: 1_120_000 },
};
const TIERS = {
  Exploited: { rank: 1, base: 120_000, span: 350_000 },
  Fortified: { rank: 2, base: 470_000, span: 650_000 },
  Stronghold: { rank: 3, base: 1_120_000, span: 0 },
};

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

function pointsOf(record, power) {
  if (record.controlling_power === power) {
    const tier = TIERS[record.power_state];
    if (tier) return tier.base + tier.span * clamp(record.power_state_control_progress ?? 0, 0, 1);
  }
  const conflict = (record.power_conflict_progress || []).find((c) => c.power === power);
  return GOALS.Prise.points * clamp(conflict?.progress ?? 0, 0, 1);
}

function isReached(record, power, goal) {
  return record.controlling_power === power && (TIERS[record.power_state]?.rank ?? 0) >= goal.rank;
}

/** Résume la route : étape en cours, progression et mérites restants. */
export function summarize(route, records, now = Date.now()) {
  const ratio = route.meritsPerPoint;
  const steps = route.stops.map((stop, k) => {
    const goal = GOALS[stop.goal];
    if (!goal) throw new Error(`Objectif inconnu : ${stop.goal}`);
    const reached = isReached(records[k], route.power, goal);
    const frac = reached ? 1 : clamp(pointsOf(records[k], route.power) / goal.points, 0, 1);
    const left = reached ? 0 : Math.min(stop.merits, (goal.points - goal.points * frac) * ratio);
    return { ...stop, reached, frac, left };
  });
  const firstOpen = steps.findIndex((s) => !s.reached);
  const index = firstOpen < 0 ? steps.length : firstOpen;
  const total = steps.reduce((sum, s) => sum + s.merits, 0);
  const left = steps.reduce((sum, s) => sum + s.left, 0);
  const updated = Date.parse(records[Math.min(index, steps.length - 1)].updated_at);
  return {
    title: route.title,
    subtitle: route.subtitle,
    steps,
    index,
    current: steps[index] ?? null,
    frac: steps[index]?.frac ?? 1,
    total,
    done: Math.max(0, total - left),
    ageMs: Number.isNaN(updated) ? null : Math.max(0, now - updated),
  };
}

export function ageLabel(ms) {
  if (ms === null) return 'date inconnue';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}
