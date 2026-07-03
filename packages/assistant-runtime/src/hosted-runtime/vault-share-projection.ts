import {
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareDailyMetricProjectionSpec,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import {
  type ProjectedWearableSleepSummary,
  listMetricPoints,
  listMetricPointsBatch,
  readProfileDocumentRuntime,
  selectMetricSeries,
  summarizeWearableSleepRuntime,
  type MetricSeriesPoint,
} from "@murphai/query";

import type { HostedRuntimeVaultSharePort } from "./platform.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_MAX_MINUTES = 24 * 60;
const HEART_RATE_ZONE_MINUTES_METRIC_KEY_PATTERN = /^heart-rate-zone-(\d+)-minutes$/u;
const HEART_RATE_ZONE_MINUTES_METRIC_KEYS = Array.from(
  { length: 21 },
  (_, zone) => `heart-rate-zone-${zone}-minutes`,
);

export const HOSTED_VAULT_SHARE_PROJECTION_NIGHT_WINDOW = 3;

export const HOSTED_VAULT_SHARE_PROJECTION_MAX_NIGHT_AGE_DAYS = 7;

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
 * Deterministic, best-effort projection offer: ask the web control plane for the active
 * projection kinds first, then read and offer only those projectable kinds from the
 * member's own vault. The web control plane is the sole authority on whether shares exist;
 * this step holds no share state.
 *
 * Never throws — a projection failure must never affect the runtime's primary work — and
 * sends nothing for a kind the vault cannot project, so members without that data make
 * no delivery call for it at all.
 */
export async function offerHostedVaultShareProjectionBestEffort(input: {
  vaultRoot: string;
  vaultSharePort: HostedRuntimeVaultSharePort | null | undefined;
}): Promise<HostedVaultShareProjectionOfferResult> {
  const port = input.vaultSharePort ?? null;

  if (!port) {
    return { outcome: "no-port" };
  }

  let projectionKinds: HostedVaultShareProjectionKind[];
  try {
    projectionKinds = uniqueHostedVaultShareProjectionKinds(
      await port.listActiveProjectionKinds(),
    );
  } catch {
    return { outcome: "error" };
  }

  if (projectionKinds.length === 0) {
    return { outcome: "no-active-share" };
  }

  const outcomes: HostedVaultShareOfferOutcome[] = [];

  for (const projectionKind of projectionKinds) {
    outcomes.push(await offerHostedVaultShareKindBestEffort({
      port,
      projectionKind,
      readRecords: resolveProjectableRecordReader(projectionKind),
      vaultRoot: input.vaultRoot,
    }));
  }

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
  projectionKind: HostedVaultShareProjectionKind,
): (vaultRoot: string) => Promise<HostedVaultShareDeliveryRecord[]> {
  switch (projectionKind) {
    case "heart-rate-zones-days.v0":
      return readProjectableHeartRateZoneDays;
    case "profile-name.v0":
      return readProjectableProfileName;
    case "sleep-times.v0":
      return readProjectableSleepNights;
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

function uniqueHostedVaultShareProjectionKinds(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
): HostedVaultShareProjectionKind[] {
  const unique: HostedVaultShareProjectionKind[] = [];
  for (const projectionKind of projectionKinds) {
    if (!unique.includes(projectionKind)) {
      unique.push(projectionKind);
    }
  }
  return unique;
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
  const points = await listMetricPointsBatch(vaultRoot, [
    {
      from: cutoffDate,
      limit: null,
      metricKey: "workout-count",
    },
    {
      from: cutoffDate,
      limit: null,
      metricKey: "activity-minutes",
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
    metricKey: "activity-minutes",
    points,
    statistic: "value",
  });
  return selectProjectableWorkoutDays({
    countRows: countSeries.rows,
    minuteRows: minuteSeries.rows,
    nowMs,
  });
}

export async function readProjectableHeartRateZoneDays(
  vaultRoot: string,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
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
  input: {
    countRows: readonly Pick<MetricSeriesPoint, "date" | "grain" | "metricKey" | "statistic" | "value">[];
    minuteRows: readonly Pick<MetricSeriesPoint, "date" | "grain" | "metricKey" | "statistic" | "value">[];
    nowMs: number;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    input.nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const records: HostedVaultShareDeliveryRecord[] = [];
  const minuteRowsByDate = new Map(
    input.minuteRows
      .filter((row) =>
        row.metricKey === "activity-minutes"
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
    const workoutCount = countRow.value;
    const workoutMinutes = minuteRow?.value;
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
        workoutCount,
        workoutMinutes,
      },
      occurredAt: `${countRow.date}T00:00:00.000Z`,
      recordKey: countRow.date,
    });

    if (records.length >= HOSTED_VAULT_SHARE_PROJECTION_DAILY_RECORD_WINDOW) {
      break;
    }
  }

  return records;
}

export function selectProjectableHeartRateZoneDays(
  points: readonly Pick<MetricSeriesPoint, "context" | "date" | "grain" | "metricKey" | "statistic" | "value">[],
  nowMs: number,
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const records: HostedVaultShareDeliveryRecord[] = [];

  const zonesByDate = new Map<string, {
    durationMinutes: number;
    label?: string;
    zone: number;
  }[]>();
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
    const label = sanitizeProjectionText(readContextString(point.context, "zoneLabel"), 80);
    const zones = zonesByDate.get(point.date) ?? [];
    zones.push({
      ...(label === undefined ? {} : { label }),
      durationMinutes,
      zone,
    });
    zonesByDate.set(point.date, zones);
  }

  for (const [date, zonesForDate] of [...zonesByDate.entries()].sort((left, right) => right[0].localeCompare(left[0]))) {
    const dayMs = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
      continue;
    }

    const zones = zonesForDate
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
