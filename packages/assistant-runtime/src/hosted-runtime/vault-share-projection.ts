import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  activityTextMatchesKind,
  formatTimeZoneDateTimeParts,
  hasMemoryDisplayNameEvidence,
  isStrictIsoDate,
  isStrictIsoDateTime,
  memoryDisplayNameSchema,
  normalizeActivityKindToken,
  normalizeIanaTimeZone,
  parseFrontmatterDocument,
  resolveMemoryDisplayName,
  validateCurrentVaultMetadata,
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  buildHostedVaultShareProjectionScopeKey,
  getHostedVaultShareActivityDistanceProjectionSpec,
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareActivitySessionCountProjectionSpec,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
  HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES,
  HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES,
  HOSTED_VAULT_SHARE_TIME_ZONE_RECORD_KEY,
  HOSTED_VAULT_SHARE_WORKOUT_GENERIC_KIND,
  HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH,
  HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
  HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY,
  type HostedVaultShareActivityDistanceProjectionSpec,
  type HostedVaultShareActivityMinutesProjectionSpec,
  type HostedVaultShareActivitySessionCountProjectionSpec,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareDailyMetricProjectionSpec,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
  type HostedVaultShareSleepMetricSource,
  type HostedVaultShareWorkout,
} from "@murphai/hosted-execution/vault-share";
import {
  type ProjectedWearableSleepSummary,
  listCanonicalEntities,
  listMetricPoints,
  listMetricPointsBatch,
  readMealNutritionTotals,
  readMemoryDocument,
  resolveAdherenceObservationActivityKind,
  selectAuthoritativeMetricPoint,
  selectMetricSeries,
  summarizeWearableSleepRuntime,
  summarizeWearableSourceHealthRuntime,
  type CanonicalEntity,
  type MealNutritionDayTotal,
  type MealNutritionTotalsResult,
  type MetricPoint,
  type MetricSeriesPoint,
} from "@murphai/query";

import type { HostedRuntimeVaultSharePort } from "./platform.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_MAX_MINUTES = 24 * 60;
const DAY_MAX_DISTANCE_METERS = 1_000_000;
const DAY_MAX_SESSIONS = 100;
const ACTIVITY_SESSION_DUPLICATE_MIN_OVERLAP_RATIO = 0.8;
// Above the source cap, fail closed instead of emitting partial daily projections.
const ACTIVITY_SESSION_SOURCE_ROW_LIMIT = 500;
const ACTIVITY_SESSION_SOURCE_ROW_QUERY_LIMIT = ACTIVITY_SESSION_SOURCE_ROW_LIMIT + 1;
const HEART_RATE_ZONE_MINUTES_METRIC_KEY_PATTERN = /^heart-rate-zone-(\d+)-minutes$/u;
const HEART_RATE_ZONE_MINUTES_METRIC_KEYS = Array.from(
  { length: 21 },
  (_, zone) => `heart-rate-zone-${zone}-minutes`,
);

export const HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW = 8;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS = 8;

export const HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW = 8;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS = 8;

const HOSTED_VAULT_SHARE_WORKOUT_CALENDAR_TIME_ZONE = "Etc/GMT+12";

function projectionCutoffDate(nowMs: number, maxAgeDays: number): string {
  return new Date(projectionCutoffMs(nowMs, maxAgeDays))
    .toISOString()
    .slice(0, 10);
}

function projectionCutoffMs(nowMs: number, maxAgeDays: number): number {
  const date = new Date(nowMs);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() - maxAgeDays * DAY_MS;
}

type MetricSourceOwnerPoint = Pick<
  MetricSeriesPoint,
  "recordIds" | "sourceFamily" | "sourceKind"
>;

type MetricSourceRevisionPoint = MetricSourceOwnerPoint & Pick<
  MetricSeriesPoint,
  "observedAt" | "pointIds"
>;

type DailyMetricProjectionPoint = MetricSourceRevisionPoint & Pick<
  MetricSeriesPoint,
  "context" | "date" | "grain" | "metricKey" | "sourceLabel" | "statistic" | "unit" | "value"
> & {
  provisional?: boolean;
  sources?: readonly HostedVaultShareSleepMetricSource[];
};

type WorkoutMetricProjectionRow = MetricSourceRevisionPoint & Pick<
  MetricSeriesPoint,
  "date" | "grain" | "metricKey" | "statistic" | "value"
>;

type HeartRateZoneMetricProjectionRow = MetricSourceRevisionPoint & Pick<
  MetricSeriesPoint,
  "context" | "date" | "grain" | "metricKey" | "statistic" | "value"
>;

export type ActivitySessionProjectionRow = MetricSourceRevisionPoint & {
  activityKind: string | null;
  date: string;
  distanceMeters?: number | null;
  durationMinutes?: number | null;
  endedAt?: string | null;
  isWorkout: boolean;
  startedAt?: string | null;
  timeZone?: string | null;
};

type ProjectableWorkoutCandidate = {
  row: ActivitySessionProjectionRow;
  startedAtMs: number;
  timeZone: string;
  workout: HostedVaultShareWorkout;
};

type ActivitySessionProjectionReadResult = {
  complete: boolean;
  rows: ActivitySessionProjectionRow[];
};

type ProjectableProfileNameResolution = {
  displayName: string;
  occurredAt: string;
  sourceRevision: string;
};

type ProjectableMemoryProfileNameRead =
  | { resolution: ProjectableProfileNameResolution; status: "resolved" }
  | { status: "absent" | "no-evidence" | "unresolved" };

export interface HostedVaultShareProjectionOfferResult {
  outcome:
    | "delivered"
    | "error"
    | "no-active-share"
    | "no-port"
    | "no-projectable-records";
}

export type HostedVaultShareProjectionScopeResolution =
  | {
    outcome: "active-scopes";
    projectionScopes: HostedVaultShareProjectionScope[];
  }
  | { outcome: "error" }
  | { outcome: "no-active-share" };

export interface HostedVaultShareProjectionCapture {
  sourceWorkspaceVersion: string;
  snapshots: Array<{
    projectionScope: HostedVaultShareProjectionScope;
    records: HostedVaultShareDeliveryRecord[];
  }>;
}

export type HostedVaultShareProjectionCaptureResult =
  | {
    capture: HostedVaultShareProjectionCapture;
    outcome: "captured";
  }
  | { outcome: "error" }
  | { outcome: "no-projectable-records" };

/**
 * Resolve Web-owned active share scopes without retaining access to the member vault.
 * The caller may cancel this network-only phase when foreground work wakes.
 */
export async function resolveHostedVaultShareProjectionScopesBestEffort(input: {
  signal?: AbortSignal | null;
  vaultSharePort: HostedRuntimeVaultSharePort;
}): Promise<HostedVaultShareProjectionScopeResolution> {
  try {
    const projectionScopesPromise = input.signal
      ? input.vaultSharePort.listActiveProjectionScopes({ signal: input.signal })
      : input.vaultSharePort.listActiveProjectionScopes();
    const projectionScopes = uniqueHostedVaultShareProjectionScopes(
      await projectionScopesPromise,
    );
    return projectionScopes.length === 0
      ? { outcome: "no-active-share" }
      : { outcome: "active-scopes", projectionScopes };
  } catch {
    return { outcome: "error" };
  }
}

/**
 * Materialize every active projectable scope while the invocation still owns the
 * restored vault. The returned capture contains no vault path or lazy read, so later
 * delivery cannot observe a successor invocation's mutable workspace generation.
 *
 * Never throws. If any read fails, no scope is delivered from this capture. For a
 * projectable scope, an empty read remains an intentional replacement snapshot.
 */
export async function captureHostedVaultShareProjectionBestEffort(input: {
  projectionScopes: readonly HostedVaultShareProjectionScope[];
  sourceWorkspaceVersion: string;
  vaultRoot: string;
}): Promise<HostedVaultShareProjectionCaptureResult> {
  const snapshots: HostedVaultShareProjectionCapture["snapshots"] = [];
  const context: HostedVaultShareProjectionReadContext = {};

  for (const projectionScope of input.projectionScopes) {
    const readRecords = resolveProjectableRecordReader(projectionScope);
    if (!readRecords) {
      continue;
    }
    try {
      snapshots.push({
        projectionScope,
        records: await readRecords({
          context,
          vaultRoot: input.vaultRoot,
        }),
      });
    } catch {
      return { outcome: "error" };
    }
  }

  return snapshots.length === 0
    ? { outcome: "no-projectable-records" }
    : {
      capture: {
        snapshots,
        sourceWorkspaceVersion: input.sourceWorkspaceVersion,
      },
      outcome: "captured",
    };
}

type HostedVaultShareOfferOutcome = HostedVaultShareProjectionOfferResult["outcome"];

export interface HostedVaultShareProjectionReadContext {
  activityRowsByVaultAndCutoff?: Map<
    string,
    Promise<ActivitySessionProjectionReadResult>
  >;
  mealNutritionTotalsByVaultAndCutoff?: Map<string, Promise<MealNutritionTotalsResult>>;
}

type ProjectableRecordReader = (input: {
  context: HostedVaultShareProjectionReadContext;
  vaultRoot: string;
}) => Promise<HostedVaultShareDeliveryRecord[]>;

/**
 * Deliver an immutable capture. This phase performs no vault reads and is safe to
 * finish after its originating invocation releases the mutable workspace path; Web's
 * committed-version fence remains the final stale-writer authority.
 */
export async function offerCapturedHostedVaultShareProjectionBestEffort(input: {
  capture: HostedVaultShareProjectionCapture;
  vaultSharePort: HostedRuntimeVaultSharePort;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const outcomes: HostedVaultShareOfferOutcome[] = [];
  for (const snapshot of input.capture.snapshots) {
    try {
      const request = {
        projectionKind: snapshot.projectionScope.projectionKind,
        projectionScope: snapshot.projectionScope,
        records: snapshot.records,
        sourceWorkspaceVersion: input.capture.sourceWorkspaceVersion,
      };
      const response = await input.vaultSharePort.deliver(request);
      outcomes.push(
        response.status === "delivered" ? "delivered" : "no-active-share",
      );
    } catch {
      return { outcome: "error" };
    }
  }
  return { outcome: combineHostedVaultShareOfferOutcomes(outcomes) };
}

function resolveProjectableRecordReader(
  projectionScope: HostedVaultShareProjectionScope,
): ProjectableRecordReader | null {
  const projectionKind = projectionScope.projectionKind;
  switch (projectionKind) {
    case HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND:
      return null;
    case "group-email.v0":
      return null;
    case "heart-rate-zones-days.v0":
      return ({ vaultRoot }) => readProjectableHeartRateZoneDays(vaultRoot);
    case "profile-name.v0":
      return ({ vaultRoot }) => readProjectableProfileName(vaultRoot);
    case "time-zone.v0":
      return ({ vaultRoot }) => readProjectableTimeZone(vaultRoot);
    case "sleep-times.v0":
      return ({ vaultRoot }) => readProjectableSleepNights(vaultRoot);
    case "workout-days.v0":
      return ({ vaultRoot }) => readProjectableWorkoutDays(vaultRoot);
    case "workouts.v0":
      return ({ context, vaultRoot }) =>
        readProjectableWorkoutsDays(vaultRoot, context);
    default: {
      const activityMinutesSpec =
        getHostedVaultShareActivityMinutesProjectionSpec(projectionScope);
      if (activityMinutesSpec) {
        return ({ context, vaultRoot }) =>
          readProjectableActivityMinutesDays(vaultRoot, activityMinutesSpec, context);
      }
      const activityDistanceSpec =
        getHostedVaultShareActivityDistanceProjectionSpec(projectionScope);
      if (activityDistanceSpec) {
        return ({ context, vaultRoot }) =>
          readProjectableActivityDistanceDays(vaultRoot, activityDistanceSpec, context);
      }
      const activitySessionCountSpec =
        getHostedVaultShareActivitySessionCountProjectionSpec(projectionScope);
      if (activitySessionCountSpec) {
        return ({ context, vaultRoot }) =>
          readProjectableActivitySessionCountDays(vaultRoot, activitySessionCountSpec, context);
      }
      const spec = getHostedVaultShareDailyMetricProjectionSpec(projectionKind);
      if (spec) {
        if (spec.source.kind === "meal-nutrition-total") {
          return ({ context, vaultRoot }) =>
            readProjectableMealNutritionDays(vaultRoot, spec, context);
        }
        return ({ vaultRoot }) => readProjectableDailyMetricDays(vaultRoot, spec);
      }
      return null;
    }
  }
}

function uniqueHostedVaultShareProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionScope[] {
  const unique: HostedVaultShareProjectionScope[] = [];
  const seen = new Set<string>();
  for (const projectionScope of projectionScopes) {
    const scopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
    if (!seen.has(scopeKey)) {
      seen.add(scopeKey);
      unique.push(projectionScope);
    }
  }
  return unique;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Kind outcomes collapse to one summary for the existing single-outcome logging seam:
 * any error is worth the warn log, otherwise any delivery counts as delivered.
 */
function combineHostedVaultShareOfferOutcomes(
  outcomes: readonly HostedVaultShareOfferOutcome[],
): HostedVaultShareOfferOutcome {
  for (const outcome of ["error", "delivered", "no-active-share"] as const) {
    if (outcomes.includes(outcome)) {
      return outcome;
    }
  }
  return "no-projectable-records";
}

/**
 * The group-visible display name projects from canonical memory. The resolver prefers
 * the typed memory record and only uses narrow legacy Identity memories as a backfill.
 * occurredAt reuses the source memory record's updatedAt so retries stay byte-identical.
 */
export async function readProjectableProfileName(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const memoryRead = await readProjectableMemoryProfileName(vaultRoot);
  const resolved =
    memoryRead.status === "resolved"
      ? memoryRead.resolution
      : memoryRead.status === "absent" || memoryRead.status === "no-evidence"
        ? await readProjectableLegacyProfileName(vaultRoot)
        : null;
  if (resolved === null) {
    return [];
  }

  return [
    {
      data: { displayName: resolved.displayName },
      occurredAt: resolved.occurredAt,
      recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
      sourceRevision: resolved.sourceRevision,
    },
  ];
}

async function readProjectableMemoryProfileName(
  vaultRoot: string,
): Promise<ProjectableMemoryProfileNameRead> {
  const snapshot = await readMemoryDocument(vaultRoot).catch(() => null);
  if (snapshot === null) {
    return { status: "unresolved" };
  }
  if (!snapshot.exists) {
    return { status: "absent" };
  }
  if (!hasMemoryDisplayNameEvidence(snapshot)) {
    return { status: "no-evidence" };
  }

  const resolved = resolveMemoryDisplayName(snapshot);
  if (
    resolved === null
    || resolved.displayName.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || !Number.isFinite(Date.parse(resolved.record.updatedAt))
  ) {
    return { status: "unresolved" };
  }

  return {
    resolution: {
      displayName: resolved.displayName,
      occurredAt: new Date(Date.parse(resolved.record.updatedAt)).toISOString(),
      sourceRevision: hashOpaqueSourceRevision({
        memoryDisplayNameRecordId: resolved.record.id,
        memoryDisplayNameSource: resolved.source,
        memoryDisplayNameUpdatedAt: resolved.record.updatedAt,
        projectionKind: "profile-name.v0",
        recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
      }),
    },
    status: "resolved",
  };
}

async function readProjectableLegacyProfileName(
  vaultRoot: string,
): Promise<ProjectableProfileNameResolution | null> {
  let markdown: string;
  try {
    markdown = await readFile(path.join(vaultRoot, "bank/profile.md"), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  const frontmatter = parseFrontmatterDocument(markdown).attributes;
  if (
    frontmatter === null
    || typeof frontmatter !== "object"
    || Array.isArray(frontmatter)
  ) {
    return null;
  }

  const displayName = memoryDisplayNameSchema.safeParse(
    (frontmatter as { displayName?: unknown }).displayName,
  );
  const updatedAt = (frontmatter as { updatedAt?: unknown }).updatedAt;
  const updatedAtMs = typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;
  if (
    !displayName.success
    || displayName.data.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || !Number.isFinite(updatedAtMs)
  ) {
    return null;
  }

  const occurredAt = new Date(updatedAtMs).toISOString();
  return {
    displayName: displayName.data,
    occurredAt,
    sourceRevision: hashOpaqueSourceRevision({
      legacyProfileDisplayName: displayName.data,
      legacyProfilePath: "bank/profile.md",
      legacyProfileUpdatedAt: occurredAt,
      projectionKind: "profile-name.v0",
      recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
    }),
  };
}

export async function readProjectableTimeZone(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  // Reuses the existing validated vault timezone; there is no second source of
  // truth for it. A vault with no valid timezone shares nothing rather than
  // guessing one.
  const timeZone = await readProjectableVaultTimeZone(vaultRoot);
  if (!timeZone) {
    return [];
  }
  return [{
    data: { timeZone },
    occurredAt: new Date(Date.now()).toISOString(),
    recordKey: HOSTED_VAULT_SHARE_TIME_ZONE_RECORD_KEY,
  }];
}

export async function readProjectableSleepNights(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const summaries = await summarizeWearableSleepRuntime(vaultRoot, {
    limit: HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  });
  return selectProjectableSleepNights(summaries, Date.now());
}

export async function readProjectableDailyMetricDays(
  vaultRoot: string,
  spec: HostedVaultShareDailyMetricProjectionSpec,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const points = await listMetricPoints(vaultRoot, {
    from: cutoffDate,
    limit: null,
    metricKey: spec.metricKey,
  });
  const acceptsManualSleepStage = spec.metricKey === "deep-sleep-minutes"
    || spec.metricKey === "rem-sleep-minutes";
  const dayGrainPoints = acceptsManualSleepStage
    ? points.map((point) =>
        isManualSleepStageCorrection(point)
          && point.grain === "event"
          ? { ...point, grain: "day" as const }
          : point
      )
    : points;
  const projectionPoints = acceptsManualSleepStage
    ? selectAuthoritativeManualSleepStageCorrections(dayGrainPoints)
    : dayGrainPoints;
  const manualCorrectionDates = acceptsManualSleepStage
    ? new Set(projectionPoints
        .filter((point) =>
          point.grain === "day" && isManualSleepStageCorrection(point)
        )
        .map((point) => point.effectiveDate))
    : new Set<string>();
  const selectionPoints = manualCorrectionDates.size > 0
    ? projectionPoints.filter((point) =>
        !manualCorrectionDates.has(point.effectiveDate)
        || isManualSleepStageCorrection(point)
      )
    : projectionPoints;
  const series = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: cutoffDate,
    grain: "day",
    metricKey: spec.metricKey,
    points: selectionPoints,
    statistic: "value",
  });
  let rows: readonly DailyMetricProjectionPoint[] = series.rows;
  if (spec.sourceMode === "all-public-sleep-sources") {
    const sourcesByDate = await readProjectableSleepMetricSourcesByDate({
      cutoffDate,
      points: projectionPoints,
      spec,
      vaultRoot,
    });
    if (!sourcesByDate) {
      return [];
    }
    rows = rows.map((row) => ({
      ...row,
      sources: sourcesByDate.get(row.date) ?? [],
    }));
  }

  const completedDateScope = [
    "deep-sleep-days.v0",
    "deep-sleep-sources-days.v1",
    "rem-sleep-days.v0",
    "rem-sleep-sources-days.v1",
  ].includes(spec.projectionKind);
  if (!completedDateScope) return selectProjectableDailyMetricDays(rows, spec, nowMs);

  const vaultTimeZone = await readProjectableVaultTimeZone(vaultRoot);
  return selectProjectableDailyMetricDays(rows.flatMap((row) => {
    const timeZone = normalizeIanaTimeZone(readContextString(row.context, "timeZone"))
      ?? vaultTimeZone;
    if (!timeZone) return [];
    const currentDate = formatTimeZoneDateTimeParts(nowMs, timeZone).dayKey;
    return row.date > currentDate ? [] : [row];
  }), spec, nowMs);
}

function isManualSleepStageCorrection(point: MetricPoint): boolean {
  return point.source.family === "event"
    && point.source.kind === "observation"
    && point.provenance.provider === null
    && point.provenance.sourceLabel === "Manual";
}

function selectAuthoritativeManualSleepStageCorrections(
  points: readonly MetricPoint[],
): MetricPoint[] {
  const manualPointsByDate = new Map<string, MetricPoint[]>();
  for (const point of points) {
    if (point.grain !== "day" || !isManualSleepStageCorrection(point)) {
      continue;
    }
    const datePoints = manualPointsByDate.get(point.effectiveDate) ?? [];
    datePoints.push(point);
    manualPointsByDate.set(point.effectiveDate, datePoints);
  }
  const authoritativeManualPointIds = new Set(
    [...manualPointsByDate.values()].flatMap((datePoints) => {
      const selected = selectAuthoritativeMetricPoint(datePoints);
      return selected ? [selected.id] : [];
    }),
  );
  return points.filter((point) =>
    !isManualSleepStageCorrection(point)
    || authoritativeManualPointIds.has(point.id)
  );
}

async function readProjectableSleepMetricSourcesByDate(input: {
  cutoffDate: string;
  points: readonly MetricPoint[];
  spec: HostedVaultShareDailyMetricProjectionSpec;
  vaultRoot: string;
}): Promise<Map<string, HostedVaultShareSleepMetricSource[]> | null> {
  const summaryMetricKey = input.spec.metricKey === "deep-sleep-minutes"
    ? "deepMinutes"
    : input.spec.metricKey === "rem-sleep-minutes"
      ? "remMinutes"
      : null;
  if (!summaryMetricKey) {
    return null;
  }

  const sourceHealth = await summarizeWearableSourceHealthRuntime(
    input.vaultRoot,
    { from: input.cutoffDate },
  );
  const providers = sourceHealth
    .filter((source) =>
      source.provider !== "unknown"
      && source.metricsContributed.includes(summaryMetricKey)
    )
    .sort((left, right) => left.provider.localeCompare(right.provider));

  const summariesByProvider = await Promise.all(providers.map(async (source) => ({
    source,
    summaries: await summarizeWearableSleepRuntime(input.vaultRoot, {
      from: input.cutoffDate,
      limit: HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW,
      providers: [source.provider],
    }),
  })));
  const sourcesByDate = new Map<string, HostedVaultShareSleepMetricSource[]>();

  for (const { source, summaries } of summariesByProvider) {
    const sourceKey = sanitizeProjectionSourceKey(source.provider);
    const sourceLabel = sanitizeProjectionSourceLabel(source.providerDisplayName);
    if (!sourceKey || !sourceLabel) {
      return null;
    }

    for (const summary of summaries) {
      const metric = summaryMetricKey === "deepMinutes"
        ? summary.deepMinutes
        : summary.remMinutes;
      const value = metric.selection.value;
      if (value === null) {
        continue;
      }
      if (
        !Number.isFinite(value)
        || value < input.spec.minValue
        || value > input.spec.maxValue
      ) {
        return null;
      }
      const unit = sanitizeProjectionUnit(metric.selection.unit);
      if (
        input.spec.expectedUnit !== undefined
        && unit !== input.spec.expectedUnit
      ) {
        return null;
      }
      const recordedAt = metric.selection.recordedAt;
      if (recordedAt !== null && !isStrictIsoDateTime(recordedAt)) {
        return null;
      }

      const sources = sourcesByDate.get(summary.date) ?? [];
      if (sources.some((candidate) => candidate.source === sourceKey)) {
        return null;
      }
      sources.push({
        label: sourceLabel,
        recordedAt,
        source: sourceKey,
        unit,
        value,
      });
      sourcesByDate.set(summary.date, sources);
    }
  }

  const manualPoints = input.points.filter(isManualSleepStageCorrection);
  const manualSeries = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: input.cutoffDate,
    grain: "day",
    metricKey: input.spec.metricKey,
    points: manualPoints,
    statistic: "value",
  });
  const manualPointsById = new Map(manualPoints.map((point) => [point.id, point]));

  for (const row of manualSeries.rows) {
    const value = row.value;
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || value < input.spec.minValue
      || value > input.spec.maxValue
    ) {
      sourcesByDate.delete(row.date);
      continue;
    }
    const unit = sanitizeProjectionUnit(row.unit);
    if (
      input.spec.expectedUnit !== undefined
      && unit !== input.spec.expectedUnit
    ) {
      sourcesByDate.delete(row.date);
      continue;
    }
    const pointIds = row.pointIds ?? [];
    const selectedPoint = pointIds.length === 1
      ? manualPointsById.get(pointIds[0] ?? "")
      : undefined;
    if (!selectedPoint) {
      sourcesByDate.delete(row.date);
      continue;
    }
    const recordedAt = selectedPoint.recordedAt;
    if (recordedAt !== null && !isStrictIsoDateTime(recordedAt)) {
      sourcesByDate.delete(row.date);
      continue;
    }

    const sources = sourcesByDate.get(row.date) ?? [];
    if (sources.some((candidate) => candidate.source === "manual")) {
      return null;
    }
    sources.push({
      label: "Manual",
      recordedAt,
      source: "manual",
      unit,
      value,
    });
    sourcesByDate.set(row.date, sources);
  }

  for (const sources of sourcesByDate.values()) {
    sources.sort((left, right) => left.source.localeCompare(right.source));
  }
  return sourcesByDate;
}

export async function readProjectableWorkoutDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const points = await listMetricPointsBatch(vaultRoot, [
    {
      from: cutoffDate,
      limit: null,
      metricKey: "workout-count",
    },
    {
      from: cutoffDate,
      limit: null,
      metricKey: "workout-minutes",
    },
  ]);
  const countSeries = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: cutoffDate,
    grain: "day",
    metricKey: "workout-count",
    points,
    statistic: "value",
  });
  const minuteSeries = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: cutoffDate,
    grain: "day",
    metricKey: "workout-minutes",
    points,
    statistic: "value",
  });
  return selectProjectableWorkoutDays({
    countRows: countSeries.rows,
    minuteRows: minuteSeries.rows,
    nowMs,
  });
}

export async function readProjectableWorkoutsDays(
  vaultRoot: string,
  context?: HostedVaultShareProjectionReadContext,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const calendarCurrentDate = readTimeZoneDate(
    nowMs,
    HOSTED_VAULT_SHARE_WORKOUT_CALENDAR_TIME_ZONE,
  );
  if (!calendarCurrentDate) {
    return [];
  }
  // The oldest emitted UTC-12 date can begin on the preceding UTC date in a
  // positive-offset event zone. Read that one preceding date, then let the
  // event-zone conversion and fixed eight-date producer window filter it.
  const sourceReadFromDate = shiftIsoDate(
    calendarCurrentDate,
    -HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW,
  );
  if (!sourceReadFromDate) {
    return [];
  }
  const [activityRead, vaultTimeZone] = await Promise.all([
    readProjectableActivitySessionRows(vaultRoot, sourceReadFromDate, context),
    readProjectableVaultTimeZone(vaultRoot),
  ]);
  if (!activityRead.complete) {
    return [];
  }
  return selectProjectableWorkoutsDays({
    nowMs,
    rows: activityRead.rows,
    vaultTimeZone,
  });
}

async function readProjectableVaultTimeZone(
  vaultRoot: string,
): Promise<string | null> {
  try {
    const rawMetadata: unknown = JSON.parse(
      await readFile(path.join(vaultRoot, VAULT_LAYOUT.metadata), "utf8"),
    );
    const validation = validateCurrentVaultMetadata(rawMetadata, {
      relativePath: VAULT_LAYOUT.metadata,
    });
    return validation.success
      ? normalizeIanaTimeZone(validation.data.metadata.timezone)
      : null;
  } catch {
    return null;
  }
}

export async function readProjectableActivityMinutesDays(
  vaultRoot: string,
  spec: HostedVaultShareActivityMinutesProjectionSpec,
  context?: HostedVaultShareProjectionReadContext,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const activityRead = await readProjectableActivitySessionRows(
    vaultRoot,
    cutoffDate,
    context,
  );
  return selectProjectableActivityMinutesDays({ nowMs, rows: activityRead.rows, spec });
}

export async function readProjectableActivityDistanceDays(
  vaultRoot: string,
  spec: HostedVaultShareActivityDistanceProjectionSpec,
  context?: HostedVaultShareProjectionReadContext,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const activityRead = await readProjectableActivitySessionRows(
    vaultRoot,
    cutoffDate,
    context,
  );
  return selectProjectableActivityDistanceDays({ nowMs, rows: activityRead.rows, spec });
}

export async function readProjectableActivitySessionCountDays(
  vaultRoot: string,
  spec: HostedVaultShareActivitySessionCountProjectionSpec,
  context?: HostedVaultShareProjectionReadContext,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const activityRead = await readProjectableActivitySessionRows(
    vaultRoot,
    cutoffDate,
    context,
  );
  return selectProjectableActivitySessionCountDays({
    nowMs,
    rows: activityRead.rows,
    spec,
  });
}

export async function readProjectableHeartRateZoneDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const points = await listMetricPointsBatch(
    vaultRoot,
    HEART_RATE_ZONE_MINUTES_METRIC_KEYS.map((metricKey) => ({
      from: cutoffDate,
      limit: null,
      metricKey,
    })),
  );
  const rows = HEART_RATE_ZONE_MINUTES_METRIC_KEYS.flatMap((metricKey) =>
    selectMetricSeries({
      duplicatePolicy: "selection-policy",
      from: cutoffDate,
      grain: "day",
      metricKey,
      points,
      statistic: "value",
    }).rows
  );
  return selectProjectableHeartRateZoneDays(rows, nowMs);
}

/**
 * Pure selection step: keep the most recent fully-timed nights, capped at the projection
 * window, and drop nights older than the recency cutoff so members with only stale sleep
 * data never offer undeliverable records. Each night maps to one delivery record whose
 * recordKey is the night date and whose occurredAt is the night date at UTC midnight —
 * occurredAt becomes plaintext mailbox metadata on the destination side, so it must
 * disclose nothing beyond the night date the dedupe key already carries; the exact
 * sleep timestamps stay inside the encrypted payload.
 */
export function selectProjectableSleepNights(
  summaries: readonly Pick<ProjectedWearableSleepSummary, "date" | "sleepEndAt" | "sleepStartAt">[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS,
  );
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const summary of summaries) {
    if (typeof summary.sleepStartAt !== "string" || typeof summary.sleepEndAt !== "string") {
      continue;
    }

    const nightMs = Date.parse(`${summary.date}T00:00:00.000Z`);
    if (!Number.isFinite(nightMs) || nightMs < cutoffMs) {
      continue;
    }

    records.push({
      data: {
        date: summary.date,
        sleepEndAt: summary.sleepEndAt,
        sleepStartAt: summary.sleepStartAt,
      },
      occurredAt: `${summary.date}T00:00:00.000Z`,
      recordKey: summary.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableDailyMetricDays(
  points: readonly DailyMetricProjectionPoint[],
  spec: HostedVaultShareDailyMetricProjectionSpec,
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const point of [...points].sort((left, right) => right.date.localeCompare(left.date))) {
    const dayMs = Date.parse(`${point.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }
    if (
      point.metricKey !== spec.metricKey
      || point.grain !== "day"
      || point.statistic !== "value"
    ) {
      continue;
    }

    const value = point.value;
    if (
      typeof value !== "number"
      || !Number.isFinite(value)
      || value < spec.minValue
      || value > spec.maxValue
    ) {
      continue;
    }

    const sources = spec.sourceMode === "all-public-sleep-sources"
      ? selectProjectableSleepMetricSources(point, value)
      : null;
    if (spec.sourceMode === "all-public-sleep-sources" && !sources) {
      continue;
    }
    const projectedAt = new Date(nowMs).toISOString();

    records.push({
      data: {
        date: point.date,
        metricKey: spec.metricKey,
        ...(spec.projectionKind === "activity-days.v0"
          ? {
              metricSemantics:
                HOSTED_VAULT_SHARE_BROAD_ACTIVITY_MINUTES_SEMANTICS,
            }
          : {}),
        ...(sources
          ? {
              projectedAt,
              sources,
              sourcesDisagree: sleepMetricSourcesDisagree(sources),
            }
          : {}),
        ...(point.provisional ? { provisional: true } : {}),
        unit: sanitizeProjectionUnit(point.unit),
        value,
      },
      occurredAt: `${point.date}T00:00:00.000Z`,
      recordKey: point.date,
      ...sourceRevisionField(
        sources
          ? deriveSourceAwareMetricSeriesPointSourceRevision(point, sources)
          : deriveMetricSeriesPointSourceRevision(point),
      ),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

function selectProjectableSleepMetricSources(
  point: DailyMetricProjectionPoint,
  selectedValue: number,
): HostedVaultShareSleepMetricSource[] | null {
  const sourceRows = point.sources ?? [];
  const wearableSourceCount = sourceRows.filter((source) => source.source !== "manual").length;
  if (
    sourceRows.length === 0
    || sourceRows.length > HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_SOURCES
    || wearableSourceCount > HOSTED_VAULT_SHARE_SLEEP_METRIC_MAX_WEARABLE_SOURCES
  ) {
    return null;
  }

  const selectedUnit = sanitizeProjectionUnit(point.unit);
  const exactMatches = sourceRows.filter((source) =>
    source.value === selectedValue && source.unit === selectedUnit
  );
  const labelMatches = exactMatches.filter((source) =>
    typeof point.sourceLabel === "string"
    && source.label === point.sourceLabel.trim()
  );
  const selectedSource = labelMatches.length === 1
    ? labelMatches[0]
    : exactMatches.length === 1
      ? exactMatches[0]
      : null;
  if (!selectedSource) {
    return null;
  }

  return sourceRows.map(({ selected: _selected, ...source }) => ({
    ...source,
    ...(source.source === selectedSource.source ? { selected: true as const } : {}),
  }));
}

function sleepMetricSourcesDisagree(
  sources: readonly HostedVaultShareSleepMetricSource[],
): boolean {
  const first = sources[0];
  return first
    ? sources.some((source) =>
        source.unit !== first.unit || source.value !== first.value
      )
    : false;
}

export async function readProjectableMealNutritionDays(
  vaultRoot: string,
  spec: HostedVaultShareDailyMetricProjectionSpec,
  context?: HostedVaultShareProjectionReadContext,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = projectionCutoffDate(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const summary = await readProjectableMealNutritionTotals(vaultRoot, cutoffDate, context);
  return selectProjectableMealNutritionDays(summary.days, spec, nowMs);
}

async function readProjectableMealNutritionTotals(
  vaultRoot: string,
  cutoffDate: string,
  context?: HostedVaultShareProjectionReadContext,
): Promise<MealNutritionTotalsResult> {
  if (context) {
    const cacheKey = `${vaultRoot}\u0000${cutoffDate}`;
    context.mealNutritionTotalsByVaultAndCutoff ??= new Map();
    const cached = context.mealNutritionTotalsByVaultAndCutoff.get(cacheKey);
    if (cached) {
      return cached;
    }
    const read = readProjectableMealNutritionTotals(vaultRoot, cutoffDate);
    context.mealNutritionTotalsByVaultAndCutoff.set(cacheKey, read);
    return read;
  }

  return readMealNutritionTotals(vaultRoot, { from: cutoffDate });
}

/**
 * Pure selection over per-day meal nutrition totals. Fails closed on partial
 * nutrition: a day is emitted only when every meal on that day contributed the
 * spec's nutrient, so a shared total is never a silent undercount. A complete
 * true-zero day is real data and is still emitted. Day identity is the meal's
 * canonical vault-local date; the UTC-midnight occurredAt is transport identity
 * only and discloses nothing beyond the date the recordKey already carries.
 */
export function selectProjectableMealNutritionDays(
  days: readonly MealNutritionDayTotal[],
  spec: HostedVaultShareDailyMetricProjectionSpec,
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  if (spec.source.kind !== "meal-nutrition-total") {
    return [];
  }
  const totalKey = spec.source.totalKey;
  const cutoffMs = projectionCutoffMs(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const day of [...days].sort((left, right) => right.date.localeCompare(left.date))) {
    if (!isStrictIsoDate(day.date)) {
      continue;
    }
    const dayMs = Date.parse(`${day.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }

    const metric = day.totals[totalKey];
    if (metric.total === null || metric.mealCount !== day.mealCount) {
      continue;
    }

    const value = metric.total;
    if (!Number.isFinite(value) || value < spec.minValue || value > spec.maxValue) {
      continue;
    }

    records.push({
      data: {
        date: day.date,
        metricKey: spec.metricKey,
        unit: spec.expectedUnit ?? null,
        value,
      },
      occurredAt: `${day.date}T00:00:00.000Z`,
      recordKey: day.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableWorkoutDays(
  input: {
    countRows: readonly WorkoutMetricProjectionRow[];
    minuteRows: readonly WorkoutMetricProjectionRow[];
    nowMs: number;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    input.nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const records: HostedVaultShareDeliveryRecord[] = [];
  const minuteRowsByDate = new Map(
    input.minuteRows
      .filter((row) =>
        row.metricKey === "workout-minutes"
        && row.grain === "day"
        && row.statistic === "value"
      )
      .map((row) => [row.date, row]),
  );

  for (const countRow of [...input.countRows].sort((left, right) => right.date.localeCompare(left.date))) {
    const dayMs = Date.parse(`${countRow.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }
    if (
      countRow.metricKey !== "workout-count"
      || countRow.grain !== "day"
      || countRow.statistic !== "value"
    ) {
      continue;
    }

    const minuteRow = minuteRowsByDate.get(countRow.date);
    if (!minuteRow || !sameMetricSeriesPointSourceOwner(countRow, minuteRow)) {
      continue;
    }

    const workoutCount = countRow.value;
    const workoutMinutes = minuteRow.value;
    if (
      typeof workoutCount !== "number"
      || typeof workoutMinutes !== "number"
      || !Number.isFinite(workoutCount)
      || !Number.isFinite(workoutMinutes)
      || !Number.isInteger(workoutCount)
      || workoutCount <= 0
      || workoutCount > 100
      || workoutMinutes < 0
      || workoutMinutes > DAY_MAX_MINUTES
    ) {
      continue;
    }

    records.push({
      data: {
        date: countRow.date,
        metricSemantics:
          HOSTED_VAULT_SHARE_CANONICAL_WORKOUT_DAY_SEMANTICS,
        workoutCount,
        workoutMinutes,
      },
      occurredAt: `${countRow.date}T00:00:00.000Z`,
      recordKey: countRow.date,
      ...sourceRevisionField(deriveCompositeMetricSeriesSourceRevision([countRow, minuteRow])),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableWorkoutsDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    vaultTimeZone: string | null;
  },
): HostedVaultShareDeliveryRecord[] {
  const vaultTimeZone = normalizeIanaTimeZone(input.vaultTimeZone);
  const candidatesByRow = new Map<
    ActivitySessionProjectionRow,
    ProjectableWorkoutCandidate
  >();

  for (const row of input.rows) {
    if (row.sourceKind !== "activity_session" || !row.isWorkout) {
      continue;
    }
    const startedAt = row.startedAt;
    if (typeof startedAt !== "string" || !isStrictIsoDateTime(startedAt)) {
      continue;
    }
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) {
      continue;
    }
    const timeZone = normalizeIanaTimeZone(row.timeZone) ?? vaultTimeZone;
    if (!timeZone) {
      return [];
    }

    const localStart = readProjectableWorkoutLocalStart(startedAt, timeZone);
    if (!localStart) {
      continue;
    }

    // A row without a specific activity kind still reached here through
    // positive workout evidence, so it is a real workout carrying only a
    // generic provider label. Keep it non-specific through dedupe: labelling it
    // now would stop it matching a specific copy of the same session, and both
    // copies would be published.
    const kind = normalizeActivityKindToken(row.activityKind ?? "");
    const minutes = row.durationMinutes;
    if (
      (kind !== null && kind.length > HOSTED_VAULT_SHARE_WORKOUT_KIND_MAX_LENGTH)
      || typeof minutes !== "number"
      || !Number.isFinite(minutes)
      || minutes <= 0
      || minutes > DAY_MAX_MINUTES
    ) {
      return [];
    }

    const projectionRow: ActivitySessionProjectionRow = {
      ...row,
      activityKind: kind,
      date: localStart.date,
      durationMinutes: minutes,
    };
    candidatesByRow.set(projectionRow, {
      row: projectionRow,
      startedAtMs,
      timeZone,
      workout: {
        // Only a row that survived dedupe without a specific kind is disclosed
        // generically; a specific copy of the same session wins above.
        kind: kind ?? HOSTED_VAULT_SHARE_WORKOUT_GENERIC_KIND,
        minutes,
        startLocalMs: localStart.localMs,
      },
    });
  }

  const dedupedCandidates: ProjectableWorkoutCandidate[] = [];
  for (const row of dedupeActivitySessionRows([...candidatesByRow.keys()])) {
    const candidate = candidatesByRow.get(row);
    if (candidate) {
      dedupedCandidates.push(candidate);
    }
  }

  // A date is complete only after it has ended in UTC-12, the last civil
  // timezone to leave it. This boundary is global and monotonic: changing a
  // member's declared timezone cannot reopen a result that was already final.
  const calendarCurrentDate = readTimeZoneDate(
    input.nowMs,
    HOSTED_VAULT_SHARE_WORKOUT_CALENDAR_TIME_ZONE,
  );
  if (!calendarCurrentDate) {
    return [];
  }
  const calendarClosedThroughDate = shiftIsoDate(calendarCurrentDate, -1);
  if (!calendarClosedThroughDate) {
    return [];
  }
  const windowDates = readRecentIsoDates(
    calendarCurrentDate,
    HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW,
  );
  if (windowDates.length !== HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
    return [];
  }
  const windowDateSet = new Set(windowDates);

  const groups = new Map<string, ProjectableWorkoutCandidate[]>();
  for (const candidate of dedupedCandidates) {
    if (!windowDateSet.has(candidate.row.date)) {
      continue;
    }
    const group = groups.get(candidate.row.date) ?? [];
    group.push(candidate);
    if (group.length > HOSTED_VAULT_SHARE_WORKOUTS_MAX_PER_DAY) {
      return [];
    }
    groups.set(candidate.row.date, group);
  }

  return windowDates.map((date): HostedVaultShareDeliveryRecord => {
    const candidates = groups.get(date) ?? [];
    const workouts = candidates
      .map((candidate) => candidate.workout)
      .sort(compareHostedVaultShareWorkouts);

    return {
      data: {
        calendarClosedThroughDate,
        date,
        timeSemantics: HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
        workouts,
      },
      occurredAt: `${date}T00:00:00.000Z`,
      recordKey: date,
      ...sourceRevisionField(
        deriveWorkoutsSourceRevision({
          calendarClosedThroughDate,
          candidates,
          date,
          workouts,
        }),
      ),
    };
  });
}

function readTimeZoneDate(
  timestamp: number | string,
  timeZone: string,
): string | null {
  try {
    const dayKey = formatTimeZoneDateTimeParts(timestamp, timeZone).dayKey;
    return isStrictIsoDate(dayKey) ? dayKey : null;
  } catch {
    return null;
  }
}

function readRecentIsoDates(currentDate: string, count: number): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = shiftIsoDate(currentDate, -offset);
    if (!date) {
      return [];
    }
    dates.push(date);
  }
  return dates;
}

function shiftIsoDate(date: string, offsetDays: number): string | null {
  if (!isStrictIsoDate(date) || !Number.isInteger(offsetDays)) {
    return null;
  }
  const dateMs = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(dateMs)) {
    return null;
  }
  const shiftedDate = new Date(dateMs + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return isStrictIsoDate(shiftedDate) ? shiftedDate : null;
}

function compareHostedVaultShareWorkouts(
  left: HostedVaultShareWorkout,
  right: HostedVaultShareWorkout,
): number {
  return left.startLocalMs - right.startLocalMs
    || left.kind.localeCompare(right.kind)
    || left.minutes - right.minutes;
}

function readProjectableWorkoutLocalStart(
  startedAt: string,
  timeZone: string,
): { date: string; localMs: number } | null {
  try {
    const parts = formatTimeZoneDateTimeParts(startedAt, timeZone);
    const timestampMs = Date.parse(startedAt);
    if (!Number.isFinite(timestampMs)) {
      return null;
    }
    const millisecond = ((timestampMs % 1_000) + 1_000) % 1_000;
    const localMs = (
      ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1_000
    ) + millisecond;
    return Number.isInteger(localMs) && localMs >= 0 && localMs < DAY_MS
      ? { date: parts.dayKey, localMs }
      : null;
  } catch {
    return null;
  }
}

export function selectProjectableActivityMinutesDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    spec: HostedVaultShareActivityMinutesProjectionSpec;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    input.nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const groups = new Map<string, {
    date: string;
    rows: ActivitySessionProjectionRow[];
    sessionCount: number;
    sessionMinutes: number;
  }>();

  const projectableRows = input.rows.filter((row) =>
    isProjectableActivitySessionRow(row, input.spec.activityKind, cutoffMs)
    && isProjectableActivitySessionDurationRow(row)
  );
  for (const row of dedupeActivitySessionRows(projectableRows, input.spec.activityKind)) {
    const durationMinutes = row.durationMinutes ?? null;
    if (durationMinutes === null) {
      continue;
    }
    const group = groups.get(row.date) ?? {
      date: row.date,
      rows: [],
      sessionCount: 0,
      sessionMinutes: 0,
    };
    group.rows.push(row);
    group.sessionCount += 1;
    group.sessionMinutes += durationMinutes;
    groups.set(row.date, group);
  }

  const records: HostedVaultShareDeliveryRecord[] = [];
  for (const group of [...groups.values()].sort((left, right) => right.date.localeCompare(left.date))) {
    if (
      group.sessionCount <= 0
      || group.sessionCount > 100
      || group.sessionMinutes <= 0
      || group.sessionMinutes > DAY_MAX_MINUTES
    ) {
      continue;
    }

    records.push({
      data: {
        activityKind: input.spec.activityKind,
        date: group.date,
        sessionCount: group.sessionCount,
        sessionMinutes: group.sessionMinutes,
      },
      occurredAt: `${group.date}T00:00:00.000Z`,
      recordKey: group.date,
      ...sourceRevisionField(deriveCompositeMetricSeriesSourceRevision(group.rows)),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableActivityDistanceDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    spec: HostedVaultShareActivityDistanceProjectionSpec;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    input.nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const groups = new Map<string, {
    date: string;
    hasIncompleteDistance: boolean;
    rows: ActivitySessionProjectionRow[];
    sessionCount: number;
    sessionDistanceMeters: number;
  }>();

  const projectableRows = input.rows.filter((row) =>
    isProjectableActivitySessionRow(row, input.spec.activityKind, cutoffMs)
  );
  for (const row of dedupeActivitySessionRows(
    projectableRows,
    input.spec.activityKind,
    choosePreferredActivitySessionDistanceRow,
  )) {
    const hasDistance = isProjectableActivitySessionDistanceRow(row);
    const distanceMeters = hasDistance ? row.distanceMeters ?? 0 : 0;
    const group = groups.get(row.date) ?? {
      date: row.date,
      hasIncompleteDistance: false,
      rows: [],
      sessionCount: 0,
      sessionDistanceMeters: 0,
    };
    group.rows.push(row);
    group.sessionCount += 1;
    group.hasIncompleteDistance ||= !hasDistance;
    group.sessionDistanceMeters += distanceMeters;
    groups.set(row.date, group);
  }

  const records: HostedVaultShareDeliveryRecord[] = [];
  for (const group of [...groups.values()].sort((left, right) => right.date.localeCompare(left.date))) {
    if (
      group.sessionCount <= 0
      || group.sessionCount > DAY_MAX_SESSIONS
      || group.hasIncompleteDistance
      || group.sessionDistanceMeters <= 0
      || group.sessionDistanceMeters > DAY_MAX_DISTANCE_METERS
    ) {
      continue;
    }

    records.push({
      data: {
        activityKind: input.spec.activityKind,
        date: group.date,
        sessionCount: group.sessionCount,
        sessionDistanceMeters: group.sessionDistanceMeters,
      },
      occurredAt: `${group.date}T00:00:00.000Z`,
      recordKey: group.date,
      ...sourceRevisionField(deriveCompositeMetricSeriesSourceRevision(group.rows)),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableActivitySessionCountDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    spec: HostedVaultShareActivitySessionCountProjectionSpec;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    input.nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const groups = new Map<string, {
    date: string;
    rows: ActivitySessionProjectionRow[];
    sessionCount: number;
  }>();

  const projectableRows = input.rows.filter((row) =>
    isProjectableActivitySessionRow(row, input.spec.activityKind, cutoffMs)
  );
  for (const row of dedupeActivitySessionRows(projectableRows, input.spec.activityKind)) {
    const group = groups.get(row.date) ?? {
      date: row.date,
      rows: [],
      sessionCount: 0,
    };
    group.rows.push(row);
    group.sessionCount += 1;
    groups.set(row.date, group);
  }

  const records: HostedVaultShareDeliveryRecord[] = [];
  for (const group of [...groups.values()].sort((left, right) => right.date.localeCompare(left.date))) {
    if (group.sessionCount <= 0 || group.sessionCount > DAY_MAX_SESSIONS) {
      continue;
    }

    records.push({
      data: {
        activityKind: input.spec.activityKind,
        date: group.date,
        sessionCount: group.sessionCount,
      },
      occurredAt: `${group.date}T00:00:00.000Z`,
      recordKey: group.date,
      ...sourceRevisionField(deriveCompositeMetricSeriesSourceRevision(group.rows)),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableHeartRateZoneDays(
  points: readonly HeartRateZoneMetricProjectionRow[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs = projectionCutoffMs(
    nowMs,
    HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS,
  );
  const records: HostedVaultShareDeliveryRecord[] = [];

  const zonesBySourceDay = new Map<string, {
    date: string;
    points: MetricSourceRevisionPoint[];
    sourceOwnerKey: string;
    zones: {
      durationMinutes: number;
      label?: string;
      zone: number;
    }[];
  }>();
  for (const point of points) {
    if (point.grain !== "day" || point.statistic !== "value") {
      continue;
    }
    const zone = parseHeartRateZoneMetricKey(point.metricKey);
    if (zone === null) {
      continue;
    }
    const durationMinutes = point.value;
    if (
      typeof durationMinutes !== "number"
      || !Number.isFinite(durationMinutes)
      || durationMinutes < 0
      || durationMinutes > DAY_MAX_MINUTES
    ) {
      continue;
    }
    const sourceOwnerKey = metricSeriesPointSourceOwnerKey(point);
    if (!sourceOwnerKey) {
      continue;
    }
    const label = sanitizeProjectionText(readContextString(point.context, "zoneLabel"), 80);
    const groupKey = `${point.date}\u0000${sourceOwnerKey}`;
    const group = zonesBySourceDay.get(groupKey) ?? {
      date: point.date,
      points: [],
      sourceOwnerKey,
      zones: [],
    };
    group.points.push(point);
    group.zones.push({
      ...(label === undefined ? {} : { label }),
      durationMinutes,
      zone,
    });
    zonesBySourceDay.set(groupKey, group);
  }

  for (const group of [...zonesBySourceDay.values()].sort((left, right) =>
    right.date.localeCompare(left.date) || left.sourceOwnerKey.localeCompare(right.sourceOwnerKey)
  )) {
    const date = group.date;
    const dayMs = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }

    const zones = group.zones
      .sort((left, right) => left.zone - right.zone || (left.label ?? "").localeCompare(right.label ?? ""))
      .slice(0, 20);

    if (zones.length === 0) {
      continue;
    }

    records.push({
      data: {
        date,
        zones,
      },
      occurredAt: `${date}T00:00:00.000Z`,
      recordKey: date,
      ...sourceRevisionField(deriveCompositeMetricSeriesSourceRevision(group.points)),
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

async function readProjectableActivitySessionRows(
  vaultRoot: string,
  cutoffDate: string,
  context?: HostedVaultShareProjectionReadContext,
): Promise<ActivitySessionProjectionReadResult> {
  if (context) {
    const cacheKey = `${vaultRoot}\u0000${cutoffDate}`;
    context.activityRowsByVaultAndCutoff ??= new Map();
    const cached = context.activityRowsByVaultAndCutoff.get(cacheKey);
    if (cached) {
      return cached;
    }

    const read = readProjectableActivitySessionRows(vaultRoot, cutoffDate);
    context.activityRowsByVaultAndCutoff.set(cacheKey, read);
    return read;
  }

  const entities = await listCanonicalEntities(vaultRoot, {
    family: "event",
    from: cutoffDate,
    kinds: ["activity_session", "intervention_session"],
    limit: ACTIVITY_SESSION_SOURCE_ROW_QUERY_LIMIT,
  });
  if (entities.length > ACTIVITY_SESSION_SOURCE_ROW_LIMIT) {
    return { complete: false, rows: [] };
  }

  const rows: ActivitySessionProjectionRow[] = [];

  for (const entity of entities) {
    const row = toActivitySessionProjectionRow(entity);
    if (row) {
      // Each selector applies its own date cutoff. The workouts projection
      // first re-derives the local date from the selected timezone.
      rows.push(row);
    }
  }

  return { complete: true, rows };
}

function toActivitySessionProjectionRow(
  entity: CanonicalEntity,
): ActivitySessionProjectionRow | null {
  if (
    entity.family !== "event"
    || (entity.kind !== "activity_session" && entity.kind !== "intervention_session")
  ) {
    return null;
  }
  if (
    entity.kind === "intervention_session"
    && isNonProjectableInterventionSessionStatus(
      entity.attributes.sessionStatus ?? entity.attributes.status,
    )
  ) {
    return null;
  }

  const rawDurationMinutes = readFiniteNumber(entity.attributes.durationMinutes);
  const durationMinutes =
    rawDurationMinutes !== null
    && rawDurationMinutes > 0
    && rawDurationMinutes <= DAY_MAX_MINUTES
      ? rawDurationMinutes
      : null;
  const timing = readCanonicalWorkoutTiming(entity);
  const date = entity.kind === "intervention_session"
    ? readInterventionSessionDate(entity)
    : readActivitySessionDate(entity, timing.startedAt);
  if (!date) {
    return null;
  }

  const observedAt = readOptionalString(entity.attributes.recordedAt)
    ?? entity.occurredAt
    ?? undefined;
  const distanceMeters = readActivitySessionDistanceMeters(entity);

  return {
    activityKind: readActivitySessionKind(entity),
    date,
    ...(distanceMeters === null ? {} : { distanceMeters }),
    ...(durationMinutes === null ? {} : { durationMinutes }),
    endedAt: timing.endedAt,
    isWorkout: entity.kind === "activity_session" && hasPositiveWorkoutEvidence(entity),
    observedAt,
    pointIds: [`event:${entity.entityId}`],
    recordIds: [entity.entityId],
    sourceFamily: "event",
    sourceKind: entity.kind,
    startedAt: timing.startedAt,
    timeZone: readOptionalString(entity.attributes.timeZone),
  };
}

function hasPositiveWorkoutEvidence(entity: CanonicalEntity): boolean {
  if (readOptionalString(entity.attributes.source)?.toLowerCase() !== "device") {
    return true;
  }

  const externalRef = readRecord(entity.attributes.externalRef);
  const system = readOptionalString(externalRef?.system);
  const resourceType = normalizeActivityKindToken(
    readOptionalString(externalRef?.resourceType),
  );
  if (!system || !resourceType) {
    return false;
  }

  return resourceType === "activity"
    || resourceType.endsWith("-activity")
    || resourceType === "activity-session"
    || resourceType.endsWith("-activity-session")
    || resourceType.split("-").some((token) => token === "workout" || token === "workouts");
}

function readCanonicalWorkoutTiming(
  entity: CanonicalEntity,
): { endedAt: string | null; startedAt: string | null } {
  const workout = readRecord(entity.attributes.workout);
  return {
    endedAt: readOptionalString(workout?.endedAt)
      ?? readOptionalString(entity.attributes.endAt),
    startedAt: readOptionalString(workout?.startedAt)
      ?? readOptionalString(entity.attributes.startAt)
      ?? entity.occurredAt
      ?? null,
  };
}

function isNonProjectableInterventionSessionStatus(value: unknown): boolean {
  const status = readOptionalString(value)?.toLowerCase();
  return status === "missed" || status === "skipped";
}

function readActivitySessionDate(
  entity: CanonicalEntity,
  startedAt: string | null,
): string | null {
  for (const value of [
    entity.date,
    readOptionalString(entity.attributes.dayKey),
    readOptionalString(entity.attributes.date),
  ]) {
    if (value && isStrictIsoDate(value)) {
      return value;
    }
  }

  for (const value of [startedAt, entity.occurredAt]) {
    const date = readIsoTimestampDate(value);
    if (date) {
      return date;
    }
  }

  return null;
}

function readInterventionSessionDate(entity: CanonicalEntity): string | null {
  for (const value of [
    readOptionalString(entity.attributes.scheduledLocalDate),
    readOptionalString(entity.attributes.sessionLocalDate),
    entity.date,
    readOptionalString(entity.attributes.date),
  ]) {
    if (value && isStrictIsoDate(value)) {
      return value;
    }
  }

  return readIsoTimestampDate(entity.occurredAt);
}

function readActivitySessionKind(entity: CanonicalEntity): string | null {
  return resolveAdherenceObservationActivityKind({
    attributes: entity.attributes as Record<string, unknown>,
  });
}

function readActivitySessionDistanceMeters(entity: CanonicalEntity): number | null {
  const distanceMeters = readFiniteNumber(entity.attributes.distanceMeters);
  if (distanceMeters !== null) {
    return normalizeActivitySessionDistanceMeters(distanceMeters);
  }

  const distanceKm = readFiniteNumber(entity.attributes.distanceKm);
  if (distanceKm !== null) {
    return normalizeActivitySessionDistanceMeters(distanceKm * 1_000);
  }

  return null;
}

function normalizeActivitySessionDistanceMeters(value: number): number | null {
  const distanceMeters = Math.round(value);
  if (
    !Number.isInteger(distanceMeters)
    || distanceMeters < 0
    || distanceMeters > DAY_MAX_DISTANCE_METERS
  ) {
    return null;
  }
  return distanceMeters;
}

function isProjectableActivitySessionRow(
  row: ActivitySessionProjectionRow,
  activityKind: string,
  cutoffMs: number,
): boolean {
  const dayMs = Date.parse(`${row.date}T00:00:00.000Z`);
  return Number.isFinite(dayMs)
    && dayMs >= cutoffMs
    && activityTextMatchesKind(row.activityKind, activityKind);
}

function isProjectableActivitySessionDurationRow(
  row: ActivitySessionProjectionRow,
): boolean {
  return typeof row.durationMinutes === "number"
    && Number.isFinite(row.durationMinutes)
    && row.durationMinutes > 0
    && row.durationMinutes <= DAY_MAX_MINUTES;
}

function isProjectableActivitySessionDistanceRow(
  row: ActivitySessionProjectionRow,
): boolean {
  const distanceMeters = row.distanceMeters;
  return Number.isInteger(distanceMeters)
    && distanceMeters !== null
    && distanceMeters !== undefined
    && distanceMeters > 0
    && distanceMeters <= DAY_MAX_DISTANCE_METERS;
}

function dedupeActivitySessionRows(
  rows: readonly ActivitySessionProjectionRow[],
  activityKind?: string,
  choosePreferred: (
    left: ActivitySessionProjectionRow,
    right: ActivitySessionProjectionRow,
  ) => ActivitySessionProjectionRow = choosePreferredActivitySessionRow,
): ActivitySessionProjectionRow[] {
  const deduped: ActivitySessionProjectionRow[] = [];
  const exactDedupeIndexes = new Map<string, number>();

  for (const row of rows) {
    const key = activitySessionRowDedupeKey(row, activityKind);
    const exactDuplicateIndex = exactDedupeIndexes.get(key);
    if (exactDuplicateIndex !== undefined) {
      deduped[exactDuplicateIndex] = choosePreferred(
        deduped[exactDuplicateIndex],
        row,
      );
      continue;
    }

    const duplicateIndex = deduped.findIndex((existing) =>
      activitySessionRowsOverlap(existing, row, activityKind)
    );
    if (duplicateIndex >= 0) {
      deduped[duplicateIndex] = choosePreferred(
        deduped[duplicateIndex],
        row,
      );
      exactDedupeIndexes.set(key, duplicateIndex);
      continue;
    }

    exactDedupeIndexes.set(key, deduped.length);
    deduped.push(row);
  }

  return deduped;
}

function activitySessionRowDedupeKey(
  row: ActivitySessionProjectionRow,
  activityKind?: string,
): string {
  const dedupeActivityKind = activityKind ?? row.activityKind;
  if (row.startedAt || row.endedAt) {
    return JSON.stringify({
      activityKind: dedupeActivityKind,
      date: row.date,
      endedAt: row.endedAt ?? null,
      startedAt: row.startedAt ?? null,
    });
  }

  return metricSeriesPointSourceOwnerKey(row)
    ?? JSON.stringify({
      activityKind: dedupeActivityKind,
      date: row.date,
      pointIds: sortedStrings(row.pointIds ?? []),
    });
}

function activitySessionRowsOverlap(
  left: ActivitySessionProjectionRow,
  right: ActivitySessionProjectionRow,
  activityKind?: string,
): boolean {
  if (left.date !== right.date) {
    return false;
  }
  if (
    activityKind === undefined
    && !activitySessionRowsHaveEquivalentKinds(left, right)
  ) {
    return false;
  }

  const leftWindow = activitySessionRowWindow(left);
  const rightWindow = activitySessionRowWindow(right);
  if (!leftWindow || !rightWindow) {
    return false;
  }

  const overlapMs =
    Math.min(leftWindow.endMs, rightWindow.endMs)
    - Math.max(leftWindow.startMs, rightWindow.startMs);
  if (overlapMs <= 0) {
    return false;
  }

  return overlapMs
    / Math.min(leftWindow.durationMs, rightWindow.durationMs)
    >= ACTIVITY_SESSION_DUPLICATE_MIN_OVERLAP_RATIO;
}

function activitySessionRowsHaveEquivalentKinds(
  left: ActivitySessionProjectionRow,
  right: ActivitySessionProjectionRow,
): boolean {
  if (left.activityKind === right.activityKind) {
    return true;
  }
  if (!left.activityKind || !right.activityKind) {
    // A row with no specific kind carries no evidence that it is a *different*
    // activity, so an overlapping specific copy of the same session may still
    // be the same workout. Only the workouts projection supplies such rows;
    // the activity selectors filter to an exact kind before deduping.
    return true;
  }
  return activityTextMatchesKind(left.activityKind, right.activityKind)
    || activityTextMatchesKind(right.activityKind, left.activityKind);
}

function activitySessionRowWindow(
  row: ActivitySessionProjectionRow,
): { durationMs: number; endMs: number; startMs: number } | null {
  const startMs = parseOptionalTimestampMs(row.startedAt);
  if (startMs === null) {
    return null;
  }
  if (typeof row.durationMinutes !== "number") {
    return null;
  }
  const explicitEndMs = parseOptionalTimestampMs(row.endedAt);
  const durationMs = row.durationMinutes * 60 * 1000;
  const endMs = explicitEndMs ?? startMs + durationMs;
  if (
    !Number.isFinite(durationMs)
    || durationMs <= 0
    || !Number.isFinite(endMs)
    || endMs <= startMs
  ) {
    return null;
  }
  return { durationMs: endMs - startMs, endMs, startMs };
}

function choosePreferredActivitySessionRow(
  left: ActivitySessionProjectionRow,
  right: ActivitySessionProjectionRow,
): ActivitySessionProjectionRow {
  // A specific activity kind is stronger evidence than a provider's generic
  // label, so the named copy of a duplicated session wins before any other
  // ranking.
  if (Boolean(left.activityKind) !== Boolean(right.activityKind)) {
    return left.activityKind ? left : right;
  }

  const completenessDifference =
    activitySessionRowCompletenessScore(right)
    - activitySessionRowCompletenessScore(left);
  if (completenessDifference > 0) {
    return right;
  }
  if (completenessDifference < 0) {
    return left;
  }

  const observedDifference =
    (parseOptionalTimestampMs(right.observedAt) ?? 0)
    - (parseOptionalTimestampMs(left.observedAt) ?? 0);
  return observedDifference > 0 ? right : left;
}

function choosePreferredActivitySessionDistanceRow(
  left: ActivitySessionProjectionRow,
  right: ActivitySessionProjectionRow,
): ActivitySessionProjectionRow {
  const leftHasDistance = isProjectableActivitySessionDistanceRow(left);
  const rightHasDistance = isProjectableActivitySessionDistanceRow(right);
  if (leftHasDistance && !rightHasDistance) {
    return left;
  }
  if (rightHasDistance && !leftHasDistance) {
    return right;
  }
  return choosePreferredActivitySessionRow(left, right);
}

function activitySessionRowCompletenessScore(row: ActivitySessionProjectionRow): number {
  return (parseOptionalTimestampMs(row.startedAt) === null ? 0 : 1)
    + (parseOptionalTimestampMs(row.endedAt) === null ? 0 : 1);
}

function sameMetricSeriesPointSourceOwner(
  left: MetricSourceOwnerPoint,
  right: MetricSourceOwnerPoint,
): boolean {
  const leftKey = metricSeriesPointSourceOwnerKey(left);
  return leftKey !== null && leftKey === metricSeriesPointSourceOwnerKey(right);
}

function metricSeriesPointSourceOwnerKey(
  point: MetricSourceOwnerPoint,
): string | null {
  const recordIds = sortedStrings(point.recordIds ?? []);
  if (recordIds.length === 0) {
    return null;
  }

  return JSON.stringify({
    recordIds,
    sourceFamily: point.sourceFamily ?? null,
    sourceKind: point.sourceKind ?? null,
  });
}

function deriveMetricSeriesPointSourceRevision(
  point: MetricSourceRevisionPoint,
): string | undefined {
  const ownerKey = metricSeriesPointSourceOwnerKey(point);
  if (!ownerKey) {
    return undefined;
  }

  return hashOpaqueSourceRevision({
    observedAt: point.observedAt ?? null,
    ownerKey,
    pointIds: sortedStrings(point.pointIds ?? []),
  });
}

function deriveSourceAwareMetricSeriesPointSourceRevision(
  point: MetricSourceRevisionPoint,
  sources: readonly HostedVaultShareSleepMetricSource[],
): string | undefined {
  const canonicalRevision = deriveMetricSeriesPointSourceRevision(point);
  if (!canonicalRevision) {
    return undefined;
  }
  return hashOpaqueSourceRevision({
    canonicalRevision,
    sources: sources.map((source) => ({
      recordedAt: source.recordedAt,
      source: source.source,
      unit: source.unit,
      value: source.value,
    })),
  });
}

function deriveCompositeMetricSeriesSourceRevision(
  points: readonly MetricSourceRevisionPoint[],
): string | undefined {
  const revisions = points.map(deriveMetricSeriesPointSourceRevision);
  if (revisions.some((revision) => !revision)) {
    return undefined;
  }

  return hashOpaqueSourceRevision({ revisions: revisions.sort() });
}

function deriveWorkoutsSourceRevision(input: {
  calendarClosedThroughDate: string;
  candidates: readonly ProjectableWorkoutCandidate[];
  date: string;
  workouts: readonly HostedVaultShareWorkout[];
}): string | undefined {
  if (input.candidates.length === 0) {
    return undefined;
  }
  const revisions = input.candidates.map((candidate) =>
    deriveMetricSeriesPointSourceRevision(candidate.row)
  );
  if (revisions.some((revision) => !revision)) {
    return undefined;
  }

  return hashOpaqueSourceRevision({
    calendarClosedThroughDate: input.calendarClosedThroughDate,
    date: input.date,
    projectionKind: "workouts.v0",
    revisions: revisions.sort(),
    timeSemantics: HOSTED_VAULT_SHARE_WORKOUT_TIME_SEMANTICS,
    workouts: input.workouts,
  });
}

function sourceRevisionField(sourceRevision: string | undefined): { sourceRevision?: string } {
  return sourceRevision ? { sourceRevision } : {};
}

function hashOpaqueSourceRevision(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 32);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function sanitizeProjectionUnit(unit: string | null): string | null {
  if (typeof unit !== "string") {
    return null;
  }
  const trimmed = unit.trim();
  return trimmed.length > 0
    && trimmed.length <= 40
    && !/[\u0000-\u001f\u007f]/u.test(trimmed)
    ? trimmed
    : null;
}

function sanitizeProjectionSourceKey(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0
    && normalized.length <= 80
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)
    ? normalized
    : null;
}

function sanitizeProjectionSourceLabel(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= 80
    && !/[\u0000-\u001f\u007f]/u.test(trimmed)
    ? trimmed
    : null;
}

function sanitizeProjectionText(value: string | null | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(trimmed)
    ? trimmed
    : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseOptionalTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readIsoTimestampDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}

function parseHeartRateZoneMetricKey(metricKey: string): number | null {
  const match = HEART_RATE_ZONE_MINUTES_METRIC_KEY_PATTERN.exec(metricKey);
  if (!match) {
    return null;
  }
  const zone = Number(match[1]);
  return Number.isInteger(zone) && zone >= 0 && zone <= 20 ? zone : null;
}

function readContextString(context: MetricSeriesPoint["context"] | undefined, key: string): string | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const value = context[key];
  return typeof value === "string" ? value : undefined;
}
