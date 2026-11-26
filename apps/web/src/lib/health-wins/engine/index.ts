import { activityCandidates } from "./activities";
import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import { defaultHealthWinRank } from "./default-rank";
import { labCandidates } from "./labs";
import { percentileCandidates } from "./percentiles";
import { newestHealthWinsFirst, rankCandidates, type SelectedHealthWin } from "./ranking";
import { isDate } from "./shared";
import type { CardSpec, HealthWinsInput } from "./types";

export { canonicalProvider } from "./daily-clean";
export { metricInfo } from "./metrics";

export type {
  Analyte, CardKind, CardSpec, DailySample, Experiment, Filter, Game, GameStreakDay, HealthWinRank,
  HealthWinRankResult, HealthWinsInput, LabDraw, Metric, RankMetric, Session, SessionType,
} from "./types";

/** Select cards in engine rank order for the optional Decisions pass. */
export function selectHealthWins(input: HealthWinsInput): SelectedHealthWin[] {
  const { today } = input.member;
  if (!isDate(today)) return [];
  const daily = cleanDaily(input.daily ?? [], today);
  const rank = input.rank ?? defaultHealthWinRank;
  return rankCandidates([
    ...dailyCandidates(daily, today),
    ...percentileCandidates(input, daily, rank),
    ...labCandidates(input, rank),
    ...activityCandidates(input),
  ], today);
}

/** Generate one member's suggested cards, newest achievement first. */
export function generateHealthWins(input: HealthWinsInput): CardSpec[] {
  return newestHealthWinsFirst(selectHealthWins(input));
}
