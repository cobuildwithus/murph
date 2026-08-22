import {
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  EXPERIMENT_PROGRESS_SCHEMA_VERSION,
  deviceDataOriginSchema,
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  experimentProgressSnapshotSchema,
  safeParseContract,
  summarizeExperimentOutcomeValues,
  toLocalDayKey,
  type DeviceDataOrigin,
  type ExperimentFrontmatter,
  type ExperimentOutcome,
  type ExperimentOutcomeMetricPoint,
  type ExperimentOutcomeStatistic,
  type ExperimentStructuredReviewResult,
  type ExperimentProgressMetricSignal,
  type ExperimentProgressSnapshot,
} from "@murphai/contracts";

import { getExperiment, type VaultReadModel } from "./read-model.ts";
import {
  buildExperimentAdherenceCalendar,
  countAdherenceConfidenceSessions,
  countCalendarAdherenceSessions,
  countCompletedAdherenceSessions,
  eventKindIsCandidateForEvidence,
  expandExperimentAdherenceExpectations,
  experimentAdherenceTargetPlansDate,
  linkedEventObservationMatchesEvidence,
  resolveActivityEvidenceLocalDate,
  resolveAdherenceObservationActivityKind,
  resolveExperimentAdherenceRollupTarget,
  resolveExperimentAdherenceTargets,
  resolveEffectiveExperimentLinkedEventMissingPolicy,
  resolveInterventionSessionLocalDate,
  type ExperimentAdherenceCalendarResult,
  type ExperimentAdherenceObservation,
} from "./experiment-adherence.ts";
import {
  isRegisteredExperimentMetricSource,
  matchesExperimentMetricIdentity,
  resolveExperimentMetricIdentity,
} from "./experiment-metrics.ts";
import {
  resolveExperimentMetricOutcome,
  resolveExperimentPrimaryOutcome,
  summarizeExperimentOutcomeEvidencePlan,
  type ExperimentOutcomeEvidencePlanSummary,
  type ResolvedExperimentMetricOutcome,
  type ResolvedExperimentPrimaryOutcome,
} from "./experiment-outcomes.ts";
import { metricPointRecordIds } from "./metrics/index.ts";
import {
  readExperimentProtocolProjectionFields,
  type ExperimentProtocolProjectionFields,
} from "./protocols.ts";
import {
  assessExperimentPrimaryMetricCapture,
  metricWindowUnitsAreCompatible,
  resolveMetricDefinition,
  resolveExperimentSessionMetricSpec,
  validateExperimentSessionMetricValue,
  selectMetricSeries,
  unitsEquivalent,
  type MetricPoint,
  type MetricSeriesPoint,
} from "./metrics/index.ts";
import { buildMetricProjection } from "./metrics/projection.ts";
import { summarizeWearableDay, type WearableDaySummary } from "./wearables.ts";
import { readWearableExternalRef } from "./wearables/observation.ts";
import {
  inferJunctionWearableDataOriginFromExternalRef,
  resolveWearablePublicSourceProvider,
} from "./wearables/origin.ts";
import type { WearableExternalRef } from "./wearables/types.ts";

import type { CanonicalEntity } from "./canonical-entities.ts";

const MAX_EXPERIMENT_ANALYSIS_WINDOW_DAYS = 366;
const MAX_DATA_COVERAGE_PROVIDERS = 20;
// Answers whether the vault is currently receiving workout events.
const ACTIVITY_PROVIDER_COVERAGE_WINDOW_DAYS = 30;

export type ExperimentProgressPhase =
  | "planned"
  | "baseline"
  | "intervention"
  | "review_due"
  | "completed"
  | "paused"
  | "abandoned";
export type ExperimentAdherenceStatus =
  | "not_started"
  | "behind"
  | "on_track"
  | "met_minimum"
  | "met_target"
  | "unknown";
export type ExperimentCoverageStatus =
  | "no_wearable_data"
  | "insufficient"
  | "partial"
  | "sufficient_for_progress"
  | "ready_for_review";
export type ExperimentRecommendationAction = "skip" | "remind" | "summary" | "review";
export type ExperimentOutcomeConfidenceLevel = "low" | "medium" | "high";
export type ExperimentProgressReadinessReason =
  | "missing_run_plan"
  | "missing_baseline_window"
  | "missing_intervention_window"
  | "missing_analysis_plan"
  | "missing_primary_biomarker"
  | "missing_metric_window"
  | "unsupported_primary_biomarker"
  | "uncapturable_primary_biomarker";
export type ExperimentFollowupKind = "missed-log" | "weekly-digest";
export type ExperimentFollowupAction = "notify" | "skip";
export type ExperimentFollowupReason =
  | "experiment_not_active"
  | "not_in_intervention_window"
  | "missed_log_followup_disabled"
  | "reminders_disabled"
  | "session_already_logged"
  | "session_assumed"
  | "planned_session_log_missing"
  | "unsupported_session_schedule"
  | "weekly_digest_disabled"
  | "weekly_digest_not_due"
  | "weekly_digest_due";

export interface ExperimentMetricPeriodSummary {
  daysWithData: number;
  mean: number | null;
  totalDays: number;
  unit: string | null;
}

export interface ExperimentMetricResult {
  baselineDayCount: number;
  baselineMean: number | null;
  baseline: ExperimentMetricPeriodSummary;
  biomarkerKey: string;
  completeness: "insufficient" | "partial" | "good";
  deltaAbs: number | null;
  deltaPct: number | null;
  expectedDirection: "increase" | "decrease" | "stabilize" | null;
  interventionDayCount: number;
  interventionMean: number | null;
  intervention: ExperimentMetricPeriodSummary;
  label: string;
  movedAsExpected: boolean | null;
  statistic?: ExperimentOutcomeStatistic;
  unit: string | null;
}

export interface ExperimentOutcomeMetricResult extends ExperimentMetricResult {
  points: ExperimentOutcomeMetricPoint[];
}

export interface ExperimentProgressSummary extends ExperimentProgressSnapshot {
  schema: typeof EXPERIMENT_PROGRESS_SCHEMA_VERSION;
  asOf: string;
  adherence: {
    completedSessions: number;
    assumedSessions?: number;
    evidence?: {
      eventKind: "activity_session" | "intervention_session";
      activityKind?: string;
      activityKinds?: string[];
      minimumDurationMinutes?: number;
    };
    confirmedSessions?: number;
    expectedSessionsByNow: number | null;
    loggedSessions?: number;
    minimumUsefulSessions: number | null;
    partialSessions?: number;
    sensedSessions?: number;
    sessionEventIds?: string[];
    status: ExperimentAdherenceStatus;
    targetSessions: number | null;
  };
  confounders: string[];
  dataCoverage: {
    activityProviders: string[];
    baselineDaysAvailable: number;
    interventionDaysAvailable: number;
    primaryBiomarkerKey?: string | null;
    primaryMetricDaysAvailable: number;
    status: ExperimentCoverageStatus;
    wearableProviders: string[];
  };
  dayInRun: number | null;
  setupReadiness: {
    status: "ready" | "incomplete";
    blockingReasons: ExperimentProgressReadinessReason[];
  };
  analysisReadiness: {
    status: "ready" | "incomplete";
    blockingReasons: ExperimentProgressReadinessReason[];
  };
  experiment: {
    id: string;
    slug: string;
    status: ExperimentFrontmatter["status"];
    title: string;
  };
  commonsProtocolRef: ExperimentProtocolProjectionFields["commonsProtocolRef"];
  effectiveProtocolSnapshot: ExperimentProtocolProjectionFields["effectiveProtocolSnapshot"];
  phase: ExperimentProgressPhase;
  protocolRef: ExperimentProtocolProjectionFields["protocolRef"];
  recommendation: {
    action: ExperimentRecommendationAction;
    reason: string;
    shouldNotifyUser: boolean;
  };
  earlySignals?: ExperimentProgressMetricSignal[];
  signals: ExperimentMetricResult[];
  windows: {
    baselineEnd: string | null;
    baselineStart: string | null;
    interventionEnd: string | null;
    interventionStart: string | null;
  };
}

export interface ExperimentOutcomeSummary extends ExperimentOutcome {
  schema: typeof EXPERIMENT_OUTCOME_SCHEMA_VERSION;
  schemaVersion: typeof EXPERIMENT_OUTCOME_SCHEMA_VERSION;
  adherenceSummary: {
    adherenceLevel?: "unknown" | "low" | "partial" | "good";
    completedSessions: number;
    minimumUsefulSessions: number | null;
    status: ExperimentAdherenceStatus;
    targetSessions: number | null;
  };
  asOf: string;
  generatedAt?: string;
  outcomeId?: string;
  conclusion: {
    caveats: string[];
    headline: string;
    plainLanguage: string;
  };
  confidence: {
    level: ExperimentOutcomeConfidenceLevel;
    reasons: string[];
  };
  confounders: string[];
  experiment: {
    id: string;
    slug: string;
    status: ExperimentFrontmatter["status"];
    title: string;
  };
  commonsProtocolRef: ExperimentProtocolProjectionFields["commonsProtocolRef"];
  effectiveProtocolSnapshot: ExperimentProtocolProjectionFields["effectiveProtocolSnapshot"];
  metricResults: ExperimentOutcomeMetricResult[];
  structuredReview?: ExperimentStructuredReviewResult;
  protocolRef: ExperimentProtocolProjectionFields["protocolRef"];
  windows: ExperimentProgressSummary["windows"];
}

export interface ExperimentFollowupDueDecision {
  schema: "murph.experiment-followup-due.v1";
  kind: ExperimentFollowupKind;
  action: ExperimentFollowupAction;
  reason: ExperimentFollowupReason;
  date: string;
  dedupeKey: string;
  experiment: {
    id: string;
    slug: string;
    status: ExperimentFrontmatter["status"];
    title: string;
  };
  window: {
    sessionDate: string | null;
    baselineStart: string | null;
    baselineEnd: string | null;
    interventionStart: string | null;
    interventionEnd: string | null;
  };
}

interface ExperimentSummaryContext {
  adherenceEvents: CanonicalEntity[];
  asOf: string;
  baselineDates: string[];
  confounders: string[];
  events: CanonicalEntity[];
  experiment: CanonicalEntity;
  frontmatter: QueryExperimentFrontmatter;
  interventionDates: string[];
  metricPoints: readonly MetricPoint[];
  progressPhase: ExperimentProgressPhase;
  summariesByDate: Map<string, WearableDaySummary | null>;
}

type ExperimentFollowupContext = Pick<
  ExperimentSummaryContext,
  "adherenceEvents" | "events" | "frontmatter" | "progressPhase"
> & {
  adherenceTargets: readonly QueryExperimentAdherenceTarget[];
};

interface ExperimentMetricPointOptions {
  metricPoints?: readonly MetricPoint[];
}

interface MetricWindowPair {
  baseline: MetricWindowSelection;
  intervention: MetricWindowSelection;
  source: "point_measurement" | "run_window";
}

type QueryExperimentFrontmatter = ExperimentFrontmatter;
type QueryExperimentAdherenceTarget = NonNullable<
  NonNullable<ExperimentFrontmatter["runPlan"]>["adherenceTargets"]
>[number];

interface MetricWindowSelection {
  daysWithData: number;
  mean: number | null;
  points: ExperimentOutcomeMetricPoint[];
  totalDays: number;
  unit: string | null;
}

export function summarizeExperimentProgress(
  vault: VaultReadModel,
  slug: string,
  options: { asOf?: string } & ExperimentMetricPointOptions = {},
): ExperimentProgressSummary {
  const context = buildExperimentSummaryContext(vault, slug, options);
  const signals = buildMetricResults(context);
  const primaryOutcome = resolveExperimentPrimaryOutcome(context.frontmatter.analysisPlan);
  const primarySignal =
    primaryOutcome?.kind === "metric"
      ? signals.find((signal) => signal.biomarkerKey === primaryOutcome.key) ?? null
      : null;
  const primaryBiomarkerKey = primaryOutcome?.key ?? null;
  const hasPrimarySignal =
    primaryBiomarkerKey !== null && primarySignal?.biomarkerKey === primaryBiomarkerKey;
  const metricDaysAvailable = summarizeSignalDayCoverage(signals);
  const baselineDaysAvailable = metricDaysAvailable.baselineDaysAvailable > 0
    ? metricDaysAvailable.baselineDaysAvailable
    : hasPrimarySignal
      ? primarySignal.baselineDayCount
      : countDatesWithWearableData(context.baselineDates, context.summariesByDate);
  const interventionDaysAvailable = metricDaysAvailable.interventionDaysAvailable > 0
    ? metricDaysAvailable.interventionDaysAvailable
    : hasPrimarySignal
      ? primarySignal.interventionDayCount
      : countDatesWithWearableData(context.interventionDates, context.summariesByDate);
  const adherence = buildAdherenceSummary(context);
  const dataCoverage = buildCoverageSummary({
    asOf: context.asOf,
    baselineDaysAvailable,
    interventionDaysAvailable,
    primarySignal,
    progressPhase: context.progressPhase,
    frontmatter: context.frontmatter,
    signals,
    summariesByDate: context.summariesByDate,
    vault,
  });
  const setupReadiness = buildSetupReadiness(context.frontmatter);
  const analysisReadiness = buildAnalysisReadiness(context.frontmatter);

  const result = safeParseContract(experimentProgressSnapshotSchema, {
    schemaVersion: EXPERIMENT_PROGRESS_SCHEMA_VERSION,
    schema: EXPERIMENT_PROGRESS_SCHEMA_VERSION,
    asOf: context.asOf,
    adherence,
    confounders: context.confounders,
    dataCoverage,
    dayInRun: dayInRun(context.frontmatter, context.asOf),
    setupReadiness,
    analysisReadiness,
    experiment: {
      id: context.frontmatter.experimentId,
      slug: context.frontmatter.slug,
      status: context.frontmatter.status,
      title: context.frontmatter.title,
    },
    commonsProtocolRef: context.frontmatter.commonsProtocolRef ?? null,
    phase: context.progressPhase,
    protocolRef: context.frontmatter.protocolRef ?? null,
    recommendation: buildProgressRecommendation({
      adherence,
      assistantSupport: context.frontmatter.assistantSupport,
      dataCoverage,
      hasSafetyFollowUp: hasSafetyFollowUp(context.events),
      phase: context.progressPhase,
    }),
    earlySignals: buildProgressSignals(signals),
    signals,
    windows: buildWindowSummary(context.frontmatter),
  });

  if (!result.success) {
    throw new Error(`Experiment progress for "${slug}" is invalid.`);
  }

  return {
    ...result.data,
    schema: EXPERIMENT_PROGRESS_SCHEMA_VERSION,
    commonsProtocolRef: context.frontmatter.commonsProtocolRef ?? null,
    effectiveProtocolSnapshot: context.frontmatter.effectiveProtocolSnapshot ?? null,
    protocolRef: context.frontmatter.protocolRef ?? null,
  } as ExperimentProgressSummary;
}

export function analyzeExperimentOutcome(
  vault: VaultReadModel,
  slug: string,
  options: { asOf?: string } & ExperimentMetricPointOptions = {},
): ExperimentOutcomeSummary {
  const context = buildExperimentSummaryContext(vault, slug, options);
  const primaryOutcome = resolveExperimentPrimaryOutcome(context.frontmatter.analysisPlan);
  const outcomeEvidence = primaryOutcome
    ? summarizeExperimentOutcomeEvidencePlan(
        context.frontmatter.analysisPlan,
        primaryOutcome.key,
        {
          evidenceObservedOnByRecordId: collectVaultEvidenceObservedOn(vault),
          observedThrough: context.asOf,
        },
      )
    : null;
  const metricResults = buildMetricResults(context, { includePoints: true });
  const adherence = buildAdherenceSummary(context);
  const primary =
    primaryOutcome?.kind === "metric"
      ? metricResults.find((metric) => metric.biomarkerKey === primaryOutcome.key) ?? null
      : null;
  const confidence = buildOutcomeConfidence({
    adherence,
    confounders: context.confounders,
    legacyPrimaryBiomarker:
      context.frontmatter.analysisPlan?.primaryOutcome === undefined,
    outcomeEvidence,
    primary,
    primaryOutcome,
  });
  const structuredReview = buildStructuredReviewResult(
    primaryOutcome,
    outcomeEvidence,
  );

  const result = safeParseContract(experimentOutcomeSchema, {
    schemaVersion: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    schema: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    adherenceSummary: {
      adherenceLevel: classifyAdherenceLevel(adherence),
      completedSessions: adherence.completedSessions,
      minimumUsefulSessions: adherence.minimumUsefulSessions,
      status: adherence.status,
      targetSessions: adherence.targetSessions,
    },
    asOf: context.asOf,
    conclusion: buildOutcomeConclusion(
      primaryOutcome,
      primary,
      outcomeEvidence,
      confidence.level,
      context.frontmatter.analysisPlan?.primaryOutcome === undefined,
    ),
    confidence,
    confounders: context.confounders,
    experiment: {
      id: context.frontmatter.experimentId,
      slug: context.frontmatter.slug,
      status: context.frontmatter.status,
      title: context.frontmatter.title,
    },
    commonsProtocolRef: context.frontmatter.commonsProtocolRef ?? null,
    effectiveProtocolSnapshot: context.frontmatter.effectiveProtocolSnapshot ?? null,
    metricResults,
    ...(structuredReview === undefined ? {} : { structuredReview }),
    outcomeId: `${context.frontmatter.experimentId}-outcome-${context.asOf}`,
    protocolRef: context.frontmatter.protocolRef ?? null,
    windows: buildWindowSummary(context.frontmatter),
  });

  if (!result.success) {
    throw new Error(`Experiment outcome for "${slug}" is invalid.`);
  }

  return {
    ...result.data,
    schema: EXPERIMENT_OUTCOME_SCHEMA_VERSION,
    commonsProtocolRef: context.frontmatter.commonsProtocolRef ?? null,
    effectiveProtocolSnapshot: context.frontmatter.effectiveProtocolSnapshot ?? null,
    protocolRef: context.frontmatter.protocolRef ?? null,
  } as ExperimentOutcomeSummary;
}

export function decideExperimentFollowupDue(
  vault: VaultReadModel,
  slug: string,
  options: {
    date?: string;
    kind: ExperimentFollowupKind;
    now?: string | number | Date;
  },
): ExperimentFollowupDueDecision {
  const date = options.date ?? resolveVaultLocalDate(vault, options.now ?? new Date());
  const context = buildExperimentFollowupContext(vault, slug, date);

  if (options.kind === "weekly-digest") {
    return decideWeeklyDigestDue(context, date);
  }

  return decideMissedLogDue(context, date);
}

function buildExperimentSummaryContext(
  vault: VaultReadModel,
  slug: string,
  options: { asOf?: string } & ExperimentMetricPointOptions,
): ExperimentSummaryContext {
  const experiment = getExperiment(vault, slug);
  if (!experiment) {
    throw new Error(`Experiment "${slug}" was not found in the query read model.`);
  }

  const frontmatter = requireExperimentFrontmatter(experiment);
  const asOf = normalizeAsOfDate(options.asOf);
  const progressPhase = resolveProgressPhase(frontmatter, asOf);
  const adherenceTargets = resolveAdherenceTargetsFromFrontmatter(frontmatter);
  const events = findExperimentEvents(vault, experiment, frontmatter, asOf);
  const adherenceEvents = findAdherenceEvidenceEvents({
    asOf,
    events,
    frontmatter,
    targets: adherenceTargets,
    vault,
  });
  const dateSet = new Set<string>([
    ...dateRange(frontmatter.runPlan?.baselineStart, frontmatter.runPlan?.baselineEnd),
    ...dateRange(
      frontmatter.runPlan?.interventionStart,
      minIsoDate(frontmatter.runPlan?.interventionEnd, asOf),
    ),
  ]);
  const summariesByDate = new Map<string, WearableDaySummary | null>();

  for (const date of dateSet) {
    summariesByDate.set(date, summarizeWearableDay(vault, date));
  }

  return {
    adherenceEvents,
    asOf,
    baselineDates: dateRange(frontmatter.runPlan?.baselineStart, frontmatter.runPlan?.baselineEnd),
    confounders: summarizeConfounders(events),
    events,
    experiment,
    frontmatter,
    interventionDates: dateRange(
      frontmatter.runPlan?.interventionStart,
      minIsoDate(frontmatter.runPlan?.interventionEnd, asOf),
    ),
    metricPoints: [
      ...(options.metricPoints ?? buildMetricProjection(vault).metricPoints).filter(
        (point) => point.source.kind !== "intervention-session-field",
      ),
      ...buildExperimentSessionMetricPoints(events, frontmatter),
    ],
    progressPhase,
    summariesByDate,
  };
}

function collectVaultEvidenceObservedOn(
  vault: VaultReadModel,
): Map<string, string | null> {
  const observedOnByRecordId = new Map<string, string | null>();
  for (const entity of vault.entities) {
    const observedOn = entity.date ?? extractDate(entity.occurredAt);
    for (const recordId of [
      entity.entityId,
      entity.primaryLookupId,
      ...entity.lookupIds,
    ]) {
      observedOnByRecordId.set(recordId, observedOn);
    }
  }
  return observedOnByRecordId;
}

function buildExperimentFollowupContext(
  vault: VaultReadModel,
  slug: string,
  asOf: string,
): ExperimentFollowupContext {
  const experiment = getExperiment(vault, slug);
  if (!experiment) {
    throw new Error(`Experiment "${slug}" was not found in the query read model.`);
  }

  const frontmatter = requireExperimentFrontmatter(experiment);
  const events = findExperimentEvents(vault, experiment, frontmatter, asOf);
  const adherenceTargets = resolveAdherenceTargetsFromFrontmatter(frontmatter);
  return {
    adherenceEvents: findAdherenceEvidenceEvents({
      asOf,
      events,
      frontmatter,
      targets: adherenceTargets,
      vault,
    }),
    adherenceTargets,
    events,
    frontmatter,
    progressPhase: resolveProgressPhase(frontmatter, asOf),
  };
}

function requireExperimentFrontmatter(entity: CanonicalEntity): QueryExperimentFrontmatter {
  const result = safeParseContract(experimentFrontmatterSchema, entity.attributes);
  if (!result.success) {
    throw new Error(`Experiment "${entity.entityId}" has invalid frontmatter for experiment analysis.`);
  }

  return result.data;
}

function buildMetricResults(
  context: ExperimentSummaryContext,
  options: { includePoints: true },
): ExperimentOutcomeMetricResult[];
function buildMetricResults(
  context: ExperimentSummaryContext,
  options?: { includePoints?: false },
): ExperimentMetricResult[];
function buildMetricResults(
  context: ExperimentSummaryContext,
  options: { includePoints?: boolean } = {},
): Array<ExperimentMetricResult & { points?: ExperimentOutcomeMetricPoint[] }> {
  return resolveMetricOutcomes(context.frontmatter).map((outcome) => {
    const metricWindows = selectMetricWindows(context, outcome);
    const baselineWindow = metricWindows.baseline;
    const interventionWindow = metricWindows.intervention;
    const baselineMean = baselineWindow.mean;
    const interventionMean = interventionWindow.mean;
    const windowsSummarizable =
      (baselineWindow.daysWithData === 0 || baselineMean !== null) &&
      (interventionWindow.daysWithData === 0 || interventionMean !== null);
    const unitsCompatible =
      windowsSummarizable &&
      metricWindowUnitsAreCompatible({
        left: {
          unit: baselineWindow.unit,
          value: baselineMean,
        },
        right: {
          unit: interventionWindow.unit,
          value: interventionMean,
        },
        statistic: outcome.statistic,
      });
    const deltaAbs =
      unitsCompatible && baselineMean !== null && interventionMean !== null
        ? round(interventionMean - baselineMean)
        : null;
    const deltaPct =
      unitsCompatible &&
      baselineMean !== null &&
      interventionMean !== null &&
      baselineMean !== 0
        ? round(((interventionMean - baselineMean) / Math.abs(baselineMean)) * 100)
        : null;
    const unit = unitsCompatible
      ? interventionWindow.unit ?? baselineWindow.unit
      : null;
    const expectedDirection = resolveExpectedDirection(
      context.frontmatter.analysisPlan,
      outcome.key,
    );
    const baselineSummary = {
      daysWithData: baselineWindow.daysWithData,
      mean: baselineMean,
      totalDays: baselineWindow.totalDays,
      unit: unitsCompatible ? unit : baselineWindow.unit,
    };
    const interventionSummary = {
      daysWithData: interventionWindow.daysWithData,
      mean: interventionMean,
      totalDays: interventionWindow.totalDays,
      unit: unitsCompatible ? unit : interventionWindow.unit,
    };

    return {
      baselineDayCount: baselineWindow.daysWithData,
      baselineMean,
      baseline: baselineSummary,
      biomarkerKey: outcome.key,
      completeness: unitsCompatible
        ? classifyMetricCompleteness(
            baselineWindow.daysWithData,
            interventionWindow.daysWithData,
            { pointMeasurement: metricWindows.source === "point_measurement" },
          )
        : "insufficient",
      deltaAbs,
      deltaPct,
      expectedDirection,
      interventionDayCount: interventionWindow.daysWithData,
      interventionMean,
      intervention: interventionSummary,
      label: outcome.label,
      movedAsExpected: movedAsExpected(deltaAbs, expectedDirection),
      ...(outcome.statistic === "mean" ? {} : { statistic: outcome.statistic }),
      ...(options.includePoints
        ? {
            points: [...baselineWindow.points, ...interventionWindow.points].map(
              (point) =>
                unitsCompatible && unit !== null
                  ? { ...point, unit }
                  : point,
            ),
          }
        : {}),
      unit,
    };
  });
}

function resolveMetricOutcomes(
  frontmatter: ExperimentFrontmatter,
): ResolvedExperimentMetricOutcome[] {
  const primary = resolveExperimentPrimaryOutcome(frontmatter.analysisPlan);
  const candidates = [
    ...(primary?.kind === "metric" ? [primary] : []),
    ...(frontmatter.analysisPlan?.secondaryBiomarkerKeys ?? []).map((key) =>
      resolveExperimentMetricOutcome(key),
    ),
  ];
  const seen = new Set<string>();
  return candidates.filter((outcome) => {
    if (seen.has(outcome.key)) {
      return false;
    }
    seen.add(outcome.key);
    return true;
  });
}

function resolveExpectedDirection(
  analysisPlan: QueryExperimentFrontmatter["analysisPlan"] | undefined,
  biomarkerKey: string,
): ExperimentMetricResult["expectedDirection"] {
  const explicitDirection = analysisPlan?.expectedDirections?.find(
    (entry) => entry.biomarkerKey === biomarkerKey,
  )?.direction;
  if (explicitDirection) {
    return explicitDirection;
  }

  if (
    analysisPlan &&
    resolveExperimentPrimaryOutcome(analysisPlan)?.key === biomarkerKey
  ) {
    return analysisPlan.desiredDirection ?? null;
  }

  return null;
}

/**
 * Build the per-day adherence calendar for one experiment, or null when the
 * run plan declares no adherence targets. Reuses the same target synthesis and
 * observation mapping as the progress summary so day statuses stay consistent.
 */
export function collectExperimentAdherenceCalendar(
  vault: VaultReadModel,
  slug: string,
  options: { asOf?: string } & ExperimentMetricPointOptions = {},
): ExperimentAdherenceCalendarResult | null {
  return buildAdherenceCalendarFromContext(
    buildExperimentSummaryContext(vault, slug, options),
  );
}

function resolveAdherenceTargets(
  context: ExperimentSummaryContext,
): QueryExperimentAdherenceTarget[] {
  return resolveAdherenceTargetsFromFrontmatter(context.frontmatter);
}

function resolveAdherenceTargetsFromFrontmatter(
  frontmatter: QueryExperimentFrontmatter,
): QueryExperimentAdherenceTarget[] {
  return resolveExperimentAdherenceTargets({
    explicitTargets: frontmatter.runPlan?.adherenceTargets,
    protocolActivitySessionEvidence:
      frontmatter.effectiveProtocolSnapshot?.activitySessionEvidence,
    protocolKey: frontmatter.commonsProtocolRef?.key,
    protocolSessionsPerDay:
      frontmatter.effectiveProtocolSnapshot?.frequency?.sessionsPerDay,
    runPlan: frontmatter.runPlan,
  });
}

function buildAdherenceCalendarFromContext(
  context: ExperimentSummaryContext,
): ExperimentAdherenceCalendarResult | null {
  const targets = resolveAdherenceTargets(context);
  if (targets.length === 0) {
    return null;
  }

  return buildExperimentAdherenceCalendar({
    asOf: context.asOf,
    observations: buildAdherenceObservations(context, targets),
    targets,
    windows: buildWindowSummary(context.frontmatter),
  });
}

function buildAdherenceSummary(context: ExperimentSummaryContext): ExperimentProgressSummary["adherence"] {
  const targets = resolveAdherenceTargets(context);
  const rollupTarget = resolveExperimentAdherenceRollupTarget(targets);
  const hasAmbiguousTargets = targets.length > 1 && !rollupTarget;
  const targetSessions =
    rollupTarget?.rollup?.targetCompletions ??
    (hasAmbiguousTargets ? null : context.frontmatter.runPlan?.targetSessions ?? null);
  const minimumUsefulSessions =
    rollupTarget?.rollup?.minimumUsefulCompletions ??
    (hasAmbiguousTargets ? null : context.frontmatter.runPlan?.minimumUsefulSessions ?? null);
  const progressTarget = hasAmbiguousTargets ? null : rollupTarget ?? targets[0] ?? null;
  const adherenceCalendar = buildAdherenceCalendarFromContext(context);
  const rollupCells = progressTarget?.calendar && rollupTarget && adherenceCalendar
    ? adherenceCalendar.cells.filter((cell) => cell.targetId === rollupTarget.targetId)
    : null;
  const progressObservations = progressTarget
    ? buildAdherenceObservations(context, [progressTarget])
    : [];
  const progressCells = progressTarget?.calendar
    ? rollupCells ?? adherenceCalendar?.cells ?? []
    : [];
  const occurrenceCounts =
    progressTarget?.calendar && progressTarget.evidence.kind === "linkedEventCount"
      ? countCalendarAdherenceSessions({
          asOf: context.asOf,
          cells: progressCells,
          observations: progressObservations,
          target: progressTarget,
        })
      : null;
  const progressCounts = occurrenceCounts ??
    (progressTarget && !progressTarget.calendar
      ? countCompletedAdherenceSessions({
          asOfDate: context.asOf,
          observations: progressObservations,
          target: progressTarget,
          windows: buildWindowSummary(context.frontmatter),
        })
      : null);
  const confidenceCounts = !hasAmbiguousTargets && progressTarget?.calendar
    ? occurrenceCounts ?? countAdherenceConfidenceSessions({
        cells: progressCells,
        observations: progressObservations,
      })
    : progressCounts ?? {
        sensedSessions: 0,
        confirmedSessions: 0,
        assumedSessions: 0,
      };

  const countedLoggedEvidenceIds = occurrenceCounts
    ? new Set(occurrenceCounts.loggedEvidenceIds)
    : null;
  const sessionEventIds = context.events
    .filter(isCompletedSessionEvent)
    .filter((event) =>
      countedLoggedEvidenceIds === null ||
      countedLoggedEvidenceIds.has(event.entityId)
    )
    .map((event) => event.entityId);

  let completedSessions = 0;
  let partialSessions = 0;
  if (!hasAmbiguousTargets) {
    if (occurrenceCounts) {
      completedSessions = occurrenceCounts.completedSessions;
      partialSessions = occurrenceCounts.partialSessions;
    } else if (progressTarget?.calendar) {
      completedSessions = progressCells.filter(
        (cell) => cell.status === "satisfied" || cell.status === "assumed",
      ).length;
      partialSessions = progressCells.filter((cell) => cell.status === "partial").length;
    } else {
      completedSessions = progressCounts?.completedSessions ?? 0;
      partialSessions = progressCounts?.partialSessions ?? 0;
    }
  }

  const loggedSessions = completedSessions + partialSessions;
  const expectedSessionsByNow = hasAmbiguousTargets
    ? null
    : occurrenceCounts
      ? occurrenceCounts.expectedSessionsByNow
      : progressTarget?.calendar && adherenceCalendar
        ? (rollupCells ?? adherenceCalendar.cells)
            .filter((cell) => cell.status !== "scheduled").length
        : computeExpectedSessionsByNow(
            context.frontmatter,
            context.asOf,
            targetSessions,
          );
  const evidence = buildProgressAdherenceEvidence(progressTarget);

  let status: ExperimentAdherenceStatus = "unknown";
  if (hasAmbiguousTargets) {
    status = "unknown";
  } else if (loggedSessions === 0) {
    status = "not_started";
  } else if (targetSessions !== null && loggedSessions >= targetSessions) {
    status = "met_target";
  } else if (
    minimumUsefulSessions !== null &&
    loggedSessions >= minimumUsefulSessions
  ) {
    status = "met_minimum";
  } else if (
    expectedSessionsByNow !== null &&
    loggedSessions < expectedSessionsByNow
  ) {
    status = "behind";
  } else if (loggedSessions > 0) {
    status = "on_track";
  }

  const summary: ExperimentProgressSummary["adherence"] = {
    completedSessions,
    ...(evidence ? { evidence } : {}),
    expectedSessionsByNow,
    loggedSessions,
    sessionEventIds,
    ...(partialSessions > 0 ? { partialSessions } : {}),
    minimumUsefulSessions,
    status,
    targetSessions,
  };
  if (confidenceCounts.sensedSessions > 0) {
    summary.sensedSessions = confidenceCounts.sensedSessions;
  }
  if (confidenceCounts.confirmedSessions > 0) {
    summary.confirmedSessions = confidenceCounts.confirmedSessions;
  }
  if (confidenceCounts.assumedSessions > 0) {
    summary.assumedSessions = confidenceCounts.assumedSessions;
  }

  return summary;
}

function buildProgressAdherenceEvidence(
  target: QueryExperimentAdherenceTarget | null,
): ExperimentProgressSummary["adherence"]["evidence"] | null {
  if (!target || target.evidence.kind !== "linkedEventCount") {
    return null;
  }

  if (
    target.evidence.eventKind !== "activity_session" &&
    target.evidence.eventKind !== "intervention_session"
  ) {
    return null;
  }

  return {
    eventKind: target.evidence.eventKind,
    ...(target.evidence.activityKind ? { activityKind: target.evidence.activityKind } : {}),
    ...(target.evidence.activityKinds
      ? { activityKinds: [...target.evidence.activityKinds] }
      : {}),
    ...(target.evidence.minimumDurationMinutes === undefined
      ? {}
      : {
          minimumDurationMinutes:
            target.evidence.minimumDurationMinutes,
        }),
  };
}

function buildAdherenceObservations(
  context: ExperimentSummaryContext,
  targets: readonly QueryExperimentAdherenceTarget[],
): ExperimentAdherenceObservation[] {
  const observations: ExperimentAdherenceObservation[] = [];

  for (const target of targets ?? []) {
    switch (target.evidence.kind) {
      case "linkedEventCount":
        const linkedEvidence = target.evidence;
        observations.push(...context.adherenceEvents
          .filter((event) => eventKindIsCandidateForEvidence(event.kind, linkedEvidence))
          .map((event) => ({
            activityKind: resolveAdherenceObservationActivityKind({
              attributes: event.attributes as Record<string, unknown>,
            }),
            durationMinutes: readActivityDurationMinutes(event),
            evidenceId: event.entityId,
            eventKind: event.kind,
            localDate:
              event.kind === "activity_session"
                ? resolveActivityEvidenceLocalDate(event) ?? context.asOf
                : event.kind === "intervention_session"
                  ? resolveInterventionSessionLocalDate(event) ?? context.asOf
                  : readStringAttribute(event, "scheduledLocalDate") ??
                    readStringAttribute(event, "sessionLocalDate") ??
                    (target.calendar && event.occurredAt
                      ? toLocalDayKey(new Date(event.occurredAt), target.calendar?.timeZone ?? "UTC")
                      : event.date ?? extractDate(event.occurredAt) ?? context.asOf),
            source: readStringAttribute(event, "source"),
            status: readExperimentSessionStatus(event),
            targetId: target.targetId,
          })));
        break;
      case "metricPresence":
      case "metricThreshold":
        const metricEvidence = target.evidence;
        for (const row of selectMetricAdherenceRows(context, metricEvidence.metricKey)) {
          observations.push({
            comparator: row.comparator,
            evidenceId: row.id,
            localDate: row.date,
            metricKey: metricEvidence.metricKey,
            targetId: target.targetId,
            value: row.value,
          });
        }
        break;
    }
  }

  return observations;
}

function selectMetricAdherenceRows(
  context: ExperimentSummaryContext,
  metricKey: string,
): Array<{ comparator: MetricPoint["comparator"]; date: string; id: string; value: number }> {
  const selectedMetricKey = resolveExperimentMetricIdentity(metricKey).metricKey;
  const points = context.metricPoints.filter((point) =>
    point.effectiveDate <= context.asOf && matchesExperimentMetricIdentity(metricKey, point)
  );
  return selectMetricSeries({
    metricKey: selectedMetricKey,
    points,
  }).rows.flatMap((row) =>
    typeof row.value === "number" && Number.isFinite(row.value)
      ? [{
          comparator: row.comparator ?? null,
          date: row.date,
          id: row.id ?? row.pointIds?.[0] ?? `metric-series:${row.metricKey}:${row.date}`,
          value: row.value,
        }]
      : []
  );
}

function buildCoverageSummary(input: {
  asOf: string;
  baselineDaysAvailable: number;
  interventionDaysAvailable: number;
  frontmatter: ExperimentFrontmatter;
  primarySignal: ExperimentMetricResult | null;
  progressPhase: ExperimentProgressPhase;
  signals: readonly ExperimentMetricResult[];
  summariesByDate: Map<string, WearableDaySummary | null>;
  vault: VaultReadModel;
}): ExperimentProgressSummary["dataCoverage"] {
  const primaryOutcome = resolveExperimentPrimaryOutcome(input.frontmatter.analysisPlan);
  const activityProviders = buildActivityProviderCoverage(input.vault, input.asOf);
  const wearableProviders = normalizeDataCoverageProviderList(
    [...input.summariesByDate.values()].flatMap((summary) => summary?.providers ?? []),
  );

  if (primaryOutcome?.kind === "structured_review") {
    const evidence = summarizeExperimentOutcomeEvidencePlan(
      input.frontmatter.analysisPlan,
      primaryOutcome.key,
      {
        evidenceObservedOnByRecordId: collectVaultEvidenceObservedOn(input.vault),
        observedThrough: input.asOf,
      },
    );
    const primaryMetricDaysAvailable =
      evidence.baseline.observedCount + evidence.followup.observedCount;
    const status: ExperimentCoverageStatus =
      evidence.reviewReady &&
        (input.progressPhase === "review_due" || input.progressPhase === "completed")
        ? "ready_for_review"
        : primaryMetricDaysAvailable > 0
          ? "partial"
          : "insufficient";

    return {
      activityProviders,
      baselineDaysAvailable: evidence.baseline.observedCount,
      interventionDaysAvailable: evidence.followup.observedCount,
      primaryBiomarkerKey: primaryOutcome.key,
      primaryMetricDaysAvailable,
      status,
      wearableProviders,
    };
  }

  const primaryMetricDaysAvailable =
    (input.primarySignal?.baselineDayCount ?? 0) +
    (input.primarySignal?.interventionDayCount ?? 0);
  const anySignalMetricData = input.signals.some(
    (signal) => signal.baselineDayCount + signal.interventionDayCount > 0,
  );
  const anyWearableSummaryData = [...input.summariesByDate.values()].some(
    (summary) => summary !== null && summary.providers.length > 0,
  );
  let status: ExperimentCoverageStatus = "insufficient";

  const hasCompleteMetricWindow = hasAnalysisMetricWindow(input.frontmatter);
  const hasPointMeasurementData =
    hasObservedPrimaryPointMeasurementWindow(input.frontmatter) &&
    (input.primarySignal?.baselineDayCount ?? 0) >= 1 &&
    (input.primarySignal?.interventionDayCount ?? 0) >= 1;

  if (
    input.primarySignal !== null &&
    input.frontmatter.analysisPlan?.primaryOutcome === undefined &&
    hasCompleteMetricWindow &&
    primaryMetricDaysAvailable === 0 &&
    !anySignalMetricData &&
    !anyWearableSummaryData
  ) {
    status = "no_wearable_data";
  } else if (
    hasPointMeasurementData &&
    (input.progressPhase === "review_due" || input.progressPhase === "completed")
  ) {
    status = "ready_for_review";
  } else if (
    (input.progressPhase === "review_due" || input.progressPhase === "completed") &&
    (input.primarySignal?.baselineDayCount ?? 0) >= 3 &&
    (input.primarySignal?.interventionDayCount ?? 0) >= 3
  ) {
    status = "ready_for_review";
  } else if (
    (input.primarySignal?.baselineDayCount ?? 0) >= 3 &&
    (input.primarySignal?.interventionDayCount ?? 0) >= 2
  ) {
    status = "sufficient_for_progress";
  } else if (primaryMetricDaysAvailable > 0 || anySignalMetricData) {
    status = "partial";
  } else {
    status = "insufficient";
  }

  return {
    activityProviders,
    baselineDaysAvailable: input.baselineDaysAvailable,
    interventionDaysAvailable: input.interventionDaysAvailable,
    primaryBiomarkerKey: primaryOutcome?.key ?? input.primarySignal?.biomarkerKey ?? null,
    primaryMetricDaysAvailable,
    status,
    wearableProviders,
  };
}

function buildActivityProviderCoverage(vault: VaultReadModel, asOf: string): string[] {
  const windowStart = addDaysToIsoDate(
    asOf,
    -(ACTIVITY_PROVIDER_COVERAGE_WINDOW_DAYS - 1),
  );
  return normalizeDataCoverageProviderList(
    vault.events.flatMap((event) => {
      if (event.kind !== "activity_session") {
        return [];
      }

      const localDate = resolveActivityEvidenceLocalDate(event);
      if (!localDate || localDate < windowStart || localDate > asOf) {
        return [];
      }

      const provider = resolveActivitySessionProviderCoverageLabel(event);
      return provider ? [provider] : [];
    }),
  );
}

function resolveActivitySessionProviderCoverageLabel(event: CanonicalEntity): string | null {
  const externalRef = readWearableExternalRef(event.attributes.externalRef);
  const dataOrigin = readActivitySessionDataOrigin(event.attributes.dataOrigin, externalRef);
  const provider = resolveWearablePublicSourceProvider({
    dataOrigin,
    externalRef,
    provider: externalRef?.system,
  }, {
    suppressJunctionSourceInstanceFallback: true,
  });

  if (provider && provider !== "unknown" && provider !== "manual") {
    return provider;
  }

  const source = readCoverageString(event.attributes.source);
  if (
    source === "device" ||
    dataOrigin !== null ||
    (externalRef !== null && externalRef.system !== "manual")
  ) {
    return "wearable";
  }

  return null;
}

function readActivitySessionDataOrigin(
  value: unknown,
  externalRef: WearableExternalRef | null,
): DeviceDataOrigin | null {
  const parsed = deviceDataOriginSchema.safeParse(value);
  return parsed.success ? parsed.data : inferJunctionWearableDataOriginFromExternalRef(externalRef);
}

function normalizeDataCoverageProviderList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_DATA_COVERAGE_PROVIDERS);
}

function readCoverageString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function summarizeSignalDayCoverage(signals: readonly ExperimentMetricResult[]) {
  return signals.reduce(
    (summary, signal) => ({
      baselineDaysAvailable: Math.max(
        summary.baselineDaysAvailable,
        signal.baselineDayCount,
      ),
      interventionDaysAvailable: Math.max(
        summary.interventionDaysAvailable,
        signal.interventionDayCount,
      ),
    }),
    {
      baselineDaysAvailable: 0,
      interventionDaysAvailable: 0,
    },
  );
}

function readinessResult(blockingReasons: ExperimentProgressReadinessReason[]) {
  return {
    status: blockingReasons.length === 0 ? "ready" : "incomplete",
    blockingReasons,
  } as const;
}

function buildSetupReadiness(
  frontmatter: ExperimentFrontmatter,
): ExperimentProgressSummary["setupReadiness"] {
  const blockingReasons: ExperimentProgressReadinessReason[] = [];
  const runPlan = frontmatter.runPlan;

  if (!runPlan) {
    blockingReasons.push("missing_run_plan");
  }
  if (
    !hasCompletePrimaryPointMeasurementPlan(frontmatter) &&
    (!runPlan?.baselineStart || !runPlan.baselineEnd)
  ) {
    blockingReasons.push("missing_baseline_window");
  }
  if (!runPlan?.interventionStart || !runPlan.interventionEnd) {
    blockingReasons.push("missing_intervention_window");
  }

  return readinessResult(blockingReasons);
}

function buildAnalysisReadiness(
  frontmatter: ExperimentFrontmatter,
): ExperimentProgressSummary["analysisReadiness"] {
  const blockingReasons: ExperimentProgressReadinessReason[] = [];
  const primaryOutcome = resolveExperimentPrimaryOutcome(frontmatter.analysisPlan);

  if (!frontmatter.analysisPlan) {
    blockingReasons.push("missing_analysis_plan");
  }
  if (!primaryOutcome) {
    blockingReasons.push("missing_primary_biomarker");
  }
  if (primaryOutcome?.kind === "metric") {
    const sessionFields = frontmatter.runPlan?.logging?.sessionFields ?? [];
    const capture = primaryOutcome.capture;
    if (
      capture.kind === "session_field" &&
      sessionFields.filter((fieldId) => fieldId === capture.fieldId).length !== 1
    ) {
      blockingReasons.push("uncapturable_primary_biomarker");
    } else if (
      capture.kind === "measurement" &&
      frontmatter.analysisPlan?.primaryOutcome === undefined &&
      !isRegisteredExperimentMetricSource(primaryOutcome.key)
    ) {
      blockingReasons.push("unsupported_primary_biomarker");
    } else if (capture.kind === "measurement") {
      const captureAssessment = assessExperimentPrimaryMetricCapture({
        primaryBiomarkerKey: primaryOutcome.key,
        sessionFields,
      });
      if (captureAssessment.issue === "unsupported_primary_biomarker") {
        blockingReasons.push("unsupported_primary_biomarker");
      } else if (captureAssessment.issue === "uncapturable_primary_biomarker") {
        blockingReasons.push("uncapturable_primary_biomarker");
      }
    }
  }
  if (!hasAnalysisMetricWindow(frontmatter)) {
    blockingReasons.push("missing_metric_window");
  }

  return readinessResult(blockingReasons);
}

function buildExperimentSessionMetricPoints(
  events: readonly CanonicalEntity[],
  frontmatter: ExperimentFrontmatter,
): MetricPoint[] {
  const primaryOutcome = resolveExperimentPrimaryOutcome(frontmatter.analysisPlan);
  const customSessionCapture =
    primaryOutcome?.kind === "metric" &&
      primaryOutcome.capture.kind === "session_field"
      ? primaryOutcome
      : null;
  const declaredSessionFields = new Set(
    frontmatter.runPlan?.logging?.sessionFields ?? [],
  );
  return events.flatMap((event) => {
    if (event.kind !== "intervention_session") {
      return [];
    }

    const eventExperimentId = readStringAttribute(event, "experimentId");
    const eventExperimentSlug = readStringAttribute(event, "experimentSlug");
    if (
      (eventExperimentId === null && eventExperimentSlug === null) ||
      (eventExperimentId !== null && eventExperimentId !== frontmatter.experimentId) ||
      (eventExperimentSlug !== null && eventExperimentSlug !== frontmatter.slug)
    ) {
      return [];
    }

    const fields = readRecordAttribute(event, "fields");
    if (!fields) {
      return [];
    }

    const effectiveDate =
      resolveInterventionSessionLocalDate(event) ??
      event.date ??
      extractDate(event.occurredAt);
    if (!effectiveDate) {
      return [];
    }

    const observedAt = event.occurredAt ?? `${effectiveDate}T00:00:00.000Z`;
    const recordedAt = readStringAttribute(event, "recordedAt") ?? event.occurredAt;

    const seenMetricKeys = new Set<string>();
    return Object.entries(fields).flatMap(([fieldId, value], resultIndex) => {
      if (!declaredSessionFields.has(fieldId)) {
        return [];
      }
      const spec = resolveExperimentSessionMetricSpec(fieldId);
      const isCustomPrimaryField =
        customSessionCapture?.capture.kind === "session_field" &&
        customSessionCapture.capture.fieldId === fieldId;
      if (
        (!spec && !isCustomPrimaryField) ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        return [];
      }
      if (spec && !validateExperimentSessionMetricValue({ fieldId, value }).success) {
        return [];
      }
      const metricKey = isCustomPrimaryField
        ? customSessionCapture.metricKey
        : spec?.key;
      if (!metricKey || seenMetricKeys.has(metricKey)) {
        return [];
      }
      seenMetricKeys.add(metricKey);
      const unit = isCustomPrimaryField &&
          customSessionCapture.capture.kind === "session_field"
        ? customSessionCapture.capture.unit ?? spec?.canonicalUnit ?? null
        : spec?.canonicalUnit ?? null;

      return [{
        schemaVersion: "murph.metric-point.v1",
        biomarkerKey: isCustomPrimaryField
          ? customSessionCapture.key
          : spec?.biomarkerKey ?? null,
        canonicalUnit: unit,
        canonicalValue: value,
        comparator: null,
        confidence: "medium",
        context: {
          experimentId: readStringAttribute(event, "experimentId"),
          experimentSlug: readStringAttribute(event, "experimentSlug"),
          sessionFieldId: fieldId,
        },
        effectiveDate,
        grain: "day",
        id: `metric-point:${event.entityId}:session-field:${metricKey}`,
        metricKey,
        observedAt,
        provenance: {
          dataOrigin: null,
          externalRef: null,
          labName: null,
          provider: null,
          rawRefs: [],
          sourceLabel: "Experiment session field",
        },
        recordedAt,
        reportedAt: null,
        source: {
          family: "event",
          kind: "intervention-session-field",
          path: event.path,
          recordId: event.entityId,
          resultIndex,
        },
        statistic: "value",
        textValue: null,
        unit,
        value,
      } satisfies MetricPoint];
    });
  });
}

function readRecordAttribute(
  entity: CanonicalEntity,
  key: string,
): Record<string, unknown> | null {
  const value = (entity.attributes as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readActivityDurationMinutes(entity: CanonicalEntity): number | null {
  const attributes = entity.attributes as Record<string, unknown>;
  const direct = attributes.durationMinutes;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  const nested = readRecordAttribute(entity, "workout")?.durationMinutes;
  return typeof nested === "number" && Number.isFinite(nested)
    ? nested
    : null;
}

function buildProgressRecommendation(input: {
  adherence: ExperimentProgressSummary["adherence"];
  assistantSupport: ExperimentFrontmatter["assistantSupport"];
  dataCoverage: ExperimentProgressSummary["dataCoverage"];
  hasSafetyFollowUp: boolean;
  phase: ExperimentProgressPhase;
}): ExperimentProgressSummary["recommendation"] {
  if (input.hasSafetyFollowUp) {
    return {
      action: "summary",
      reason: "A safety-related experiment event was logged and needs follow-up.",
      shouldNotifyUser: true,
    };
  }

  if (input.phase === "review_due") {
    return {
      action: "review",
      reason: "The intervention window ended and the experiment is ready for review.",
      shouldNotifyUser: true,
    };
  }

  if (
    input.phase === "intervention" &&
    input.assistantSupport?.remindersEnabled &&
    input.adherence.status === "behind"
  ) {
    return {
      action: "remind",
      reason: "Logged sessions are behind the current target pace.",
      shouldNotifyUser: true,
    };
  }

  if (
    input.phase === "intervention" &&
    input.assistantSupport?.weeklyDigestEnabled &&
    input.dataCoverage.status !== "no_wearable_data"
  ) {
    return {
      action: "summary",
      reason: "A weekly digest is enabled and wearable data is available.",
      shouldNotifyUser: true,
    };
  }

  return {
    action: "skip",
    reason:
      input.dataCoverage.status === "no_wearable_data"
        ? "No wearable data is available yet."
        : "Too early; no action is needed.",
    shouldNotifyUser: false,
  };
}

function buildOutcomeConfidence(input: {
  adherence: ExperimentProgressSummary["adherence"];
  confounders: string[];
  legacyPrimaryBiomarker: boolean;
  outcomeEvidence: ExperimentOutcomeEvidencePlanSummary | null;
  primary: ExperimentMetricResult | null;
  primaryOutcome: ResolvedExperimentPrimaryOutcome | null;
}): ExperimentOutcomeSummary["confidence"] {
  const reasons: string[] = [];
  const loggedSessions = readLoggedAdherenceSessions(input.adherence);

  if (input.primaryOutcome?.kind === "structured_review") {
    if (!input.outcomeEvidence?.reviewReady) {
      reasons.push("Baseline or follow-up review evidence is still missing.");
    }
    reasons.push(
      "The result is a structured before-and-after review rather than a quantified effect estimate.",
    );
  } else if (!input.primary || input.primary.completeness === "insufficient") {
    reasons.push(
      input.legacyPrimaryBiomarker
        ? "Primary biomarker coverage is insufficient for a strong before-and-after read."
        : "Primary outcome coverage is insufficient for a strong before-and-after read.",
    );
  }

  if (
    input.adherence.minimumUsefulSessions !== null &&
    loggedSessions < input.adherence.minimumUsefulSessions
  ) {
    reasons.push("Logged session count stayed below the minimum useful target.")
  }

  if (
    (input.adherence.assumedSessions ?? 0) >
      (input.adherence.sensedSessions ?? 0) + (input.adherence.confirmedSessions ?? 0)
  ) {
    reasons.push("Most sessions are assumed rather than confirmed.");
  }

  if (input.confounders.length > 0) {
    reasons.push("Context and confounder logs were present during the run.")
  }

  let level: ExperimentOutcomeConfidenceLevel = "high";
  if (reasons.length >= 2) {
    level = "low";
  } else if (reasons.length === 1) {
    level = "medium";
  }

  return {
    level,
    reasons,
  };
}

function readLoggedAdherenceSessions(
  adherence: ExperimentProgressSummary["adherence"],
): number {
  return adherence.loggedSessions ??
    adherence.completedSessions + (adherence.partialSessions ?? 0);
}

function buildStructuredReviewResult(
  primaryOutcome: ResolvedExperimentPrimaryOutcome | null,
  outcomeEvidence: ExperimentOutcomeEvidencePlanSummary | null,
): ExperimentStructuredReviewResult | undefined {
  if (primaryOutcome?.kind !== "structured_review" || !outcomeEvidence) {
    return undefined;
  }

  const baselineRecordIds = outcomeEvidence.baseline.recordIds;
  const followupRecordIds = outcomeEvidence.followup.recordIds;
  const status =
    baselineRecordIds.length > 0 && followupRecordIds.length > 0
      ? "ready_for_review"
      : baselineRecordIds.length > 0
        ? "baseline_only"
        : followupRecordIds.length > 0
          ? "followup_only"
          : "missing";

  return {
    kind: "structured_review",
    key: primaryOutcome.key,
    label: primaryOutcome.label,
    status,
    baseline: {
      kinds: outcomeEvidence.baseline.kinds,
      recordIds: baselineRecordIds,
    },
    followup: {
      kinds: outcomeEvidence.followup.kinds,
      recordIds: followupRecordIds,
    },
  };
}

function buildOutcomeConclusion(
  primaryOutcome: ResolvedExperimentPrimaryOutcome | null,
  primary: ExperimentMetricResult | null,
  outcomeEvidence: ExperimentOutcomeEvidencePlanSummary | null,
  confidenceLevel: ExperimentOutcomeConfidenceLevel,
  legacyPrimaryBiomarker: boolean,
): ExperimentOutcomeSummary["conclusion"] {
  if (primaryOutcome?.kind === "structured_review") {
    if (outcomeEvidence?.reviewReady) {
      return {
        caveats: [
          "This is an N-of-1 structured review, not medical advice.",
          "Qualitative evidence can support a decision without yielding a numeric effect estimate.",
        ],
        headline: `${primaryOutcome.label} is ready for a structured before-and-after review.`,
        plainLanguage:
          "Murph preserved the baseline and follow-up evidence for review without inventing a numeric score, percentage, or causal claim.",
      };
    }

    const missingRoles = [
      outcomeEvidence?.baseline.observedCount ? null : "baseline",
      outcomeEvidence?.followup.observedCount ? null : "follow-up",
    ].filter((value): value is string => value !== null);
    return {
      caveats: [
        "This is an N-of-1 structured review, not medical advice.",
        "Qualitative evidence should be compared directly rather than converted into a made-up score.",
      ],
      headline: `${primaryOutcome.label} needs ${missingRoles.join(" and ")} evidence before review.`,
      plainLanguage:
        "The experiment can stay saved and supported, but Murph will not fabricate a result before the planned evidence is available.",
    };
  }

  if (!primary || primary.deltaAbs === null || primary.interventionMean === null) {
    const primaryTerm = legacyPrimaryBiomarker ? "biomarker" : "outcome";
    return {
      caveats: [
        "This is an N-of-1 readout, not medical advice.",
        `Sparse ${primaryTerm} coverage or missing sessions can make this directional rather than decisive.`,
      ],
      headline: `The experiment finished, but the primary ${primaryTerm} readout is incomplete.`,
      plainLanguage:
        `Murph reached the end of the run, but there was not enough primary ${primaryTerm} data to make a trustworthy before-and-after comparison.`,
    };
  }

  const deltaText = primary.unit
    ? `${formatSignedNumber(primary.deltaAbs)} ${primary.unit}`
    : formatSignedNumber(primary.deltaAbs);

  return {
    caveats: [
      "This is an N-of-1 result, not medical advice.",
      "Concurrent illness, travel, alcohol, training load, and other context can change the readout.",
    ],
    headline: `${primary.label} moved ${deltaText} during the experiment.`,
    plainLanguage:
      `${primary.label} changed from ${formatNullableNumber(primary.baselineMean)} to ` +
      `${formatNullableNumber(primary.interventionMean)}${primary.unit ? ` ${primary.unit}` : ""}. ` +
      `Confidence is ${confidenceLevel}; treat this as associated with the intervention window rather than proof of causation.`,
  };
}

function buildProgressSignals(
  signals: readonly ExperimentMetricResult[],
): ExperimentProgressMetricSignal[] {
  return signals.map((signal) => ({
    baselineDaysAvailable: signal.baselineDayCount,
    baselineMean: signal.baselineMean,
    biomarkerKey: signal.biomarkerKey,
    confidence:
      signal.baselineDayCount >= 5 && signal.interventionDayCount >= 5
        ? "medium"
        : "low",
    currentInterventionMean: signal.interventionMean,
    deltaAbs: signal.deltaAbs,
    expectedDirection: signal.expectedDirection,
    interventionDaysAvailable: signal.interventionDayCount,
    label: signal.label,
    movedAsExpected: signal.movedAsExpected,
    reason:
      signal.interventionDayCount === 0
        ? "No intervention-window metric data is available yet."
        : `Only ${signal.interventionDayCount} intervention day(s) are available so far.`,
    unit: signal.unit,
  }));
}

function buildWindowSummary(
  frontmatter: ExperimentFrontmatter,
): ExperimentProgressSummary["windows"] {
  return {
    baselineEnd: frontmatter.runPlan?.baselineEnd ?? null,
    baselineStart: frontmatter.runPlan?.baselineStart ?? null,
    interventionEnd: frontmatter.runPlan?.interventionEnd ?? null,
    interventionStart: frontmatter.runPlan?.interventionStart ?? null,
  };
}

function buildFollowupBase(
  context: ExperimentFollowupContext,
  date: string,
  kind: ExperimentFollowupKind,
  reason: ExperimentFollowupReason,
  action: ExperimentFollowupAction,
  sessionDate: string | null,
): ExperimentFollowupDueDecision {
  const windows = buildWindowSummary(context.frontmatter);

  return {
    schema: "murph.experiment-followup-due.v1",
    kind,
    action,
    reason,
    date,
    dedupeKey: [
      "experiment-followup",
      context.frontmatter.experimentId,
      kind,
      sessionDate ?? date,
    ].join(":"),
    experiment: {
      id: context.frontmatter.experimentId,
      slug: context.frontmatter.slug,
      status: context.frontmatter.status,
      title: context.frontmatter.title,
    },
    window: {
      sessionDate,
      ...windows,
    },
  };
}

function decideMissedLogDue(
  context: ExperimentFollowupContext,
  date: string,
): ExperimentFollowupDueDecision {
  const assistantSupport = context.frontmatter.assistantSupport;

  if (context.frontmatter.status !== "active") {
    return buildFollowupBase(context, date, "missed-log", "experiment_not_active", "skip", null);
  }

  if (context.progressPhase !== "intervention") {
    return buildFollowupBase(context, date, "missed-log", "not_in_intervention_window", "skip", null);
  }

  if (assistantSupport?.remindersEnabled !== true) {
    return buildFollowupBase(context, date, "missed-log", "reminders_disabled", "skip", null);
  }

  if (assistantSupport.missedLogFollowup === "never") {
    return buildFollowupBase(
      context,
      date,
      "missed-log",
      "missed_log_followup_disabled",
      "skip",
      null,
    );
  }

  if (hasSessionLogForDate(context, date)) {
    return buildFollowupBase(
      context,
      date,
      "missed-log",
      "session_already_logged",
      "skip",
      date,
    );
  }

  if (hasAssumedAfterGraceCalendarSessionTarget(context, date)) {
    return buildFollowupBase(
      context,
      date,
      "missed-log",
      "session_assumed",
      "skip",
      date,
    );
  }

  if (!isDailyInterventionSchedule(context.frontmatter)) {
    return buildFollowupBase(
      context,
      date,
      "missed-log",
      "unsupported_session_schedule",
      "skip",
      null,
    );
  }

  return buildFollowupBase(
    context,
    date,
    "missed-log",
    "planned_session_log_missing",
    "notify",
    date,
  );
}

function hasAssumedAfterGraceCalendarSessionTarget(
  context: ExperimentFollowupContext,
  date: string,
): boolean {
  const rollupTarget = resolveExperimentAdherenceRollupTarget(context.adherenceTargets);
  const targets = rollupTarget ? [rollupTarget] : context.adherenceTargets;
  const windows = buildWindowSummary(context.frontmatter);
  const plannedCalendarTargets = targets.filter((target) =>
    target.calendar !== undefined &&
    experimentAdherenceTargetPlansDate({
      localDate: date,
      target,
      windows,
    })
  );

  return plannedCalendarTargets.length > 0 &&
    plannedCalendarTargets.every((target) =>
      target.evidence.kind === "linkedEventCount" &&
      resolveEffectiveExperimentLinkedEventMissingPolicy({
        evidence: target.evidence,
        expectedCount:
          expandExperimentAdherenceExpectations(target, windows)
            .find((expectation) => expectation.localDate === date)
            ?.expectedCount ?? 0,
      }) === "assumed_after_grace"
    );
}

function decideWeeklyDigestDue(
  context: ExperimentFollowupContext,
  date: string,
): ExperimentFollowupDueDecision {
  if (context.frontmatter.status !== "active") {
    return buildFollowupBase(context, date, "weekly-digest", "experiment_not_active", "skip", null);
  }

  if (
    context.progressPhase !== "intervention" &&
    context.progressPhase !== "review_due"
  ) {
    return buildFollowupBase(
      context,
      date,
      "weekly-digest",
      "not_in_intervention_window",
      "skip",
      null,
    );
  }

  if (context.frontmatter.assistantSupport?.weeklyDigestEnabled !== true) {
    return buildFollowupBase(
      context,
      date,
      "weekly-digest",
      "weekly_digest_disabled",
      "skip",
      null,
    );
  }

  if (!isWeeklyDigestDueOnDate(context.frontmatter, date)) {
    return buildFollowupBase(
      context,
      date,
      "weekly-digest",
      "weekly_digest_not_due",
      "skip",
      null,
    );
  }

  return buildFollowupBase(
    context,
    date,
    "weekly-digest",
    "weekly_digest_due",
    "notify",
    date,
  );
}

function isWeeklyDigestDueOnDate(frontmatter: ExperimentFrontmatter, date: string): boolean {
  const interventionStart = frontmatter.runPlan?.interventionStart;
  if (!interventionStart || date < interventionStart) {
    return false;
  }

  const interventionEnd = frontmatter.runPlan?.interventionEnd;
  if (interventionEnd && date > interventionEnd) {
    return false;
  }

  return daysBetweenInclusive(interventionStart, date) % 7 === 0;
}

function hasSessionLogForDate(context: ExperimentFollowupContext, date: string): boolean {
  if (
    context.events.some((event) =>
      event.kind === "intervention_session" &&
      resolveInterventionSessionLocalDate(event) === date
    )
  ) {
    return true;
  }

  const activityEvidenceTargets = context.adherenceTargets.flatMap((target) =>
    target.evidence.kind === "linkedEventCount" &&
      target.evidence.eventKind === "activity_session"
      ? [target.evidence]
      : []
  );
  if (activityEvidenceTargets.length === 0) {
    return false;
  }

  return context.adherenceEvents.some((event) => {
    if (event.kind !== "activity_session") {
      return false;
    }

    const eventDate = resolveActivityEvidenceLocalDate(event);
    if (eventDate !== date) {
      return false;
    }

    const activityKind = resolveAdherenceObservationActivityKind({
      attributes: event.attributes as Record<string, unknown>,
    });
    const observation: ExperimentAdherenceObservation = {
      activityKind,
      durationMinutes: readActivityDurationMinutes(event),
      evidenceId: event.entityId,
      eventKind: event.kind,
      localDate: eventDate,
    };
    return activityEvidenceTargets.some((evidence) =>
      linkedEventObservationMatchesEvidence(observation, evidence)
    );
  });
}

function isDailyInterventionSchedule(frontmatter: ExperimentFrontmatter): boolean {
  const runPlan = frontmatter.runPlan;
  if (!runPlan?.interventionStart || !runPlan.interventionEnd) {
    return false;
  }

  const totalDays = daysBetweenInclusive(runPlan.interventionStart, runPlan.interventionEnd);
  if (totalDays <= 0) {
    return false;
  }

  const targetSessions = runPlan.targetSessions;
  const sessionsPerWeek = runPlan.sessionsPerWeek;

  return (
    (typeof targetSessions === "number" && targetSessions >= totalDays) ||
    (typeof sessionsPerWeek === "number" && sessionsPerWeek >= 7)
  );
}

function countDatesWithWearableData(
  dates: readonly string[],
  summariesByDate: ReadonlyMap<string, WearableDaySummary | null>,
): number {
  return dates.filter((date) => {
    const summary = summariesByDate.get(date);
    return Boolean(summary && summary.providers.length > 0);
  }).length;
}

function summarizeConfounders(events: readonly CanonicalEntity[]): string[] {
  const values = new Set<string>();

  for (const event of events) {
    const attributes = event.attributes as Record<string, unknown>;
    const date = event.date ?? extractDate(event.occurredAt);
    if (event.kind === "intervention_session") {
      if (attributes.afterExercise === true && date) {
        values.add(`post-exercise session on ${date}`);
      }

      for (const confounder of readConfounders(attributes.confounders)) {
        values.add(`${humanizeSlug(confounder)} on ${date ?? "unknown date"}`);
      }

      for (const symptom of readStringArray(attributes.symptoms)) {
        values.add(`${symptom} reported on ${date ?? "unknown date"}`);
      }

      continue;
    }

    if (event.kind === "experiment_context") {
      const contextType =
        typeof attributes.contextType === "string" && attributes.contextType.length > 0
          ? attributes.contextType
          : event.title ?? event.kind;
      values.add(`${humanizeSlug(contextType)} context logged on ${date ?? "unknown date"}`);
      continue;
    }

    if (event.kind !== "experiment_event") {
      values.add(`${event.title ?? event.kind} on ${date ?? "unknown date"}`);
    }
  }

  return [...values].slice(0, 8);
}

function hasSafetyFollowUp(events: readonly CanonicalEntity[]): boolean {
  return events.some((event) => {
    if (event.kind === "adverse_effect") {
      return true;
    }

    if (event.kind !== "experiment_context") {
      return false;
    }

    const severity = (event.attributes as Record<string, unknown>).severity;
    return severity === "safety" || severity === "blocking";
  });
}

function hasAnalysisMetricWindow(frontmatter: ExperimentFrontmatter): boolean {
  const primaryOutcome = resolveExperimentPrimaryOutcome(frontmatter.analysisPlan);
  if (!primaryOutcome) {
    return false;
  }

  if (primaryOutcome.kind === "structured_review") {
    return summarizeExperimentOutcomeEvidencePlan(
      frontmatter.analysisPlan,
      primaryOutcome.key,
    ).completePlan;
  }

  if (hasCompletePrimaryPointMeasurementPlan(frontmatter)) {
    return true;
  }

  if (
    frontmatter.runPlan?.baselineStart !== undefined &&
    frontmatter.runPlan?.baselineEnd !== undefined &&
    frontmatter.runPlan?.interventionStart !== undefined &&
    frontmatter.runPlan?.interventionEnd !== undefined
  ) {
    return true;
  }

  return false;
}

function hasCompletePrimaryPointMeasurementPlan(
  frontmatter: ExperimentFrontmatter,
): boolean {
  const primaryBiomarkerKey = resolveExperimentPrimaryOutcome(
    frontmatter.analysisPlan,
  )?.key;
  return Boolean(
    primaryBiomarkerKey &&
      hasCompletePointMeasurementPlanForBiomarker(
        frontmatter.analysisPlan,
        primaryBiomarkerKey,
      ),
  );
}

function hasObservedPrimaryPointMeasurementWindow(
  frontmatter: ExperimentFrontmatter,
): boolean {
  const primaryBiomarkerKey = resolveExperimentPrimaryOutcome(
    frontmatter.analysisPlan,
  )?.key;
  return Boolean(
    primaryBiomarkerKey &&
      hasMeasurementAnchorForRole(
        frontmatter.analysisPlan,
        primaryBiomarkerKey,
        "baseline",
      ) &&
      hasMeasurementAnchorForRole(
        frontmatter.analysisPlan,
        primaryBiomarkerKey,
        "followup",
      ),
  );
}

function hasCompletePointMeasurementPlanForBiomarker(
  analysisPlan: QueryExperimentFrontmatter["analysisPlan"] | undefined,
  biomarkerKey: string,
): boolean {
  return (
    (hasMeasurementAnchorForRole(analysisPlan, biomarkerKey, "baseline") ||
      hasPlannedMeasurementForRole(analysisPlan, biomarkerKey, "baseline")) &&
    (hasMeasurementAnchorForRole(analysisPlan, biomarkerKey, "followup") ||
      hasPlannedMeasurementForRole(analysisPlan, biomarkerKey, "followup"))
  );
}

function hasMeasurementAnchorForRole(
  analysisPlan: QueryExperimentFrontmatter["analysisPlan"] | undefined,
  biomarkerKey: string,
  role: "baseline" | "followup",
): boolean {
  return (analysisPlan?.measurementAnchors ?? []).some(
    (anchor) => anchor.role === role && anchor.biomarkerKeys.includes(biomarkerKey),
  );
}

function hasPlannedMeasurementForRole(
  analysisPlan: QueryExperimentFrontmatter["analysisPlan"] | undefined,
  biomarkerKey: string,
  role: "baseline" | "followup",
): boolean {
  return (analysisPlan?.plannedMeasurements ?? []).some(
    (measurement) =>
      measurement.role === role &&
      measurement.biomarkerKeys.includes(biomarkerKey) &&
      dateRange(measurement.targetWindow?.start, measurement.targetWindow?.end).length >
        0,
  );
}

function selectMetricWindows(
  context: ExperimentSummaryContext,
  outcome: ResolvedExperimentMetricOutcome,
): MetricWindowPair {
  if (
    hasMeasurementAnchorForRole(
      context.frontmatter.analysisPlan,
      outcome.key,
      "baseline",
    ) &&
    hasCompletePointMeasurementPlanForBiomarker(
      context.frontmatter.analysisPlan,
      outcome.key,
    )
  ) {
    return {
      baseline:
        collectAnchoredMetricWindow(context, outcome, "baseline") ??
        collectPlannedMetricWindow(context, outcome.key, "baseline") ??
        emptyMetricWindowSelection(0),
      intervention:
        collectAnchoredMetricWindow(context, outcome, "followup") ??
        collectPlannedMetricWindow(context, outcome.key, "followup") ??
        emptyMetricWindowSelection(0),
      source: "point_measurement",
    };
  }

  const runWindows = collectRunMetricWindows(context, outcome);
  return {
    baseline: runWindows.baseline,
    intervention: runWindows.intervention,
    source: "run_window",
  };
}

function collectRunMetricWindows(
  context: ExperimentSummaryContext,
  outcome: ResolvedExperimentMetricOutcome,
): Pick<MetricWindowPair, "baseline" | "intervention"> {
  const aggregation = resolveOutcomeSameDayAggregation(
    context.frontmatter,
    outcome,
  );
  const seriesPoints = selectExperimentOutcomeSeries({
    ...(aggregation !== undefined ? { aggregation } : {}),
    outcome,
    points: context.metricPoints,
  });

  return {
    baseline: collectSeriesMetricWindow(
      seriesPoints,
      context.baselineDates,
      "baseline",
      outcome.statistic,
    ),
    intervention: collectSeriesMetricWindow(
      seriesPoints,
      context.interventionDates,
      "intervention",
      outcome.statistic,
    ),
  };
}

function collectPlannedMetricWindow(
  context: ExperimentSummaryContext,
  outcomeKey: string,
  role: "baseline" | "followup",
): MetricWindowSelection | null {
  const plannedMeasurement = (context.frontmatter.analysisPlan?.plannedMeasurements ?? []).find(
    (measurement) =>
      measurement.role === role &&
      measurement.biomarkerKeys.includes(outcomeKey) &&
      dateRange(measurement.targetWindow?.start, measurement.targetWindow?.end).length > 0,
  );
  if (!plannedMeasurement) {
    return null;
  }

  return emptyMetricWindowSelection(
    dateRange(
      plannedMeasurement.targetWindow?.start,
      plannedMeasurement.targetWindow?.end,
    ).length,
  );
}

function collectAnchoredMetricWindow(
  context: ExperimentSummaryContext,
  outcome: ResolvedExperimentMetricOutcome,
  role: "baseline" | "followup",
): MetricWindowSelection | null {
  const anchors = (context.frontmatter.analysisPlan?.measurementAnchors ?? []).filter(
    (anchor) => anchor.role === role && anchor.biomarkerKeys.includes(outcome.key),
  );
  if (anchors.length === 0) {
    return null;
  }

  const anchorRecordIds = new Set(anchors.map((anchor) => anchor.recordId));
  const anchoredPoints = context.metricPoints.filter(
    (point) =>
      point.effectiveDate <= context.asOf &&
      metricPointRecordIds(point).some((recordId) => anchorRecordIds.has(recordId)) &&
      matchesExperimentMetricIdentity(outcome.metricKey, point),
  );
  const aggregation = resolveOutcomeSameDayAggregation(
    context.frontmatter,
    outcome,
  );
  const points = selectExperimentOutcomeSeries({
    ...(aggregation !== undefined ? { aggregation } : {}),
    outcome,
    points: anchoredPoints,
  }).flatMap((point) =>
    typeof point.value === "number" && Number.isFinite(point.value)
      ? [{
          date: point.date,
          phase: role === "baseline" ? "baseline" as const : "intervention" as const,
          unit: point.unit,
          value: point.value,
        }]
      : []
  );

  return metricWindowSelectionFromValues(points, anchors.length, outcome.statistic);
}

function selectExperimentOutcomeSeries(input: {
  aggregation?: ExperimentOutcomeStatistic;
  outcome: ResolvedExperimentMetricOutcome;
  points: readonly MetricPoint[];
}): MetricSeriesPoint[] {
  const rows = selectMetricSeries({
    ...(input.aggregation !== undefined ? { aggregation: input.aggregation } : {}),
    metricKey: input.outcome.metricKey,
    points: input.points,
  }).rows;
  if (input.aggregation === "count") {
    return rows;
  }
  const canonicalUnit = resolveMetricDefinition(input.outcome.metricKey)?.canonicalUnit ?? null;
  if (canonicalUnit === null) {
    return rows;
  }

  return rows.filter(
    (row) => row.unit !== null && unitsEquivalent(row.unit, canonicalUnit),
  );
}

function resolveOutcomeSameDayAggregation(
  frontmatter: ExperimentFrontmatter,
  outcome: ResolvedExperimentMetricOutcome,
): ExperimentOutcomeStatistic | undefined {
  const configured = frontmatter.analysisPlan?.primaryOutcome;
  return configured?.kind === "metric" &&
      configured.key.trim().toLowerCase() === outcome.key
    ? outcome.statistic
    : undefined;
}

function collectSeriesMetricWindow(
  seriesPoints: readonly MetricSeriesPoint[],
  dates: readonly string[],
  phase: ExperimentOutcomeMetricPoint["phase"],
  statistic: ExperimentOutcomeStatistic,
): MetricWindowSelection {
  const start = dates[0] ?? null;
  const end = dates.at(-1) ?? null;
  if (!start || !end) {
    return emptyMetricWindowSelection(dates.length);
  }

  const points = seriesPoints.flatMap((point) =>
    point.date >= start &&
      point.date <= end &&
      typeof point.value === "number" &&
      Number.isFinite(point.value)
      ? [{
          date: point.date,
          phase,
          unit: point.unit,
          value: point.value,
        }]
      : [],
  );

  return metricWindowSelectionFromValues(points, dates.length, statistic);
}

function emptyMetricWindowSelection(totalDays: number): MetricWindowSelection {
  return {
    daysWithData: 0,
    mean: null,
    points: [],
    totalDays,
    unit: null,
  };
}

function metricWindowSelectionFromValues(
  points: ExperimentOutcomeMetricPoint[],
  totalDays: number,
  statistic: ExperimentOutcomeStatistic,
): MetricWindowSelection {
  if (points.length === 0) {
    return emptyMetricWindowSelection(totalDays);
  }

  const units = [...new Set(points.map((point) => point.unit).filter(
    (unit): unit is string => unit !== null,
  ))];
  const unit = statistic === "count"
    ? "count"
    : units.length === 0
      ? null
      : units.every((candidate) => unitsEquivalent(units[0] ?? null, candidate))
        ? units.at(-1) ?? null
        : null;
  const compatible = statistic === "count" || units.length < 2 || unit !== null;

  return {
    daysWithData: points.length,
    mean: compatible ? summarizeExperimentOutcomeValues(points, statistic) : null,
    points,
    totalDays,
    unit,
  };
}

function readStringAttribute(entity: CanonicalEntity, key: string): string | null {
  const value = (entity.attributes as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readExperimentSessionStatus(
  entity: CanonicalEntity,
): ExperimentAdherenceObservation["status"] {
  const status = readStringAttribute(entity, "sessionStatus");
  switch (status) {
    case "partial":
      return "partial";
    case "missed":
      return "missed";
    case "skipped":
      return "skipped";
    default:
      return "completed";
  }
}

function resolveProgressPhase(
  frontmatter: ExperimentFrontmatter,
  asOf: string,
): ExperimentProgressPhase {
  if (frontmatter.status === "completed") {
    return "completed";
  }

  if (frontmatter.status === "paused") {
    return "paused";
  }

  if (frontmatter.status === "abandoned") {
    return "abandoned";
  }

  if (frontmatter.status === "planned") {
    return "planned";
  }

  const runPlan = frontmatter.runPlan;
  if (!runPlan?.interventionStart || !runPlan.interventionEnd) {
    return "planned";
  }

  const interventionStart = runPlan.interventionStart;
  const interventionEnd = runPlan.interventionEnd;
  const baselineStart = runPlan.baselineStart;
  const baselineEnd = runPlan.baselineEnd;

  if (interventionEnd && asOf > interventionEnd) {
    return "review_due";
  }

  if (interventionStart && asOf >= interventionStart) {
    return "intervention";
  }

  if (baselineStart && baselineEnd && asOf >= baselineStart && asOf <= baselineEnd) {
    return "baseline";
  }

  return "planned";
}

function findExperimentEvents(
  vault: VaultReadModel,
  experiment: CanonicalEntity,
  frontmatter: ExperimentFrontmatter,
  asOf: string,
): CanonicalEntity[] {
  const from = frontmatter.runPlan?.baselineStart ?? frontmatter.startedOn;
  const experimentId = frontmatter.experimentId;

  return vault.events.filter((event) => {
    const date = event.kind === "intervention_session"
      ? resolveInterventionSessionLocalDate(event)
      : event.date ?? extractDate(event.occurredAt);
    if (from && date && date < from) {
      return false;
    }

    if (date && date > asOf) {
      return false;
    }

    if (event.experimentSlug === frontmatter.slug) {
      return true;
    }

    if (typeof event.attributes.experimentSlug === "string" && event.attributes.experimentSlug === frontmatter.slug) {
      return true;
    }

    if (event.attributes.experimentId === experimentId) {
      return true;
    }

    if (event.relatedIds.includes(experimentId)) {
      return true;
    }

    return event.links.some((link) => link.targetId === experiment.entityId);
  });
}

function findAdherenceEvidenceEvents(input: {
  asOf: string;
  events: readonly CanonicalEntity[];
  frontmatter: ExperimentFrontmatter;
  targets: readonly QueryExperimentAdherenceTarget[];
  vault: VaultReadModel;
}): CanonicalEntity[] {
  const byId = new Map(input.events.map((event) => [event.entityId, event]));
  const needsActivityEvidence = input.targets.some((target) =>
    target.evidence.kind === "linkedEventCount" &&
    target.evidence.eventKind === "activity_session"
  );
  if (!needsActivityEvidence) {
    return [...byId.values()];
  }

  const interventionStart = input.frontmatter.runPlan?.interventionStart;
  const interventionEnd = input.frontmatter.runPlan?.interventionEnd;
  if (!interventionStart || !interventionEnd || input.asOf < interventionStart) {
    return [...byId.values()];
  }
  const effectiveEnd = minIsoDate(interventionEnd, input.asOf);
  if (!effectiveEnd) {
    return [...byId.values()];
  }

  for (const event of input.vault.events) {
    if (event.kind !== "activity_session") {
      continue;
    }
    const date = resolveActivityEvidenceLocalDate(event);
    if (!date || date < interventionStart || date > effectiveEnd) {
      continue;
    }
    byId.set(event.entityId, event);
  }

  return [...byId.values()];
}

function isCompletedSessionEvent(event: CanonicalEntity): boolean {
  if (event.kind !== "intervention_session") {
    return false;
  }

  const sessionStatus = event.attributes.sessionStatus;
  return sessionStatus !== "missed" && sessionStatus !== "skipped";
}

function computeExpectedSessionsByNow(
  frontmatter: ExperimentFrontmatter,
  asOf: string,
  targetSessions: number | null,
): number | null {
  const interventionStart = frontmatter.runPlan?.interventionStart;
  const interventionEnd = frontmatter.runPlan?.interventionEnd;
  if (
    targetSessions === null ||
    !interventionStart ||
    !interventionEnd ||
    asOf < interventionStart
  ) {
    return null;
  }

  const totalDays = daysBetweenInclusive(interventionStart, interventionEnd);
  const elapsedDays = daysBetweenInclusive(
    interventionStart,
    minIsoDate(interventionEnd, asOf) ?? interventionEnd,
  );
  if (totalDays <= 0) {
    return null;
  }

  return Math.max(1, Math.floor((targetSessions * elapsedDays) / totalDays));
}

function dayInRun(frontmatter: ExperimentFrontmatter, asOf: string): number | null {
  const runPlan = frontmatter.runPlan;
  if (!runPlan?.interventionStart || !runPlan.interventionEnd) {
    return null;
  }

  const start = runPlan.baselineStart ?? runPlan.interventionStart;
  if (!start || asOf < start) {
    return null;
  }

  return daysBetweenInclusive(start, asOf);
}

function dateRange(start: string | undefined, end: string | undefined | null): string[] {
  if (!start || !end || start > end) {
    return [];
  }

  const totalDays = daysBetweenInclusive(start, end);
  if (!Number.isFinite(totalDays) || totalDays < 1) {
    throw new Error(`Experiment analysis window ${start} to ${end} is invalid.`);
  }
  if (totalDays > MAX_EXPERIMENT_ANALYSIS_WINDOW_DAYS) {
    throw new Error(
      `Experiment analysis window ${start} to ${end} spans ${totalDays} days; maximum supported span is ${MAX_EXPERIMENT_ANALYSIS_WINDOW_DAYS} days.`,
    );
  }

  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDaysToIsoDate(cursor, 1);
  }

  return dates;
}

function normalizeAsOfDate(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  return value;
}

function resolveVaultLocalDate(vault: VaultReadModel, value: string | number | Date): string {
  return toLocalDayKey(value, resolveVaultTimeZone(vault));
}

function resolveVaultTimeZone(vault: VaultReadModel): string {
  const metadata = vault.metadata;
  const timezone =
    metadata && typeof metadata === "object" && typeof metadata.timezone === "string"
      ? metadata.timezone
      : null;

  return timezone ?? "UTC";
}

function classifyMetricCompleteness(
  baselineDays: number,
  interventionDays: number,
  options: { pointMeasurement?: boolean } = {},
): ExperimentMetricResult["completeness"] {
  if (options.pointMeasurement && baselineDays >= 1 && interventionDays >= 1) {
    return "good";
  }

  if (baselineDays >= 3 && interventionDays >= 3) {
    return "good";
  }

  if (baselineDays > 0 || interventionDays > 0) {
    return "partial";
  }

  return "insufficient";
}

function humanizeBiomarkerKey(value: string): string {
  const label = value.split(":").at(-1) ?? value;
  return label
    .split("-")
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function humanizeSlug(value: string): string {
  return value.replace(/-/gu, " ");
}

function movedAsExpected(
  deltaAbs: number | null,
  expectedDirection: ExperimentMetricResult["expectedDirection"],
): boolean | null {
  if (deltaAbs === null || expectedDirection === null || deltaAbs === 0) {
    return null;
  }

  if (expectedDirection === "increase") {
    return deltaAbs > 0;
  }

  if (expectedDirection === "decrease") {
    return deltaAbs < 0;
  }

  return Math.abs(deltaAbs) < 0.5;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function minIsoDate(left: string | undefined, right: string | undefined): string | null {
  if (!left && !right) {
    return null;
  }

  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return left <= right ? left : right;
}

function addDaysToIsoDate(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00.000Z`);
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  const startStamp = new Date(`${start}T00:00:00.000Z`);
  const endStamp = new Date(`${end}T00:00:00.000Z`);
  return Math.floor((endStamp.valueOf() - startStamp.valueOf()) / 86_400_000) + 1;
}

function extractDate(value: string | null): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function readConfounders(value: unknown): string[] {
  if (Array.isArray(value)) {
    return readStringArray(value);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value)
    .flatMap(([key, entry]) => {
      if (entry === false || entry === null || entry === undefined) {
        return [];
      }

      if (typeof entry === "string" && entry.trim().length === 0) {
        return [];
      }

      return [key];
    });
}

function classifyAdherenceLevel(
  adherence: ExperimentProgressSummary["adherence"],
): "unknown" | "low" | "partial" | "good" {
  if (adherence.status === "met_target") {
    return "good";
  }

  if (adherence.status === "met_minimum" || adherence.status === "on_track") {
    return "partial";
  }

  if (adherence.completedSessions > 0) {
    return "low";
  }

  return "unknown";
}
