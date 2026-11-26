import { dayNumber } from "./shared";
import type { Candidate, CardKind, CardSpec, Filter } from "./types";

const themes = {
  Sleep: "sleep", Fitness: "fitness", Heart: "heart",
  Labs: "labs", Challenges: "challenges", Experiments: "experiments",
} as const satisfies Record<Filter, CardSpec["theme"]>;

const dailyKindOrder: Partial<Record<CardKind, number>> = {
  trend_change: 0, threshold_count: 1, streak: 2, best_month: 3, personal_record: 4,
};

type Scored = Candidate & { score: number };

function byScore(a: Scored, b: Scored): number {
  return b.score - a.score || (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0);
}

function distinctClaims(group: Scored[]): Scored[] {
  if (!group[0].metric) return group.sort(byScore);
  group.sort((a, b) => (dailyKindOrder[a.card.kind] ?? 0) - (dailyKindOrder[b.card.kind] ?? 0) || byScore(a, b));
  const seen = new Set<string>();
  return group.filter(({ card, metric }) => {
    // A monthly mean repeats a trend's measurement. Distance's best month measures a total.
    const monthlyMean = card.kind === "best_month" && metric !== "distance_km";
    const claim = `${metric}:${monthlyMean ? "trend_change" : card.kind}`;
    if (seen.has(claim)) return false;
    seen.add(claim);
    return true;
  });
}

/** A full year of recency and a personal record are each worth one effect-to-noise unit. */
export function rankCandidates(candidates: readonly Candidate[], today: string): CardSpec[] {
  const asOf = dayNumber(today);
  // Two different accounts of the same achievement cannot establish which card is true.
  const unique = new Map<string, Candidate | null>();
  for (const candidate of candidates) {
    const id = candidate.card.id;
    const previous = unique.get(id);
    if (previous === undefined) unique.set(id, candidate);
    else if (previous && JSON.stringify(previous.card) !== JSON.stringify(candidate.card)) unique.set(id, null);
  }
  const groups = new Map<string, Scored[]>();
  for (const candidate of unique.values()) {
    if (!candidate) continue;
    const { card, date, effect, noise } = candidate;
    const age = asOf - dayNumber(date);
    const recency = Math.max(0, 1 - age / 365);
    const key = candidate.metric ? card.filter : `${card.filter}:other`;
    const group = groups.get(key) ?? [];
    group.push({ ...candidate, score: effect / noise + recency + Number(card.kind === "personal_record") });
    groups.set(key, group);
  }

  const queues = Array.from(groups.values(), distinctClaims);
  const selected: Scored[] = [];
  const counts = new Map<Filter, number>();
  while (selected.length < 12) {
    // Compare each filter's next eligible daily claim with its other independently scored cards.
    const next = queues.filter(queue => queue.length && (counts.get(queue[0].card.filter) ?? 0) < 3)
      .sort((a, b) => byScore(a[0], b[0]))[0];
    if (!next) break;
    const candidate = next.shift()!;
    selected.push(candidate);
    const filter = candidate.card.filter;
    counts.set(filter, (counts.get(filter) ?? 0) + 1);
  }
  const remaining = queues.flat().sort(byScore);
  const missingFilters = new Set(remaining.map(({ card }) => card.filter).filter(filter => !counts.has(filter)));
  for (const candidate of remaining) {
    if (selected.length === 24) break;
    // Leave a slot for the best remaining card from each unrepresented filter.
    const firstForFilter = missingFilters.delete(candidate.card.filter);
    if (firstForFilter || selected.length < 24 - missingFilters.size) selected.push(candidate);
  }
  return selected.map(({ card }) => ({
    ...card, theme: themes[card.filter], share: { caption_tips: [] },
  }));
}
