import { activityCandidates } from "./activities";
import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import { defaultHealthWinRank } from "./default-rank";
import { labCandidates } from "./labs";
import { percentileCandidates } from "./percentiles";
import { rankCandidates } from "./ranking";
import { isDate } from "./shared";
import type { CardSpec, HealthWinsInput } from "./types";

export { canonicalProvider } from "./daily-clean";
export { metricInfo } from "./metrics";

export type {
  Analyte, CardKind, CardSpec, DailySample, Experiment, Filter, Game, HealthWinRank,
  HealthWinRankResult, HealthWinsInput, LabDraw, Metric, RankMetric, Session, SessionType,
} from "./types";

/** Generate one member's ranked cards as of the supplied local calendar day. */
export function generateHealthWins(input: HealthWinsInput): CardSpec[] {
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
