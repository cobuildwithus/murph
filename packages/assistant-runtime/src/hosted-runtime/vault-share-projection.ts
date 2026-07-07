import { createHash } from "node:crypto";

import {
  activityTextMatchesKind,
  isStrictIsoDate,
} from "@murphai/contracts";
import {
  getHostedVaultShareActivityHeartRateZoneProjectionSpec,
  getHostedVaultShareActivityMinutesProjectionSpec,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  type HostedVaultShareActivityHeartRateZoneProjectionSpec,
  type HostedVaultShareActivityMinutesProjectionSpec,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareDailyMetricProjectionSpec,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import {
  readVault,
  type ProjectedWearableSleepSummary,
  listMetricPoints,
  listMetricPointsBatch,
  readProfileDocumentRuntime,
  selectMetricSeries,
  summarizeWearableSleepRuntime,
  type CanonicalEntity,
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
  "date" | "grain" | "metricKey" | "statistic" | "unit" | "value"
>;

type WorkoutMetricProjectionRow = MetricSourceRevisionPoint & Pick<
  MetricSeriesPoint,
  "date" | "grain" | "metricKey" | "statistic" | "value"
>;

type HeartRateZoneMetricProjectionRow = MetricSourceRevisionPoint & Pick<
  MetricSeriesPoint,
  "context" | "date" | "grain" | "metricKey" | "statistic" | "value"
>;

interface ActivitySessionHeartRateZoneProjectionRow {
  durationMinutes: number;
  label?: string;
  zone?: number;
}

export type ActivitySessionProjectionRow = MetricSourceRevisionPoint & {
  activityKind: string | null;
  date: string;
  durationMinutes: number;
  endedAt?: string | null;
  heartRateZones: readonly ActivitySessionHeartRateZoneProjectionRow[];
  startedAt?: string | null;
};

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
    case "group-email.v0":
      return async () => [];
    case "heart-rate-zones-days.v0":
      return readProjectableHeartRateZoneDays;
    case "profile-name.v0":
      return readProjectableProfileName;
    case "sleep-times.v0":
      return readProjectableSleepNights;
    case "workout-days.v0":
      return readProjectableWorkoutDays;
    default: {
      const activityMinutesSpec =
        getHostedVaultShareActivityMinutesProjectionSpec(projectionKind);
      if (activityMinutesSpec) {
        return (vaultRoot) =>
          readProjectableActivityMinutesDays(vaultRoot, activityMinutesSpec);
      }
      const activityHeartRateZoneSpec =
        getHostedVaultShareActivityHeartRateZoneProjectionSpec(projectionKind);
      if (activityHeartRateZoneSpec) {
        return (vaultRoot) =>
          readProjectableActivityHeartRateZoneDays(vaultRoot, activityHeartRateZoneSpec);
      }
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
      sourceRevision: hashOpaqueSourceRevision({
        profileUpdatedAt: snapshot.frontmatter.updatedAt,
        projectionKind: "profile-name.v0",
        recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
      }),
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

export async function readProjectableActivityMinutesDays(
  vaultRoot: string,
  spec: HostedVaultShareActivityMinutesProjectionSpec,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const rows = await readProjectableActivitySessionRows(vaultRoot, cutoffDate);
  return selectProjectableActivityMinutesDays({ nowMs, rows, spec });
}

export async function readProjectableActivityHeartRateZoneDays(
  vaultRoot: string,
  spec: HostedVaultShareActivityHeartRateZoneProjectionSpec,
): Promise<HostedVaultShareDeliveryRecord[]> {
  const nowMs = Date.now();
  const cutoffDate = new Date(
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS,
  ).toISOString().slice(0, 10);
  const rows = await readProjectableActivitySessionRows(vaultRoot, cutoffDate);
  return selectProjectableActivityHeartRateZoneDays({ nowMs, rows, spec });
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
  points: readonly DailyMetricProjectionPoint[],
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
      ...sourceRevisionField(deriveMetricSeriesPointSourceRevision(point)),
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

export function selectProjectableActivityMinutesDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    spec: HostedVaultShareActivityMinutesProjectionSpec;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    input.nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const groups = new Map<string, {
    date: string;
    rows: ActivitySessionProjectionRow[];
    sessionCount: number;
    sessionMinutes: number;
  }>();

  for (const row of dedupeActivitySessionRows(input.rows)) {
    if (!isProjectableActivitySessionRow(row, input.spec.activityKind, cutoffMs)) {
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
    group.sessionMinutes += row.durationMinutes;
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

export function selectProjectableActivityHeartRateZoneDays(
  input: {
    nowMs: number;
    rows: readonly ActivitySessionProjectionRow[];
    spec: HostedVaultShareActivityHeartRateZoneProjectionSpec;
  },
): HostedVaultShareDeliveryRecord[] {
  const cutoffMs =
    input.nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
  const groups = new Map<string, {
    date: string;
    rows: ActivitySessionProjectionRow[];
    zones: ActivitySessionHeartRateZoneProjectionRow[];
  }>();

  for (const row of dedupeActivitySessionRows(input.rows)) {
    if (
      !isProjectableActivitySessionRow(row, input.spec.activityKind, cutoffMs)
      || row.heartRateZones.length === 0
    ) {
      continue;
    }
    const group = groups.get(row.date) ?? {
      date: row.date,
      rows: [],
      zones: [],
    };
    group.rows.push(row);
    group.zones.push(...row.heartRateZones);
    groups.set(row.date, group);
  }

  const records: HostedVaultShareDeliveryRecord[] = [];
  for (const group of [...groups.values()].sort((left, right) => right.date.localeCompare(left.date))) {
    const zones = mergeActivitySessionHeartRateZones(group.zones)
      .filter((zone) =>
        zone.durationMinutes >= 0
        && zone.durationMinutes <= DAY_MAX_MINUTES
        && (zone.zone !== undefined || zone.label !== undefined)
      )
      .slice(0, 20);

    if (zones.length === 0) {
      continue;
    }

    records.push({
      data: {
        activityKind: input.spec.activityKind,
        date: group.date,
        zones,
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
  const cutoffMs =
    nowMs - HOSTED_VAULT_SHARE_PROJECTION_MAX_DAILY_RECORD_AGE_DAYS * DAY_MS;
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
): Promise<ActivitySessionProjectionRow[]> {
  const vault = await readVault(vaultRoot);
  const rows: ActivitySessionProjectionRow[] = [];

  for (const entity of vault.entities) {
    const row = toActivitySessionProjectionRow(entity);
    if (row && row.date >= cutoffDate) {
      rows.push(row);
    }
  }

  return rows;
}

function toActivitySessionProjectionRow(
  entity: CanonicalEntity,
): ActivitySessionProjectionRow | null {
  if (entity.family !== "event" || entity.kind !== "activity_session") {
    return null;
  }

  const durationMinutes = readFiniteNumber(entity.attributes.durationMinutes);
  const date = readActivitySessionDate(entity);
  if (
    durationMinutes === null
    || durationMinutes <= 0
    || durationMinutes > DAY_MAX_MINUTES
    || !date
  ) {
    return null;
  }

  const startedAt = readOptionalString(entity.attributes.startAt)
    ?? entity.occurredAt
    ?? null;
  const endedAt = readOptionalString(entity.attributes.endAt);
  const observedAt = readOptionalString(entity.attributes.recordedAt)
    ?? entity.occurredAt
    ?? undefined;

  return {
    activityKind: readActivitySessionKind(entity),
    date,
    durationMinutes,
    endedAt,
    heartRateZones: readActivitySessionHeartRateZones(entity.attributes.workout),
    observedAt,
    pointIds: [`event:${entity.entityId}`],
    recordIds: [entity.entityId],
    sourceFamily: "event",
    sourceKind: "activity_session",
    startedAt,
  };
}

function readActivitySessionDate(entity: CanonicalEntity): string | null {
  for (const value of [
    entity.date,
    readOptionalString(entity.attributes.dayKey),
    readOptionalString(entity.attributes.date),
  ]) {
    if (value && isStrictIsoDate(value)) {
      return value;
    }
  }

  for (const value of [
    readOptionalString(entity.attributes.startAt),
    entity.occurredAt,
  ]) {
    const date = readIsoTimestampDate(value);
    if (date) {
      return date;
    }
  }

  return null;
}

function readActivitySessionKind(entity: CanonicalEntity): string | null {
  return readOptionalString(entity.attributes.activityType)
    ?? readWorkoutActivityType(entity.attributes.workout);
}

function readWorkoutActivityType(workout: unknown): string | null {
  const record = readRecord(workout);
  if (!record) {
    return null;
  }
  return readOptionalString(record.sport)
    ?? readOptionalString(record.sportName)
    ?? readOptionalString(record.activityType);
}

function readActivitySessionHeartRateZones(
  workout: unknown,
): ActivitySessionHeartRateZoneProjectionRow[] {
  const record = readRecord(workout);
  if (!record || !Array.isArray(record.heartRateZones)) {
    return [];
  }

  const zones: ActivitySessionHeartRateZoneProjectionRow[] = [];
  for (const entry of record.heartRateZones) {
    const zoneRecord = readRecord(entry);
    if (!zoneRecord) {
      continue;
    }
    const durationMinutes = readFiniteNumber(zoneRecord.durationMinutes);
    if (
      durationMinutes === null
      || durationMinutes < 0
      || durationMinutes > DAY_MAX_MINUTES
    ) {
      continue;
    }
    const zoneValue = readFiniteNumber(zoneRecord.zone);
    const zone = zoneValue === null
      ? undefined
      : Number.isInteger(zoneValue) && zoneValue >= 0 && zoneValue <= 20
        ? zoneValue
        : undefined;
    const label = sanitizeProjectionText(readOptionalString(zoneRecord.label), 80);
    if (zone === undefined && label === undefined) {
      continue;
    }
    zones.push({
      ...(label === undefined ? {} : { label }),
      ...(zone === undefined ? {} : { zone }),
      durationMinutes,
    });
  }

  return mergeActivitySessionHeartRateZones(zones);
}

function isProjectableActivitySessionRow(
  row: ActivitySessionProjectionRow,
  activityKind: string,
  cutoffMs: number,
): boolean {
  const dayMs = Date.parse(`${row.date}T00:00:00.000Z`);
  return Number.isFinite(dayMs)
    && dayMs >= cutoffMs
    && activityTextMatchesKind(row.activityKind, activityKind)
    && Number.isFinite(row.durationMinutes)
    && row.durationMinutes > 0
    && row.durationMinutes <= DAY_MAX_MINUTES;
}

function dedupeActivitySessionRows(
  rows: readonly ActivitySessionProjectionRow[],
): ActivitySessionProjectionRow[] {
  const deduped = new Map<string, ActivitySessionProjectionRow>();
  for (const row of rows) {
    const key = activitySessionRowDedupeKey(row);
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

function activitySessionRowDedupeKey(row: ActivitySessionProjectionRow): string {
  if (row.startedAt || row.endedAt) {
    return JSON.stringify({
      activityKind: row.activityKind,
      date: row.date,
      durationMinutes: row.durationMinutes,
      endedAt: row.endedAt ?? null,
      startedAt: row.startedAt ?? null,
    });
  }

  return metricSeriesPointSourceOwnerKey(row)
    ?? JSON.stringify({
      activityKind: row.activityKind,
      date: row.date,
      durationMinutes: row.durationMinutes,
      pointIds: sortedStrings(row.pointIds ?? []),
    });
}

function mergeActivitySessionHeartRateZones(
  zones: readonly ActivitySessionHeartRateZoneProjectionRow[],
): ActivitySessionHeartRateZoneProjectionRow[] {
  const merged = new Map<string, ActivitySessionHeartRateZoneProjectionRow>();

  for (const zone of zones) {
    const key = `${zone.zone ?? ""}|${zone.label ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      existing.durationMinutes += zone.durationMinutes;
      continue;
    }
    merged.set(key, { ...zone });
  }

  return [...merged.values()].sort((left, right) =>
    (left.zone ?? Number.MAX_SAFE_INTEGER) - (right.zone ?? Number.MAX_SAFE_INTEGER)
    || (left.label ?? "").localeCompare(right.label ?? "")
  );
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

function deriveCompositeMetricSeriesSourceRevision(
  points: readonly MetricSourceRevisionPoint[],
): string | undefined {
  const revisions = points.map(deriveMetricSeriesPointSourceRevision);
  if (revisions.some((revision) => !revision)) {
    return undefined;
  }

  return hashOpaqueSourceRevision({ revisions: revisions.sort() });
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
