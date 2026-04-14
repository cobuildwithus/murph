export type ExperimentStatus = "active" | "finished" | "upcoming";

export interface Expert {
  initials: string;
  name: string;
  field: string;
  quote: string;
}

export interface Study {
  type: "OBS" | "RCT" | "MA";
  title: string;
  authors: string;
  journal: string;
  year: number;
  participants: number;
  duration: string;
  finding: string;
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

export interface Experiment {
  id: string;
  title: string;
  category: string;
  status: ExperimentStatus;
  image: string;
  matchPercent?: number;
  durationDays: number;
  baselineDays: number;
  studyCount: number;
  day?: number;
  completionPercent?: number;
  dateRange?: string;
  evidenceLevel: number;
  evidenceLabel: string;
  description: string;
  expectedSignals: {
    label: string;
    value: string;
    unit?: string;
    delta: string;
    direction: "up" | "down" | "neutral";
    expected: string;
    baseline?: string;
    description?: string;
  }[];
  protocol: { number: number; title: string; detail: string }[];
  whyItWorks: string;
  experts: Expert[];
  researchStats: {
    studies: number;
    participants: number;
    yearsFollowUp: number;
    evidenceLevel: string;
  };
  studies: Study[];
  podcastLinks?: { label: string; url: string }[];
  safety: {
    cautionLevel: number;
    whoShouldAvoid: string[];
    precautions: string[];
  };
  signals: {
    label: string;
    value: string;
    unit?: string;
    delta: string;
    direction: "up" | "down" | "neutral";
    expected: string;
    baseline?: string;
  }[];
  trends: TrendData[];
  timeline: TimelineEvent[];
  nextStep?: {
    title: string;
    when: string;
    instructions?: string;
    context?: string;
    nextSession?: string;
  };
  summary?: string;
  summaryDetail?: string;
  conclusions?: {
    title: string;
    variant: "positive" | "neutral" | "insight" | "recommendation";
    items: { icon: string; text: string }[];
  }[];
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
