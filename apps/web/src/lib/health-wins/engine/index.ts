import { activityCandidates } from "./activities";
import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import { defaultHealthWinRank } from "./default-rank";
import { dietCandidates } from "./diet";
import { labCandidates } from "./labs";
import { percentileCandidates } from "./percentiles";
import { rankCandidates } from "./ranking";
import { isDate } from "./shared";
import type { CardSpec, DetectedHealthWins, HealthWinsInput } from "./types";

export { canonicalProvider } from "./daily-clean";
export { metricInfo } from "./metrics";

export type {
  Analyte, CardKind, CardSpec, DailySample, Experiment, Filter, Game, GameStreakDay, HealthWinAchievement, HealthWinRank,
  HealthWinRankResult, HealthWinsInput, LabDraw, MealDay, Metric, RankMetric, Session, SessionType,
} from "./types";

/** Generate one member's ranked cards as of the supplied local calendar day. */
export function generateHealthWins(input: HealthWinsInput): CardSpec[] {
  return detectHealthWins(input).cards;
}

export function detectHealthWins(input: HealthWinsInput): DetectedHealthWins {
  const { today } = input.member;
  if (!isDate(today)) return { cards: [], achievements: new Map() };
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
