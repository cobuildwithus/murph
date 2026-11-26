import { heartRateMethod, heartRateWindowSource, rankAge, rankBetterShare, rankLowerIsBetter } from "../../game/progress/norms";
import { canonicalProvider } from "./daily-clean";
import { labUnitKey } from "./shared";
import type { HealthWinRank } from "./types";

/** Compare each observation to a reference population measured the same way. */
export const defaultHealthWinRank: HealthWinRank = (metric, value, { member, daily, fasting, unit }) => {
  let source = null;
  if (metric === "restingHeartRate") {
    if (!daily?.length) return null;
    const days = daily.map(point => ({ date: point.date, source: point.provider }));
    source = heartRateWindowSource(days, daily[0].date, member.today);
    if (!source || heartRateMethod(source) !== heartRateMethod(canonicalProvider(member.wearableProvider ?? ""))) return null;
  }
  const fastingReference = metric === "triglycerides" || metric === "ldlCholesterol" || metric === "fastingInsulin";
  if (fastingReference && fasting != null && fasting !== true) return null;
  const rank = rankAge(metric, value, member, source);
  if (!rank || (rank.unit !== undefined && labUnitKey(unit) !== labUnitKey(rank.unit))) return null;
  return {
    betterShare: rankBetterShare(metric, rank),
    source: fastingReference && fasting == null
      ? `Fasting status unknown for this draw. Compared with a fasting reference group. ${rank.source}`
      : rank.source,
    group: rank.group,
    cuts: rank.cuts,
    lowerIsBetter: rankLowerIsBetter(metric, rank),
  };
};
