import {
  experimentAnalysisPlanSchema,
  experimentAdherenceTargetsSchema,
  experimentOutcomeRefSchema,
  experimentRunScheduleIntentSchema,
  summarizeExperimentOutcomeValues,
  type ExperimentAdherenceTarget,
  type ExperimentOutcome,
  type ExperimentOutcomeStatistic,
  type ExperimentRunScheduleIntent,
} from "@murphai/contracts";

import {
  buildExperimentAdherenceCalendar,
  countAdherenceConfidenceSessions,
  countCalendarAdherenceSessions,
  countCompletedAdherenceSessions,
  eventKindIsCandidateForEvidence,
  resolveActivityEvidenceLocalDate,
  resolveExperimentAdherenceRollupTarget,
  resolveAdherenceObservationActivityKind,
  resolveExperimentAdherenceTargets,
  type ExperimentAdherenceCalendarResult,
  type ExperimentAdherenceCellStatus,
  type ExperimentAdherenceObservation,
} from "../experiment-adherence.ts";
import {
  resolveExperimentMetricOutcome,
  resolveExperimentPrimaryOutcome,
  summarizeExperimentOutcomeEvidencePlan,
  type ResolvedExperimentMetricOutcome,
} from "../experiment-outcomes.ts";
import {
  metricWindowUnitsAreCompatible,
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
  selectMetricWindowComparison,
  unitsEquivalent,
  type MetricWindowSummary,
} from "../metrics/index.ts";
import type {
  BrowserVaultCoreCapableQueryClient,
  BrowserVaultEntity,
  BrowserVaultMetricRow,
  BrowserVaultMetricSeriesCapableQueryClient as BrowserVaultMetricsCapableQueryClient,
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
  | "ready_for_review"
  | "enough_data";

export type BrowserVaultExperimentSavedOutcomeStatus =
  | "available"
  | "not_expected"
  | "pending"
  | "unavailable";

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
  activityKind?: string;
  activityKinds?: string[];
  minimumDurationMinutes?: number;
  calendar?: ExperimentAdherenceTarget["calendar"];
  evidence: ExperimentAdherenceTarget["evidence"];
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
  statistic: ExperimentOutcomeStatistic;
  status: BrowserVaultExperimentBiomarkerStatus;
  statusReason: string;
  unit: string | null;
}

export interface BrowserVaultExperimentScheduleResult {
  cells: BrowserVaultExperimentScheduleCell[];
  assumedSessions: number;
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
  | "assumed"
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
    assumedSessions?: number;
    confirmedSessions?: number;
    expectedSessionsByNow: number | null;
    loggedSessions: number;
    minimumUsefulSessions: number | null;
    missedSessions: number;
    partialSessions: number;
    sensedSessions?: number;
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
  persistedOutcome: ExperimentOutcome | null;
  progress: BrowserVaultExperimentProgressResult | null;
  savedOutcomeStatus: BrowserVaultExperimentSavedOutcomeStatus;
  schedule: BrowserVaultExperimentScheduleResult | null;
}

interface BrowserVaultExperimentRunContext {
  adherenceEvents: BrowserVaultEntity[];
  adherenceTargets: ExperimentAdherenceTarget[];
  asOf: string;
  diagnostics: BrowserVaultExperimentResultDiagnostic[];
  evidenceObservedOnByRecordId: ReadonlyMap<string, string | null>;
  evidenceThrough: string;
  entity: BrowserVaultEntity;
  events: BrowserVaultEntity[];
  eventTimeZone: string | null;
  expectedEffects: BrowserVaultExperimentExpectedEffectInput[];
  persistedOutcome: ExperimentOutcome | null;
  run: BrowserVaultExperimentResultRun;
  unsupportedExplicitAdherenceTargets: boolean;
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
  client: BrowserVaultMetricsCapableQueryClient,
  lookup: BrowserVaultExperimentResultsLookup,
  options: BrowserVaultExperimentResultsOptions = {},
): BrowserVaultExperimentResultsView | null {
  const asOf = options.asOf ?? client.replica.generatedAt;
  const entity = findBrowserVaultExperimentRun(client, lookup);

  if (!entity) {
    return null;
  }

  const context = buildRunContext(
    client,
    entity,
    asOf,
    findReferencedExperimentOutcome(client, entity),
  );
  const { persistedOutcome } = context;
  const liveBiomarkers = persistedOutcome
    ? null
    : buildBiomarkerResults(
        client,
        context,
        buildMetricWindowContext(context.run.windows, context.evidenceThrough),
      );
  const biomarkers = persistedOutcome
    ? buildPersistedOutcomeBiomarkers(client, persistedOutcome)
    : liveBiomarkers ?? [];
  const adherence = buildAdherenceResult(context);
  const schedule = buildScheduleResult(adherence);
  const progress = buildProgressResult(context, biomarkers, schedule, adherence);
  const outcome = persistedOutcome
    ? buildPersistedOutcomeResult(persistedOutcome)
    : null;
  const runContext = buildExperimentContextEntries(context);

  return {
    adherence,
    asOf: context.asOf,
    biomarkers,
    context: runContext,
    diagnostics: context.diagnostics,
    experiment: context.run,
    outcome,
    persistedOutcome,
    progress,
    savedOutcomeStatus: resolveSavedOutcomeStatus(context, persistedOutcome),
    schedule,
  };
}

/**
 * Resolve the metric series needed by one exact experiment result. Undefined
 * means the encrypted metrics index that owns saved outcomes is not loaded yet;
 * null means no matching experiment exists.
 */
export function selectBrowserVaultExperimentMetricKeys(
  client: BrowserVaultCoreCapableQueryClient,
  lookup: BrowserVaultExperimentResultsLookup,
): string[] | null | undefined {
  const entity = findBrowserVaultExperimentRun(client, lookup);
  if (!entity) return null;
  if (!hasBrowserVaultExperimentOutcomes(client)) return undefined;

  const referencedOutcome = findReferencedExperimentOutcome(client, entity);
  const persistedOutcome = shouldUseReferencedExperimentOutcome(
    entity,
    referencedOutcome,
  )
    ? referencedOutcome
    : null;
  return persistedOutcome
    ? resolveBrowserVaultPersistedOutcomeMetricKeys(persistedOutcome)
    : resolveBrowserVaultExperimentEntityMetricKeys(entity);
}

function hasBrowserVaultExperimentOutcomes(
  client: BrowserVaultCoreCapableQueryClient,
): client is BrowserVaultMetricsCapableQueryClient {
  return "experimentOutcomes" in client.replica;
}

export function resolveBrowserVaultExperimentEntityMetricKeys(
  entity: BrowserVaultEntity,
): string[] {
  return uniqueStrings(collectBiomarkerKeys(entity.attributes).flatMap((biomarkerKey) => {
    const outcome = resolveBrowserMetricOutcome(entity.attributes, biomarkerKey);
    const sourceMetric = resolveBiomarkerMetricSource(biomarkerKey, outcome.metricKey);
    return sourceMetric ? [sourceMetric.metricKey] : [];
  })).sort();
}

function findBrowserVaultExperimentRun(
  client: BrowserVaultCoreCapableQueryClient,
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
  client: BrowserVaultMetricsCapableQueryClient,
  entity: BrowserVaultEntity,
  asOf: string,
  referencedOutcome: ExperimentOutcome | null,
): BrowserVaultExperimentRunContext {
  const diagnostics: BrowserVaultExperimentResultDiagnostic[] = [];
  const attributes = entity.attributes;
  const sourceStatus = readString(attributes.status) ?? entity.status;
  const liveWindows = readRunWindows(attributes);
  const endedOn = readIsoDate(attributes.endedOn);
  const persistedOutcome = shouldUseReferencedExperimentOutcome(
    entity,
    referencedOutcome,
  )
    ? referencedOutcome
    : null;
  const plannedEnd = (referencedOutcome?.windows ?? liveWindows).interventionEnd;
  const endedEarly = endedOn !== null && plannedEnd !== null && endedOn < plannedEnd;
  const windows = endedEarly
    ? clampRunWindowsToTerminalDate(liveWindows, endedOn)
    : persistedOutcome?.windows ?? liveWindows;
  const schedule = readRunSchedule(attributes, diagnostics);
  const runPlanRecord = readRecord(attributes.runPlan);
  const parsedAdherenceTargets = readAdherenceTargets(attributes, diagnostics);
  const sourceCommonsProtocolRef =
    persistedOutcome?.commonsProtocolRef ?? attributes.commonsProtocolRef;
  const sourceEffectiveProtocolSnapshot =
    persistedOutcome?.effectiveProtocolSnapshot ??
    attributes.effectiveProtocolSnapshot;
  const adherenceTargets = resolveExperimentAdherenceTargets({
    explicitTargets: parsedAdherenceTargets.targets,
    protocolActivitySessionEvidence: readProtocolActivitySessionEvidence(
      sourceEffectiveProtocolSnapshot,
    ),
    protocolKey: readString(readRecord(sourceCommonsProtocolRef)?.key),
    protocolSessionsPerDay: readProtocolSessionsPerDay(
      sourceEffectiveProtocolSnapshot,
    ),
    runPlan: {
      minimumUsefulSessions: readNumber(runPlanRecord, "minimumUsefulSessions") ?? undefined,
      modality: readString(runPlanRecord?.modality) ?? undefined,
      schedule: schedule ?? undefined,
      sessionsPerWeek: readNumber(runPlanRecord, "sessionsPerWeek") ?? undefined,
      targetSessions: readNumber(runPlanRecord, "targetSessions") ?? undefined,
    },
  });
  const runTimeZone = adherenceTargets.find((target) => target.calendar)?.calendar?.timeZone ?? schedule?.timeZone ?? null;
  const requestedAsOfDate = runTimeZone ? toZonedIsoDate(asOf, runTimeZone) : toIsoDate(asOf);
  const evidenceThrough = endedOn !== null
    ? minIsoDate(requestedAsOfDate, endedOn) ?? requestedAsOfDate
    : requestedAsOfDate;
  const effectiveAsOf = endedEarly ? evidenceThrough : asOf;
  const startedOn = readString(attributes.startedOn) ?? entity.date ?? extractDate(entity.occurredAt);
  const completedAt = readString(attributes.completedAt) ?? readString(attributes.endedOn);
  const runStart = windows.baselineStart ?? windows.interventionStart;
  const run = {
    commonsProtocolRef: cloneRecordOrNull(
      persistedOutcome
        ? persistedOutcome.commonsProtocolRef
        : attributes.commonsProtocolRef,
    ),
    completedAt,
    dayInRun: computeDayInRun(runStart, evidenceThrough),
    effectiveProtocolSnapshot: cloneRecordOrNull(
      persistedOutcome
        ? persistedOutcome.effectiveProtocolSnapshot
        : attributes.effectiveProtocolSnapshot,
    ),
    id: readString(attributes.experimentId) ?? entity.id,
    phase: endedEarly
      ? "abandoned"
      : persistedOutcome
        ? "completed"
        : resolveExperimentPhase(sourceStatus, windows, evidenceThrough),
    protocolRef: cloneRecordOrNull(
      persistedOutcome
        ? persistedOutcome.protocolRef
        : attributes.protocolRef,
    ),
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
    status: persistedOutcome?.experiment.status ?? sourceStatus,
    title: persistedOutcome?.experiment.title ?? entity.title ?? readString(attributes.title) ?? entity.id,
    windows,
  } satisfies BrowserVaultExperimentResultRun;
  const events = selectExperimentEvents(client, entity, run, evidenceThrough, runTimeZone);
  const adherenceEvents = selectAdherenceEvidenceEvents({
    client,
    evidenceThrough,
    eventTimeZone: runTimeZone,
    linkedEvents: events,
    run,
    targets: adherenceTargets,
  });
  const expectedEffects = readExpectedEffectInputs(attributes);

  return {
    adherenceEvents,
    asOf: effectiveAsOf,
    diagnostics,
    entity,
    evidenceObservedOnByRecordId: collectBrowserEvidenceObservedOn(
      client.replica.entities,
    ),
    evidenceThrough,
    events,
    eventTimeZone: runTimeZone,
    adherenceTargets,
    expectedEffects,
    persistedOutcome,
    run,
    unsupportedExplicitAdherenceTargets: parsedAdherenceTargets.unsupportedExplicit,
  };
}

function collectBrowserEvidenceObservedOn(
  entities: readonly BrowserVaultEntity[],
): Map<string, string | null> {
  const observedOnByRecordId = new Map<string, string | null>();
  for (const entity of entities) {
    const observedOn = entity.date ?? extractDate(entity.occurredAt);
    for (const recordId of [entity.id, ...entity.lookupIds]) {
      observedOnByRecordId.set(recordId, observedOn);
    }
  }
  return observedOnByRecordId;
}

function projectBrowserAdherenceTarget(
  target: ExperimentAdherenceTarget,
): BrowserVaultExperimentAdherenceTarget {
  return {
    ...(target.evidence.kind === "linkedEventCount" && target.evidence.activityKind
      ? { activityKind: target.evidence.activityKind }
      : {}),
    ...(target.evidence.kind === "linkedEventCount" && target.evidence.activityKinds
      ? { activityKinds: [...target.evidence.activityKinds] }
      : {}),
    ...(target.evidence.kind === "linkedEventCount" &&
        target.evidence.minimumDurationMinutes !== undefined
      ? { minimumDurationMinutes: target.evidence.minimumDurationMinutes }
      : {}),
    ...(target.calendar ? { calendar: target.calendar } : {}),
    evidence: target.evidence,
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

function clampRunWindowsToTerminalDate(
  windows: BrowserVaultExperimentRunWindows,
  terminalDate: string,
): BrowserVaultExperimentRunWindows {
  return {
    baselineEnd: minIsoDate(windows.baselineEnd, terminalDate),
    baselineStart: windows.baselineStart,
    interventionEnd: minIsoDate(windows.interventionEnd, terminalDate),
    interventionStart: windows.interventionStart,
  };
}

function findReferencedExperimentOutcome(
  client: BrowserVaultMetricsCapableQueryClient,
  entity: BrowserVaultEntity,
): ExperimentOutcome | null {
  const parsedRef = experimentOutcomeRefSchema.safeParse(
    entity.attributes.outcomeRef,
  );
  if (!parsedRef.success) {
    return null;
  }

  const experimentId = readString(entity.attributes.experimentId) ?? entity.id;
  const experimentSlug = readString(entity.attributes.slug) ?? entity.experimentSlug ?? entity.id;

  return (client.replica.experimentOutcomes ?? []).find((outcome) =>
    outcome.outcomeId === parsedRef.data.outcomeId &&
    (parsedRef.data.generatedAt === undefined ||
      outcome.generatedAt === parsedRef.data.generatedAt) &&
    outcome.experiment.id === experimentId &&
    outcome.experiment.slug === experimentSlug
  ) ?? null;
}

function shouldUseReferencedExperimentOutcome(
  entity: BrowserVaultEntity,
  outcome: ExperimentOutcome | null,
): outcome is ExperimentOutcome {
  if (!outcome) return false;
  const endedOn = readIsoDate(entity.attributes.endedOn);
  const plannedEnd = outcome.windows.interventionEnd;
  return endedOn === null || plannedEnd === null || endedOn >= plannedEnd;
}

function resolveBrowserVaultPersistedOutcomeMetricKeys(
  outcome: ExperimentOutcome,
): string[] {
  return uniqueStrings(outcome.metricResults.flatMap((metric) => {
    if (metric.points !== undefined) return [];
    const sourceMetric = resolveBiomarkerMetricSource(metric.biomarkerKey);
    return sourceMetric ? [sourceMetric.metricKey] : [];
  })).sort();
}

function resolveSavedOutcomeStatus(
  context: BrowserVaultExperimentRunContext,
  persistedOutcome: ExperimentOutcome | null,
): BrowserVaultExperimentSavedOutcomeStatus {
  if (context.run.phase !== "completed" && context.run.phase !== "review_due") {
    return "not_expected";
  }

  if (persistedOutcome) {
    return "available";
  }

  if (context.entity.attributes.outcomeRef === undefined ||
      context.entity.attributes.outcomeRef === null) {
    return "pending";
  }

  return "unavailable";
}

function buildPersistedOutcomeResult(
  outcome: ExperimentOutcome,
): BrowserVaultExperimentOutcomeResult {
  const primary = outcome.metricResults[0] ?? null;
  const structuredReview = outcome.structuredReview;

  return {
    confidence: outcome.confidence,
    primaryBiomarkerKey:
      structuredReview?.key ?? primary?.biomarkerKey ?? null,
    status:
      structuredReview?.status === "ready_for_review"
        ? "ready_for_review"
        : primary?.completeness === "good"
          ? "enough_data"
          : "sparse_data",
  };
}

function buildPersistedOutcomeBiomarkers(
  client: BrowserVaultMetricsCapableQueryClient,
  outcome: ExperimentOutcome,
): BrowserVaultExperimentBiomarkerResult[] {
  const metricWindow = buildMetricWindowContext(outcome.windows, outcome.asOf);
  return outcome.metricResults.map((metric) => {
    const sourceMetric = resolveBiomarkerMetricSource(metric.biomarkerKey);
    const baselineUnit = metric.baseline?.unit ?? metric.unit;
    const interventionUnit = metric.intervention?.unit ?? metric.unit;
    const expectedEffect: BrowserVaultExperimentExpectedEffect = {
      caveats: [],
      confidence: null,
      description: null,
      direction: metric.expectedDirection,
      expectedRange: null,
      sourceKeys: [],
    };

    return {
      baseline: {
        daysWithData: metric.baseline?.daysWithData ?? metric.baselineDayCount,
        end: outcome.windows.baselineEnd,
        mean: metric.baseline?.mean ?? metric.baselineMean,
        start: outcome.windows.baselineStart,
        totalDays: metric.baseline?.totalDays ??
          dateRange(outcome.windows.baselineStart, outcome.windows.baselineEnd).length,
        unit: baselineUnit,
      },
      biomarkerKey: metric.biomarkerKey,
      completeness: metric.completeness,
      deltaAbs: metric.deltaAbs,
      deltaPct: metric.deltaPct,
      expectedEffect,
      intervention: {
        daysWithData: metric.intervention?.daysWithData ?? metric.interventionDayCount,
        end: outcome.windows.interventionEnd,
        mean: metric.intervention?.mean ?? metric.interventionMean,
        start: outcome.windows.interventionStart,
        totalDays: metric.intervention?.totalDays ??
          dateRange(outcome.windows.interventionStart, outcome.windows.interventionEnd).length,
        unit: interventionUnit,
      },
      label: metric.label,
      movedAsExpected: metric.movedAsExpected,
      points: metric.points !== undefined && sourceMetric
        ? metric.points.map((point) => ({
            confidence: "none" as const,
            date: point.date,
            metricKey: sourceMetric.metricKey,
            phase: point.phase,
            unit: point.unit,
            value: point.value,
          }))
        : sourceMetric
          ? metricRowsToExperimentPoints(
              collectMetricRows(client, sourceMetric, metricWindow),
              sourceMetric,
              metricWindow,
            )
          : [],
      sourceMetric,
      statistic: metric.statistic ?? "mean",
      status: "available",
      statusReason: "Saved experiment analysis is available.",
      unit: metric.unit,
    };
  });
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
): { targets: ExperimentAdherenceTarget[] | null; unsupportedExplicit: boolean } {
  const runPlan = readRecord(attributes.runPlan);

  if (!runPlan || runPlan.adherenceTargets === undefined || runPlan.adherenceTargets === null) {
    return { targets: null, unsupportedExplicit: false };
  }

  const result = experimentAdherenceTargetsSchema.safeParse(runPlan.adherenceTargets);
  if (!result.success) {
    diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment has adherence targets, but they are not supported by browser Results.",
      severity: "warning",
    });
    return { targets: [], unsupportedExplicit: true };
  }

  if (!result.data.every(isBrowserSupportedAdherenceTarget)) {
    diagnostics.push({
      code: "invalid_schedule",
      message: "The experiment has adherence targets outside the browser Results support set.",
      severity: "warning",
    });
    return { targets: [], unsupportedExplicit: true };
  }

  return { targets: result.data, unsupportedExplicit: false };
}

function isBrowserSupportedAdherenceTarget(target: ExperimentAdherenceTarget): boolean {
  return target.evidence.kind === "linkedEventCount" &&
    (target.evidence.eventKind === "intervention_session" ||
      target.evidence.eventKind === "activity_session");
}

function selectExperimentEvents(
  client: BrowserVaultMetricsCapableQueryClient,
  experiment: BrowserVaultEntity,
  run: BrowserVaultExperimentResultRun,
  evidenceThrough: string,
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

    if (eventDate && eventDate > evidenceThrough) {
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

function selectAdherenceEvidenceEvents(input: {
  client: BrowserVaultMetricsCapableQueryClient;
  evidenceThrough: string;
  eventTimeZone: string | null;
  linkedEvents: readonly BrowserVaultEntity[];
  run: BrowserVaultExperimentResultRun;
  targets: readonly ExperimentAdherenceTarget[];
}): BrowserVaultEntity[] {
  const byId = new Map(input.linkedEvents.map((event) => [event.id, event]));
  const needsActivityEvidence = input.targets.some((target) =>
    target.evidence.kind === "linkedEventCount" &&
    target.evidence.eventKind === "activity_session"
  );
  if (!needsActivityEvidence) {
    return [...byId.values()];
  }

  const interventionStart = input.run.windows.interventionStart;
  const interventionEnd = input.run.windows.interventionEnd;
  if (!interventionStart || !interventionEnd || input.evidenceThrough < interventionStart) {
    return [...byId.values()];
  }
  const effectiveEnd = minIsoDate(interventionEnd, input.evidenceThrough);
  if (!effectiveEnd) {
    return [...byId.values()];
  }

  for (const entity of input.client.replica.entities) {
    if (entity.family !== "event" || entity.kind !== "activity_session") {
      continue;
    }
    const eventDate = resolveActivityEvidenceLocalDate(entity);
    if (!eventDate || eventDate < interventionStart || eventDate > effectiveEnd) {
      continue;
    }
    byId.set(entity.id, entity);
  }

  return [...byId.values()];
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
  evidenceThrough: string,
): MetricWindowContext {
  const baselineDates = dateRange(windows.baselineStart, windows.baselineEnd);
  const interventionDates = dateRange(
    windows.interventionStart,
    minIsoDate(windows.interventionEnd, evidenceThrough),
  );

  return {
    baselineDates,
    interventionDates,
    windows,
  };
}

function buildBiomarkerResults(
  client: BrowserVaultMetricsCapableQueryClient,
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
  client: BrowserVaultMetricsCapableQueryClient,
  context: BrowserVaultExperimentRunContext,
  metricWindow: MetricWindowContext,
  biomarkerKey: string,
): BrowserVaultExperimentBiomarkerResult {
  const outcome = resolveBrowserMetricOutcome(context.entity.attributes, biomarkerKey);
  const sourceMetric = resolveBiomarkerMetricSource(biomarkerKey, outcome.metricKey);
  const label = outcome.label;
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
      statistic: outcome.statistic,
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
    statistic: outcome.statistic,
  });
  if (anchoredResult) {
    return anchoredResult;
  }

  const metricRows = collectMetricRows(client, sourceMetric, metricWindow);
  const metricSeriesPoints = metricRows.map(browserMetricRowToSeriesPoint);
  const points = aggregateBrowserOutcomePointsByDate(
    metricRowsToExperimentPoints(metricRows, sourceMetric, metricWindow),
    outcome.statistic,
  );
  const comparison = selectMetricWindowComparison({
    baselineWindow: {
      end: metricWindow.windows.baselineEnd,
      start: metricWindow.windows.baselineStart,
      totalDays: metricWindow.baselineDates.length,
    },
    comparisonWindow: {
      end: minIsoDate(metricWindow.windows.interventionEnd, context.evidenceThrough),
      start: metricWindow.windows.interventionStart,
      totalDays: metricWindow.interventionDates.length,
    },
    metricKey: sourceMetric.metricKey,
    points: metricSeriesPoints,
    statistic: outcome.statistic,
  });
  const baseline = experimentWindowSummaryFromMetricWindow(comparison.baseline);
  const intervention = experimentWindowSummaryFromMetricWindow(comparison.comparison);
  const deltaAbs = comparison.delta !== null ? round(comparison.delta) : null;
  const deltaPct = comparison.deltaPercent !== null ? round(comparison.deltaPercent) : null;
  const windowUnavailable =
    metricWindow.baselineDates.length === 0 && metricWindow.interventionDates.length === 0;
  const status = comparison.status === "unsupported"
    ? "unavailable"
    : resolveBiomarkerStatus({
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
    completeness: comparison.status !== "unsupported"
      ? classifyMetricCompleteness(
          baseline.daysWithData,
          intervention.daysWithData,
        )
      : "insufficient",
    deltaAbs,
    deltaPct,
    expectedEffect,
    intervention,
    label,
    movedAsExpected: movedAsExpected(deltaAbs, expectedEffect.direction),
    points,
    sourceMetric,
    statistic: outcome.statistic,
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
  client: BrowserVaultMetricsCapableQueryClient;
  context: BrowserVaultExperimentRunContext;
  expectedEffect: BrowserVaultExperimentExpectedEffect;
  label: string;
  sourceMetric: BrowserVaultExperimentMetricSource;
  statistic: ExperimentOutcomeStatistic;
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
    input.context.evidenceThrough,
  );
  const followupRows = collectAnchoredMetricRows(
    input.client,
    input.sourceMetric,
    followupAnchors,
    input.context.evidenceThrough,
  );
  const baselinePoints = aggregateBrowserOutcomePointsByDate(
    metricRowsToAnchoredExperimentPoints(
      baselineRows,
      input.sourceMetric,
      "baseline",
    ),
    input.statistic,
  );
  const interventionPoints = aggregateBrowserOutcomePointsByDate(
    metricRowsToAnchoredExperimentPoints(
      followupRows,
      input.sourceMetric,
      "intervention",
    ),
    input.statistic,
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
    input.statistic,
  );
  const intervention = summarizeAnchoredMetricWindow(
    interventionPoints,
    followupAnchors.length || plannedFollowupWindow.totalDays,
    plannedFollowupWindow,
    input.statistic,
  );
  const windowsSummarizable =
    (baseline.daysWithData === 0 || baseline.mean !== null) &&
    (intervention.daysWithData === 0 || intervention.mean !== null);
  const unitsCompatible =
    windowsSummarizable &&
    metricWindowUnitsAreCompatible({
      left: {
        unit: baseline.unit,
        value: baseline.mean,
      },
      right: {
        unit: intervention.unit,
        value: intervention.mean,
      },
      statistic: input.statistic,
    });
  const deltaAbs =
    unitsCompatible && baseline.mean !== null && intervention.mean !== null
      ? round(intervention.mean - baseline.mean)
      : null;
  const deltaPct =
    unitsCompatible &&
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
  const unit = unitsCompatible ? intervention.unit ?? baseline.unit : null;

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
    completeness: unitsCompatible
      ? classifyMetricCompleteness(
          baseline.daysWithData,
          intervention.daysWithData,
          { pointMeasurement: true },
        )
      : "insufficient",
    deltaAbs,
    deltaPct,
    expectedEffect: input.expectedEffect,
    intervention,
    label: input.label,
    movedAsExpected: movedAsExpected(deltaAbs, input.expectedEffect.direction),
    points,
    sourceMetric: input.sourceMetric,
    statistic: input.statistic,
    status,
    statusReason: buildBiomarkerStatusReason(status, input.label),
    unit,
  };
}

function collectMetricRows(
  client: BrowserVaultMetricsCapableQueryClient,
  sourceMetric: BrowserVaultExperimentMetricSource,
  metricWindow: MetricWindowContext,
): BrowserVaultMetricRowWithValue[] {
  return client.metrics.series({ metricKey: sourceMetric.metricKey })
    .filter((row): row is BrowserVaultMetricRowWithValue =>
      resolveMetricPointPhase(row.date, metricWindow) !== null &&
      hasNumericMetricValue(row)
    )
    .sort(compareMetricRowsAsc);
}

function collectAnchoredMetricRows(
  client: BrowserVaultMetricsCapableQueryClient,
  sourceMetric: BrowserVaultExperimentMetricSource,
  anchors: readonly BrowserMeasurementAnchor[],
  evidenceThrough: string,
): BrowserVaultMetricRowWithValue[] {
  const anchorIds = new Set(anchors.map((anchor) => anchor.recordId));
  if (anchorIds.size === 0) {
    return [];
  }

  return client.metrics.series({ metricKey: sourceMetric.metricKey })
    .filter((row): row is BrowserVaultMetricRowWithValue =>
      hasNumericMetricValue(row) &&
      row.date <= evidenceThrough &&
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

function aggregateBrowserOutcomePointsByDate(
  points: readonly BrowserVaultExperimentMetricPoint[],
  statistic: ExperimentOutcomeStatistic,
): BrowserVaultExperimentMetricPoint[] {
  const groups = new Map<string, BrowserVaultExperimentMetricPoint[]>();
  for (const point of points) {
    const key = `${point.phase}\u0000${point.date}`;
    const rows = groups.get(key) ?? [];
    rows.push(point);
    groups.set(key, rows);
  }

  return [...groups.values()].flatMap((rows) => {
    const sorted = rows.slice().sort((left, right) =>
      left.date.localeCompare(right.date)
    );
    const latest = sorted.at(-1);
    if (!latest) {
      return [];
    }
    const units = uniqueStrings(sorted.flatMap((point) => point.unit ? [point.unit] : []));
    if (
      statistic !== "count" &&
      units.length > 1 &&
      !units.every((unit) => unitsEquivalent(units[0] ?? null, unit))
    ) {
      return sorted;
    }
    const reductionPoints = statistic === "count"
      ? sorted.map((point) => ({ date: point.date, value: 1 }))
      : sorted;
    const value = summarizeExperimentOutcomeValues(reductionPoints, statistic);
    if (value === null) {
      return [];
    }
    return [{
      ...latest,
      unit: statistic === "count" ? "count" : latest.unit,
      value,
    }];
  }).sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }
    return left.phase.localeCompare(right.phase);
  });
}

function summarizeAnchoredMetricWindow(
  points: readonly BrowserVaultExperimentMetricPoint[],
  totalDays: number,
  fallbackWindow: { end: string | null; start: string | null; totalDays: number } | null,
  statistic: ExperimentOutcomeStatistic,
): BrowserVaultExperimentMetricWindowSummary {
  const units = uniqueStrings(points.flatMap((point) => point.unit ? [point.unit] : []));
  const compatible =
    statistic === "count" ||
    units.length < 2 ||
    units.every((unit) => unitsEquivalent(units[0] ?? null, unit));
  const unit = statistic === "count"
    ? "count"
    : compatible
      ? points.at(-1)?.unit ?? null
      : null;
  const dates = points.map((point) => point.date).sort((left, right) => left.localeCompare(right));

  return {
    daysWithData: points.length,
    end: dates.at(-1) ?? fallbackWindow?.end ?? null,
    mean: compatible ? summarizeExperimentOutcomeValues(points, statistic) : null,
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
  statistic: ExperimentOutcomeStatistic;
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
    statistic: input.statistic,
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
): BrowserVaultExperimentAdherenceResult | null {
  const adherenceTargets = context.adherenceTargets;
  const interventionStart = context.run.windows.interventionStart;
  const interventionEnd = context.run.windows.interventionEnd;

  if (context.unsupportedExplicitAdherenceTargets) {
    return null;
  }

  if (
    adherenceTargets.length === 0 ||
    !interventionStart ||
    !interventionEnd
  ) {
    context.diagnostics.push({
      code: "no_schedule",
      message: "No structured adherence target is available for this experiment.",
      severity: "info",
    });
    return null;
  }
  if (!adherenceTargets.some((target) => target.calendar)) {
    context.diagnostics.push({
      code: "no_schedule",
      message: "No structured adherence target is available for this experiment.",
      severity: "info",
    });
  }

  try {
    const adherence = buildExperimentAdherenceCalendar({
      asOf: context.asOf,
      observations: buildAdherenceObservations(context, adherenceTargets),
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
  if (!adherence.targets.some((target) => target.calendar)) {
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
  targets: readonly ExperimentAdherenceTarget[],
): ExperimentAdherenceObservation[] {
  const observations: ExperimentAdherenceObservation[] = [];

  for (const target of targets) {
    switch (target.evidence.kind) {
      case "linkedEventCount":
        const linkedEvidence = target.evidence;
        observations.push(...context.adherenceEvents
          .filter((event) => eventKindIsCandidateForEvidence(event.kind, linkedEvidence))
          .map((event) => ({
            activityKind: resolveAdherenceObservationActivityKind({ attributes: event.attributes }),
            durationMinutes: readBrowserActivityDurationMinutes(event),
            evidenceId: event.id,
            eventKind: event.kind,
            localDate:
              event.kind === "activity_session"
                ? resolveActivityEvidenceLocalDate(event) ?? context.evidenceThrough
                : readSessionEventLocalDate(event) ??
                  readEventLocalDate(event, target.calendar?.timeZone ?? context.eventTimeZone) ??
                  event.date ??
                  extractDate(event.occurredAt) ??
                  context.evidenceThrough,
            source: readString(event.attributes.source),
            status: readSessionScheduleStatus(event),
            targetId: target.targetId,
          })));
        break;
      case "metricPresence":
      case "metricThreshold":
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
    assumedSessions: countCells(countedCells, "assumed"),
    completedSessions: countCells(countedCells, "completed") + countCells(countedCells, "assumed"),
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
  adherence: BrowserVaultExperimentAdherenceResult | null,
): BrowserVaultExperimentProgressResult {
  const rollupTarget = resolveExperimentAdherenceRollupTarget(context.adherenceTargets);
  const hasAmbiguousTargets = context.adherenceTargets.length > 1 && !rollupTarget;
  const hasUnsupportedExplicitTargets = context.unsupportedExplicitAdherenceTargets;
  const targetSessions =
    hasUnsupportedExplicitTargets ? null :
    rollupTarget?.rollup?.targetCompletions ??
    (hasAmbiguousTargets ? null : context.run.runPlan.targetSessions);
  const minimumUsefulSessions =
    hasUnsupportedExplicitTargets ? null :
    rollupTarget?.rollup?.minimumUsefulCompletions ??
    (hasAmbiguousTargets ? null : context.run.runPlan.minimumUsefulSessions);
  const progressTarget = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? null
    : rollupTarget ?? context.adherenceTargets[0] ?? null;
  const progressObservations = progressTarget
    ? buildAdherenceObservations(context, [progressTarget])
    : [];
  const progressCells = progressTarget?.calendar && adherence
    ? rollupTarget
      ? adherence.cells.filter((cell) => cell.targetId === rollupTarget.targetId)
      : adherence.cells
    : null;
  const occurrenceCounts =
    progressTarget?.calendar &&
      progressTarget.evidence.kind === "linkedEventCount" &&
      progressCells
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
          asOfDate: context.evidenceThrough,
          observations: progressObservations,
          target: progressTarget,
          windows: context.run.windows,
        })
      : null);
  const completedSessions = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? 0
    : occurrenceCounts
      ? occurrenceCounts.completedSessions
      : progressTarget?.calendar
        ? schedule?.completedSessions ?? 0
        : progressCounts?.completedSessions ?? 0;
  const partialSessions = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? 0
    : occurrenceCounts
      ? occurrenceCounts.partialSessions
      : progressTarget?.calendar
        ? schedule?.partialSessions ?? 0
        : progressCounts?.partialSessions ?? 0;
  const missedSessions = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? 0
    : occurrenceCounts
      ? occurrenceCounts.missedSessions
      : progressTarget?.calendar
        ? schedule?.missedSessions ?? 0
        : progressCounts?.missedSessions ?? 0;
  const skippedSessions = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? 0
    : occurrenceCounts
      ? occurrenceCounts.skippedSessions
      : progressTarget?.calendar
        ? schedule?.skippedSessions ?? 0
        : progressCounts?.skippedSessions ?? 0;
  const loggedSessions = completedSessions + partialSessions;
  const progressSchedule = progressTarget?.calendar && rollupTarget && schedule
    ? {
        ...schedule,
        cells: schedule.cells.filter((cell) => cell.targetId === rollupTarget.targetId),
      }
    : progressTarget?.calendar ? schedule : null;
  const confidenceCounts = hasUnsupportedExplicitTargets || hasAmbiguousTargets
    ? { sensedSessions: 0, confirmedSessions: 0, assumedSessions: 0 }
    : occurrenceCounts ??
      (progressTarget?.calendar
        ? countAdherenceConfidenceSessions({
            cells: progressCells ?? [],
            observations: progressObservations,
          })
        : progressCounts ?? {
            sensedSessions: 0,
            confirmedSessions: 0,
            assumedSessions: 0,
          });
  const scheduledExpectedSessionsByNow =
    hasUnsupportedExplicitTargets || hasAmbiguousTargets
      ? null
      : computeExpectedSessionsByNow(
          context.run,
          context.evidenceThrough,
          targetSessions,
          progressSchedule,
        );
  const expectedSessionsByNow =
    occurrenceCounts && scheduledExpectedSessionsByNow !== null
      ? occurrenceCounts.expectedSessionsByNow
      : scheduledExpectedSessionsByNow;
  const primary = biomarkers[0] ?? null;
  const primaryOutcome = resolveExperimentPrimaryOutcome(
    readExperimentAnalysisPlan(context.entity.attributes),
  );
  const structuredEvidence = primaryOutcome?.kind === "structured_review"
    ? summarizeExperimentOutcomeEvidencePlan(
        readExperimentAnalysisPlan(context.entity.attributes),
        primaryOutcome.key,
        {
          evidenceObservedOnByRecordId: context.evidenceObservedOnByRecordId,
          observedThrough: context.evidenceThrough,
        },
      )
    : null;
  const primaryBaselineDays =
    structuredEvidence?.baseline.observedCount ?? primary?.baseline.daysWithData ?? 0;
  const primaryInterventionDays =
    structuredEvidence?.followup.observedCount ?? primary?.intervention.daysWithData ?? 0;
  const coverageStatus = structuredEvidence
    ? structuredEvidence.reviewReady &&
        (context.run.phase === "review_due" || context.run.phase === "completed")
      ? "ready_for_review"
      : primaryBaselineDays + primaryInterventionDays > 0
        ? "partial"
        : "insufficient"
    : classifyCoverageStatus(context, primary);

  return {
    adherence: {
      completedSessions,
      ...(confidenceCounts.assumedSessions > 0 ? { assumedSessions: confidenceCounts.assumedSessions } : {}),
      ...(confidenceCounts.confirmedSessions > 0 ? { confirmedSessions: confidenceCounts.confirmedSessions } : {}),
      expectedSessionsByNow,
      loggedSessions,
      minimumUsefulSessions,
      missedSessions,
      partialSessions,
      ...(confidenceCounts.sensedSessions > 0 ? { sensedSessions: confidenceCounts.sensedSessions } : {}),
      skippedSessions,
      status: hasUnsupportedExplicitTargets || hasAmbiguousTargets
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
      primaryBiomarkerKey: primaryOutcome?.key ?? primary?.biomarkerKey ?? null,
      primaryMetricDaysAvailable: primaryBaselineDays + primaryInterventionDays,
      status: coverageStatus,
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
    !hasBrowserAnalysisMetricWindow(context) &&
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
  const analysisPlan = readExperimentAnalysisPlan(context.entity.attributes);
  const primaryOutcome = resolveExperimentPrimaryOutcome(analysisPlan);

  if (!analysisPlan) {
    blockingReasons.push("missing_analysis_plan");
  }
  if (!primaryOutcome) {
    blockingReasons.push("missing_primary_biomarker");
  }
  if (!hasBrowserAnalysisMetricWindow(context)) {
    blockingReasons.push("missing_metric_window");
  }

  return readinessResult(blockingReasons);
}

function hasBrowserAnalysisMetricWindow(context: BrowserVaultExperimentRunContext): boolean {
  const analysisPlan = readExperimentAnalysisPlan(context.entity.attributes);
  const primaryOutcome = resolveExperimentPrimaryOutcome(analysisPlan);
  if (!primaryOutcome) {
    return false;
  }

  if (primaryOutcome.kind === "structured_review") {
    return summarizeExperimentOutcomeEvidencePlan(
      analysisPlan,
      primaryOutcome.key,
    ).completePlan;
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
  const primaryBiomarkerKey = resolveExperimentPrimaryOutcome(
    readExperimentAnalysisPlan(context.entity.attributes),
  )?.key;
  return Boolean(
    primaryBiomarkerKey &&
      hasCompletePointMeasurementPlanForBiomarker(
        context.entity.attributes,
        primaryBiomarkerKey,
      ),
  );
}

function collectBiomarkerKeys(attributes: JsonRecord): string[] {
  const analysisPlan = readExperimentAnalysisPlan(attributes);
  const primaryOutcome = resolveExperimentPrimaryOutcome(analysisPlan);
  const keys = [
    primaryOutcome?.kind === "metric" ? primaryOutcome.key : null,
    ...(analysisPlan?.secondaryBiomarkerKeys ?? []),
  ];

  for (const effect of readExpectedEffectInputs(attributes)) {
    keys.push(effect.biomarkerKey);
  }

  return uniqueStrings(keys);
}

function resolveBrowserMetricOutcome(
  attributes: JsonRecord,
  biomarkerKey: string,
): ResolvedExperimentMetricOutcome {
  const analysisPlan = readExperimentAnalysisPlan(attributes);
  const primaryOutcome = resolveExperimentPrimaryOutcome(analysisPlan);
  return primaryOutcome?.kind === "metric" && primaryOutcome.key === biomarkerKey
    ? primaryOutcome
    : resolveExperimentMetricOutcome(biomarkerKey);
}

function readExperimentAnalysisPlan(
  attributes: JsonRecord,
) {
  const parsed = experimentAnalysisPlanSchema.safeParse(attributes.analysisPlan);
  return parsed.success ? parsed.data : undefined;
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
  resolvedMetricKey?: string,
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

  return {
    metricKey: resolvedMetricKey ?? metricDefinition?.key ?? slug,
  };
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

  if (
    resolveExperimentPrimaryOutcome(
      readExperimentAnalysisPlan(attributes),
    )?.key !== biomarkerKey
  ) {
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

function readBrowserActivityDurationMinutes(
  event: BrowserVaultEntity,
): number | null {
  return readFiniteNumber(event.attributes.durationMinutes) ??
    readFiniteNumber(readRecord(event.attributes.workout)?.durationMinutes);
}

function readProtocolActivitySessionEvidence(
  snapshotLike: unknown,
): {
  activityKinds: string[];
  minimumDurationMinutes?: number;
} | null {
  const evidence = readRecord(
    readRecord(snapshotLike)?.activitySessionEvidence,
  );
  if (!evidence) {
    return null;
  }

  const activityKinds = Array.isArray(evidence.activityKinds)
    ? evidence.activityKinds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const minimumDurationMinutes = readFiniteNumber(
    evidence.minimumDurationMinutes,
  );

  return {
    activityKinds,
    ...(minimumDurationMinutes === null
      ? {}
      : { minimumDurationMinutes }),
  };
}

function readProtocolSessionsPerDay(snapshotLike: unknown): number | null {
  return readFiniteNumber(
    readRecord(readRecord(snapshotLike)?.frequency)?.sessionsPerDay,
  );
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
