import {
  experimentAdherenceTargetsSchema,
  experimentRunScheduleIntentSchema,
  type ExperimentAdherenceTarget,
  type ExperimentRunScheduleIntent,
} from "@murphai/contracts";

import {
  buildExperimentAdherenceCalendar,
  resolveExperimentAdherenceRollupTarget,
  synthesizeLegacySessionAdherenceTargets,
  type ExperimentAdherenceCalendarResult,
  type ExperimentAdherenceCellStatus,
  type ExperimentAdherenceObservation,
} from "../experiment-adherence.ts";
import {
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricWindowComparison,
  type MetricWindowSummary,
} from "../metrics/index.ts";
import type {
  BrowserVaultEntity,
  BrowserVaultMetricRow,
  BrowserVaultQueryClient,
  BrowserVaultSummaryConfidence,
} from "./shared.ts";
import { browserMetricRowToSeriesPoint } from "./metric-points.ts";

type JsonRecord = Record<string, unknown>;

const MAX_BROWSER_EXPERIMENT_WINDOW_DAYS = 3660;

export type BrowserVaultExperimentResultsLookup =
  | string
  | {
      experimentId?: string;
      protocolKeys?: readonly string[];
      slug?: string;
    };

export interface BrowserVaultExperimentResultsOptions {
  asOf?: string;
}

export type BrowserVaultExperimentProgressPhase =
  | "planned"
  | "baseline"
  | "intervention"
  | "review_due"
  | "completed"
  | "paused"
  | "abandoned";

export type BrowserVaultExperimentBiomarkerStatus =
  | "available"
  | "no_data"
  | "unsupported_source"
  | "unavailable";

export type BrowserVaultExperimentCoverageStatus =
  | "no_data"
  | "insufficient"
  | "partial"
  | "sufficient_for_progress"
  | "ready_for_review";

export type BrowserVaultExperimentOutcomeStatus =
  | "not_ready"
  | "sparse_data"
  | "enough_data";

export type BrowserVaultExperimentExpectedDirection =
  | "increase"
  | "decrease"
  | "stabilize"
  | "mixed"
  | "watch";

export type BrowserVaultExperimentResultDiagnosticCode =
  | "invalid_schedule"
  | "missing_analysis_plan"
  | "no_schedule"
  | "no_window"
  | "sparse_data"
  | "unsupported_biomarker";

export interface BrowserVaultExperimentResultDiagnostic {
  biomarkerKey?: string;
  code: BrowserVaultExperimentResultDiagnosticCode;
  message: string;
  severity: "info" | "warning";
}

export interface BrowserVaultExperimentRunWindows {
  baselineEnd: string | null;
  baselineStart: string | null;
  interventionEnd: string | null;
  interventionStart: string | null;
}

export interface BrowserVaultExperimentResultRun {
  commonsProtocolRef: JsonRecord | null;
  completedAt: string | null;
  dayInRun: number | null;
  effectiveProtocolSnapshot: JsonRecord | null;
  id: string;
  phase: BrowserVaultExperimentProgressPhase;
  protocolRef: JsonRecord | null;
  runPlan: {
    adherenceTargets: BrowserVaultExperimentAdherenceTarget[];
    minimumUsefulSessions: number | null;
    schedule: ExperimentRunScheduleIntent | null;
    sessionsPerWeek: number | null;
    targetSessions: number | null;
  } & BrowserVaultExperimentRunWindows;
  slug: string;
  startedOn: string | null;
  status: string | null;
  title: string;
  windows: BrowserVaultExperimentRunWindows;
}

export interface BrowserVaultExperimentAdherenceTarget {
  calendar: ExperimentAdherenceTarget["calendar"];
  label: string;
  phase: ExperimentAdherenceTarget["phase"];
  rollup?: ExperimentAdherenceTarget["rollup"];
  targetId: string;
}

export interface BrowserVaultExperimentMetricSource {
  metricKey: string;
}

export interface BrowserVaultExperimentMetricPoint {
  confidence: BrowserVaultSummaryConfidence["level"];
  date: string;
  metricKey: string;
  phase: "baseline" | "intervention";
  unit: string | null;
  value: number;
}

export interface BrowserVaultExperimentMetricWindowSummary {
  daysWithData: number;
  end: string | null;
  mean: number | null;
  start: string | null;
  totalDays: number;
  unit: string | null;
}

export interface BrowserVaultExperimentExpectedRange {
  dayOrigin: "run" | "intervention";
  endDay: number;
  high: number;
  low: number;
  scale: "absolute" | "delta" | "percent";
  sourceKeys: string[];
  startDay: number;
  unit: string | null;
}

export interface BrowserVaultExperimentExpectedEffect {
  caveats: string[];
  confidence: "low" | "moderate" | "high" | null;
  description: string | null;
  direction: BrowserVaultExperimentExpectedDirection | null;
  expectedRange: BrowserVaultExperimentExpectedRange | null;
  sourceKeys: string[];
}

export interface BrowserVaultExperimentBiomarkerResult {
  baseline: BrowserVaultExperimentMetricWindowSummary;
  biomarkerKey: string;
  completeness: "insufficient" | "partial" | "good";
  deltaAbs: number | null;
  deltaPct: number | null;
  expectedEffect: BrowserVaultExperimentExpectedEffect;
  intervention: BrowserVaultExperimentMetricWindowSummary;
  label: string;
  movedAsExpected: boolean | null;
  points: BrowserVaultExperimentMetricPoint[];
  sourceMetric: BrowserVaultExperimentMetricSource | null;
  status: BrowserVaultExperimentBiomarkerStatus;
  statusReason: string;
  unit: string | null;
}

export interface BrowserVaultExperimentScheduleResult {
  cells: BrowserVaultExperimentScheduleCell[];
  completedSessions: number;
  failedSessions: number;
  missedSessions: number;
  unknownSessions: number;
  partialSessions: number;
  plannedSessions: number;
  skippedSessions: number;
  timeZone: string;
}

export type BrowserVaultExperimentScheduleCellKind =
  | "completed"
  | "partial"
  | "missed"
  | "failed"
  | "unknown"
  | "scheduled";

export interface BrowserVaultExperimentScheduleCell {
  evidenceIds: string[];
  kind: BrowserVaultExperimentScheduleCellKind;
  label: string;
  localDate: string;
  localTime: string | null;
  planned: boolean;
  reason: string;
  source: "event" | "planned";
  targetId: string;
  timeZone: string;
}

export interface BrowserVaultExperimentContextEntry {
  confounders: string[];
  date: string | null;
  id: string;
  kind: "session" | "context";
  note: string | null;
  symptoms: string[];
}

export interface BrowserVaultExperimentAdherenceResult {
  cells: ExperimentAdherenceCalendarResult["cells"];
  summary: ExperimentAdherenceCalendarResult["summary"];
  targets: BrowserVaultExperimentAdherenceTarget[];
  timeZone: string;
}

export interface BrowserVaultExperimentProgressResult {
  adherence: {
    completedSessions: number;
    expectedSessionsByNow: number | null;
    loggedSessions: number;
    minimumUsefulSessions: number | null;
    missedSessions: number;
    partialSessions: number;
    skippedSessions: number;
    status: "not_started" | "behind" | "on_track" | "met_minimum" | "met_target" | "unknown";
    targetSessions: number | null;
  };
  dataCoverage: {
    baselineDaysAvailable: number;
    interventionDaysAvailable: number;
    primaryBiomarkerKey: string | null;
    primaryMetricDaysAvailable: number;
    status: BrowserVaultExperimentCoverageStatus;
  };
  setupReadiness: {
    status: "ready" | "incomplete";
    blockingReasons: string[];
  };
  analysisReadiness: {
    status: "ready" | "incomplete";
    blockingReasons: string[];
  };
  dayInRun: number | null;
  phase: BrowserVaultExperimentProgressPhase;
  windows: BrowserVaultExperimentRunWindows;
}

export interface BrowserVaultExperimentOutcomeResult {
  confidence: {
    level: "low" | "medium" | "high";
    reasons: string[];
  };
  primaryBiomarkerKey: string | null;
  status: BrowserVaultExperimentOutcomeStatus;
}

export interface BrowserVaultExperimentResultsView {
  adherence: BrowserVaultExperimentAdherenceResult | null;
  asOf: string;
  biomarkers: BrowserVaultExperimentBiomarkerResult[];
  context: BrowserVaultExperimentContextEntry[];
  diagnostics: BrowserVaultExperimentResultDiagnostic[];
  experiment: BrowserVaultExperimentResultRun;
  outcome: BrowserVaultExperimentOutcomeResult | null;
  progress: BrowserVaultExperimentProgressResult | null;
  schedule: BrowserVaultExperimentScheduleResult | null;
}

interface BrowserVaultExperimentRunContext {
  asOf: string;
  asOfDate: string;
  diagnostics: BrowserVaultExperimentResultDiagnostic[];
  entity: BrowserVaultEntity;
  events: BrowserVaultEntity[];
  eventTimeZone: string | null;
  adherenceTargets: ExperimentAdherenceTarget[];
  expectedEffects: BrowserVaultExperimentExpectedEffectInput[];
  run: BrowserVaultExperimentResultRun;
}

interface BrowserVaultExperimentExpectedEffectInput {
  biomarkerKey: string;
  caveats: string[];
  confidence: "low" | "moderate" | "high" | null;
  description: string | null;
  direction: BrowserVaultExperimentExpectedDirection | null;
  range: BrowserVaultExperimentExpectedRange | null;
  sourceKeys: string[];
}

interface MetricWindowContext {
  baselineDates: string[];
  interventionDates: string[];
  windows: BrowserVaultExperimentRunWindows;
}

const ACTIVE_EXPERIMENT_RUN_STATUSES = new Set([
  "active",
  "in_progress",
  "ongoing",
  "open",
  "running",
]);

export function selectBrowserVaultExperimentResults(
  client: BrowserVaultQueryClient,
  lookup: BrowserVaultExperimentResultsLookup,
  options: BrowserVaultExperimentResultsOptions = {},
): BrowserVaultExperimentResultsView | null {
  const asOf = options.asOf ?? client.replica.generatedAt;
  const entity = findBrowserVaultExperimentRun(client, lookup);

  if (!entity) {
    return null;
  }

  const context = buildRunContext(client, entity, asOf);
  const metricWindow = buildMetricWindowContext(context.run.windows, context.asOfDate);
  const biomarkers = buildBiomarkerResults(client, context, metricWindow);
  const adherence = buildAdherenceResult(context, client.replica.metricRows);
  const schedule = buildScheduleResult(adherence);
  const progress = buildProgressResult(context, biomarkers, schedule);
  const outcome = buildOutcomeResult(context, biomarkers, progress);
  const runContext = buildExperimentContextEntries(context);

  return {
    adherence,
    asOf,
    biomarkers,
    context: runContext,
    diagnostics: context.diagnostics,
    experiment: context.run,
    outcome,
    progress,
    schedule,
  };
}

function findBrowserVaultExperimentRun(
  client: BrowserVaultQueryClient,
  lookup: BrowserVaultExperimentResultsLookup,
): BrowserVaultEntity | null {
  const candidates = client.replica.entities.filter((entity) => entity.family === "experiment");
  const matches = candidates.filter((entity) => matchesRunLookup(entity, lookup));

  return matches.sort(compareExperimentRunCandidates)[0] ?? null;
}

function matchesRunLookup(
  entity: BrowserVaultEntity,
  lookup: BrowserVaultExperimentResultsLookup,
): boolean {
  if (typeof lookup === "string") {
    const lookupSet = new Set(readRunLookupKeys(entity));
    return lookupSet.has(lookup);
  }

  if (lookup.experimentId) {
    const lookupSet = new Set(readExperimentIdLookupKeys(entity));
    if (lookupSet.has(lookup.experimentId)) {
      return true;
    }
  }

  if (lookup.slug) {
    const lookupSet = new Set(readSlugLookupKeys(entity));
    if (lookupSet.has(lookup.slug)) {
      return true;
    }
  }

  if (lookup.protocolKeys && lookup.protocolKeys.length > 0) {
    const protocolLookupSet = new Set(readProtocolLookupKeys(entity.attributes));
    if (lookup.protocolKeys.some((key) => protocolLookupSet.has(key))) {
      return true;
    }
  }

  return false;
}

function compareExperimentRunCandidates(left: BrowserVaultEntity, right: BrowserVaultEntity): number {
  const leftActive = isActiveExperimentRunStatus(
    readString(left.attributes.status) ?? left.status,
  ) ? 1 : 0;
  const rightActive = isActiveExperimentRunStatus(
    readString(right.attributes.status) ?? right.status,
  ) ? 1 : 0;

  if (leftActive !== rightActive) {
    return rightActive - leftActive;
  }

  return compareStringsDesc(left.occurredAt ?? left.date, right.occurredAt ?? right.date);
}

function isActiveExperimentRunStatus(status: string | null | undefined): boolean {
  return typeof status === "string" &&
    ACTIVE_EXPERIMENT_RUN_STATUSES.has(status.trim().toLowerCase());
}

function buildRunContext(
  client: BrowserVaultQueryClient,
  entity: BrowserVaultEntity,
  asOf: string,
): BrowserVaultExperimentRunContext {
  const diagnostics: BrowserVaultExperimentResultDiagnostic[] = [];
  const attributes = entity.attributes;
  const windows = readRunWindows(attributes);
  const schedule = readRunSchedule(attributes, diagnostics);
  const runPlanRecord = readRecord(attributes.runPlan);
  const parsedAdherenceTargets = readAdherenceTargets(attributes, diagnostics);
  const adherenceTargets: ExperimentAdherenceTarget[] = parsedAdherenceTargets === null
    ? synthesizeLegacySessionAdherenceTargets({
        runPlan: {
          minimumUsefulSessions: readNumber(runPlanRecord, "minimumUsefulSessions") ?? undefined,
          modality: readString(runPlanRecord?.modality) ?? undefined,
          schedule: schedule ?? undefined,
          targetSessions: readNumber(runPlanRecord, "targetSessions") ?? undefined,
        },
      })
    : parsedAdherenceTargets;
  const runTimeZone = adherenceTargets[0]?.calendar.timeZone ?? schedule?.timeZone ?? null;
  const asOfDate = runTimeZone ? toZonedIsoDate(asOf, runTimeZone) : toIsoDate(asOf);
  const startedOn = readString(attributes.startedOn) ?? entity.date ?? extractDate(entity.occurredAt);
  const completedAt = readString(attributes.completedAt) ?? readString(attributes.endedOn);
  const runStart = windows.baselineStart ?? windows.interventionStart;
  const run = {
    commonsProtocolRef: cloneRecordOrNull(attributes.commonsProtocolRef),
    completedAt,
    dayInRun: windows.interventionStart !== null && windows.interventionEnd !== null
      ? computeDayInRun(runStart, asOfDate)
      : null,
    effectiveProtocolSnapshot: cloneRecordOrNull(attributes.effectiveProtocolSnapshot),
    id: readString(attributes.experimentId) ?? entity.id,
    phase: resolveExperimentPhase(readString(attributes.status) ?? entity.status, windows, asOfDate),
    protocolRef: cloneRecordOrNull(attributes.protocolRef),
    runPlan: {
      ...windows,
      adherenceTargets: adherenceTargets.map(projectBrowserAdherenceTarget),
      minimumUsefulSessions: readNumber(attributes.runPlan, "minimumUsefulSessions"),
      schedule,
      sessionsPerWeek: readNumber(attributes.runPlan, "sessionsPerWeek"),
      targetSessions: readNumber(attributes.runPlan, "targetSessions"),
    },
    slug: readString(attributes.slug) ?? entity.experimentSlug ?? entity.id,
    startedOn,
    status: readString(attributes.status) ?? entity.status,
    title: entity.title ?? readString(attributes.title) ?? entity.id,
    windows,
  } satisfies BrowserVaultExperimentResultRun;
  const events = selectExperimentEvents(client, entity, run, asOfDate, runTimeZone);
  const expectedEffects = readExpectedEffectInputs(attributes);

  return {
    asOf,
    asOfDate,
    diagnostics,
    entity,
    events,
    eventTimeZone: runTimeZone,
    adherenceTargets,
    expectedEffects,
    run,
  };
}

function projectBrowserAdherenceTarget(
  target: ExperimentAdherenceTarget,
): BrowserVaultExperimentAdherenceTarget {
  return {
    calendar: target.calendar,
    label: target.label,
    phase: target.phase,
    rollup: target.rollup,
    targetId: target.targetId,
  };
}

function readRunWindows(attributes: JsonRecord): BrowserVaultExperimentRunWindows {
  const runPlan = readRecord(attributes.runPlan);

  return {
    baselineEnd: readIsoDate(runPlan?.baselineEnd) ?? readIsoDate(attributes.baselineEnd),
    baselineStart: readIsoDate(runPlan?.baselineStart) ?? readIsoDate(attributes.baselineStart),
    interventionEnd: readIsoDate(runPlan?.interventionEnd) ?? readIsoDate(attributes.interventionEnd),
    interventionStart: readIsoDate(runPlan?.interventionStart) ?? readIsoDate(attributes.interventionStart),
  };
}

function readRunSchedule(
  attributes: JsonRecord,
  diagnostics: BrowserVaultExperimentResultDiagnostic[],
): ExperimentRunScheduleIntent | null {
  const runPlan = readRecord(attributes.runPlan);

  if (!runPlan || runPlan.schedule === undefined || runPlan.schedule === null) {
    return null;
  }

  const result = experimentRunScheduleIntentSchema.safeParse(runPlan.schedule);
  if (!result.success) {
    diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment has a run-plan schedule, but it is not a supported browser run schedule.",
      severity: "warning",
    });
    return null;
  }

  return result.data;
}

function readAdherenceTargets(
  attributes: JsonRecord,
  diagnostics: BrowserVaultExperimentResultDiagnostic[],
): ExperimentAdherenceTarget[] | null {
  const runPlan = readRecord(attributes.runPlan);

  if (!runPlan || runPlan.adherenceTargets === undefined || runPlan.adherenceTargets === null) {
    return null;
  }

  const result = experimentAdherenceTargetsSchema.safeParse(runPlan.adherenceTargets);
  if (!result.success) {
    diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment has adherence targets, but they are not supported by browser Results.",
      severity: "warning",
    });
    return [];
  }

  return result.data;
}

function selectExperimentEvents(
  client: BrowserVaultQueryClient,
  experiment: BrowserVaultEntity,
  run: BrowserVaultExperimentResultRun,
  asOfDate: string,
  eventTimeZone: string | null,
): BrowserVaultEntity[] {
  const from = run.windows.baselineStart ?? run.startedOn;

  return client.replica.entities.filter((entity) => {
    if (entity.family !== "event") {
      return false;
    }

    const eventDate = readSessionEventLocalDate(entity) ?? readEventLocalDate(entity, eventTimeZone);
    if (from && eventDate && eventDate < from) {
      return false;
    }

    if (eventDate && eventDate > asOfDate) {
      return false;
    }

    if (entity.experimentSlug === run.slug) {
      return true;
    }

    if (readString(entity.attributes.experimentSlug) === run.slug) {
      return true;
    }

    if (readString(entity.attributes.experimentId) === run.id) {
      return true;
    }

    return entity.links.some((link) => link.targetId === experiment.id || link.targetId === run.id);
  });
}

function readEventLocalDate(entity: BrowserVaultEntity, timeZone: string | null): string | null {
  if (timeZone && entity.occurredAt) {
    try {
      return toZonedIsoDate(entity.occurredAt, timeZone);
    } catch {
      return entity.date ?? extractDate(entity.occurredAt);
    }
  }

  return entity.date ?? extractDate(entity.occurredAt);
}

function readSessionEventLocalDate(entity: BrowserVaultEntity): string | null {
  return (
    readIsoDate(entity.attributes.scheduledLocalDate) ??
    readIsoDate(entity.attributes.sessionLocalDate)
  );
}

function buildMetricWindowContext(
  windows: BrowserVaultExperimentRunWindows,
  asOfDate: string,
): MetricWindowContext {
  const baselineDates = dateRange(windows.baselineStart, windows.baselineEnd);
  const interventionDates = dateRange(
    windows.interventionStart,
    minIsoDate(windows.interventionEnd, asOfDate),
  );

  return {
    baselineDates,
    interventionDates,
    windows,
  };
}

function buildBiomarkerResults(
  client: BrowserVaultQueryClient,
  context: BrowserVaultExperimentRunContext,
  metricWindow: MetricWindowContext,
): BrowserVaultExperimentBiomarkerResult[] {
  const biomarkerKeys = collectBiomarkerKeys(context.entity.attributes);

  if (biomarkerKeys.length === 0) {
    context.diagnostics.push({
      code: "missing_analysis_plan",
      message: "The experiment does not expose protocol or test-plan biomarkers in browser-safe fields.",
      severity: "warning",
    });
  }

  return biomarkerKeys.map((biomarkerKey) =>
    buildBiomarkerResult(client, context, metricWindow, biomarkerKey),
  );
}

function buildBiomarkerResult(
  client: BrowserVaultQueryClient,
  context: BrowserVaultExperimentRunContext,
  metricWindow: MetricWindowContext,
  biomarkerKey: string,
): BrowserVaultExperimentBiomarkerResult {
  const sourceMetric = resolveBiomarkerMetricSource(biomarkerKey);
  const label = humanizeBiomarkerKey(biomarkerKey);
  const expectedEffect = buildExpectedEffect(context, biomarkerKey);

  if (!sourceMetric) {
    context.diagnostics.push({
      biomarkerKey,
      code: "unsupported_biomarker",
      message: `${label} is represented in the run plan but has no supported browser metric source yet.`,
      severity: "info",
    });
    return emptyBiomarkerResult({
      biomarkerKey,
      expectedEffect,
      label,
      sourceMetric: null,
      status: "unsupported_source",
      statusReason: "No supported browser metric source is mapped for this biomarker.",
      window: metricWindow,
    });
  }

  const anchoredResult = buildAnchoredBiomarkerResult({
    biomarkerKey,
    client,
    context,
    expectedEffect,
    label,
    sourceMetric,
  });
  if (anchoredResult) {
    return anchoredResult;
  }

  const metricRows = collectMetricRows(client, sourceMetric, metricWindow);
  const metricSeriesPoints = metricRows.map(browserMetricRowToSeriesPoint);
  const points = metricRowsToExperimentPoints(metricRows, sourceMetric, metricWindow);
  const comparison = selectMetricWindowComparison({
    baselineWindow: {
      end: metricWindow.windows.baselineEnd,
      start: metricWindow.windows.baselineStart,
      totalDays: metricWindow.baselineDates.length,
    },
    comparisonWindow: {
      end: minIsoDate(metricWindow.windows.interventionEnd, context.asOfDate),
      start: metricWindow.windows.interventionStart,
      totalDays: metricWindow.interventionDates.length,
    },
    metricKey: sourceMetric.metricKey,
    points: metricSeriesPoints,
    statistic: "mean",
  });
  const baseline = experimentWindowSummaryFromMetricWindow(comparison.baseline);
  const intervention = experimentWindowSummaryFromMetricWindow(comparison.comparison);
  const deltaAbs = comparison.delta !== null ? round(comparison.delta) : null;
  const deltaPct = comparison.deltaPercent !== null ? round(comparison.deltaPercent) : null;
  const windowUnavailable =
    metricWindow.baselineDates.length === 0 && metricWindow.interventionDates.length === 0;
  const status = resolveBiomarkerStatus({
    points,
    sourceMetric,
    windowUnavailable,
  });
  const unit = comparison.unit;
  const statusReason = buildBiomarkerStatusReason(status, label);

  if (status === "no_data") {
    context.diagnostics.push({
      biomarkerKey,
      code: "sparse_data",
      message: `${label} has a supported browser metric source but no data in the run windows.`,
      severity: "info",
    });
  }

  if (status === "unavailable") {
    context.diagnostics.push({
      biomarkerKey,
      code: "no_window",
      message: `${label} cannot be analyzed because the run does not expose baseline or intervention windows.`,
      severity: "warning",
    });
  }

  return {
    baseline,
    biomarkerKey,
    completeness: classifyMetricCompleteness(
      baseline.daysWithData,
      intervention.daysWithData,
    ),
    deltaAbs,
    deltaPct,
    expectedEffect,
    intervention,
    label,
    movedAsExpected: movedAsExpected(deltaAbs, expectedEffect.direction),
    points,
    sourceMetric,
    status,
    statusReason,
    unit,
  };
}

type BrowserVaultMetricRowWithValue = BrowserVaultMetricRow & { value: number };

interface BrowserMeasurementAnchor {
  observedOn: string | null;
  recordId: string;
  role: "baseline" | "followup";
}

function buildAnchoredBiomarkerResult(input: {
  biomarkerKey: string;
  client: BrowserVaultQueryClient;
  context: BrowserVaultExperimentRunContext;
  expectedEffect: BrowserVaultExperimentExpectedEffect;
  label: string;
  sourceMetric: BrowserVaultExperimentMetricSource;
}): BrowserVaultExperimentBiomarkerResult | null {
  if (
    !hasCompletePointMeasurementPlanForBiomarker(
      input.context.entity.attributes,
      input.biomarkerKey,
    )
  ) {
    return null;
  }

  const baselineAnchors = readMeasurementAnchors(
    input.context.entity.attributes,
    input.biomarkerKey,
    "baseline",
  );
  const followupAnchors = readMeasurementAnchors(
    input.context.entity.attributes,
    input.biomarkerKey,
    "followup",
  );
  const baselineRows = collectAnchoredMetricRows(
    input.client,
    input.sourceMetric,
    baselineAnchors,
  );
  const followupRows = collectAnchoredMetricRows(
    input.client,
    input.sourceMetric,
    followupAnchors,
  );
  const baselinePoints = metricRowsToAnchoredExperimentPoints(
    baselineRows,
    input.sourceMetric,
    "baseline",
  );
  const interventionPoints = metricRowsToAnchoredExperimentPoints(
    followupRows,
    input.sourceMetric,
    "intervention",
  );
  const plannedFollowupWindow = readPlannedMeasurementWindow(
    input.context.entity.attributes,
    input.biomarkerKey,
    "followup",
  );
  const baseline = summarizeAnchoredMetricWindow(
    baselinePoints,
    baselineAnchors.length,
    null,
  );
  const intervention = summarizeAnchoredMetricWindow(
    interventionPoints,
    followupAnchors.length || plannedFollowupWindow.totalDays,
    plannedFollowupWindow,
  );
  const deltaAbs =
    baseline.mean !== null && intervention.mean !== null
      ? round(intervention.mean - baseline.mean)
      : null;
  const deltaPct =
    baseline.mean !== null &&
    intervention.mean !== null &&
    baseline.mean !== 0
      ? round(((intervention.mean - baseline.mean) / Math.abs(baseline.mean)) * 100)
      : null;
  const points = [...baselinePoints, ...interventionPoints];
  const status = resolveBiomarkerStatus({
    points,
    sourceMetric: input.sourceMetric,
    windowUnavailable: baselineAnchors.length === 0 && followupAnchors.length === 0,
  });
  const unit = intervention.unit ?? baseline.unit;

  if (status === "no_data") {
    input.context.diagnostics.push({
      biomarkerKey: input.biomarkerKey,
      code: "sparse_data",
      message: `${input.label} has measurement anchors but no matching browser metric rows.`,
      severity: "info",
    });
  }

  if (status === "unavailable") {
    input.context.diagnostics.push({
      biomarkerKey: input.biomarkerKey,
      code: "no_window",
      message: `${input.label} has a measurement plan but no observed measurement anchors yet.`,
      severity: "warning",
    });
  }

  return {
    baseline,
    biomarkerKey: input.biomarkerKey,
    completeness: classifyMetricCompleteness(
      baseline.daysWithData,
      intervention.daysWithData,
      { pointMeasurement: true },
    ),
    deltaAbs,
    deltaPct,
    expectedEffect: input.expectedEffect,
    intervention,
    label: input.label,
    movedAsExpected: movedAsExpected(deltaAbs, input.expectedEffect.direction),
    points,
    sourceMetric: input.sourceMetric,
    status,
    statusReason: buildBiomarkerStatusReason(status, input.label),
    unit,
  };
}

function collectMetricRows(
  client: BrowserVaultQueryClient,
  sourceMetric: BrowserVaultExperimentMetricSource,
  metricWindow: MetricWindowContext,
): BrowserVaultMetricRowWithValue[] {
  const byDate = new Map<string, BrowserVaultMetricRowWithValue>();
  for (const row of client.metrics.series({ metricKey: sourceMetric.metricKey })) {
    const phase = resolveMetricPointPhase(row.date, metricWindow);
    if (phase && hasNumericMetricValue(row)) {
      byDate.set(row.date, row);
    }
  }
  return [...byDate.values()].sort(compareMetricRowsAsc);
}

function collectAnchoredMetricRows(
  client: BrowserVaultQueryClient,
  sourceMetric: BrowserVaultExperimentMetricSource,
  anchors: readonly BrowserMeasurementAnchor[],
): BrowserVaultMetricRowWithValue[] {
  const anchorIds = new Set(anchors.map((anchor) => anchor.recordId));
  if (anchorIds.size === 0) {
    return [];
  }

  return client.metrics.series({ metricKey: sourceMetric.metricKey })
    .filter((row): row is BrowserVaultMetricRowWithValue =>
      hasNumericMetricValue(row) &&
      row.recordIds.some((recordId) => anchorIds.has(recordId))
    )
    .sort(compareMetricRowsAsc);
}

function metricRowsToExperimentPoints(
  rows: readonly BrowserVaultMetricRowWithValue[],
  sourceMetric: BrowserVaultExperimentMetricSource,
  metricWindow: MetricWindowContext,
): BrowserVaultExperimentMetricPoint[] {
  return rows.flatMap((row) => {
    const phase = resolveMetricPointPhase(row.date, metricWindow);
    return phase ? [{
      confidence: row.confidence,
      date: row.date,
      metricKey: sourceMetric.metricKey,
      phase,
      unit: row.unit,
      value: row.value,
    }] : [];
  });
}

function metricRowsToAnchoredExperimentPoints(
  rows: readonly BrowserVaultMetricRowWithValue[],
  sourceMetric: BrowserVaultExperimentMetricSource,
  phase: BrowserVaultExperimentMetricPoint["phase"],
): BrowserVaultExperimentMetricPoint[] {
  return rows.map((row) => ({
    confidence: row.confidence,
    date: row.date,
    metricKey: sourceMetric.metricKey,
    phase,
    unit: row.unit,
    value: row.value,
  }));
}

function summarizeAnchoredMetricWindow(
  points: readonly BrowserVaultExperimentMetricPoint[],
  totalDays: number,
  fallbackWindow: { end: string | null; start: string | null; totalDays: number } | null,
): BrowserVaultExperimentMetricWindowSummary {
  const values = points.map((point) => point.value);
  const unit = points[0]?.unit ?? null;
  const dates = points.map((point) => point.date).sort((left, right) => left.localeCompare(right));

  return {
    daysWithData: points.length,
    end: dates.at(-1) ?? fallbackWindow?.end ?? null,
    mean: values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    start: dates[0] ?? fallbackWindow?.start ?? null,
    totalDays,
    unit,
  };
}

function hasNumericMetricValue(row: BrowserVaultMetricRow): row is BrowserVaultMetricRowWithValue {
  return typeof row.value === "number" && Number.isFinite(row.value);
}

function compareMetricRowsAsc(
  left: BrowserVaultMetricRow,
  right: BrowserVaultMetricRow,
): number {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (left.observedAt !== right.observedAt) return left.observedAt.localeCompare(right.observedAt);
  return left.id.localeCompare(right.id);
}

function experimentWindowSummaryFromMetricWindow(
  summary: MetricWindowSummary,
): BrowserVaultExperimentMetricWindowSummary {
  return {
    daysWithData: summary.daysWithData,
    end: summary.end,
    mean: summary.value,
    start: summary.start,
    totalDays: summary.totalDays,
    unit: summary.unit,
  };
}

function resolveMetricPointPhase(
  date: string,
  metricWindow: MetricWindowContext,
): BrowserVaultExperimentMetricPoint["phase"] | null {
  if (dateInRange(date, metricWindow.windows.baselineStart, metricWindow.windows.baselineEnd)) {
    return "baseline";
  }

  if (
    dateInRange(
      date,
      metricWindow.windows.interventionStart,
      minIsoDate(metricWindow.windows.interventionEnd, metricWindow.interventionDates.at(-1) ?? null),
    )
  ) {
    return "intervention";
  }

  return null;
}

function buildExpectedEffect(
  context: BrowserVaultExperimentRunContext,
  biomarkerKey: string,
): BrowserVaultExperimentExpectedEffect {
  const exactEffect = context.expectedEffects.find((effect) => effect.biomarkerKey === biomarkerKey);
  const direction =
    exactEffect?.direction ?? readAnalysisPlanExpectedDirection(context.entity.attributes, biomarkerKey);

  return {
    caveats: exactEffect?.caveats ?? [],
    confidence: exactEffect?.confidence ?? null,
    description: exactEffect?.description ?? null,
    direction,
    expectedRange: exactEffect?.range ?? null,
    sourceKeys: exactEffect?.sourceKeys ?? [],
  };
}

function emptyBiomarkerResult(input: {
  biomarkerKey: string;
  expectedEffect: BrowserVaultExperimentExpectedEffect;
  label: string;
  sourceMetric: BrowserVaultExperimentMetricSource | null;
  status: BrowserVaultExperimentBiomarkerStatus;
  statusReason: string;
  window: MetricWindowContext;
}): BrowserVaultExperimentBiomarkerResult {
  const baseline = emptyMetricWindowSummary(
    input.window.windows.baselineStart,
    input.window.windows.baselineEnd,
    input.window.baselineDates.length,
    null,
  );
  const intervention = emptyMetricWindowSummary(
    input.window.windows.interventionStart,
    input.window.windows.interventionEnd,
    input.window.interventionDates.length,
    null,
  );

  return {
    baseline,
    biomarkerKey: input.biomarkerKey,
    completeness: "insufficient",
    deltaAbs: null,
    deltaPct: null,
    expectedEffect: input.expectedEffect,
    intervention,
    label: input.label,
    movedAsExpected: null,
    points: [],
    sourceMetric: input.sourceMetric,
    status: input.status,
    statusReason: input.statusReason,
    unit: null,
  };
}

function emptyMetricWindowSummary(
  start: string | null,
  end: string | null,
  totalDays: number,
  unit: string | null,
): BrowserVaultExperimentMetricWindowSummary {
  return {
    daysWithData: 0,
    end,
    mean: null,
    start,
    totalDays,
    unit,
  };
}

function buildAdherenceResult(
  context: BrowserVaultExperimentRunContext,
  metricRows: readonly BrowserVaultMetricRow[],
): BrowserVaultExperimentAdherenceResult | null {
  const adherenceTargets = context.adherenceTargets;
  const interventionStart = context.run.windows.interventionStart;
  const interventionEnd = context.run.windows.interventionEnd;

  if (adherenceTargets.length === 0 || !interventionStart || !interventionEnd) {
    context.diagnostics.push({
      code: "no_schedule",
      message: "No structured adherence target is available for this experiment.",
      severity: "info",
    });
    return null;
  }

  try {
    const adherence = buildExperimentAdherenceCalendar({
      asOf: context.asOf,
      observations: buildAdherenceObservations(context, metricRows, adherenceTargets),
      targets: adherenceTargets,
      windows: context.run.windows,
    });
    return {
      cells: adherence.cells,
      summary: adherence.summary,
      targets: adherenceTargets.map(projectBrowserAdherenceTarget),
      timeZone: adherence.timeZone,
    };
  } catch {
    context.diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment adherence target could not be expanded safely for browser Results.",
      severity: "warning",
    });
    return null;
  }
}

function buildScheduleResult(
  adherence: BrowserVaultExperimentAdherenceResult | null,
): BrowserVaultExperimentScheduleResult | null {
  if (!adherence) {
    return null;
  }

  const rollupTarget = resolveExperimentAdherenceRollupTarget(adherence.targets);
  const hasAmbiguousTargets = adherence.targets.length > 1 && !rollupTarget;
  const cells: BrowserVaultExperimentScheduleCell[] = adherence.cells.map((cell) => ({
    evidenceIds: cell.evidenceIds,
    kind: mapAdherenceCellStatus(cell.status),
    label: cell.label,
    localDate: cell.localDate,
    localTime: cell.localTime,
    planned: cell.planned,
    reason: cell.reason,
    source: cell.evidenceIds.length > 0 ? "event" : "planned",
    targetId: cell.targetId,
    timeZone: adherence.timeZone,
  }));
  const countedCells = hasAmbiguousTargets
    ? []
    : rollupTarget
    ? cells.filter((cell) => cell.targetId === rollupTarget.targetId)
    : cells;

  return summarizeScheduleCells(adherence.timeZone, cells, countedCells);
}

function buildAdherenceObservations(
  context: BrowserVaultExperimentRunContext,
  metricRows: readonly BrowserVaultMetricRow[],
  targets: readonly ExperimentAdherenceTarget[],
): ExperimentAdherenceObservation[] {
  const observations: ExperimentAdherenceObservation[] = [];

  for (const target of targets) {
    switch (target.evidence.kind) {
      case "linkedEventCount":
        const linkedEvidence = target.evidence;
        observations.push(...context.events
          .filter((event) => event.kind === linkedEvidence.eventKind)
          .map((event) => ({
            evidenceId: event.id,
            eventKind: event.kind,
            localDate:
              readSessionEventLocalDate(event) ??
              readEventLocalDate(event, target.calendar.timeZone) ??
              event.date ??
              context.asOfDate,
            status: readSessionScheduleStatus(event),
            targetId: target.targetId,
          })));
        break;
      case "metricPresence":
      case "metricThreshold":
        const metricEvidence = target.evidence;
        observations.push(...metricRows
          .filter((row) => row.metricKey === metricEvidence.metricKey)
          .map((row) => ({
            evidenceId: row.id,
            localDate: row.date,
            metricKey: row.metricKey,
            targetId: target.targetId,
            value: row.value,
          })));
        break;
    }
  }

  return observations;
}

function readSessionScheduleStatus(
  event: BrowserVaultEntity,
): ExperimentAdherenceObservation["status"] {
  const status = readString(event.attributes.sessionStatus);

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

function mapAdherenceCellStatus(
  status: ExperimentAdherenceCellStatus,
): BrowserVaultExperimentScheduleCellKind {
  switch (status) {
    case "satisfied":
      return "completed";
    default:
      return status;
  }
}

function summarizeScheduleCells(
  timeZone: string,
  cells: readonly BrowserVaultExperimentScheduleCell[],
  countedCells: readonly BrowserVaultExperimentScheduleCell[] = cells,
): BrowserVaultExperimentScheduleResult {
  return {
    cells: cells.slice(),
    completedSessions: countCells(countedCells, "completed"),
    failedSessions: countCells(countedCells, "failed"),
    missedSessions: countCells(countedCells, "missed"),
    unknownSessions: countCells(countedCells, "unknown"),
    partialSessions: countCells(countedCells, "partial"),
    plannedSessions: countedCells.filter((cell) => cell.planned).length,
    skippedSessions: 0,
    timeZone,
  };
}

function buildExperimentContextEntries(
  context: BrowserVaultExperimentRunContext,
): BrowserVaultExperimentContextEntry[] {
  return context.events
    .map((event) => buildExperimentContextEntry(event, context.eventTimeZone))
    .filter((entry): entry is BrowserVaultExperimentContextEntry => entry !== null)
    .sort(compareContextEntriesAsc);
}

function buildExperimentContextEntry(
  event: BrowserVaultEntity,
  eventTimeZone: string | null,
): BrowserVaultExperimentContextEntry | null {
  if (event.kind !== "intervention_session" && event.kind !== "experiment_context") {
    return null;
  }

  const attributes = event.attributes;
  const date = event.kind === "intervention_session"
    ? readSessionEventLocalDate(event) ?? readEventLocalDate(event, eventTimeZone)
    : readEventLocalDate(event, eventTimeZone);
  const note = readString(attributes.note);
  const symptoms = readStringArray(attributes.symptoms);
  const confounders = event.kind === "intervention_session"
    ? readSessionConfounderLabels(attributes)
    : readContextConfounderLabels(attributes);

  if (note === null && symptoms.length === 0 && confounders.length === 0) {
    return null;
  }

  return {
    confounders,
    date,
    id: event.id,
    kind: event.kind === "intervention_session" ? "session" : "context",
    note,
    symptoms,
  };
}

function readSessionConfounderLabels(attributes: JsonRecord): string[] {
  const labels = readConfounderLabels(attributes.confounders);

  if (attributes.afterExercise === true) {
    labels.unshift("After exercise");
  }

  return uniqueStrings(labels);
}

function readContextConfounderLabels(attributes: JsonRecord): string[] {
  const severity = readString(attributes.severity);
  const contextType = readString(attributes.contextType);

  return severity === "potential_confounder" && contextType
    ? [humanizeLabel(contextType)]
    : [];
}

function readConfounderLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return readStringArray(value).map(humanizeLabel);
  }

  const record = readRecord(value);
  if (!record) {
    return [];
  }

  return Object.entries(record).flatMap(([key, entry]) => {
    if (entry === false || entry === null || entry === undefined) {
      return [];
    }

    if (entry === true) {
      return [humanizeLabel(key)];
    }

    if (typeof entry === "string") {
      const valueText = entry.trim();
      return valueText.length > 0 ? [`${humanizeLabel(key)}: ${valueText}`] : [];
    }

    if (typeof entry === "number" && Number.isFinite(entry)) {
      return [`${humanizeLabel(key)}: ${entry}`];
    }

    return [humanizeLabel(key)];
  });
}

function compareContextEntriesAsc(
  left: BrowserVaultExperimentContextEntry,
  right: BrowserVaultExperimentContextEntry,
): number {
  const leftDate = left.date ?? "";
  const rightDate = right.date ?? "";
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return left.id.localeCompare(right.id);
}

function buildProgressResult(
  context: BrowserVaultExperimentRunContext,
  biomarkers: readonly BrowserVaultExperimentBiomarkerResult[],
  schedule: BrowserVaultExperimentScheduleResult | null,
): BrowserVaultExperimentProgressResult {
  const rollupTarget = resolveExperimentAdherenceRollupTarget(context.adherenceTargets);
  const hasAmbiguousTargets = context.adherenceTargets.length > 1 && !rollupTarget;
  const targetSessions =
    rollupTarget?.rollup?.targetCompletions ??
    (hasAmbiguousTargets ? null : context.run.runPlan.targetSessions);
  const minimumUsefulSessions =
    rollupTarget?.rollup?.minimumUsefulCompletions ??
    (hasAmbiguousTargets ? null : context.run.runPlan.minimumUsefulSessions);
  const completedSessions = hasAmbiguousTargets
    ? 0
    : schedule?.completedSessions ?? countSessionEvents(context.events, "completed");
  const partialSessions = hasAmbiguousTargets
    ? 0
    : schedule?.partialSessions ?? countSessionEvents(context.events, "partial");
  const missedSessions = hasAmbiguousTargets
    ? 0
    : schedule?.missedSessions ?? countSessionEvents(context.events, "missed");
  const skippedSessions = hasAmbiguousTargets ? 0 : schedule?.skippedSessions ?? 0;
  const loggedSessions = completedSessions + partialSessions;
  const progressSchedule = rollupTarget && schedule
    ? {
        ...schedule,
        cells: schedule.cells.filter((cell) => cell.targetId === rollupTarget.targetId),
      }
    : schedule;
  const expectedSessionsByNow = hasAmbiguousTargets
    ? null
    : computeExpectedSessionsByNow(
        context.run,
        context.asOfDate,
        targetSessions,
        progressSchedule,
      );
  const primary = biomarkers[0] ?? null;
  const primaryBaselineDays = primary?.baseline.daysWithData ?? 0;
  const primaryInterventionDays = primary?.intervention.daysWithData ?? 0;

  return {
    adherence: {
      completedSessions,
      expectedSessionsByNow,
      loggedSessions,
      minimumUsefulSessions,
      missedSessions,
      partialSessions,
      skippedSessions,
      status: hasAmbiguousTargets
        ? "unknown"
        : classifyAdherenceStatus({
            expectedSessionsByNow,
            loggedSessions,
            minimumUsefulSessions,
            targetSessions,
          }),
      targetSessions,
    },
    dataCoverage: {
      baselineDaysAvailable: primaryBaselineDays,
      interventionDaysAvailable: primaryInterventionDays,
      primaryBiomarkerKey: primary?.biomarkerKey ?? null,
      primaryMetricDaysAvailable: primaryBaselineDays + primaryInterventionDays,
      status: classifyCoverageStatus(context, primary),
    },
    setupReadiness: buildBrowserSetupReadiness(context),
    analysisReadiness: buildBrowserAnalysisReadiness(context),
    dayInRun: context.run.dayInRun,
    phase: context.run.phase,
    windows: context.run.windows,
  };
}

function readinessResult(blockingReasons: string[]) {
  return {
    status: blockingReasons.length === 0 ? "ready" : "incomplete",
    blockingReasons,
  } as const;
}

function buildBrowserSetupReadiness(
  context: BrowserVaultExperimentRunContext,
): BrowserVaultExperimentProgressResult["setupReadiness"] {
  const blockingReasons: string[] = [];

  if (!readRecord(context.entity.attributes.runPlan)) {
    blockingReasons.push("missing_run_plan");
  }
  if (
    !hasCompleteBrowserPrimaryPointMeasurementWindow(context) &&
    (!context.run.windows.baselineStart || !context.run.windows.baselineEnd)
  ) {
    blockingReasons.push("missing_baseline_window");
  }
  if (!context.run.windows.interventionStart || !context.run.windows.interventionEnd) {
    blockingReasons.push("missing_intervention_window");
  }

  return readinessResult(blockingReasons);
}

function buildBrowserAnalysisReadiness(
  context: BrowserVaultExperimentRunContext,
): BrowserVaultExperimentProgressResult["analysisReadiness"] {
  const blockingReasons: string[] = [];
  const analysisPlan = readRecord(context.entity.attributes.analysisPlan);

  if (!analysisPlan) {
    blockingReasons.push("missing_analysis_plan");
  }
  if (!readString(analysisPlan?.primaryBiomarkerKey)) {
    blockingReasons.push("missing_primary_biomarker");
  }
  if (!hasBrowserAnalysisMetricWindow(context)) {
    blockingReasons.push("missing_metric_window");
  }

  return readinessResult(blockingReasons);
}

function hasBrowserAnalysisMetricWindow(context: BrowserVaultExperimentRunContext): boolean {
  const primaryBiomarkerKey = readString(readRecord(context.entity.attributes.analysisPlan)?.primaryBiomarkerKey);
  if (!primaryBiomarkerKey) {
    return false;
  }

  if (hasCompleteBrowserPrimaryPointMeasurementWindow(context)) {
    return true;
  }

  return (
    context.run.windows.baselineStart !== null &&
    context.run.windows.baselineEnd !== null &&
    context.run.windows.interventionStart !== null &&
    context.run.windows.interventionEnd !== null
  );
}

function hasCompleteBrowserPrimaryPointMeasurementWindow(
  context: BrowserVaultExperimentRunContext,
): boolean {
  const primaryBiomarkerKey = readString(
    readRecord(context.entity.attributes.analysisPlan)?.primaryBiomarkerKey,
  );
  return Boolean(
    primaryBiomarkerKey &&
      hasCompletePointMeasurementPlanForBiomarker(
        context.entity.attributes,
        primaryBiomarkerKey,
      ),
  );
}

function buildOutcomeResult(
  context: BrowserVaultExperimentRunContext,
  biomarkers: readonly BrowserVaultExperimentBiomarkerResult[],
  progress: BrowserVaultExperimentProgressResult,
): BrowserVaultExperimentOutcomeResult | null {
  if (context.run.phase !== "completed" && context.run.phase !== "review_due") {
    return null;
  }

  const primary = biomarkers[0] ?? null;
  const reasons: string[] = [];

  if (!primary || primary.completeness !== "good") {
    reasons.push("Primary biomarker coverage is insufficient for a strong before-and-after read.");
  }

  if (
    progress.adherence.minimumUsefulSessions !== null &&
    progress.adherence.loggedSessions < progress.adherence.minimumUsefulSessions
  ) {
    reasons.push("Logged session count stayed below the minimum useful target.");
  }

  const unsupportedCount = biomarkers.filter((entry) => entry.status === "unsupported_source").length;
  if (unsupportedCount > 0) {
    reasons.push("Some planned biomarkers are not supported by browser metric sources yet.");
  }

  const enoughData = primary?.completeness === "good";

  return {
    confidence: {
      level: reasons.length >= 2 ? "low" : reasons.length === 1 ? "medium" : "high",
      reasons,
    },
    primaryBiomarkerKey: primary?.biomarkerKey ?? null,
    status: enoughData ? "enough_data" : "sparse_data",
  };
}

function collectBiomarkerKeys(attributes: JsonRecord): string[] {
  const analysisPlan = readRecord(attributes.analysisPlan);
  const keys = [
    readString(analysisPlan?.primaryBiomarkerKey),
    ...readStringArray(analysisPlan?.secondaryBiomarkerKeys),
  ];

  for (const effect of readExpectedEffectInputs(attributes)) {
    keys.push(effect.biomarkerKey);
  }

  return uniqueStrings(keys);
}

function hasCompletePointMeasurementPlanForBiomarker(
  attributes: JsonRecord,
  biomarkerKey: string,
): boolean {
  return (
    readMeasurementAnchors(attributes, biomarkerKey, "baseline").length > 0 &&
    (readMeasurementAnchors(attributes, biomarkerKey, "followup").length > 0 ||
      readPlannedMeasurementWindow(attributes, biomarkerKey, "followup").totalDays > 0)
  );
}

function readMeasurementAnchors(
  attributes: JsonRecord,
  biomarkerKey: string,
  role: "baseline" | "followup",
): BrowserMeasurementAnchor[] {
  const analysisPlan = readRecord(attributes.analysisPlan);
  return readArray(analysisPlan?.measurementAnchors).flatMap((value) => {
    const record = readRecord(value);
    if (!record || readString(record.role) !== role) {
      return [];
    }
    if (!readStringArray(record.biomarkerKeys).includes(biomarkerKey)) {
      return [];
    }

    const recordId = readString(record.recordId);
    if (!recordId) {
      return [];
    }

    return [{
      observedOn: readIsoDate(record.observedOn),
      recordId,
      role,
    }];
  });
}

function readPlannedMeasurementWindow(
  attributes: JsonRecord,
  biomarkerKey: string,
  role: "baseline" | "followup",
): { end: string | null; start: string | null; totalDays: number } {
  const analysisPlan = readRecord(attributes.analysisPlan);
  for (const value of readArray(analysisPlan?.plannedMeasurements)) {
    const record = readRecord(value);
    const targetWindow = readRecord(record?.targetWindow);
    if (!record || !targetWindow || readString(record.role) !== role) {
      continue;
    }
    if (!readStringArray(record.biomarkerKeys).includes(biomarkerKey)) {
      continue;
    }

    const start = readIsoDate(targetWindow.start);
    const end = readIsoDate(targetWindow.end);
    return {
      end,
      start,
      totalDays: dateRange(start, end).length,
    };
  }

  return { end: null, start: null, totalDays: 0 };
}

function resolveBiomarkerMetricSource(
  biomarkerKey: string,
): BrowserVaultExperimentMetricSource | null {
  const normalized = biomarkerKey.trim().toLowerCase();
  const slug = normalized.split(":").at(-1) ?? normalized;

  if (slug.includes("blood-pressure")) {
    return null;
  }

  const biomarkerDefinition = resolveMetricDefinitionForBiomarker(
    normalized.startsWith("biomarker:") ? normalized : `biomarker:${slug}`,
  );
  const metricDefinition = biomarkerDefinition ?? resolveMetricDefinition(slug);

  return metricDefinition ? { metricKey: metricDefinition.key } : null;
}

function readExpectedEffectInputs(attributes: JsonRecord): BrowserVaultExperimentExpectedEffectInput[] {
  const values = [
    ...readArray(attributes.expectedEffects),
    ...readArray(attributes.expectedSignalDescriptions),
  ];
  const effects: BrowserVaultExperimentExpectedEffectInput[] = [];

  for (const value of values) {
    const effect = readExpectedEffectInput(value);
    if (effect) {
      effects.push(effect);
    }
  }

  return effects;
}

function readExpectedEffectInput(value: unknown): BrowserVaultExperimentExpectedEffectInput | null {
  const record = readRecord(value);
  const biomarkerKey = readString(record?.biomarkerKey);

  if (!record || !biomarkerKey) {
    return null;
  }

  const sourceKeys = readStringArray(record.sourceKeys);

  return {
    biomarkerKey,
    caveats: readStringArray(record.caveats),
    confidence: readExpectedEffectConfidence(record.confidence),
    description: readString(record.description),
    direction: readExpectedDirection(record.direction) ?? readExpectedDirection(record.expected),
    range: readExpectedRange(record.range, sourceKeys),
    sourceKeys,
  };
}

function readExpectedRange(
  value: unknown,
  inheritedSourceKeys: readonly string[],
): BrowserVaultExperimentExpectedRange | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const startDay = readFiniteNumber(record.startDay);
  const endDay = readFiniteNumber(record.endDay);
  const low = readFiniteNumber(record.low);
  const high = readFiniteNumber(record.high);
  const scale = readExpectedRangeScale(record.scale);
  const dayOrigin = readExpectedRangeDayOrigin(record.dayOrigin);

  if (
    startDay === null ||
    endDay === null ||
    low === null ||
    high === null ||
    scale === null ||
    dayOrigin === null
  ) {
    return null;
  }

  const sourceKeys = readStringArray(record.sourceKeys);

  return {
    dayOrigin,
    endDay,
    high,
    low,
    scale,
    sourceKeys: sourceKeys.length > 0 ? sourceKeys : inheritedSourceKeys.slice(),
    startDay,
    unit: readString(record.unit),
  };
}

function readExpectedRangeScale(value: unknown): BrowserVaultExperimentExpectedRange["scale"] | null {
  if (value === "absolute" || value === "delta" || value === "percent") {
    return value;
  }

  return null;
}

function readExpectedRangeDayOrigin(
  value: unknown,
): BrowserVaultExperimentExpectedRange["dayOrigin"] | null {
  if (value === undefined || value === null || value === "run") {
    return "run";
  }

  if (value === "intervention") {
    return "intervention";
  }

  return null;
}

function readExpectedEffectConfidence(
  value: unknown,
): BrowserVaultExperimentExpectedEffect["confidence"] {
  if (value === "low" || value === "moderate" || value === "high") {
    return value;
  }

  return null;
}

function readAnalysisPlanExpectedDirection(
  attributes: JsonRecord,
  biomarkerKey: string,
): BrowserVaultExperimentExpectedDirection | null {
  const analysisPlan = readRecord(attributes.analysisPlan);
  const explicitDirection = readAnalysisPlanExpectedDirections(analysisPlan).find(
    (entry) => entry.biomarkerKey === biomarkerKey,
  )?.direction ?? null;
  if (explicitDirection) {
    return explicitDirection;
  }

  if (readString(analysisPlan?.primaryBiomarkerKey) !== biomarkerKey) {
    return null;
  }

  return readExpectedDirection(analysisPlan?.desiredDirection);
}

function readAnalysisPlanExpectedDirections(
  analysisPlan: JsonRecord | null,
): Array<{ biomarkerKey: string; direction: BrowserVaultExperimentExpectedDirection }> {
  return readArray(analysisPlan?.expectedDirections).flatMap((value) => {
    const record = readRecord(value);
    const biomarkerKey = readString(record?.biomarkerKey);
    const direction = readExpectedDirection(record?.direction);
    return biomarkerKey && direction ? [{ biomarkerKey, direction }] : [];
  });
}

function readExpectedDirection(value: unknown): BrowserVaultExperimentExpectedDirection | null {
  if (value === "increase" || value === "up" || value === "up_or_stable") {
    return "increase";
  }

  if (value === "decrease" || value === "down" || value === "down_or_stable") {
    return "decrease";
  }

  if (value === "stabilize" || value === "stable") {
    return "stabilize";
  }

  if (value === "mixed" || value === "mixed_or_contextual" || value === "contextual") {
    return "mixed";
  }

  if (value === "watch") {
    return "watch";
  }

  return null;
}

function resolveBiomarkerStatus(input: {
  points: readonly BrowserVaultExperimentMetricPoint[];
  sourceMetric: BrowserVaultExperimentMetricSource | null;
  windowUnavailable: boolean;
}): BrowserVaultExperimentBiomarkerStatus {
  if (!input.sourceMetric) {
    return "unsupported_source";
  }

  if (input.windowUnavailable) {
    return "unavailable";
  }

  if (input.points.length === 0) {
    return "no_data";
  }

  return "available";
}

function buildBiomarkerStatusReason(
  status: BrowserVaultExperimentBiomarkerStatus,
  label: string,
): string {
  switch (status) {
    case "available":
      return `${label} has browser metric points in the run windows.`;
    case "no_data":
      return `${label} has no browser metric points in the run windows.`;
    case "unsupported_source":
      return `${label} is not mapped to a browser metric source yet.`;
    case "unavailable":
      return `${label} is unavailable because the run windows are missing.`;
  }
}

function classifyMetricCompleteness(
  baselineDays: number,
  interventionDays: number,
  options: { pointMeasurement?: boolean } = {},
): BrowserVaultExperimentBiomarkerResult["completeness"] {
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

function classifyAdherenceStatus(input: {
  expectedSessionsByNow: number | null;
  loggedSessions: number;
  minimumUsefulSessions: number | null;
  targetSessions: number | null;
}): BrowserVaultExperimentProgressResult["adherence"]["status"] {
  if (input.loggedSessions === 0) {
    return "not_started";
  }

  if (input.targetSessions !== null && input.loggedSessions >= input.targetSessions) {
    return "met_target";
  }

  if (
    input.minimumUsefulSessions !== null &&
    input.loggedSessions >= input.minimumUsefulSessions
  ) {
    return "met_minimum";
  }

  if (
    input.expectedSessionsByNow !== null &&
    input.loggedSessions < input.expectedSessionsByNow
  ) {
    return "behind";
  }

  return "on_track";
}

function classifyCoverageStatus(
  context: BrowserVaultExperimentRunContext,
  primary: BrowserVaultExperimentBiomarkerResult | null,
): BrowserVaultExperimentCoverageStatus {
  const baselineDays = primary?.baseline.daysWithData ?? 0;
  const interventionDays = primary?.intervention.daysWithData ?? 0;
  const totalDays = baselineDays + interventionDays;
  const hasCompleteWindows =
    context.run.windows.baselineStart !== null &&
    context.run.windows.baselineEnd !== null &&
    context.run.windows.interventionStart !== null &&
    context.run.windows.interventionEnd !== null;
  const hasPointMeasurementData =
    hasCompleteBrowserPrimaryPointMeasurementWindow(context) &&
    baselineDays >= 1 &&
    interventionDays >= 1;

  if (totalDays === 0) {
    return (
      hasCompleteWindows ||
      hasCompleteBrowserPrimaryPointMeasurementWindow(context)
    ) && primary !== null
      ? "no_data"
      : "insufficient";
  }

  if (
    hasPointMeasurementData &&
    (context.run.phase === "review_due" || context.run.phase === "completed")
  ) {
    return "ready_for_review";
  }

  if (
    (context.run.phase === "review_due" || context.run.phase === "completed") &&
    baselineDays >= 3 &&
    interventionDays >= 3
  ) {
    return "ready_for_review";
  }

  if (baselineDays >= 3 && interventionDays >= 2) {
    return "sufficient_for_progress";
  }

  if (totalDays > 0) {
    return "partial";
  }

  return "insufficient";
}

function resolveExperimentPhase(
  status: string | null,
  windows: BrowserVaultExperimentRunWindows,
  asOfDate: string,
): BrowserVaultExperimentProgressPhase {
  if (status === "completed") {
    return "completed";
  }

  if (status === "paused") {
    return "paused";
  }

  if (status === "abandoned") {
    return "abandoned";
  }

  if (status === "planned") {
    return "planned";
  }

  if (
    windows.interventionStart === null ||
    windows.interventionEnd === null
  ) {
    return "planned";
  }

  if (windows.interventionEnd && asOfDate > windows.interventionEnd) {
    return "review_due";
  }

  if (windows.interventionStart && asOfDate >= windows.interventionStart) {
    return "intervention";
  }

  if (
    windows.baselineStart !== null &&
    windows.baselineEnd !== null &&
    asOfDate >= windows.baselineStart &&
    asOfDate <= windows.baselineEnd
  ) {
    return "baseline";
  }

  return "planned";
}

function computeExpectedSessionsByNow(
  run: BrowserVaultExperimentResultRun,
  asOfDate: string,
  targetSessions: number | null,
  schedule: BrowserVaultExperimentScheduleResult | null,
): number | null {
  const interventionStart = run.windows.interventionStart;
  const interventionEnd = run.windows.interventionEnd;

  if (
    !interventionStart ||
    !interventionEnd ||
    asOfDate < interventionStart
  ) {
    return null;
  }

  if (schedule) {
    return schedule.cells.filter((cell) => cell.planned && cell.kind !== "scheduled").length;
  }

  if (targetSessions === null) {
    return null;
  }

  const totalDays = daysBetweenInclusive(interventionStart, interventionEnd);
  const elapsedEnd = minIsoDate(interventionEnd, asOfDate);

  if (totalDays <= 0 || elapsedEnd === null) {
    return null;
  }

  return Math.max(
    1,
    Math.floor((targetSessions * daysBetweenInclusive(interventionStart, elapsedEnd)) / totalDays),
  );
}

function countSessionEvents(
  events: readonly BrowserVaultEntity[],
  status: NonNullable<ExperimentAdherenceObservation["status"]>,
): number {
  return events
    .filter((event) => event.kind === "intervention_session")
    .filter((event) => readSessionScheduleStatus(event) === status)
    .length;
}

function countCells(
  cells: readonly BrowserVaultExperimentScheduleCell[],
  kind: BrowserVaultExperimentScheduleCell["kind"],
): number {
  return cells.filter((cell) => cell.kind === kind).length;
}

function readRunLookupKeys(entity: BrowserVaultEntity): string[] {
  return uniqueStrings([
    ...readExperimentIdLookupKeys(entity),
    ...readSlugLookupKeys(entity),
    ...readProtocolLookupKeys(entity.attributes),
  ]);
}

function readExperimentIdLookupKeys(entity: BrowserVaultEntity): string[] {
  return uniqueStrings([
    entity.id,
    ...entity.lookupIds,
    readString(entity.attributes.experimentId),
  ]);
}

function readSlugLookupKeys(entity: BrowserVaultEntity): string[] {
  return uniqueStrings([
    entity.experimentSlug,
    readString(entity.attributes.slug),
    ...entity.lookupIds,
  ]);
}

function readProtocolLookupKeys(attributes: JsonRecord): string[] {
  const protocolRef = readRecord(attributes.protocolRef);
  const commonsProtocolRef = readRecord(attributes.commonsProtocolRef);

  return uniqueStrings([
    readString(protocolRef?.protocolId),
    readString(protocolRef?.protocolRevisionId),
    readString(protocolRef?.effectiveSpecHash),
    readString(commonsProtocolRef?.key),
    readString(commonsProtocolRef?.pageRevisionId),
    readString(commonsProtocolRef?.runSpecRevisionId),
    readString(commonsProtocolRef?.testPlanId),
  ]);
}

function readNumber(recordLike: unknown, key: string): number | null {
  const record = readRecord(recordLike);
  if (!record) {
    return null;
  }

  return readFiniteNumber(record[key]);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readIsoDate(value: unknown): string | null {
  const text = readString(value);
  return text && /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function cloneRecordOrNull(value: unknown): JsonRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return cloneRecord(record);
}

function cloneRecord(record: JsonRecord): JsonRecord {
  const output: JsonRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (isBrowserSafeJson(value)) {
      output[key] = cloneJson(value);
    }
  }

  return output;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isBrowserSafeJson(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isBrowserSafeJson);
  }

  const record = readRecord(value);
  return record ? Object.values(record).every(isBrowserSafeJson) : false;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function dateRange(start: string | null, end: string | null): string[] {
  if (!start || !end || start > end) {
    return [];
  }
  if (daysBetweenInclusive(start, end) > MAX_BROWSER_EXPERIMENT_WINDOW_DAYS) {
    return [];
  }

  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDaysToIsoDate(cursor, 1);
  }

  return dates;
}

function dateInRange(date: string, start: string | null, end: string | null): boolean {
  return Boolean(start && end && date >= start && date <= end);
}

function computeDayInRun(start: string | null, asOfDate: string): number | null {
  if (!start || asOfDate < start) {
    return null;
  }

  return daysBetweenInclusive(start, asOfDate);
}

function minIsoDate(left: string | null, right: string | null): string | null {
  if (!left && !right) {
    return null;
  }

  if (!left) {
    return right;
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

function toIsoDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Browser experiment results asOf must be an ISO date or timestamp.");
  }

  return parsed.toISOString().slice(0, 10);
}

function toZonedIsoDate(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Browser experiment results asOf must be an ISO date or timestamp.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(parsed);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");

  if (!year || !month || !day) {
    throw new Error("Could not format browser experiment asOf in the run schedule time zone.");
  }

  return `${year}-${month}-${day}`;
}

function extractDate(value: string | null): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function compareStringsDesc(left: string | null, right: string | null): number {
  return (right ?? "").localeCompare(left ?? "");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function movedAsExpected(
  deltaAbs: number | null,
  direction: BrowserVaultExperimentExpectedDirection | null,
): boolean | null {
  if (deltaAbs === null || direction === null || deltaAbs === 0) {
    return null;
  }

  if (direction === "increase") {
    return deltaAbs > 0;
  }

  if (direction === "decrease") {
    return deltaAbs < 0;
  }

  if (direction === "stabilize") {
    return Math.abs(deltaAbs) < 0.5;
  }

  return null;
}

function humanizeBiomarkerKey(value: string): string {
  const label = value.split(":").at(-1) ?? value;
  return label
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

function humanizeLabel(value: string): string {
  const label = value.split(":").at(-1) ?? value;

  if (label.trim().length === 0) {
    return "";
  }

  return label
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
