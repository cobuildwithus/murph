import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import { defaultHealthWinRank } from "./default-rank";
import { labCandidates } from "./labs";
import { isMetric } from "./metrics";
import { percentileCandidates } from "./percentiles";
import { decorateCard } from "./ranking";
import { dayNumber, isDate } from "./shared";
import type { Candidate, CardSpec, HealthWinsInput, Measure } from "./types";

function measureCandidates(input: HealthWinsInput, measure: Measure): Candidate[] {
  const { today } = input.member;
  if (!isDate(today)) return [];
  const rank = input.rank ?? defaultHealthWinRank;
  if (isMetric(measure)) {
    const daily = cleanDaily(input.daily?.filter(row => row.metric === measure) ?? [], today);
    return [
      ...percentileCandidates(input, daily, rank, { minBetterShare: 0 }),
      ...dailyCandidates(daily, today, { anyDelta: true }),
    ];
  }
  const labs = input.labs?.filter(draw => draw.analyte === measure);
  return labCandidates({ ...input, labs }, rank, { minBetterShare: 0, rangeMode: "independent" });
}

function selectCard(input: HealthWinsInput, measure: Measure, kinds: readonly string[]): CardSpec | null {
  const candidates = measureCandidates(input, measure);
  for (const kind of new Set(kinds)) {
    const candidate = candidates.find(({ card }) => card.measure === measure && card.kind === kind);
    if (candidate) return decorateCard(candidate.card);
  }
  return null;
}

/**
 * A lab's latest draw is over a year old. See yours still shows it to its viewer, but it isn't posted: a lab card
 * names no year, so an old draw would read as news (the same rule keeps it out of suggestions).
 */
export function seeYoursIsOld(input: HealthWinsInput, measure: Measure): boolean {
  if (isMetric(measure) || !isDate(input.member.today)) return false;
  const today = input.member.today;
  const latest = (input.labs ?? []).filter(draw => draw.analyte === measure && isDate(draw.date) && draw.date <= today)
    .map(draw => draw.date).sort().at(-1);
  return latest !== undefined && dayNumber(today) - dayNumber(latest) > 365;
}

/** Recompute the exact requested kind for publication, with no fallback or suggestion ranking. */
export function seeYoursCard(input: HealthWinsInput, measure: Measure, kind: string): CardSpec | null {
  return selectCard(input, measure, [kind]);
}

type SeeYoursChoice = { card: CardSpec } | { reason: "no_labs" | "no_wearable" | "not_enough_data" };

export function chooseSeeYours(input: HealthWinsInput, measure: Measure, friendKind: string, observed: boolean): SeeYoursChoice {
  const wearable = isMetric(measure);
  if (!observed) return { reason: wearable ? "no_wearable" : "no_labs" };
  const card = selectCard(input, measure, [friendKind, "percentile", wearable ? "trend_change" : "lab_range"]);
  return card ? { card } : { reason: "not_enough_data" };
}
