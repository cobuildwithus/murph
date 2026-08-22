import type {
  ExperimentOutcomeStatistic,
  ExperimentStructuredReviewResult,
  HealthCommonsExperimentOnboarding,
  HealthCommonsMeasurementMethodTier,
} from "@murphai/contracts";

export type ExperimentStatus = "active" | "paused" | "finished" | "stopped" | "upcoming";

export type ExperimentOnboarding = HealthCommonsExperimentOnboarding;

export interface Expert {
  initials: string;
  name: string;
  field: string;
  profileImageUrl?: string;
  quote: string;
}

export type EvidenceStance =
  | "supports"
  | "mixed"
  | "does_not_confirm"
  | "contradicts"
  | "safety_boundary"
  | "context_only";

export type EvidenceScope =
  | "direct_protocol"
  | "same_mechanism"
  | "clinical_supervised"
  | "adjacent_variant"
  | "measurement_context"
  | "general_guideline";

export type StudyResult =
  | "positive"
  | "mixed"
  | "no_clear_advantage"
  | "negative"
  | "not_efficacy_evidence";

export interface Study {
  type: "OBS" | "RCT" | "INT" | "N1" | "MECH" | "MA" | "REV" | "GUIDE" | "SRC";
  title: string;
  authors: string;
  journal: string;
  year?: number;
  participants?: number;
  participantCountKind?: "reported" | "approximate" | "range";
  includedStudyCount?: number;
  population?: string;
  duration?: string;
  designLabel?: string;
  groupId?: string;
  stance?: EvidenceStance;
  scope?: EvidenceScope;
  result?: StudyResult;
  headline?: string;
  finding?: string;
  findingKind?: "finding" | "why_it_matters" | "protocol_takeaway";
  implication?: string;
  caveat?: string;
  displayPriority?: number;
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
  startDate: string;
  history: { day: number; value: number }[];
  baseline: { day: number; value: number }[];
  active: { day: number; value: number }[];
  expectedRange?: { day: number; low: number; high: number }[];
  baselineAvg: number;
  currentValue: number;
  currentValueLabel?:
    | "count"
    | "experiment average"
    | "latest"
    | "maximum"
    | "median"
    | "minimum"
    | "total";
  statistic?: ExperimentOutcomeStatistic;
  delta: string;
  windowComparison?: {
    baselineDaysWithData: number;
    baselineTotalDays: number;
    interventionDaysWithData: number;
    interventionTotalDays: number;
  };
}

export type ExperimentSignalProminence = "focus" | "context";

export type ExperimentSignalEstimatedChange =
  | {
      basis?: string;
      confidence?: "low" | "moderate" | "high" | "mixed";
      high: number;
      kind: "absolute" | "relative_percent";
      low: number;
      unit: string;
      window?: string;
    }
  | {
      basis?: string;
      confidence?: "low" | "moderate" | "high" | "mixed";
      kind: "mixed_or_contextual";
      window?: string;
    };

export interface ExperimentSignal {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  direction: "up" | "down" | "neutral";
  sentiment?: "positive" | "negative" | "neutral";
  displayValue?: string;
  estimatedChange?: ExperimentSignalEstimatedChange;
  expected: string;
  baseline?: string;
  biomarkerRouteId?: string;
  description?: string;
  protocolProminence?: ExperimentSignalProminence;
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

export interface ExperimentMechanismChainStep {
  content: string;
  label: string;
}

export type ExperimentSessionShapeSegmentKind =
  | "preparation"
  | "stimulus"
  | "recovery"
  | "cooldown"
  | "transition"
  | "context";

export interface ExperimentSessionShapeSegment {
  durationMinutes: number;
  kind: ExperimentSessionShapeSegmentKind;
  label: string;
}

export type ExperimentSessionShapeTick =
  | string
  | {
      label: string;
      offsetMinutes: number;
    }
  | {
      label: string;
      positionPercent: number;
    };

export interface ExperimentSessionShape {
  label?: string;
  segments: ExperimentSessionShapeSegment[];
  summarySegments?: ExperimentSessionShapeSegment[];
  ticks?: ExperimentSessionShapeTick[];
}

export interface ExperimentMeasurementMethodReference {
  href?: string;
  key: string;
  modalities: string[];
  privacy?: {
    containsIdentifiableImages?: boolean;
    localOnlyRecommended?: boolean;
    notes: string[];
  };
  routeId?: string;
  shortName: string;
  summary?: string;
  tier: HealthCommonsMeasurementMethodTier;
  title: string;
}

export interface ExperimentMeasurementPath {
  isDefault: boolean;
  label: string;
  methodKeys: string[];
  methods: ExperimentMeasurementMethodReference[];
  notes: string[];
  outcomeLabels: string[];
  pathId: string;
  required: boolean;
  safetyOutcomeLabels: string[];
  tier: HealthCommonsMeasurementMethodTier;
}

export interface ExperimentResearchStat {
  label: string;
  value: string | number;
}

export interface ExperimentResearchGroup {
  id: string;
  label: string;
  stance: EvidenceStance;
  summary: string;
  studies: Study[];
  defaultOpen?: boolean;
}

export interface ExperimentResearchLandscape {
  bottomLine: string;
  confidenceLabel: "early" | "moderate" | "strong" | "mixed" | "limited";
  primaryClaim: string;
  mainCaveat: string;
  groups: ExperimentResearchGroup[];
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
  researchSummaryLabel: string;
  evidenceLevel: number;
  evidenceLabel: string;
  description: string;
  expectedSignals: ExperimentSignal[];
  measurementPaths: ExperimentMeasurementPath[];
  protocolFacts: ExperimentProtocolFact[];
  protocol: ExperimentProtocolStep[];
  protocolTips: string[];
  protocolKeepInMind: string[];
  protocolLogFields: string[];
  experimentOnboarding?: ExperimentOnboarding;
  mechanismChain: ExperimentMechanismChainStep[];
  sessionShape?: ExperimentSessionShape;
  whyItWorks: string;
  experts: Expert[];
  researchStats: ExperimentResearchStat[];
  researchLandscape?: ExperimentResearchLandscape;
  researchGroups?: ExperimentResearchGroup[];
  studies: Study[];
  podcastLinks?: { label: string; url: string }[];
  safety: ExperimentSafety;
  commons?: ExperimentCommonsReference;
}

export type ScheduleCellKind =
  | "baseline"
  | "completed"
  | "assumed"
  | "partial"
  | "missed"
  | "failed"
  | "unknown"
  | "scheduled";

export interface ScheduleCell {
  columnStart?: number;
  dayLabel: string;
  date?: string;
  kind: ScheduleCellKind;
  detail?: string;
  isToday?: boolean;
  occurrences?: ScheduleCellOccurrences;
}

export interface ScheduleCellOccurrences {
  assumed: number;
  completed: number;
  expected: number;
  failed: number;
  missed: number;
  partial: number;
  scheduled: number;
  unknown: number;
}

export interface ScheduleWeek {
  label: string;
  dateRange: string;
  summary?: string;
  cells: ScheduleCell[];
}

export interface ExperimentSchedule {
  cadence: string;
  dose?: string;
  loggedSessions?: number;
  weeks: ScheduleWeek[];
}

export interface ExperimentRunContextEntry {
  confounders: string[];
  date: string | null;
  id: string;
  kind: "session" | "context";
  note?: string;
  symptoms: string[];
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
  baselineDays?: number;
  durationDays?: number;
  day?: number;
  completionPercent?: number;
  dateRange?: string;
  analysisAvailableOn?: string;
  signals: ExperimentSignal[];
  trends: TrendData[];
  timeline: TimelineEvent[];
  schedule?: ExperimentSchedule;
  sessionContext?: ExperimentRunContextEntry[];
  nextStep?: ExperimentNextStep;
  outcomeStatus: "available" | "not_expected" | "pending" | "unavailable";
  outcomeKind?: "metric" | "structured_review" | null;
  structuredReviewStatus?: ExperimentStructuredReviewResult["status"];
  outcomeConfidence?: "low" | "medium" | "high";
  summary?: string;
  summaryDetail?: string;
  timingKnown: boolean;
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
  schedule?: ExperimentSchedule;
  sessionContext?: ExperimentRunContextEntry[];
  privateRun?: ExperimentRunProjection;
  nextStep?: ExperimentNextStep;
  outcomeConfidence?: ExperimentRunProjection["outcomeConfidence"];
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
