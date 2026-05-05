import {
  experimentRunScheduleIntentSchema,
  type ExperimentRunScheduleIntent,
} from "@murphai/contracts";

import {
  expandBrowserVaultRunSchedule,
  type BrowserVaultRunScheduleCell,
  type BrowserVaultRunScheduleExpansionEvent,
  type BrowserVaultRunScheduleEventStatus,
} from "./run-schedule.ts";
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
  cells: BrowserVaultRunScheduleCell[];
  completedSessions: number;
  missedSessions: number;
  partialSessions: number;
  plannedSessions: number;
  skippedSessions: number;
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
  asOf: string;
  biomarkers: BrowserVaultExperimentBiomarkerResult[];
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
  const schedule = buildScheduleResult(context);
  const progress = buildProgressResult(context, biomarkers, schedule);
  const outcome = buildOutcomeResult(context, biomarkers, progress);

  return {
    asOf,
    biomarkers,
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
  const asOfDate = schedule ? toZonedIsoDate(asOf, schedule.timeZone) : toIsoDate(asOf);
  const startedOn = readString(attributes.startedOn) ?? entity.date ?? extractDate(entity.occurredAt);
  const completedAt = readString(attributes.completedAt) ?? readString(attributes.endedOn);
  const run = {
    commonsProtocolRef: cloneRecordOrNull(attributes.commonsProtocolRef),
    completedAt,
    dayInRun: computeDayInRun(windows.baselineStart ?? startedOn, asOfDate),
    effectiveProtocolSnapshot: cloneRecordOrNull(attributes.effectiveProtocolSnapshot),
    id: readString(attributes.experimentId) ?? entity.id,
    phase: resolveExperimentPhase(readString(attributes.status) ?? entity.status, windows, asOfDate),
    protocolRef: cloneRecordOrNull(attributes.protocolRef),
    runPlan: {
      ...windows,
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
  const events = selectExperimentEvents(client, entity, run, asOfDate, schedule?.timeZone ?? null);
  const expectedEffects = readExpectedEffectInputs(attributes);

  return {
    asOf,
    asOfDate,
    diagnostics,
    entity,
    events,
    expectedEffects,
    run,
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
    completeness: classifyMetricCompleteness(baseline.daysWithData, intervention.daysWithData),
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

function buildScheduleResult(
  context: BrowserVaultExperimentRunContext,
): BrowserVaultExperimentScheduleResult | null {
  const schedule = context.run.runPlan.schedule;
  const interventionStart = context.run.windows.interventionStart;
  const interventionEnd = context.run.windows.interventionEnd;

  if (!schedule || !interventionStart || !interventionEnd) {
    context.diagnostics.push({
      code: "no_schedule",
      message: "No structured run schedule is available for this experiment.",
      severity: "info",
    });
    return null;
  }

  try {
    const cells = expandBrowserVaultRunSchedule({
      asOf: context.asOf,
      events: buildScheduleExpansionEvents(context.events),
      schedule,
      window: {
        endLocalDate: interventionEnd,
        startLocalDate: interventionStart,
      },
    });
    return summarizeScheduleCells(schedule.timeZone, cells);
  } catch {
    context.diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment schedule could not be expanded safely for browser Results.",
      severity: "warning",
    });
    return null;
  }
}

function buildScheduleExpansionEvents(
  events: readonly BrowserVaultEntity[],
): BrowserVaultRunScheduleExpansionEvent[] {
  return events
    .filter((event) => event.kind === "intervention_session")
    .map((event) => ({
      localDate: readSessionEventLocalDate(event) ?? (event.occurredAt ? null : event.date),
      occurredAt: event.occurredAt,
      status: readSessionScheduleStatus(event),
    }));
}

function readSessionScheduleStatus(event: BrowserVaultEntity): BrowserVaultRunScheduleEventStatus {
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

function summarizeScheduleCells(
  timeZone: string,
  cells: readonly BrowserVaultRunScheduleCell[],
): BrowserVaultExperimentScheduleResult {
  return {
    cells: cells.slice(),
    completedSessions: countCells(cells, "completed"),
    missedSessions: countCells(cells, "missed"),
    partialSessions: countCells(cells, "partial"),
    plannedSessions: cells.filter((cell) => cell.planned).length,
    skippedSessions: countCells(cells, "skipped"),
    timeZone,
  };
}

function buildProgressResult(
  context: BrowserVaultExperimentRunContext,
  biomarkers: readonly BrowserVaultExperimentBiomarkerResult[],
  schedule: BrowserVaultExperimentScheduleResult | null,
): BrowserVaultExperimentProgressResult {
  const targetSessions = context.run.runPlan.targetSessions;
  const minimumUsefulSessions = context.run.runPlan.minimumUsefulSessions;
  const completedSessions = schedule?.completedSessions ?? countSessionEvents(context.events, "completed");
  const partialSessions = schedule?.partialSessions ?? countSessionEvents(context.events, "partial");
  const missedSessions = schedule?.missedSessions ?? countSessionEvents(context.events, "missed");
  const skippedSessions = schedule?.skippedSessions ?? countSessionEvents(context.events, "skipped");
  const loggedSessions = completedSessions + partialSessions;
  const expectedSessionsByNow = computeExpectedSessionsByNow(
    context.run,
    context.asOfDate,
    targetSessions,
    schedule,
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
      status: classifyAdherenceStatus({
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
      status: classifyCoverageStatus(context.run.phase, primary),
    },
    dayInRun: context.run.dayInRun,
    phase: context.run.phase,
    windows: context.run.windows,
  };
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
): BrowserVaultExperimentBiomarkerResult["completeness"] {
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
  phase: BrowserVaultExperimentProgressPhase,
  primary: BrowserVaultExperimentBiomarkerResult | null,
): BrowserVaultExperimentCoverageStatus {
  const baselineDays = primary?.baseline.daysWithData ?? 0;
  const interventionDays = primary?.intervention.daysWithData ?? 0;
  const totalDays = baselineDays + interventionDays;

  if (totalDays === 0) {
    return "no_data";
  }

  if (
    (phase === "review_due" || phase === "completed") &&
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

  if (windows.interventionEnd && asOfDate > windows.interventionEnd) {
    return "review_due";
  }

  if (windows.interventionStart && asOfDate >= windows.interventionStart) {
    return "intervention";
  }

  return "baseline";
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
  status: BrowserVaultRunScheduleEventStatus,
): number {
  return events
    .filter((event) => event.kind === "intervention_session")
    .filter((event) => readSessionScheduleStatus(event) === status)
    .length;
}

function countCells(
  cells: readonly BrowserVaultRunScheduleCell[],
  kind: BrowserVaultRunScheduleCell["kind"],
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
