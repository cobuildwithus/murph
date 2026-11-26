import { heartRateMethod, heartRateWindowSource, rankAge, rankBetterShare, rankLowerIsBetter } from "../../game/progress/norms";
import { canonicalProvider } from "./daily-clean";
import { labUnitKey } from "./shared";
import type { HealthWinRank, HealthWinRankResult, RankMetric } from "./types";

const citations = {
  oura_sleeping_hr: "Oura sleeping heart rate norms",
  apple_resting_hr: "Apple Heart and Movement Study",
  friend_vo2max: "FRIEND registry",
  nhanes_steps: "US adults, NHANES 2011-2014",
  nhanes_labs: "US adults, NHANES 2021-2023",
} satisfies Record<NonNullable<HealthWinRankResult["referenceKey"]>, string>;

function rankReference(metric: RankMetric, source: string | null): keyof typeof citations {
  switch (metric) {
    case "restingHeartRate":
      return heartRateMethod(source) === "sleep" ? "oura_sleeping_hr" : "apple_resting_hr";
    case "vo2Max": return "friend_vo2max";
    case "steps": return "nhanes_steps";
    default: return "nhanes_labs";
  }
}

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
  const referenceKey = rankReference(metric, source);
  const citation = citations[referenceKey];
  return {
    referenceKey,
    betterShare: rankBetterShare(metric, rank),
    source: fastingReference && fasting == null
      ? `Fasting status unknown for this draw. Compared with a fasting reference group. ${citation}`
      : citation,
    group: rank.group,
    cuts: rank.cuts,
    lowerIsBetter: rankLowerIsBetter(metric, rank),
  };
};
