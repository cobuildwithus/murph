import {
  EXPERIMENT_OUTCOME_SCHEMA_VERSION,
  EXPERIMENT_PROGRESS_SCHEMA_VERSION,
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  experimentProgressSnapshotSchema,
  safeParseContract,
  toLocalDayKey,
  type ExperimentFrontmatter,
  type ExperimentOutcome,
  type ExperimentProgressMetricSignal,
  type ExperimentProgressSnapshot,
} from "@murphai/contracts";

import { getExperiment, type VaultReadModel } from "./read-model.ts";
import {
  buildExperimentAdherenceCalendar,
  resolveExperimentAdherenceRollupTarget,
  synthesizeLegacySessionAdherenceTargets,
  type ExperimentAdherenceCalendarResult,
  type ExperimentAdherenceObservation,
} from "./experiment-adherence.ts";
import { matchesExperimentMetricIdentity } from "./experiment-metrics.ts";
import {
  readExperimentProtocolProjectionFields,
  type ExperimentProtocolProjectionFields,
} from "./protocols.ts";
import {
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  normalizeMetricKey,
  selectMetricSeries,
  selectMetricValue,
  selectMetricWindowComparison,
  type MetricPoint,
  type MetricWindowSummary,
} from "./metrics/index.ts";
import { buildMetricProjection } from "./metrics/projection.ts";
import { summarizeWearableDay, type WearableDaySummary } from "./wearables.ts";

import type { CanonicalEntity } from "./canonical-entities.ts";

const MAX_EXPERIMENT_ANALYSIS_WINDOW_DAYS = 366;

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
  | "missing_metric_window";
export type ExperimentFollowupKind = "missed-log" | "weekly-digest";
export type ExperimentFollowupAction = "notify" | "skip";
export type ExperimentFollowupReason =
  | "experiment_not_active"
  | "not_in_intervention_window"
  | "missed_log_followup_disabled"
  | "reminders_disabled"
  | "session_already_logged"
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
  unit: string | null;
}

export interface ExperimentProgressSummary extends ExperimentProgressSnapshot {
  schema: typeof EXPERIMENT_PROGRESS_SCHEMA_VERSION;
  asOf: string;
  adherence: {
    completedSessions: number;
    expectedSessionsByNow: number | null;
    minimumUsefulSessions: number | null;
    sessionEventIds?: string[];
    status: ExperimentAdherenceStatus;
    targetSessions: number | null;
  };
  confounders: string[];
  dataCoverage: {
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
  metricResults: ExperimentMetricResult[];
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
  asOf: string;
  baselineDates: string[];
  completedSessions: number;
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
  "events" | "frontmatter" | "progressPhase"
>;

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
  const completedSessionEventIds = context.events
    .filter(isCompletedSessionEvent)
    .map((event) => event.entityId);
  const primarySignal = signals[0] ?? null;
  const primaryBiomarkerKey = context.frontmatter.analysisPlan?.primaryBiomarkerKey ?? null;
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
  const adherence = {
    ...buildAdherenceSummary(context),
    sessionEventIds: completedSessionEventIds,
  };
  const dataCoverage = buildCoverageSummary({
    baselineDaysAvailable,
    interventionDaysAvailable,
    primarySignal,
    progressPhase: context.progressPhase,
    frontmatter: context.frontmatter,
    signals,
    summariesByDate: context.summariesByDate,
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
  const metricResults = buildMetricResults(context);
  const adherence = buildAdherenceSummary(context);
  const confidence = buildOutcomeConfidence({
    adherence,
    confounders: context.confounders,
    metricResults,
  });
  const primary = metricResults[0] ?? null;

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
    conclusion: buildOutcomeConclusion(primary, confidence.level),
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
  const events = findExperimentEvents(vault, experiment, frontmatter, asOf);
  const completedSessions = events.filter(isCompletedSessionEvent).length;
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
    asOf,
    baselineDates: dateRange(frontmatter.runPlan?.baselineStart, frontmatter.runPlan?.baselineEnd),
    completedSessions,
    confounders: summarizeConfounders(events),
    events,
    experiment,
    frontmatter,
    interventionDates: dateRange(
      frontmatter.runPlan?.interventionStart,
      minIsoDate(frontmatter.runPlan?.interventionEnd, asOf),
    ),
    metricPoints: options.metricPoints ?? buildMetricProjection(vault).metricPoints,
    progressPhase,
    summariesByDate,
  };
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
  return {
    events: findExperimentEvents(vault, experiment, frontmatter, asOf),
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

function buildMetricResults(context: ExperimentSummaryContext): ExperimentMetricResult[] {
  const biomarkerKeys = [
    context.frontmatter.analysisPlan?.primaryBiomarkerKey,
    ...(context.frontmatter.analysisPlan?.secondaryBiomarkerKeys ?? []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return biomarkerKeys.map((biomarkerKey) => {
    const metricWindows = selectMetricWindows(context, biomarkerKey);
    const baselineWindow = metricWindows.baseline;
    const interventionWindow = metricWindows.intervention;
    const baselineMean = baselineWindow.mean;
    const interventionMean = interventionWindow.mean;
    const deltaAbs =
      baselineMean !== null && interventionMean !== null
        ? round(interventionMean - baselineMean)
        : null;
    const deltaPct =
      baselineMean !== null &&
      interventionMean !== null &&
      baselineMean !== 0
        ? round(((interventionMean - baselineMean) / Math.abs(baselineMean)) * 100)
        : null;
    const unit = interventionWindow.unit ?? baselineWindow.unit;
    const expectedDirection = resolveExpectedDirection(context.frontmatter.analysisPlan, biomarkerKey);
    const baselineSummary = {
      daysWithData: baselineWindow.daysWithData,
      mean: baselineMean,
      totalDays: baselineWindow.totalDays,
      unit,
    };
    const interventionSummary = {
      daysWithData: interventionWindow.daysWithData,
      mean: interventionMean,
      totalDays: interventionWindow.totalDays,
      unit,
    };

    return {
      baselineDayCount: baselineWindow.daysWithData,
      baselineMean,
      baseline: baselineSummary,
      biomarkerKey,
      completeness: classifyMetricCompleteness(
        baselineWindow.daysWithData,
        interventionWindow.daysWithData,
        { pointMeasurement: metricWindows.source === "point_measurement" },
      ),
      deltaAbs,
      deltaPct,
      expectedDirection,
      interventionDayCount: interventionWindow.daysWithData,
      interventionMean,
      intervention: interventionSummary,
      label: humanizeBiomarkerKey(biomarkerKey),
      movedAsExpected: movedAsExpected(deltaAbs, expectedDirection),
      unit,
    };
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

  if (analysisPlan?.primaryBiomarkerKey === biomarkerKey) {
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
  return (
    context.frontmatter.runPlan?.adherenceTargets ??
    synthesizeLegacySessionAdherenceTargets({
      runPlan: context.frontmatter.runPlan,
    })
  );
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
  const adherenceCalendar = buildAdherenceCalendarFromContext(context);
  const rollupCells = rollupTarget && adherenceCalendar
    ? adherenceCalendar.cells.filter((cell) => cell.targetId === rollupTarget.targetId)
    : null;
  const completedSessions = hasAmbiguousTargets
    ? 0
    : rollupCells
    ? rollupCells.filter((cell) => cell.status === "satisfied").length
    : context.completedSessions;
  const expectedSessionsByNow = hasAmbiguousTargets
    ? null
    : adherenceCalendar
    ? (rollupCells ?? adherenceCalendar.cells).filter((cell) => cell.status !== "scheduled").length
    : computeExpectedSessionsByNow(
        context.frontmatter,
        context.asOf,
        targetSessions,
      );

  let status: ExperimentAdherenceStatus = "unknown";
  if (hasAmbiguousTargets) {
    status = "unknown";
  } else if (completedSessions === 0) {
    status = "not_started";
  } else if (targetSessions !== null && completedSessions >= targetSessions) {
    status = "met_target";
  } else if (
    minimumUsefulSessions !== null &&
    completedSessions >= minimumUsefulSessions
  ) {
    status = "met_minimum";
  } else if (
    expectedSessionsByNow !== null &&
    completedSessions < expectedSessionsByNow
  ) {
    status = "behind";
  } else if (completedSessions > 0) {
    status = "on_track";
  }

  return {
    completedSessions,
    expectedSessionsByNow,
    minimumUsefulSessions,
    status,
    targetSessions,
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
        observations.push(...context.events
          .filter((event) => event.kind === linkedEvidence.eventKind)
          .map((event) => ({
            evidenceId: event.entityId,
            eventKind: event.kind,
            localDate:
              readStringAttribute(event, "scheduledLocalDate") ??
              readStringAttribute(event, "sessionLocalDate") ??
              (event.occurredAt
                ? toLocalDayKey(new Date(event.occurredAt), target.calendar.timeZone)
                : event.date ?? context.asOf),
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
  const points = context.metricPoints.filter((point) =>
    point.effectiveDate <= context.asOf && matchesExperimentMetricIdentity(metricKey, point)
  );
  const selectedMetricKey = points[0]?.metricKey ?? normalizeMetricKey(metricKey);
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
  baselineDaysAvailable: number;
  interventionDaysAvailable: number;
  frontmatter: ExperimentFrontmatter;
  primarySignal: ExperimentMetricResult | null;
  progressPhase: ExperimentProgressPhase;
  signals: readonly ExperimentMetricResult[];
  summariesByDate: Map<string, WearableDaySummary | null>;
}): ExperimentProgressSummary["dataCoverage"] {
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

  const wearableProviders = [...new Set(
    [...input.summariesByDate.values()].flatMap((summary) => summary?.providers ?? []),
  )].sort((left, right) => left.localeCompare(right));

  return {
    baselineDaysAvailable: input.baselineDaysAvailable,
    interventionDaysAvailable: input.interventionDaysAvailable,
    primaryBiomarkerKey: input.primarySignal?.biomarkerKey ?? null,
    primaryMetricDaysAvailable,
    status,
    wearableProviders,
  };
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

  if (!frontmatter.analysisPlan) {
    blockingReasons.push("missing_analysis_plan");
  }
  if (!frontmatter.analysisPlan?.primaryBiomarkerKey) {
    blockingReasons.push("missing_primary_biomarker");
  }
  if (
    !hasAnalysisMetricWindow(frontmatter)
  ) {
    blockingReasons.push("missing_metric_window");
  }

  return readinessResult(blockingReasons);
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
  metricResults: ExperimentMetricResult[];
}): ExperimentOutcomeSummary["confidence"] {
  const reasons: string[] = [];
  const primary = input.metricResults[0] ?? null;

  if (!primary || primary.completeness === "insufficient") {
    reasons.push("Primary biomarker coverage is insufficient for a strong before-and-after read.")
  }

  if (
    input.adherence.minimumUsefulSessions !== null &&
    input.adherence.completedSessions < input.adherence.minimumUsefulSessions
  ) {
    reasons.push("Completed session count stayed below the minimum useful target.")
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

function buildOutcomeConclusion(
  primary: ExperimentMetricResult | null,
  confidenceLevel: ExperimentOutcomeConfidenceLevel,
): ExperimentOutcomeSummary["conclusion"] {
  if (!primary || primary.deltaAbs === null || primary.interventionMean === null) {
    return {
      caveats: [
        "This is an N-of-1 readout, not medical advice.",
        "Sparse biomarker coverage or missing sessions can make this directional rather than decisive.",
      ],
      headline: "The experiment finished, but the primary biomarker readout is incomplete.",
      plainLanguage:
        "Murph reached the end of the run, but there was not enough primary biomarker data to make a trustworthy before-and-after comparison.",
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
        ? "No intervention-window wearable data is available yet."
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

  if (hasSessionLogForDate(context.events, date)) {
    return buildFollowupBase(
      context,
      date,
      "missed-log",
      "session_already_logged",
      "skip",
      date,
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

function hasSessionLogForDate(events: readonly CanonicalEntity[], date: string): boolean {
  return events.some((event) => event.kind === "intervention_session" && event.date === date);
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
  const primaryBiomarkerKey = frontmatter.analysisPlan?.primaryBiomarkerKey;
  if (!primaryBiomarkerKey) {
    return false;
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
  const primaryBiomarkerKey = frontmatter.analysisPlan?.primaryBiomarkerKey;
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
  const primaryBiomarkerKey = frontmatter.analysisPlan?.primaryBiomarkerKey;
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
    hasMeasurementAnchorForRole(analysisPlan, biomarkerKey, "baseline") &&
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
  biomarkerKey: string,
): MetricWindowPair {
  if (
    hasCompletePointMeasurementPlanForBiomarker(
      context.frontmatter.analysisPlan,
      biomarkerKey,
    )
  ) {
    return {
      baseline: collectAnchoredMetricWindow(context, biomarkerKey, "baseline") ?? {
        daysWithData: 0,
        mean: null,
        totalDays: 0,
        unit: null,
      },
      intervention:
        collectAnchoredMetricWindow(context, biomarkerKey, "followup") ??
        collectPlannedMetricWindow(context, biomarkerKey, "followup") ?? {
          daysWithData: 0,
          mean: null,
          totalDays: 0,
          unit: null,
        },
      source: "point_measurement",
    };
  }

  const runWindows = collectRunMetricWindows(context, biomarkerKey);
  return {
    baseline: runWindows.baseline,
    intervention: runWindows.intervention,
    source: "run_window",
  };
}

function collectRunMetricWindows(
  context: ExperimentSummaryContext,
  biomarkerKey: string,
): Pick<MetricWindowPair, "baseline" | "intervention"> {
  const emptyWindows = {
    baseline: emptyMetricWindowSelection(context.baselineDates.length),
    intervention: emptyMetricWindowSelection(context.interventionDates.length),
  };
  const metricKey = resolveMetricKeyForBiomarker(biomarkerKey);
  if (!metricKey) {
    return emptyWindows;
  }

  const comparison = selectMetricWindowComparison({
    baselineWindow: metricWindowRangeFromDates(context.baselineDates),
    comparisonWindow: metricWindowRangeFromDates(context.interventionDates),
    metricKey,
    points: selectMetricSeries({
      metricKey,
      points: context.metricPoints,
    }).rows,
    statistic: "mean",
  });

  return {
    baseline: metricWindowSelectionFromSummary(comparison.baseline),
    intervention: metricWindowSelectionFromSummary(comparison.comparison),
  };
}

function resolveMetricKeyForBiomarker(biomarkerKey: string): string | null {
  const normalized = biomarkerKey.trim().toLowerCase();
  const slug = normalized.split(":").at(-1) ?? normalized;
  const normalizedBiomarkerKey = normalized.startsWith("biomarker:")
    ? normalized
    : `biomarker:${slug}`;

  return (
    resolveMetricDefinitionForBiomarker(normalizedBiomarkerKey)?.key ??
    resolveMetricDefinition(slug)?.key ??
    null
  );
}

function collectPlannedMetricWindow(
  context: ExperimentSummaryContext,
  biomarkerKey: string,
  role: "baseline" | "followup",
): MetricWindowSelection | null {
  const plannedMeasurement = (context.frontmatter.analysisPlan?.plannedMeasurements ?? []).find(
    (measurement) =>
      measurement.role === role &&
      measurement.biomarkerKeys.includes(biomarkerKey) &&
      dateRange(measurement.targetWindow?.start, measurement.targetWindow?.end).length >
        0,
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
  biomarkerKey: string,
  role: "baseline" | "followup",
): MetricWindowSelection | null {
  const anchors = (context.frontmatter.analysisPlan?.measurementAnchors ?? []).filter(
    (anchor) => anchor.role === role && anchor.biomarkerKeys.includes(biomarkerKey),
  );
  if (anchors.length === 0) {
    return null;
  }

  const metricKey = resolveMetricKeyForBiomarker(biomarkerKey);
  const values: number[] = [];
  let unit: string | null = null;
  for (const anchor of anchors) {
    const anchoredPoints = context.metricPoints.filter(
      (point) =>
        point.effectiveDate <= context.asOf &&
        metricPointRecordIds(point).includes(anchor.recordId) &&
        (metricKey ? point.metricKey === metricKey : point.biomarkerKey === biomarkerKey),
    );
    const selection = selectMetricValue({
      biomarkerKey,
      now: context.asOf,
      points: anchoredPoints,
    });
    const fallbackPoint = anchoredPoints.find((point) =>
      typeof point.canonicalValue === "number" &&
      Number.isFinite(point.canonicalValue) &&
      typeof point.canonicalUnit === "string" &&
      point.canonicalUnit.length > 0
    );
    const value = typeof selection.value === "number" ? selection.value : fallbackPoint?.canonicalValue ?? null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }

    values.push(value);
    unit ??= typeof selection.value === "number" ? selection.unit : fallbackPoint?.canonicalUnit ?? null;
  }

  return metricWindowSelectionFromValues(values, anchors.length, unit);
}

function metricPointRecordIds(point: MetricPoint): string[] {
  const contributingRecordIds = point.context.contributingRecordIds;
  if (!Array.isArray(contributingRecordIds)) {
    return [point.source.recordId];
  }

  return [...new Set([
    ...contributingRecordIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    point.source.recordId,
  ])];
}

function emptyMetricWindowSelection(totalDays: number): MetricWindowSelection {
  return {
    daysWithData: 0,
    mean: null,
    totalDays,
    unit: null,
  };
}

function metricWindowSelectionFromSummary(
  summary: MetricWindowSummary,
): MetricWindowSelection {
  return {
    daysWithData: summary.daysWithData,
    mean: summary.value !== null ? round(summary.value) : null,
    totalDays: summary.totalDays,
    unit: summary.unit,
  };
}

function metricWindowSelectionFromValues(
  values: readonly number[],
  totalDays: number,
  unit: string | null,
): MetricWindowSelection {
  if (values.length === 0) {
    return emptyMetricWindowSelection(totalDays);
  }

  return {
    daysWithData: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    totalDays,
    unit,
  };
}

function metricWindowRangeFromDates(
  dates: readonly string[],
): { end: string | null; start: string | null; totalDays: number } {
  return {
    end: dates.at(-1) ?? null,
    start: dates[0] ?? null,
    totalDays: dates.length,
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
    const date = event.date ?? extractDate(event.occurredAt);
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
