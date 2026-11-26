import type { ExperimentMetricResult } from "@murphai/query";

import type { LabNormMetric } from "../../game/progress/norms";
import type { ActivityCharts } from "./activities";
import type { DailyCharts } from "./daily";
import type { LabCharts } from "./labs";
import type { PercentileCharts } from "./percentiles";

export type Metric =
  | "sleep_total_min" | "sleep_deep_min" | "sleep_score" | "sleep_efficiency"
  | "rhr_bpm" | "hrv_ms" | "steps" | "distance_km" | "floors" | "vo2max";

export interface DailySample {
  metric: Metric;
  provider: string;
  date: string;
  value: number;
}

export type SessionType = "run" | "walk" | "sauna" | "hiit" | "basketball" | "other";

export interface Session {
  type: SessionType;
  date: string;
  minutes: number;
}

export type Analyte =
  | "hdl" | "ldl" | "triglycerides" | "total_chol" | "hs_crp" | "insulin" | "a1c" | "glucose";

export interface LabDraw {
  analyte: Analyte;
  date: string;
  value: number;
  unit: string;
  flag?: "high" | "low" | "normal";
  fasting?: boolean | null;
  specimen?: string;
  /** Inclusive limits supplied by the reporting lab, in the draw's unit. */
  referenceRange?: { low?: number; high?: number };
}

export interface Experiment {
  slug: string;
  title: string;
  baseline: { start: string; end: string };
  intervention: { start: string; end: string };
  metric: Metric;
  baselineMean: number;
  interventionMean: number;
  expectedDirection: ExperimentMetricResult["expectedDirection"];
  adherence: { done: number; target: number };
  /** Identify private interventions even when the measured outcome is shareable. */
  sensitiveCategory?: "medications" | "genetics" | "conditions" | "weight";
}

export interface Game {
  exercise: string;
  total: number;
  unit: string;
  landmarksPassed: readonly { id: string; height: number }[];
  next: { id: string; height: number; toGo: number } | null;
  bestStreak: { days: number; start: string; end: string; missedOn: string | null } | null;
}

export type RankMetric = "restingHeartRate" | "steps" | "vo2Max" | LabNormMetric;

export interface HealthWinRankResult {
  /** Percentage of the comparison group the member's value outperforms, from 0 to 100. */
  betterShare: number;
  source: string;
  group: string;
  cuts: { percentile: number; value: number }[];
  lowerIsBetter: boolean;
}

export type HealthWinRank = (metric: RankMetric, value: number, context: {
  member: HealthWinsInput["member"];
  unit: string;
  /** Date-ordered, provider-selected observations contributing to this ranked value. */
  daily?: readonly DailySample[];
  fasting?: LabDraw["fasting"];
}) => HealthWinRankResult | null;

export interface HealthWinsInput {
  member: {
    today: string;
    age: number | null;
    sex: "female" | "male" | null;
    wearableProvider: string | null;
  };
  daily?: readonly DailySample[];
  sessions?: readonly Session[];
  labs?: readonly LabDraw[];
  experiments?: readonly Experiment[];
  games?: readonly Game[];
  /** All scheduled games contribute, including games without a classified exercise. */
  gameStreak?: Game["bestStreak"];
  rank?: HealthWinRank;
}

export type Filter = "Sleep" | "Fitness" | "Heart" | "Labs" | "Challenges" | "Experiments";
type Charts = DailyCharts & LabCharts & PercentileCharts & ActivityCharts;
export type CardKind = keyof Charts;

type DetectedCard = {
  [K in CardKind]: {
    kind: K;
    id: string;
    filter: Filter;
    title: { number: string; measure: string };
    subtitle: string;
    source_note: string;
    chart: Charts[K];
  }
}[CardKind];

export type CardSpec = DetectedCard & {
  theme: Lowercase<Filter>;
  share: { caption_tips: readonly string[] };
};

/** Private ranking evidence. Effect and noise use the same units. */
export interface Candidate {
  card: DetectedCard;
  /** Daily metric behind a trend, threshold, streak, monthly best or record. */
  metric?: Metric;
  date: string;
  effect: number;
  noise: number;
}
