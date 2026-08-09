import {
  activityTextMatchesKind,
  experimentAdherenceTargetSchema,
  normalizeActivityKindToken,
  type ExperimentAdherenceEvidenceRule,
  type ExperimentAdherenceTarget,
  type ExperimentRunPlan,
  type ExperimentRunScheduleIntent,
  type ProtocolActivitySessionEvidence,
} from "@murphai/contracts";
import type { MetricComparator } from "./metrics/index.ts";

export type ExperimentAdherenceCellStatus =
  | "scheduled"
  | "satisfied"
  | "assumed"
  | "partial"
  | "missed"
  | "failed"
  | "unknown";

export interface ExperimentAdherenceWindows {
  baselineEnd: string | null;
  baselineStart: string | null;
  interventionEnd: string | null;
  interventionStart: string | null;
}

export interface ExperimentAdherenceObservation {
  activityKind?: string | null;
  durationMinutes?: number | null;
  comparator?: MetricComparator | null;
  evidenceId: string;
  eventKind?: string | null;
  localDate: string;
  metricKey?: string | null;
  source?: string | null;
  status?: "completed" | "partial" | "missed" | "skipped" | null;
  targetId?: string | null;
  value?: number | null;
}

export interface ExperimentAdherenceCell {
  targetId: string;
  label: string;
  localDate: string;
  localTime: string | null;
  planned: true;
  status: ExperimentAdherenceCellStatus;
  score: number | null;
  expectedCount: number | null;
  observedCount: number | null;
  evidenceIds: string[];
  reason: string;
}

export interface ExperimentAdherenceCalendarResult {
  timeZone: string;
  targets: Array<{
    targetId: string;
    label: string;
    rollup?: ExperimentAdherenceTarget["rollup"];
    plannedCount: number;
    satisfiedCount: number;
    assumedCount: number;
    partialCount: number;
    missedCount: number;
    failedCount: number;
    unknownCount: number;
    scheduledCount: number;
    score: number | null;
  }>;
  cells: ExperimentAdherenceCell[];
  summary: {
    status: "not_started" | "behind" | "on_track" | "met_minimum" | "met_target" | "unknown";
    plannedCount: number;
    satisfiedCount: number;
    assumedCount: number;
    partialCount: number;
    missedCount: number;
    failedCount: number;
    unknownCount: number;
    scheduledCount: number;
    score: number | null;
  };
}

export interface BuildExperimentAdherenceCalendarInput {
  asOf: Date | string;
  observations?: readonly ExperimentAdherenceObservation[];
  targets: readonly ExperimentAdherenceTarget[];
  windows: ExperimentAdherenceWindows;
}

interface AdherenceExpectation {
  expectedCount: number;
  label: string;
  localDate: string;
  localTime: string | null;
  target: ExperimentAdherenceTarget;
}

const ISO_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const MAX_ADHERENCE_CELLS = 3660;
const DEVICE_OBSERVABLE_ACTIVITY_KINDS = [
  "running",
  "cycling",
  "swimming",
  "rowing",
  "walking",
  "hiking",
  "strength",
  "elliptical",
] as const;
// Modality terms classify run plans; observation tokens below classify sensed event labels.
const GENERIC_WORKOUT_MODALITIES = new Set([
  "workout",
  "workouts",
  "exercise",
  "training",
  "fitness",
]);
const GENERIC_ACTIVITY_KIND_TOKENS = new Set([
  "workout",
  "activity",
  "activity-session",
  "session",
  "exercise",
  "cardio",
  "fitness",
  "general",
  "other",
  "unknown",
]);

type LegacyExperimentRunPlan = Pick<
  ExperimentRunPlan,
  "minimumUsefulSessions" | "modality" | "schedule" | "sessionsPerWeek" | "targetSessions"
>;

interface ResolvedExperimentProtocolActivitySessionEvidence {
  activityKinds: readonly string[];
  minimumDurationMinutes: number | null;
}

const LEGACY_ZONE_2_AEROBIC_BASE_PROTOCOL_KEY =
  "protocol_variant:aerobic-base-training/zone-2-aerobic-base-block";
const LEGACY_ZONE_2_AEROBIC_BASE_ACTIVITY_EVIDENCE = {
  activityKinds: ["walking", "cycling", "rowing", "elliptical"],
  minimumDurationMinutes: 35,
} as const satisfies ResolvedExperimentProtocolActivitySessionEvidence;

export type LinkedEventCountEvidence = Extract<ExperimentAdherenceEvidenceRule, { kind: "linkedEventCount" }>;

export interface AdherenceSessionCounts {
  completedSessions: number;
  sensedSessions: number;
  confirmedSessions: number;
  assumedSessions: number;
  missedSessions: number;
  partialSessions: number;
  skippedSessions: number;
}

export interface CalendarAdherenceSessionCounts extends AdherenceSessionCounts {
  expectedSessionsByNow: number;
  loggedEvidenceIds: string[];
}

export interface AdherenceConfidenceSessionCounts {
  sensedSessions: number;
  confirmedSessions: number;
  assumedSessions: number;
}

export function resolveAdherenceEvidence(
  modality: string | null | undefined,
): { eventKind: "activity_session" | "intervention_session"; activityKind?: string } {
  const normalizedModality = normalizeActivityKindToken(modality);
  if (normalizedModality === "cardio") {
    return { eventKind: "activity_session", activityKind: "cardio" };
  }

  const activityKind = resolveDeviceObservableActivityKind(modality);
  if (activityKind) {
    return { eventKind: "activity_session", activityKind };
  }

  if (normalizedModality && GENERIC_WORKOUT_MODALITIES.has(normalizedModality)) {
    return { eventKind: "activity_session" };
  }

  return { eventKind: "intervention_session" };
}

export function resolveExperimentAdherenceTargets(input: {
  explicitTargets?: readonly ExperimentAdherenceTarget[] | null;
  protocolActivitySessionEvidence?: ProtocolActivitySessionEvidence | null;
  protocolKey?: string | null;
  runPlan: LegacyExperimentRunPlan | null | undefined;
}): ExperimentAdherenceTarget[] {
  const protocolEvidence = resolveProtocolActivitySessionEvidence(input);
  if (input.explicitTargets !== undefined && input.explicitTargets !== null) {
    const explicitTargets = input.explicitTargets.slice();
    if (
      !protocolEvidence ||
      !explicitTargetsMatchLegacyGeneratedTarget(
        explicitTargets,
        input.runPlan,
      )
    ) {
      return explicitTargets;
    }
    return explicitTargets.map((target) =>
      applyProtocolActivitySessionEvidence(target, protocolEvidence)
    );
  }

  const synthesized = synthesizeLegacySessionAdherenceTargets({
    runPlan: input.runPlan,
  });
  return protocolEvidence
    ? synthesized.map((target) =>
        applyProtocolActivitySessionEvidence(target, protocolEvidence)
      )
    : synthesized;
}

function resolveProtocolActivitySessionEvidence(input: {
  protocolActivitySessionEvidence?: ProtocolActivitySessionEvidence | null;
  protocolKey?: string | null;
}): ResolvedExperimentProtocolActivitySessionEvidence | null {
  const activityKinds = normalizeAcceptedActivityKinds(
    input.protocolActivitySessionEvidence?.activityKinds,
  );
  if (activityKinds.length > 0) {
    return {
      activityKinds,
      minimumDurationMinutes: normalizePositiveInteger(
        input.protocolActivitySessionEvidence?.minimumDurationMinutes,
      ),
    };
  }

  return input.protocolKey === LEGACY_ZONE_2_AEROBIC_BASE_PROTOCOL_KEY
    ? LEGACY_ZONE_2_AEROBIC_BASE_ACTIVITY_EVIDENCE
    : null;
}

function explicitTargetsMatchLegacyGeneratedTarget(
  targets: readonly ExperimentAdherenceTarget[],
  runPlan: LegacyExperimentRunPlan | null | undefined,
): boolean {
  if (targets.length !== 1) {
    return false;
  }
  const target = targets[0];
  const synthesized = synthesizeLegacySessionAdherenceTargets({ runPlan })[0];
  if (!target || !synthesized) {
    return false;
  }

  // Zod emits both strict targets in the same schema-owned key order. Comparing
  // those parsed values makes the compatibility repair exact across the full
  // historical generated shape: label, phase, calendar, evidence, grace, and
  // rollup. Any custom material difference remains authoritative.
  return JSON.stringify(experimentAdherenceTargetSchema.parse(target)) ===
    JSON.stringify(experimentAdherenceTargetSchema.parse(synthesized));
}

function applyProtocolActivitySessionEvidence(
  target: ExperimentAdherenceTarget,
  protocolEvidence: ResolvedExperimentProtocolActivitySessionEvidence,
): ExperimentAdherenceTarget {
  if (target.evidence.kind !== "linkedEventCount") {
    return target;
  }

  return {
    ...target,
    evidence: {
      kind: "linkedEventCount",
      eventKind: "activity_session",
      activityKinds: [...protocolEvidence.activityKinds],
      ...(protocolEvidence.minimumDurationMinutes === null
        ? {}
        : {
            minimumDurationMinutes:
              protocolEvidence.minimumDurationMinutes,
          }),
      ...(target.evidence.partialCredit === undefined
        ? {}
        : { partialCredit: target.evidence.partialCredit }),
      missing: "missed_after_grace",
    },
  };
}

function normalizeAcceptedActivityKinds(
  values: readonly string[] | null | undefined,
): string[] {
  return [...new Set(
    (values ?? [])
      .map((value) => normalizeActivityKindToken(value))
      .filter((value): value is string => value !== null),
  )];
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0
    ? value
    : null;
}

export function eventKindIsCandidateForEvidence(
  eventKind: string | null | undefined,
  evidence: LinkedEventCountEvidence,
): boolean {
  if (!eventKind) {
    return false;
  }

  if (evidence.eventKind === "activity_session") {
    return eventKind === "activity_session" || eventKind === "intervention_session";
  }

  return eventKind === evidence.eventKind;
}

export function resolveActivityEvidenceLocalDate(event: {
  date?: string | null;
  occurredAt?: string | null;
}): string | null {
  return event.date ?? extractDate(event.occurredAt);
}

export function resolveInterventionSessionLocalDate(event: {
  attributes?: Record<string, unknown> | null;
  date?: string | null;
  occurredAt?: string | null;
}): string | null {
  const attributes = event.attributes ?? {};
  return readString(attributes.scheduledLocalDate) ??
    readString(attributes.sessionLocalDate) ??
    event.date ??
    extractDate(event.occurredAt);
}

export function resolveAdherenceObservationActivityKind(input: {
  attributes: Record<string, unknown>;
}): string | null {
  for (const candidate of listActivityKindCandidates(input.attributes)) {
    const normalized = normalizeActivityKindToken(candidate);
    if (normalized && !GENERIC_ACTIVITY_KIND_TOKENS.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

export function buildExperimentAdherenceCalendar(
  input: BuildExperimentAdherenceCalendarInput,
): ExperimentAdherenceCalendarResult {
  const targets = input.targets.slice();
  const timeZone = targets.find((target) => target.calendar)?.calendar?.timeZone ?? "UTC";
  const asOf = resolveAsOf(input.asOf, timeZone);
  const observations = input.observations ?? [];
  const expectationCount = targets.reduce(
    (total, target) => total + countExperimentAdherenceExpectations(target, input.windows),
    0,
  );
  if (expectationCount > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const expectations = targets.flatMap((target) =>
    expandExperimentAdherenceExpectations(target, input.windows)
  );

  const cells = expectations
    .map((expectation) =>
      evaluateExperimentAdherenceExpectation({
        asOf,
        expectation,
        observations: collectMatchingObservations(expectation.target, expectation.localDate, observations),
      }),
    )
    .sort(compareAdherenceCells);
  const targetSummaries = targets.map((target) => summarizeTargetCells(
    target,
    cells.filter((cell) => cell.targetId === target.targetId),
  ));
  const summary = summarizeCells(cells);

  return {
    timeZone,
    targets: targetSummaries,
    cells,
    summary,
  };
}

export function expandExperimentAdherenceExpectations(
  target: ExperimentAdherenceTarget,
  windows: ExperimentAdherenceWindows,
): AdherenceExpectation[] {
  if (!target.calendar) {
    return [];
  }

  const range = resolveTargetDateRange(target.phase, windows);
  if (!range) {
    return [];
  }

  switch (target.calendar.kind) {
    case "daily":
      const dailyCalendar = target.calendar;
      return dateRange(range.start, range.end).map((localDate) => ({
        expectedCount: dailyCalendar.targetCountPerDay ?? 1,
        label: target.label,
        localDate,
        localTime: dailyCalendar.localTime ?? null,
        target,
      }));
    case "weekdays":
      const weekdayCalendar = target.calendar;
      return weekdayDateRange(range.start, range.end, weekdayCalendar.weekdays)
        .map((localDate) => ({
          expectedCount: weekdayCalendar.targetCountPerDay ?? 1,
          label: target.label,
          localDate,
          localTime: weekdayCalendar.localTime ?? null,
          target,
        }));
    case "explicitDates":
      return target.calendar.dates
        .filter((entry) => entry.localDate >= range.start && entry.localDate <= range.end)
        .map((entry) => ({
          expectedCount: entry.targetCount ?? 1,
          label: entry.label ?? target.label,
          localDate: entry.localDate,
          localTime: entry.localTime ?? null,
          target,
        }));
  }
}

export function experimentAdherenceTargetPlansDate(input: {
  localDate: string;
  target: ExperimentAdherenceTarget;
  windows: ExperimentAdherenceWindows;
}): boolean {
  const { target } = input;
  if (!target.calendar) {
    return false;
  }

  const range = resolveTargetDateRange(target.phase, input.windows);
  if (!range || input.localDate < range.start || input.localDate > range.end) {
    return false;
  }

  switch (target.calendar.kind) {
    case "daily":
      return true;
    case "weekdays":
      return target.calendar.weekdays.includes(localDateWeekday(input.localDate));
    case "explicitDates":
      return target.calendar.dates.some((entry) => entry.localDate === input.localDate);
  }
}

function countExperimentAdherenceExpectations(
  target: ExperimentAdherenceTarget,
  windows: ExperimentAdherenceWindows,
): number {
  if (!target.calendar) {
    return 0;
  }

  const range = resolveTargetDateRange(target.phase, windows);
  if (!range) {
    return 0;
  }

  switch (target.calendar.kind) {
    case "daily":
      return countLocalDateRangeDays(range.start, range.end);
    case "weekdays":
      return countWeekdaysInRange(range.start, range.end, target.calendar.weekdays);
    case "explicitDates":
      return target.calendar.dates.filter((entry) =>
        entry.localDate >= range.start && entry.localDate <= range.end
      ).length;
  }
}

export function synthesizeLegacySessionAdherenceTargets(input: {
  runPlan: LegacyExperimentRunPlan | null | undefined;
}): ExperimentAdherenceTarget[] {
  const runPlan = input.runPlan;
  if (!runPlan) {
    return [];
  }

  const label = runPlan.modality?.trim() || "Session";
  const evidence = resolveAdherenceEvidence(runPlan.modality);
  const rollup =
    runPlan.targetSessions !== undefined || runPlan.minimumUsefulSessions !== undefined
      ? {
          ...(runPlan.targetSessions !== undefined
            ? { targetCompletions: runPlan.targetSessions }
            : {}),
          ...(runPlan.minimumUsefulSessions !== undefined
            ? { minimumUsefulCompletions: runPlan.minimumUsefulSessions }
            : {}),
        }
      : null;
  const base: ExperimentAdherenceTarget = {
    targetId: slugifyTargetId(label) ?? "session",
    label,
    phase: "intervention" as const,
    evidence: {
      kind: "linkedEventCount" as const,
      eventKind: evidence.eventKind,
      ...(evidence.activityKind ? { activityKind: evidence.activityKind } : {}),
      missing: "missed_after_grace" as const,
    },
    grace: { hours: 24 },
    ...(rollup ? { rollup } : {}),
  };

  if (runPlan.schedule) {
    const calendar = calendarFromLegacySchedule(runPlan.schedule);
    if (calendar) {
      return [{
        ...base,
        calendar,
        evidence: {
          kind: "linkedEventCount" as const,
          eventKind: evidence.eventKind,
          ...(evidence.activityKind ? { activityKind: evidence.activityKind } : {}),
          missing: evidence.eventKind === "intervention_session"
            ? "assumed_after_grace" as const
            : "missed_after_grace" as const,
        },
      }];
    }
  }

  return [base];
}

export function resolveExperimentAdherenceRollupTarget<
  Target extends {
    rollup?: ExperimentAdherenceTarget["rollup"] | null;
    targetId: string;
  },
>(targets: readonly Target[]): Target | null {
  const rollupTargets = targets.filter((target) =>
    target.rollup !== undefined && target.rollup !== null
  );
  if (rollupTargets.length === 1) {
    return rollupTargets[0] ?? null;
  }

  if (rollupTargets.length > 1) {
    return null;
  }

  return targets.length === 1 ? targets[0] ?? null : null;
}

export function countCompletedAdherenceSessions(input: {
  asOfDate: string;
  observations: readonly ExperimentAdherenceObservation[];
  target: ExperimentAdherenceTarget | null | undefined;
  windows: ExperimentAdherenceWindows;
}): AdherenceSessionCounts {
  const target = input.target;
  if (!target || target.evidence.kind !== "linkedEventCount") {
    return emptyAdherenceSessionCounts();
  }
  if (target.calendar) {
    return emptyAdherenceSessionCounts();
  }
  const evidence = target.evidence;

  const range = resolveTargetDateRange(target.phase, input.windows);
  if (!range || input.asOfDate < range.start) {
    return emptyAdherenceSessionCounts();
  }

  const end = minLocalDate(range.end, input.asOfDate);
  const matchingObservations = suppressManualActivityDuplicates(
    input.observations.filter((observation) =>
      observation.localDate >= range.start &&
      observation.localDate <= end &&
      linkedEventObservationMatchesEvidence(observation, evidence)
    ),
    evidence,
  );

  const counts = emptyAdherenceSessionCounts();
  for (const observation of matchingObservations) {
    switch (observation.status) {
      case "partial":
        counts.partialSessions += 1;
        countAdherenceObservationConfidence(counts, observation);
        break;
      case "missed":
        counts.missedSessions += 1;
        break;
      case "skipped":
        counts.skippedSessions += 1;
        break;
      default:
        counts.completedSessions += 1;
        countAdherenceObservationConfidence(counts, observation);
        break;
    }
  }

  return counts;
}

export function countCalendarAdherenceSessions(input: {
  asOf: Date | string;
  cells: readonly ExperimentAdherenceCell[];
  observations: readonly ExperimentAdherenceObservation[];
  target: ExperimentAdherenceTarget;
}): CalendarAdherenceSessionCounts {
  const counts: CalendarAdherenceSessionCounts = {
    ...emptyAdherenceSessionCounts(),
    expectedSessionsByNow: 0,
    loggedEvidenceIds: [],
  };
  const { target } = input;
  if (!target.calendar || target.evidence.kind !== "linkedEventCount") {
    return counts;
  }

  const asOf = resolveAsOf(input.asOf, target.calendar.timeZone);
  const countedEvidenceIds = new Set<string>();
  for (const cell of input.cells) {
    if (cell.targetId !== target.targetId) {
      continue;
    }

    const expectedCount = normalizeExpectedOccurrenceCount(cell.expectedCount);
    if (expectedCount === 0) {
      continue;
    }

    const matchingObservations = collectMatchingObservations(
      target,
      cell.localDate,
      input.observations,
    ).filter((observation) => !countedEvidenceIds.has(observation.evidenceId));
    const positiveObservations = matchingObservations
      .filter((observation) =>
        observation.status !== "missed" && observation.status !== "skipped"
      )
      .sort(compareCalendarPositiveObservations);
    const negativeObservations = matchingObservations.filter((observation) =>
      observation.status === "missed" || observation.status === "skipped"
    );

    let remaining = expectedCount;
    for (const observation of positiveObservations) {
      if (remaining === 0) {
        break;
      }
      if (countedEvidenceIds.has(observation.evidenceId)) {
        continue;
      }

      countedEvidenceIds.add(observation.evidenceId);
      counts.loggedEvidenceIds.push(observation.evidenceId);
      if (observation.status === "partial") {
        counts.partialSessions += 1;
      } else {
        counts.completedSessions += 1;
      }
      countAdherenceObservationConfidence(counts, observation);
      remaining -= 1;
    }

    for (const observation of negativeObservations) {
      if (remaining === 0) {
        break;
      }
      if (countedEvidenceIds.has(observation.evidenceId)) {
        continue;
      }

      countedEvidenceIds.add(observation.evidenceId);
      // Adherence v1 deliberately treats an explicit skip as a miss.
      counts.missedSessions += 1;
      remaining -= 1;
    }

    const explicitOccurrences = expectedCount - remaining;
    const expectation: AdherenceExpectation = {
      expectedCount,
      label: cell.label,
      localDate: cell.localDate,
      localTime: cell.localTime,
      target,
    };
    if (asOfWithinGrace(asOf, expectation)) {
      // Repeated daily targets usually have one aggregate due time. Until that
      // grace window closes, only explicitly observed occurrences are due.
      counts.expectedSessionsByNow += explicitOccurrences;
      continue;
    }

    counts.expectedSessionsByNow += expectedCount;
    if (remaining === 0) {
      continue;
    }

    const missingPolicy =
      target.evidence.missing === "assumed_after_grace" &&
        target.evidence.eventKind !== "intervention_session"
        ? "missed_after_grace"
        : target.evidence.missing;
    if (missingPolicy === "assumed_after_grace") {
      counts.completedSessions += remaining;
      counts.assumedSessions += remaining;
    } else if (missingPolicy === "missed_after_grace") {
      counts.missedSessions += remaining;
    }
  }

  return counts;
}

function normalizeExpectedOccurrenceCount(
  value: number | null | undefined,
): number {
  return Math.max(0, Math.trunc(value ?? 1));
}

function compareCalendarPositiveObservations(
  left: ExperimentAdherenceObservation,
  right: ExperimentAdherenceObservation,
): number {
  const leftPartial = left.status === "partial" ? 1 : 0;
  const rightPartial = right.status === "partial" ? 1 : 0;
  if (leftPartial !== rightPartial) {
    return leftPartial - rightPartial;
  }

  const sourceDifference =
    adherenceObservationConfidencePriority(left) -
    adherenceObservationConfidencePriority(right);
  return sourceDifference !== 0
    ? sourceDifference
    : left.evidenceId.localeCompare(right.evidenceId);
}

function adherenceObservationConfidencePriority(
  observation: ExperimentAdherenceObservation,
): number {
  if (isSensedAdherenceObservation(observation)) {
    return 0;
  }

  switch (normalizeObservationSource(observation.source)) {
    case "manual":
      return 1;
    case "derived":
      return 3;
    default:
      return 2;
  }
}

export function countAdherenceConfidenceSessions(input: {
  cells?: readonly ExperimentAdherenceCell[] | null;
  observations: readonly ExperimentAdherenceObservation[];
}): AdherenceConfidenceSessionCounts {
  const counts = emptyAdherenceConfidenceSessionCounts();
  const cells = input.cells ?? null;
  if (!cells) {
    for (const observation of input.observations) {
      if (observation.status !== "missed" && observation.status !== "skipped") {
        countAdherenceObservationConfidence(counts, observation);
      }
    }
    return counts;
  }

  const observationsById = new Map(
    input.observations.map((observation) => [observation.evidenceId, observation]),
  );
  for (const cell of cells) {
    if (cell.status === "assumed") {
      counts.assumedSessions += 1;
      continue;
    }
    if (cell.status !== "satisfied" && cell.status !== "partial") {
      continue;
    }
    const observations = cell.evidenceIds
      .map((evidenceId) => observationsById.get(evidenceId))
      .filter((observation): observation is ExperimentAdherenceObservation =>
        observation !== undefined &&
        observation.status !== "missed" &&
        observation.status !== "skipped"
      );
    if (observations.some((observation) => isSensedAdherenceObservation(observation))) {
      counts.sensedSessions += 1;
    } else if (
      observations.some(
        (observation) => normalizeObservationSource(observation.source) === "manual",
      )
    ) {
      counts.confirmedSessions += 1;
    } else if (
      observations.some(
        (observation) => normalizeObservationSource(observation.source) === "derived",
      )
    ) {
      counts.assumedSessions += 1;
    }
  }

  return counts;
}

function evaluateExperimentAdherenceExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const { expectation } = input;
  const { target } = expectation;

  switch (target.evidence.kind) {
    case "linkedEventCount":
      return evaluateLinkedEventCountExpectation(input);
    case "metricPresence":
      return evaluateMetricPresenceExpectation(input);
    case "metricThreshold":
      return evaluateMetricThresholdExpectation(input);
  }
}

function evaluateLinkedEventCountExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const evidence = input.expectation.target.evidence;
  if (evidence.kind !== "linkedEventCount") {
    throw new TypeError("Linked-event adherence expectation received non-linked evidence.");
  }
  const partialCredit = evidence.partialCredit ?? 0.5;
  let observedScore = 0;
  for (const observation of input.observations) {
    if (observation.status === "partial") {
      observedScore += partialCredit;
    } else if (observation.status !== "missed" && observation.status !== "skipped") {
      observedScore += 1;
    }
  }

  if (observedScore >= input.expectation.expectedCount) {
    return cell(input.expectation, "satisfied", 1, observedScore, input.observations, "Evidence meets the planned target.");
  }

  if (observedScore > 0) {
    return cell(
      input.expectation,
      "partial",
      Math.max(0, Math.min(1, observedScore / input.expectation.expectedCount)),
      observedScore,
      input.observations,
      "Some evidence was logged, but not enough for the planned target.",
    );
  }

  const explicitMissed = input.observations.filter((observation) => observation.status === "missed");
  if (explicitMissed.length > 0) {
    return cell(
      input.expectation,
      "missed",
      0,
      0,
      explicitMissed,
      "Target evidence was marked missed.",
    );
  }

  const explicitSkipped = input.observations.filter((observation) => observation.status === "skipped");
  if (explicitSkipped.length > 0) {
    return cell(
      input.expectation,
      "missed",
      0,
      0,
      explicitSkipped,
      "Target evidence was marked missed.",
    );
  }

  return missingCell(input);
}

function evaluateMetricPresenceExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  if (input.observations.length > 0) {
    return cell(input.expectation, "satisfied", 1, 1, input.observations, "Metric evidence is present.");
  }

  return missingCell(input);
}

function evaluateMetricThresholdExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const evidence = input.expectation.target.evidence;
  if (evidence.kind !== "metricThreshold") {
    throw new TypeError("Metric-threshold adherence expectation received non-threshold evidence.");
  }
  const numericObservations = input.observations.filter((candidate) => typeof candidate.value === "number");
  const exactObservations = numericObservations.filter((candidate) => !candidate.comparator);
  if (numericObservations.length === 0) {
    return missingCell(input);
  }

  const passingObservation = exactObservations.find((observation) =>
    typeof observation.value === "number" && metricValueSatisfiesRule(observation.value, evidence)
  );
  if (passingObservation) {
    return cell(input.expectation, "satisfied", 1, 1, [passingObservation], "Metric value meets the target.");
  }

  if (exactObservations.length === 0) {
    return cell(
      input.expectation,
      "unknown",
      null,
      numericObservations.length,
      numericObservations,
      "Metric value is bounded by a comparator.",
    );
  }

  return cell(input.expectation, "failed", 0, 1, exactObservations, "Metric value did not meet the planned target.");
}

function missingCell(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const { expectation } = input;
  const statusWithinGrace = asOfWithinGrace(input.asOf, expectation);
  if (statusWithinGrace) {
    return cell(expectation, "scheduled", null, 0, input.observations, "The planned target is not due yet.");
  }

  let missingPolicy = expectation.target.evidence.missing;
  if (
    missingPolicy === "assumed_after_grace" &&
    expectation.target.evidence.kind === "linkedEventCount" &&
    expectation.target.evidence.eventKind !== "intervention_session"
  ) {
    // Persisted targets predating the schema guard must not assume evidence outside manual intervention sessions.
    missingPolicy = "missed_after_grace";
  }
  if (missingPolicy === "assumed_after_grace") {
    return cell(expectation, "assumed", 1, 0, input.observations, "No log needed. Assumed done on schedule.");
  }

  const status =
    missingPolicy === "missed_after_grace"
      ? "missed"
      : missingPolicy === "failed_after_grace"
        ? "failed"
        : "unknown";
  const score = status === "unknown" ? null : 0;
  const reason =
    status === "unknown"
      ? "No target evidence is available."
      : "No target evidence was logged after the grace window.";

  return cell(expectation, status, score, 0, input.observations, reason);
}

function cell(
  expectation: AdherenceExpectation,
  status: ExperimentAdherenceCellStatus,
  score: number | null,
  observedCount: number | null,
  observations: readonly ExperimentAdherenceObservation[],
  reason: string,
): ExperimentAdherenceCell {
  return {
    targetId: expectation.target.targetId,
    label: expectation.label,
    localDate: expectation.localDate,
    localTime: expectation.localTime,
    planned: true,
    status,
    score,
    expectedCount: expectation.expectedCount,
    observedCount,
    evidenceIds: observations.map((observation) => observation.evidenceId),
    reason,
  };
}

function collectMatchingObservations(
  target: ExperimentAdherenceTarget,
  localDate: string,
  observations: readonly ExperimentAdherenceObservation[],
): readonly ExperimentAdherenceObservation[] {
  const matchingObservations = observations.filter((observation) => {
    if (observation.localDate !== localDate) {
      return false;
    }
    if (observation.targetId && observation.targetId !== target.targetId) {
      return false;
    }

    switch (target.evidence.kind) {
      case "linkedEventCount":
        return linkedEventObservationMatchesEvidence(observation, target.evidence);
      case "metricPresence":
      case "metricThreshold":
        return observation.metricKey === target.evidence.metricKey;
    }
  });

  return target.evidence.kind === "linkedEventCount"
    ? suppressManualActivityDuplicates(matchingObservations, target.evidence)
    : matchingObservations;
}

function metricValueSatisfiesRule(
  value: number,
  rule: Extract<ExperimentAdherenceEvidenceRule, { kind: "metricThreshold" }>,
): boolean {
  switch (rule.op) {
    case ">=":
      return value >= (rule.value ?? Number.POSITIVE_INFINITY);
    case "<=":
      return value <= (rule.value ?? Number.NEGATIVE_INFINITY);
    case "==":
      return value === rule.value;
    case "between":
      return value >= (rule.min ?? Number.POSITIVE_INFINITY) &&
        value <= (rule.max ?? Number.NEGATIVE_INFINITY);
  }
}

export function linkedEventObservationMatchesEvidence(
  observation: ExperimentAdherenceObservation,
  evidence: LinkedEventCountEvidence,
): boolean {
  if (!eventKindIsCandidateForEvidence(observation.eventKind, evidence)) {
    return false;
  }

  const acceptedActivityKinds = resolveAcceptedActivityKinds(evidence);
  if (observation.eventKind === "activity_session") {
    return (
      activityDurationMatchesEvidence(observation, evidence) &&
      (
        acceptedActivityKinds === null ||
        acceptedActivityKinds.some((activityKind) =>
          activityTextMatchesKind(observation.activityKind, activityKind)
        )
      )
    );
  }

  if (
    observation.eventKind === "intervention_session" &&
    evidence.eventKind === "activity_session"
  ) {
    if (!activityDurationMatchesEvidence(observation, evidence)) {
      return false;
    }
    if (acceptedActivityKinds === null || !observation.activityKind) {
      return true;
    }

    // Write boundaries own type matching; this read guard only honors explicit contradictions.
    // Only canonical-sport contradictions are rejected; unrecognized types pass.
    const canonicalKind = resolveDeviceObservableActivityKind(observation.activityKind);
    return canonicalKind
      ? acceptedActivityKinds.some((activityKind) =>
          activityTextMatchesKind(canonicalKind, activityKind)
        )
      : true;
  }

  return true;
}

function resolveAcceptedActivityKinds(
  evidence: LinkedEventCountEvidence,
): readonly string[] | null {
  if (evidence.activityKinds && evidence.activityKinds.length > 0) {
    return evidence.activityKinds;
  }
  return evidence.activityKind ? [evidence.activityKind] : null;
}

function activityDurationMatchesEvidence(
  observation: ExperimentAdherenceObservation,
  evidence: LinkedEventCountEvidence,
): boolean {
  const minimumDurationMinutes = evidence.minimumDurationMinutes;
  if (
    minimumDurationMinutes === undefined ||
    observation.durationMinutes === undefined ||
    observation.durationMinutes === null
  ) {
    // Preserve legacy/manual evidence when a provider did not retain duration.
    return true;
  }
  return observation.durationMinutes >= minimumDurationMinutes;
}

function suppressManualActivityDuplicates(
  observations: readonly ExperimentAdherenceObservation[],
  evidence: LinkedEventCountEvidence,
): readonly ExperimentAdherenceObservation[] {
  if (evidence.eventKind !== "activity_session") {
    return observations;
  }

  const deviceCountsByLocalDate = new Map<string, number>();
  for (const observation of observations) {
    if (isDeviceEquivalentActivityObservation(observation)) {
      deviceCountsByLocalDate.set(
        observation.localDate,
        (deviceCountsByLocalDate.get(observation.localDate) ?? 0) + 1,
      );
    }
  }

  if (deviceCountsByLocalDate.size === 0) {
    return observations;
  }

  return observations.filter((observation) => {
    if (
      !isSuppressibleNonDeviceDoneObservation(observation)
    ) {
      return true;
    }

    const remainingSuppressions = deviceCountsByLocalDate.get(observation.localDate) ?? 0;
    if (remainingSuppressions <= 0) {
      return true;
    }

    deviceCountsByLocalDate.set(observation.localDate, remainingSuppressions - 1);
    return false;
  });
}

function isDeviceEquivalentActivityObservation(
  observation: ExperimentAdherenceObservation,
): boolean {
  if (observation.eventKind !== "activity_session") {
    return false;
  }
  const source = normalizeObservationSource(observation.source);
  return source !== "manual" && source !== "derived";
}

function isSuppressibleNonDeviceDoneObservation(
  observation: ExperimentAdherenceObservation,
): boolean {
  if (observation.status !== "completed" && observation.status !== "partial") {
    return false;
  }
  if (observation.eventKind === "intervention_session") {
    return true;
  }
  if (observation.eventKind !== "activity_session") {
    return false;
  }
  const source = normalizeObservationSource(observation.source);
  return source === "manual" || source === "derived";
}

function normalizeObservationSource(source: string | null | undefined): string | null {
  const normalized = source?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function resolveDeviceObservableActivityKind(modality: string | null | undefined): string | null {
  const normalized = normalizeActivityKindToken(modality);
  if (!normalized) {
    return null;
  }

  return DEVICE_OBSERVABLE_ACTIVITY_KINDS.find((candidate) =>
    activityTextMatchesKind(normalized, candidate)
  ) ?? null;
}

function listActivityKindCandidates(attributes: Record<string, unknown>): string[] {
  const workout = readRecord(attributes.workout);
  const sport = readRecord(attributes.sport);
  const workoutSport = readRecord(workout?.sport);
  return [
    readString(attributes.activityKind),
    readString(attributes.activityType),
    readString(attributes.sportName),
    readString(attributes.type),
    readString(attributes.interventionType),
    readString(attributes.sport),
    readString(sport?.slug),
    readString(sport?.name),
    readString(sport?.type),
    readString(workout?.activityKind),
    readString(workout?.activityType),
    readString(workout?.sportName),
    readString(workout?.type),
    readString(workout?.sport),
    readString(workoutSport?.slug),
    readString(workoutSport?.name),
    readString(workoutSport?.type),
  ].filter((candidate): candidate is string => candidate !== null);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractDate(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function emptyAdherenceSessionCounts(): AdherenceSessionCounts {
  return {
    completedSessions: 0,
    sensedSessions: 0,
    confirmedSessions: 0,
    assumedSessions: 0,
    missedSessions: 0,
    partialSessions: 0,
    skippedSessions: 0,
  };
}

function emptyAdherenceConfidenceSessionCounts(): AdherenceConfidenceSessionCounts {
  return {
    sensedSessions: 0,
    confirmedSessions: 0,
    assumedSessions: 0,
  };
}

function countAdherenceObservationConfidence(
  counts: AdherenceConfidenceSessionCounts,
  observation: ExperimentAdherenceObservation,
): void {
  if (isSensedAdherenceObservation(observation)) {
    counts.sensedSessions += 1;
    return;
  }

  switch (normalizeObservationSource(observation.source)) {
    case "manual":
      counts.confirmedSessions += 1;
      return;
    case "derived":
      counts.assumedSessions += 1;
      return;
    default:
      return;
  }
}

function isSensedAdherenceObservation(
  observation: ExperimentAdherenceObservation,
): boolean {
  const source = normalizeObservationSource(observation.source);
  return source === "device" || source === "import";
}

function minLocalDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function asOfWithinGrace(asOf: Date, expectation: AdherenceExpectation): boolean {
  const plannedTime = expectation.localTime ?? "23:59";
  const plannedAtMs = zonedLocalDateTimeToEpochMs(
    expectation.localDate,
    plannedTime,
    expectation.target.calendar?.timeZone ?? "UTC",
  );
  const grace = expectation.target.grace ?? defaultGrace(expectation.target.evidence);
  const graceMs = "hours" in grace
    ? grace.hours * 60 * 60 * 1_000
    : grace.days * 24 * 60 * 60 * 1_000;

  return asOf.getTime() < plannedAtMs + graceMs;
}

function defaultGrace(evidence: ExperimentAdherenceEvidenceRule): { hours: number } {
  if (evidence.kind === "linkedEventCount") {
    return { hours: 24 };
  }

  return { hours: 0 };
}

function summarizeTargetCells(
  target: ExperimentAdherenceTarget,
  cells: readonly ExperimentAdherenceCell[],
): ExperimentAdherenceCalendarResult["targets"][number] {
  return {
    targetId: target.targetId,
    label: target.label,
    ...(target.rollup ? { rollup: target.rollup } : {}),
    ...countCellStatuses(cells),
    score: scoreCells(cells),
  };
}

function summarizeCells(
  cells: readonly ExperimentAdherenceCell[],
): ExperimentAdherenceCalendarResult["summary"] {
  const counts = countCellStatuses(cells);
  const score = scoreCells(cells);
  const numericCompleted = counts.satisfiedCount + counts.assumedCount + counts.partialCount;
  let status: ExperimentAdherenceCalendarResult["summary"]["status"] = "unknown";

  if (counts.plannedCount === 0) {
    status = "unknown";
  } else if (numericCompleted === 0) {
    status = "not_started";
  } else if (counts.missedCount > 0 || counts.failedCount > 0) {
    status = "behind";
  } else if (counts.scheduledCount > 0 || counts.unknownCount > 0) {
    status = "on_track";
  } else {
    status = "met_target";
  }

  return {
    ...counts,
    score,
    status,
  };
}

function countCellStatuses(cells: readonly ExperimentAdherenceCell[]) {
  return {
    plannedCount: cells.length,
    satisfiedCount: countCells(cells, "satisfied"),
    assumedCount: countCells(cells, "assumed"),
    partialCount: countCells(cells, "partial"),
    missedCount: countCells(cells, "missed"),
    failedCount: countCells(cells, "failed"),
    unknownCount: countCells(cells, "unknown"),
    scheduledCount: countCells(cells, "scheduled"),
  };
}

function countCells(
  cells: readonly ExperimentAdherenceCell[],
  status: ExperimentAdherenceCellStatus,
): number {
  return cells.filter((cell) => cell.status === status).length;
}

function scoreCells(cells: readonly ExperimentAdherenceCell[]): number | null {
  const scored = cells.filter((cell) => cell.score !== null);
  if (scored.length === 0) {
    return null;
  }

  return round(scored.reduce((sum, cell) => sum + (cell.score ?? 0), 0) / scored.length);
}

function resolveTargetDateRange(
  phase: ExperimentAdherenceTarget["phase"],
  windows: ExperimentAdherenceWindows,
): { end: string; start: string } | null {
  if (phase === "baseline") {
    return windows.baselineStart && windows.baselineEnd
      ? { start: windows.baselineStart, end: windows.baselineEnd }
      : null;
  }

  if (phase === "intervention") {
    return windows.interventionStart && windows.interventionEnd
      ? { start: windows.interventionStart, end: windows.interventionEnd }
      : null;
  }

  const start = windows.baselineStart ?? windows.interventionStart;
  const end = windows.interventionEnd ?? windows.baselineEnd;
  return start && end ? { start, end } : null;
}

function calendarFromLegacySchedule(
  schedule: ExperimentRunScheduleIntent,
): ExperimentAdherenceTarget["calendar"] | null {
  if (schedule.kind === "dailyLocal") {
    return {
      kind: "daily",
      timeZone: schedule.timeZone,
      localTime: schedule.localTime,
      targetCountPerDay: 1,
    };
  }

  const parsed = parseSimpleCron(schedule.expression);
  if (!parsed) {
    return null;
  }

  return {
    kind: "weekdays",
    timeZone: schedule.timeZone,
    localTime: parsed.localTime,
    weekdays: parsed.weekdays,
    targetCountPerDay: 1,
  };
}

function parseSimpleCron(expression: string): { localTime: string; weekdays: number[] } | null {
  const match = /^(?<minute>[0-5]?\d)\s+(?<hour>[01]?\d|2[0-3])\s+\*\s+\*\s+(?<weekdays>[0-7](?:,[0-7])*)$/u.exec(
    expression.trim(),
  );
  if (!match?.groups) {
    return null;
  }

  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const weekdays = [...new Set(match.groups.weekdays.split(",").map((value) => {
    const day = Number(value);
    return day === 7 ? 0 : day;
  }))].sort((left, right) => left - right);

  return {
    localTime: `${pad2(hour)}:${pad2(minute)}`,
    weekdays,
  };
}

function compareAdherenceCells(left: ExperimentAdherenceCell, right: ExperimentAdherenceCell): number {
  if (left.localDate !== right.localDate) {
    return left.localDate.localeCompare(right.localDate);
  }

  return left.targetId.localeCompare(right.targetId);
}

function dateRange(start: string, end: string): string[] {
  if (start > end) {
    return [];
  }
  if (countLocalDateRangeDays(start, end) > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function weekdayDateRange(start: string, end: string, weekdays: readonly number[]): string[] {
  if (start > end || weekdays.length === 0) {
    return [];
  }

  if (countWeekdaysInRange(start, end, weekdays) > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const weekdaySet = new Set(weekdays);
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    if (weekdaySet.has(localDateWeekday(cursor))) {
      dates.push(cursor);
    }
  }
  return dates;
}

function countLocalDateRangeDays(start: string, end: string): number {
  if (start > end) {
    return 0;
  }

  const startParts = parseIsoLocalDate(start);
  const endParts = parseIsoLocalDate(end);
  const startMs = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endMs = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function countWeekdaysInRange(start: string, end: string, weekdays: readonly number[]): number {
  const totalDays = countLocalDateRangeDays(start, end);
  if (totalDays === 0 || weekdays.length === 0) {
    return 0;
  }

  const weekdaySet = new Set(weekdays);
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * weekdaySet.size;
  const remainingDays = totalDays % 7;
  const startWeekday = localDateWeekday(start);

  for (let offset = 0; offset < remainingDays; offset += 1) {
    if (weekdaySet.has((startWeekday + offset) % 7)) {
      count += 1;
    }
  }

  return count;
}

function resolveAsOf(value: Date | string, timeZone: string): Date {
  if (typeof value === "string" && ISO_LOCAL_DATE_PATTERN.test(value)) {
    return new Date(zonedLocalDateTimeToEpochMs(value, "00:00", timeZone));
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("asOf must be a valid date or timestamp.");
  }
  return date;
}

function parseIsoLocalDate(value: string): { day: number; month: number; year: number } {
  return {
    day: Number(value.slice(8, 10)),
    month: Number(value.slice(5, 7)),
    year: Number(value.slice(0, 4)),
  };
}

function parseLocalTime(value: string): { hour: number; minute: number } {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new TypeError("localTime must use HH:MM format.");
  }

  return {
    hour: Number(value.slice(0, 2)),
    minute: Number(value.slice(3, 5)),
  };
}

function localDateWeekday(localDate: string): number {
  const parts = parseIsoLocalDate(localDate);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function addLocalDays(localDate: string, days: number): string {
  const parts = parseIsoLocalDate(localDate);
  return formatUtcLocalDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)),
  );
}

function formatUtcLocalDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join("-");
}

function zonedLocalDateTimeToEpochMs(
  localDate: string,
  localTime: string,
  timeZone: string,
): number {
  const dateParts = parseIsoLocalDate(localDate);
  const timeParts = parseLocalTime(localTime);
  const desiredAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
  );
  let guess = desiredAsUtc;

  for (let index = 0; index < 4; index += 1) {
    const actual = readZonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const diff = desiredAsUtc - actualAsUtc;

    if (diff === 0) {
      return guess;
    }

    guess += diff;
  }

  return guess;
}

function readZonedParts(
  date: Date,
  timeZone: string,
): { day: number; hour: number; minute: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return {
    day: readZonedPart(values, "day"),
    hour: readZonedPart(values, "hour"),
    minute: readZonedPart(values, "minute"),
    month: readZonedPart(values, "month"),
    year: readZonedPart(values, "year"),
  };
}

function readZonedPart(
  values: Partial<Record<Intl.DateTimeFormatPartTypes, string>>,
  key: Intl.DateTimeFormatPartTypes,
): number {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Could not read ${key} from time-zone formatter.`);
  }

  return Number(value);
}

function slugifyTargetId(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug.length > 0 ? slug : null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
