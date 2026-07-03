import {
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareDailyMetricProjectionSpec,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import {
  type ProjectedWearableActivitySummary,
  type ProjectedWearableSleepSummary,
  listMetricPoints,
  readProfileDocumentRuntime,
  selectMetricSeries,
  summarizeWearableActivityRuntime,
  summarizeWearableSleepRuntime,
  type MetricSeriesPoint,
} from "@murphai/query";

import type { HostedRuntimeVaultSharePort } from "./platform.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAILY_MINUTES = 24 * 60;

export const HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW = 3;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS = 7;

export const HOSTED_VAULT_SHARE_PROJECTION_ACTIVITY_DAY_WINDOW = 3;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_ACTIVITY_DAY_AGE_DAYS = 7;

export const HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW = 3;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS = 7;

export interface HostedVaultShareProjectionOfferResult {
  outcome:
    | "delivered"
    | "error"
    | "no-active-share"
    | "no-port"
    | "no-projectable-records";
}

/**
 * Deterministic, best-effort projection offer: read each projectable kind from the
 * member's own vault and offer it as delivery records through the vault-share port. The
 * web control plane is the sole authority on whether shares exist; this step holds no
 * share state.
 *
 * Never throws — a projection failure must never affect the runtime's primary work — and
 * sends nothing for a kind the vault cannot project, so members without that data make
 * no delivery call for it at all.
 */
export async function offerHostedVaultShareProjectionBestEffort(input: {
  readActivityRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  readProfileNameRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  readProjectionRecords?: (input: {
    projectionKind: HostedVaultShareProjectionKind;
    vaultRoot: string;
  }) => Promise<HostedVaultShareDeliveryRecord[]>;
  readRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  vaultRoot: string;
  vaultSharePort: HostedRuntimeVaultSharePort | null | undefined;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const port = input.vaultSharePort ?? null;

  if (!port) {
    return { outcome: "no-port" };
  }

  const outcomes: HostedVaultShareOfferOutcome[] = [];

  for (const projectionKind of HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS) {
    outcomes.push(await offerHostedVaultShareKindBestEffort({
      port,
      projectionKind,
      readRecords: resolveProjectableRecordReader(input, projectionKind),
      vaultRoot: input.vaultRoot,
    }));
  }

  outcomes.push(await offerHostedVaultShareKindBestEffort({
    port,
    projectionKind: "profile-name.v0",
    readRecords: resolveProjectableRecordReader(input, "profile-name.v0"),
    vaultRoot: input.vaultRoot,
  }));

  return { outcome: combineHostedVaultShareOfferOutcomes(outcomes) };
}

type HostedVaultShareOfferOutcome = HostedVaultShareProjectionOfferResult["outcome"];

async function offerHostedVaultShareKindBestEffort(input: {
  port: HostedRuntimeVaultSharePort;
  projectionKind: HostedVaultShareProjectionKind;
  readRecords: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  vaultRoot: string;
}): Promise<HostedVaultShareOfferOutcome> {
  try {
    const records = await input.readRecords(input.vaultRoot);

    if (records.length === 0) {
      return "no-projectable-records";
    }

    const response = await input.port.deliver({
      projectionKind: input.projectionKind,
      records,
    });

    return response.status === "delivered" ? "delivered" : "no-active-share";
  } catch {
    return "error";
  }
}

function resolveProjectableRecordReader(
  input: {
    readActivityRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
    readProfileNameRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
    readProjectionRecords?: (input: {
      projectionKind: HostedVaultShareProjectionKind;
      vaultRoot: string;
    }) => Promise<HostedVaultShareDeliveryRecord[]>;
    readRecords?: (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]>;
  },
  projectionKind: HostedVaultShareProjectionKind,
): (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]> {
  const readProjectionRecords = input.readProjectionRecords;
  if (readProjectionRecords) {
    return (vaultRoot) => readProjectionRecords({ projectionKind, vaultRoot });
  }

  switch (projectionKind) {
    case "activity-days.v0":
      return input.readActivityRecords ?? readProjectableActivityDays;
    case "heart-rate-zones-days.v0":
      return readProjectableHeartRateZoneDays;
    case "profile-name.v0":
      return input.readProfileNameRecords ?? readProjectableProfileName;
    case "sleep-times.v0":
      return input.readRecords ?? readProjectableSleepNights;
    case "workout-days.v0":
      return readProjectableWorkoutDays;
    default: {
      const spec = getHostedVaultShareDailyMetricProjectionSpec(projectionKind);
      if (spec) {
        return (vaultRoot) => readProjectableDailyMetricDays(vaultRoot, spec);
      }
      return async () => [];
    }
  }
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
 * The profile display name projects only from the typed canonical profile document —
 * never parsed out of freeform memory text. occurredAt reuses the document's own
 * updatedAt so retries stay byte-identical and the only plaintext mailbox metadata is
 * when the name was set.
 */
export async function readProjectableProfileName(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const snapshot = await readProfileDocumentRuntime(vaultRoot);
  const displayName = snapshot.frontmatter.displayName;

  if (
    !displayName
    || displayName.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || !Number.isFinite(Date.parse(snapshot.frontmatter.updatedAt))
  ) {
    return [];
  }

  return [
    {
      data: { displayName },
      occurredAt: new Date(Date.parse(snapshot.frontmatter.updatedAt)).toISOString(),
      recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
    },
  ];
}

export async function readProjectableSleepNights(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const summaries = await summarizeWearableSleepRuntime(vaultRoot, {
    limit: HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  });
  return selectProjectableSleepNights(summaries, Date.now());
}

export async function readProjectableActivityDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_ACTIVITY_DAY_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const points = await listMetricPoints(vaultRoot, {
    from: cutoffDate,
    limit: null,
    metricKey: "activity-minutes",
  });
  const series = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: cutoffDate,
    grain: "day",
    metricKey: "activity-minutes",
    points,
    statistic: "value",
  });
  return selectProjectableActivityDays(series.rows, nowMs);
}

export async function readProjectableDailyMetricDays(
  vaultRoot: string,
  spec: HostedVaultShareDailyMetricProjectionSpec,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const points = await listMetricPoints(vaultRoot, {
    from: cutoffDate,
    limit: null,
    metricKey: spec.metricKey,
  });
  const series = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: cutoffDate,
    grain: "day",
    metricKey: spec.metricKey,
    points,
    statistic: "value",
  });
  return selectProjectableDailyMetricDays(series.rows, spec, nowMs);
}

export async function readProjectableWorkoutDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const summaries = await summarizeWearableActivityRuntime(vaultRoot, {
    from: cutoffDate,
    limit: HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW
      + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  });
  return selectProjectableWorkoutDays(summaries, nowMs);
}

export async function readProjectableHeartRateZoneDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const summaries = await summarizeWearableActivityRuntime(vaultRoot, {
    from: cutoffDate,
    limit: HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW
      + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  });
  return selectProjectableHeartRateZoneDays(summaries, nowMs);
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
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS * DAY_MS;
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

/**
 * Keep only recent daily active-minute metric rows. The projection deliberately omits
 * provider identity and candidate provenance; group challenges need the query-owned
 * selected daily total, not a broader wearable share.
 */
export function selectProjectableActivityDays(
  points: readonly Pick<MetricSeriesPoint, "date" | "grain" | "statistic" | "value">[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_ACTIVITY_DAY_AGE_DAYS * DAY_MS;
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const point of [...points].sort((left, right) => right.date.localeCompare(left.date))) {
    const dayMs = Date.parse(`${point.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }
    if (point.grain !== "day" || point.statistic !== "value") {
      continue;
    }

    const activeMinutes = point.value;
    if (
      typeof activeMinutes !== "number"
      || !Number.isFinite(activeMinutes)
      || activeMinutes < 0
      || activeMinutes > MAX_DAILY_MINUTES
    ) {
      continue;
    }

    records.push({
      data: {
        activeMinutes,
        date: point.date,
      },
      occurredAt: `${point.date}T00:00:00.000Z`,
      recordKey: point.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_ACTIVITY_DAY_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableDailyMetricDays(
  points: readonly Pick<MetricSeriesPoint, "date" | "grain" | "metricKey" | "statistic" | "unit" | "value">[],
  spec: HostedVaultShareDailyMetricProjectionSpec,
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
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

    records.push({
      data: {
        date: point.date,
        metricKey: spec.metricKey,
        unit: sanitizeProjectionUnit(point.unit),
        value,
      },
      occurredAt: `${point.date}T00:00:00.000Z`,
      recordKey: point.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableWorkoutDays(
  summaries: readonly Pick<
    ProjectedWearableActivitySummary,
    "activityTypes" | "date" | "sessionCount" | "sessionMinutes"
  >[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const summary of [...summaries].sort((left, right) => right.date.localeCompare(left.date))) {
    const dayMs = Date.parse(`${summary.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }

    const workoutCount = summary.sessionCount.selection.value;
    const workoutMinutes = summary.sessionMinutes.selection.value;
    if (
      typeof workoutCount !== "number"
      || typeof workoutMinutes !== "number"
      || !Number.isFinite(workoutCount)
      || !Number.isFinite(workoutMinutes)
      || !Number.isInteger(workoutCount)
      || workoutCount <= 0
      || workoutCount > 100
      || workoutMinutes < 0
      || workoutMinutes > MAX_DAILY_MINUTES
    ) {
      continue;
    }

    records.push({
      data: {
        activityTypes: sanitizeActivityTypes(summary.activityTypes),
        date: summary.date,
        workoutCount,
        workoutMinutes,
      },
      occurredAt: `${summary.date}T00:00:00.000Z`,
      recordKey: summary.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableHeartRateZoneDays(
  summaries: readonly Pick<ProjectedWearableActivitySummary, "date" | "heartRateZones">[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const records: HostedVaultShareDeliveryRecord[] = [];

  for (const summary of [...summaries].sort((left, right) => right.date.localeCompare(left.date))) {
    const dayMs = Date.parse(`${summary.date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }

    const zones = (summary.heartRateZones ?? [])
      .map((zone) => sanitizeHeartRateZoneBucket(zone))
      .filter((zone) => zone !== null)
      .slice(0, 20);

    if (zones.length === 0) {
      continue;
    }

    records.push({
      data: {
        date: summary.date,
        zones,
      },
      occurredAt: `${summary.date}T00:00:00.000Z`,
      recordKey: summary.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
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

function sanitizeHeartRateZoneBucket(
  zone: ProjectedWearableActivitySummary["heartRateZones"][number],
): {
  durationMinutes: number;
  label?: string;
  maxHeartRate?: number;
  minHeartRate?: number;
  zone?: number;
} | null {
  if (
    zone.durationMinutes < 0
    || zone.durationMinutes > MAX_DAILY_MINUTES
  ) {
    return null;
  }

  const label = sanitizeProjectionText(zone.label, 80);
  const zoneIndex = typeof zone.zone === "number"
    && Number.isInteger(zone.zone)
    && zone.zone >= 0
    && zone.zone <= 20
    ? zone.zone
    : undefined;
  const minHeartRate = isPlausibleHeartRate(zone.minHeartRate)
    ? zone.minHeartRate
    : undefined;
  const maxHeartRate = isPlausibleHeartRate(zone.maxHeartRate)
    ? zone.maxHeartRate
    : undefined;
  const hasValidRange =
    minHeartRate === undefined
    || maxHeartRate === undefined
    || maxHeartRate >= minHeartRate;

  const next = {
    ...(label === undefined ? {} : { label }),
    ...(hasValidRange && maxHeartRate !== undefined ? { maxHeartRate } : {}),
    ...(hasValidRange && minHeartRate !== undefined ? { minHeartRate } : {}),
    ...(zoneIndex === undefined ? {} : { zone: zoneIndex }),
    durationMinutes: zone.durationMinutes,
  };

  return next.label !== undefined
    || next.maxHeartRate !== undefined
    || next.minHeartRate !== undefined
    || next.zone !== undefined
    ? next
    : null;
}

function isPlausibleHeartRate(value: number | undefined): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 260;
}

function sanitizeProjectionText(value: string | undefined, maxLength: number): string | undefined {
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

function sanitizeActivityTypes(activityTypes: readonly string[]): string[] {
  return [...new Set(activityTypes.map((type) => type.trim()))]
    .filter((type) =>
      type.length > 0
      && type.length <= 80
      && !/[\u0000-\u001f\u007f]/u.test(type)
    )
    .slice(0, 16);
}
