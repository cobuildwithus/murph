export type ExperimentStatus = "active" | "paused" | "finished" | "stopped" | "upcoming";

export interface Expert {
  initials: string;
  name: string;
  field: string;
  quote: string;
}

export interface Study {
  type: "OBS" | "RCT" | "MA" | "SRC";
  title: string;
  authors: string;
  journal: string;
  year?: number;
  participants?: number;
  duration?: string;
  finding: string;
  url?: string;
}

export interface TimelineEvent {
  date: string;
  label?: string;
  title: string;
  description?: string;
  variant?: "default" | "outline" | "muted" | "primary";
  upcoming?: boolean;
  last?: boolean;
}

export interface TrendData {
  label: string;
  unit: string;
  baseline: { day: number; value: number }[];
  active: { day: number; value: number }[];
  baselineAvg: number;
  currentValue: number;
  delta: string;
}

export interface ExperimentSignal {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  direction: "up" | "down" | "neutral";
  expected: string;
  baseline?: string;
  description?: string;
}

export interface ExperimentSafety {
  cautionLevel: number;
  whoShouldAvoid: string[];
  precautions: string[];
}

export interface ExperimentProtocolStep {
  number: number;
  title: string;
  detail: string;
}

export interface ExperimentProtocolFact {
  label: string;
  value: string;
  detail?: string;
}

export interface ExperimentResearchStat {
  label: string;
  value: string | number;
}

export interface ExperimentCommonsReference {
  aliases: string[];
  catalogHash: string;
  key: string;
  pageRevisionId: string;
  recipeHash: string | null;
  routeId: string;
  runSpecRevisionId: string | null;
  slug: string;
}

export interface ExperimentNextStep {
  title: string;
  when: string;
  instructions?: string;
  context?: string;
  nextSession?: string;
}

export interface ExperimentConclusionSection {
  title: string;
  variant: "positive" | "neutral" | "insight" | "recommendation";
  items: { icon: string; text: string }[];
}

export interface ExperimentProtocol {
  protocolContractVersion: number;
  id: string;
  title: string;
  category: string;
  image: string;
  matchPercent?: number;
  durationDays: number;
  baselineDays: number;
  studyCount: number;
  evidenceLevel: number;
  evidenceLabel: string;
  description: string;
  expectedSignals: ExperimentSignal[];
  protocolFacts: ExperimentProtocolFact[];
  protocol: ExperimentProtocolStep[];
  protocolTips: string[];
  protocolKeepInMind: string[];
  protocolLogFields: string[];
  whyItWorks: string;
  experts: Expert[];
  researchStats: ExperimentResearchStat[];
  studies: Study[];
  podcastLinks?: { label: string; url: string }[];
  safety: ExperimentSafety;
  commons?: ExperimentCommonsReference;
}

export interface ExperimentRunProjection {
  id: string;
  source: "browser-vault";
  snapshotGeneratedAt: string;
  slug: string | null;
  status: Exclude<ExperimentStatus, "upcoming">;
  statusLabel: string;
  startedOn: string | null;
  tags: string[];
  title: string;
  day?: number;
  completionPercent?: number;
  dateRange?: string;
  analysisAvailableOn?: string;
  signals: ExperimentSignal[];
  trends: TrendData[];
  timeline: TimelineEvent[];
  nextStep?: ExperimentNextStep;
  summary?: string;
  summaryDetail?: string;
  conclusions?: ExperimentConclusionSection[];
}

export interface Experiment extends ExperimentProtocol {
  status: ExperimentStatus;
  day?: number;
  completionPercent?: number;
  dateRange?: string;
  analysisAvailableOn?: string;
  signals: ExperimentSignal[];
  trends: TrendData[];
  timeline: TimelineEvent[];
  privateRun?: ExperimentRunProjection;
  nextStep?: ExperimentNextStep;
  summary?: string;
  summaryDetail?: string;
  conclusions?: ExperimentConclusionSection[];
}

export interface HealthDomain {
  title: string;
  description: string;
  score: number | null;
  status:
    | "biggest-opportunity"
    | "experiment-active"
    | "stable"
    | "worth-attention"
    | "solid"
    | "not-started";
  statusLabel: string;
  secondaryInfo: string;
}

export interface ProfileStats {
  completed: number;
  daysTracked: number;
}

export interface ActiveExperiment {
  id: string;
  title: string;
  day: number;
  totalDays: number;
}
