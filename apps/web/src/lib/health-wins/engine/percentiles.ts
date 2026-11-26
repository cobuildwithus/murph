import { healthMean14 } from "../../game/progress/health";
import { metricInfo } from "./metrics";
import { cardDateKey, cardText, dayNumber, formatWinDate, isDate, mean } from "./shared";
import type { Candidate, DailySample, Filter, HealthWinRank, HealthWinRankResult, HealthWinsInput } from "./types";

export interface PercentileCharts {
  percentile: {
    type: "percentile";
    value: number;
    unit: string;
    cuts: HealthWinRankResult["cuts"];
    group: string;
    topPercent: number;
    lowerIsBetter: boolean;
  };
}

interface PercentileEvidence {
  rank: HealthWinRankResult | null;
  value: number;
  id: string;
  label: string;
  unit: string;
  filter: Filter;
  date: string;
  observation: string;
}

function cohortSubtitle(group: string): string {
  const cohort = group.replace(/^(Men|Women)\b/u, word => word.toLowerCase()).replace(/\.+$/u, "");
  const band = /^(men|women) (\d+0) to (\d+)$/u.exec(cohort);
  if (band && Number(band[3]) === Number(band[2]) + 9) return `for ${band[1]} in their ${band[2]}s`;
  return `for ${cohort}`;
}

export function percentileCandidate(evidence: PercentileEvidence, today: string): Candidate | undefined {
  const { rank, value, id, label, unit, filter, date, observation } = evidence;
  if (!rank || !(rank.betterShare >= 70 && rank.betterShare <= 100)) return;
  const source = cardText(rank.source).replace(/\b\d{4}-\d{2}-\d{2}\b/gu,
    date => isDate(date) ? formatWinDate(date, today) : date);
  const group = cardText(rank.group);
  if (!source || !group) return;
  const topPercent = Math.max(1, Math.ceil(100 - rank.betterShare));
  return {
    date, effect: rank.betterShare - 50, noise: 25,
    card: {
      id: `percentile-${id}-${cardDateKey(date)}`, kind: "percentile", filter,
      title: { number: `Top ${topPercent}%`, measure: label },
      subtitle: cohortSubtitle(group),
      source_note: `${observation}. ${source}`,
      chart: { type: "percentile", value, unit, group, cuts: rank.cuts, topPercent, lowerIsBetter: rank.lowerIsBetter },
    },
  };
}

const wearableRankMetrics = { rhr_bpm: "restingHeartRate", steps: "steps", vo2max: "vo2Max" } as const;

function wearableObservation(metric: keyof typeof wearableRankMetrics, rows: readonly DailySample[], today: string) {
  const series = rows.filter(row => row.metric === metric && row.date <= today);
  const latest = series.at(-1);
  if (!latest) return;
  if (metric === "vo2max") return {
    value: latest.value, points: [latest], date: latest.date,
    observation: `Wearable estimate on ${formatWinDate(latest.date, today)}`,
  };
  const days = series.filter(row => dayNumber(today) - dayNumber(row.date) < 14);
  const value = healthMean14(days, today);
  const through = formatWinDate(today, today);
  if (value !== null) return {
    value, points: days, date: latest.date,
    observation: `Mean of ${days.length} recorded days in the 14 days through ${through}`,
  };
  if (metric !== "rhr_bpm") return;
  const month = series.filter(row => row.date.startsWith(today.slice(0, 7)));
  if (month.length < 14) return;
  return {
    value: mean(month.map(row => row.value)), points: month, date: latest.date,
    observation: `Mean of ${month.length} recorded days this month through ${through}`,
  };
}

export function percentileCandidates(input: HealthWinsInput, rows: readonly DailySample[], rank: HealthWinRank): Candidate[] {
  const candidates: Candidate[] = [];
  const { member } = input;
  for (const metric of ["rhr_bpm", "steps", "vo2max"] as const) {
    const reading = wearableObservation(metric, rows, member.today);
    if (!reading) continue;
    const { label, unit, filter } = metricInfo(metric);
    const candidate = percentileCandidate({
      rank: rank(wearableRankMetrics[metric], reading.value, { member, unit, daily: reading.points }),
      value: reading.value, date: reading.date, observation: reading.observation, id: metric, label, unit, filter,
    }, member.today);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
