import type { ExperimentMetricResult } from "@murphai/query";

import type { LabNormMetric } from "../../game/progress/norms";
import type { ActivityCharts } from "./activities";
import type { DailyCharts } from "./daily";
import type { LabCharts } from "./labs";
import type { PercentileCharts } from "./percentiles";
import type { RouteCharts } from "./route-cards";

export type RecordedActivityKind = "sauna" | "cold_plunge" | "lift" | "other" | "run" | "walk";

export interface RecordedRouteSummary {
  distanceM: number;
  climbM: number;
  splits: { distanceM: number; seconds: number }[];
}

export interface RecordedRoute extends RecordedRouteSummary {
  paths: string[];
}

export interface RecordedActivitySummary {
  id: string;
  kind: RecordedActivityKind;
  name?: string;
  startedAt: string;
  elapsedSec: number;
  movingSec: number;
  timerSec?: number;
  heartRate?: { avgBpm: number; lowBpm: number; peakBpm: number };
  route?: RecordedRouteSummary;
}

export interface RecordedActivity extends RecordedActivitySummary {
  heartRate?: NonNullable<RecordedActivitySummary["heartRate"]> & { perMinute?: (number | null)[] };
  route?: RecordedRouteSummary & { paths?: string[] };
}

type MinuteReading = { minute: number; bpm: number };
interface RecordedCharts {
  activity_heart_rate: {
    type: "heart_rate";
    perMinute: (number | null)[];
    low: MinuteReading;
    peak: MinuteReading;
    timerMinutes?: number;
  };
  activity_time: { type: "duration"; minutes: number; timerMinutes?: number };
}

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

export interface GameStreakDay {
  date: string;
  state: "posted" | "missed" | "no_game";
}

export interface Game {
  exercise: string;
  total: number;
  unit: string;
  /** Heights use feet from the Progress landmark bank. */
  landmarksPassed: readonly { id: string; height: number }[];
  /** Height is in feet. The remaining exercise amount uses the game's unit. */
  next: { id: string; height: number; toGo: number } | null;
  bestStreak: {
    days: number;
    start: string;
    end: string;
    missedOn: string | null;
    /**
     * Per-date outcomes across games for the Monday–Sunday weeks touched by the
     * streak. Omitted dates have no settled outcome. Older summaries lack daily evidence.
     */
    calendar?: readonly GameStreakDay[];
  } | null;
}

export type RankMetric = "restingHeartRate" | "steps" | "vo2Max" | LabNormMetric;

export interface HealthWinRankResult {
  /** Percentage of the comparison group the member's value outperforms, from 0 to 100. */
  betterShare: number;
  /** Short, member-facing citation for the comparison cohort. */
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
type Charts = DailyCharts & LabCharts & PercentileCharts & ActivityCharts & RecordedCharts & RouteCharts;
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
