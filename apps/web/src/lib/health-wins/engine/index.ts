import { activityCandidates } from "./activities";
import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import { defaultHealthWinRank } from "./default-rank";
import { dietCandidates } from "./diet";
import { labCandidates } from "./labs";
import { percentileCandidates } from "./percentiles";
import { newestHealthWinsFirst, rankCandidates } from "./ranking";
import { isDate } from "./shared";
import type { CardSpec, DetectedHealthWins, HealthWinsInput, SelectedHealthWin } from "./types";

export { canonicalProvider } from "./daily-clean";
export { metricInfo } from "./metrics";

export type {
  Analyte, CardKind, CardSpec, DailySample, Experiment, Filter, Game, GameStreakDay, HealthWinAchievement, HealthWinRank,
  HealthWinRankResult, HealthWinsInput, LabDraw, MealDay, Metric, RankMetric, Session, SessionType,
} from "./types";

/** Detect one member's selected cards and private nudge evidence in engine rank order. */
export function detectHealthWins(input: HealthWinsInput): DetectedHealthWins {
  const { today } = input.member;
  if (!isDate(today)) return { cards: [], achievements: new Map(), selected: [] };
  const daily = cleanDaily(input.daily ?? [], today);
  const rank = input.rank ?? defaultHealthWinRank;
  return rankCandidates([
    ...dailyCandidates(daily, today),
    ...dietCandidates(input.meals ?? [], today),
    ...percentileCandidates(input, daily, rank),
    ...labCandidates(input, rank),
    ...activityCandidates(input),
  ], today);
}

/** Select cards in engine rank order for the optional Decisions pass. */
export function selectHealthWins(input: HealthWinsInput): SelectedHealthWin[] {
  return detectHealthWins(input).selected;
}

/** Generate one member's suggested cards, newest achievement first. */
export function generateHealthWins(input: HealthWinsInput): CardSpec[] {
  return newestHealthWinsFirst(selectHealthWins(input));
}
