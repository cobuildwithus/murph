import {
  isStrictIsoDate,
  isStrictIsoDateTime,
} from "@murphai/contracts";

import {
  readNullableStringValue,
  requireArray,
  requireNumber,
  requireObject,
  requireString,
} from "./parsers/assertions.ts";

/**
 * VaultShare v0: a member grants a standing share of a fixed vault projection to a
 * destination member. The grantor's runtime offers projected records through the signed
 * callback channel; the web control plane is the sole authority on whether an active share
 * exists and is the only writer into the destination mailbox.
 *
 * Projection kinds are a closed registry on purpose: each kind is a deterministic,
 * fixed-schema projection. The wire envelope is kind-generic — every record carries a
 * path-safe `recordKey` (its identity within the share) and an `occurredAt` timestamp,
 * with the kind-specific shape isolated under `data`. Adding a kind means adding a data
 * schema and a projector, never widening the envelope.
 */
export const HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS = [
  "activity-days.v0",
  "steps-days.v0",
  "max-heart-rate-days.v0",
  "distance-days.v0",
  "active-calories-days.v0",
  "elevation-gain-days.v0",
  "floors-climbed-days.v0",
  "day-strain-days.v0",
  "workout-strain-days.v0",
  "activity-score-days.v0",
  "vo2-max-days.v0",
  "resting-heart-rate-days.v0",
  "hrv-days.v0",
] as const;

export type HostedVaultShareDailyMetricProjectionKind =
  (typeof HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS)[number];

export interface HostedVaultShareDailyMetricProjectionSpec {
  maxValue: number;
  metricKey: string;
  minValue: number;
  projectionKind: HostedVaultShareDailyMetricProjectionKind;
}

export const HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS = [
  { projectionKind: "activity-days.v0", metricKey: "activity-minutes", minValue: 0, maxValue: 1_440 },
  { projectionKind: "steps-days.v0", metricKey: "steps", minValue: 0, maxValue: 1_000_000 },
  { projectionKind: "max-heart-rate-days.v0", metricKey: "max-heart-rate", minValue: 0, maxValue: 260 },
  { projectionKind: "distance-days.v0", metricKey: "distance-km", minValue: 0, maxValue: 1_000 },
  { projectionKind: "active-calories-days.v0", metricKey: "active-calories", minValue: 0, maxValue: 20_000 },
  { projectionKind: "elevation-gain-days.v0", metricKey: "elevation-gain-meters", minValue: 0, maxValue: 100_000 },
  { projectionKind: "floors-climbed-days.v0", metricKey: "floors-climbed", minValue: 0, maxValue: 10_000 },
  { projectionKind: "day-strain-days.v0", metricKey: "day-strain", minValue: 0, maxValue: 30 },
  { projectionKind: "workout-strain-days.v0", metricKey: "workout-strain", minValue: 0, maxValue: 30 },
  { projectionKind: "activity-score-days.v0", metricKey: "activity-score", minValue: 0, maxValue: 100 },
  { projectionKind: "vo2-max-days.v0", metricKey: "estimated-vo2-max", minValue: 0, maxValue: 100 },
  { projectionKind: "resting-heart-rate-days.v0", metricKey: "resting-heart-rate", minValue: 20, maxValue: 250 },
  { projectionKind: "hrv-days.v0", metricKey: "hrv-rmssd", minValue: 0, maxValue: 500 },
] as const satisfies readonly HostedVaultShareDailyMetricProjectionSpec[];

export const HOSTED_VAULT_SHARE_PROJECTION_KINDS = [
  "group-email.v0",
  "profile-name.v0",
  "sleep-times.v0",
  "workout-days.v0",
  "heart-rate-zones-days.v0",
  ...HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS,
] as const;

/**
 * Kinds members may individually select on a group join page. profile-name.v0 is
 * excluded: it is granted implicitly with group membership (introducing yourself by
 * name is what joining means), never requested as an optional health permission.
 */
export const HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS = [
  "group-email.v0",
  "sleep-times.v0",
  "activity-days.v0",
  "workout-days.v0",
  "heart-rate-zones-days.v0",
  "steps-days.v0",
  "max-heart-rate-days.v0",
  "distance-days.v0",
  "active-calories-days.v0",
  "elevation-gain-days.v0",
  "floors-climbed-days.v0",
  "day-strain-days.v0",
  "workout-strain-days.v0",
  "activity-score-days.v0",
  "vo2-max-days.v0",
  "resting-heart-rate-days.v0",
  "hrv-days.v0",
] as const satisfies readonly HostedVaultShareProjectionKind[];

export type HostedVaultShareSelectableProjectionKind =
  (typeof HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS)[number];

/**
 * Kinds whose records are current-state facts rather than time-series entries: one
 * parser-enforced fixed recordKey per grantor, so a delivery replaces the previous fact
 * instead of extending a history. Two delivery-policy consequences, both keyed here so
 * they cannot drift apart: the server-side recency age bound does not apply (a fact set
 * long ago is still the current fact at a member's first group join), and the delivery
 * revision identity must hash the content alone — occurredAt is grantor-runtime-controlled
 * metadata, and hashing it would let drifted timestamps mint unbounded mailbox dedupe keys
 * for the same unchanged fact.
 */
export const HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS = [
  "profile-name.v0",
] as const satisfies readonly HostedVaultShareProjectionKind[];

export function isHostedVaultShareCurrentStateProjectionKind(
  kind: HostedVaultShareProjectionKind,
): boolean {
  const kinds: readonly HostedVaultShareProjectionKind[] =
    HOSTED_VAULT_SHARE_CURRENT_STATE_PROJECTION_KINDS;
  return kinds.includes(kind);
}

export type HostedVaultShareProjectionKind =
  (typeof HOSTED_VAULT_SHARE_PROJECTION_KINDS)[number];

export const HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA =
  "murph.vault-share.delivery.v1";

export const HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA =
  "murph.vault-share.revoke.v1";

export const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS = 7;

const HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH = 128;
const HOSTED_VAULT_SHARE_RECORD_KEY_PATTERN = /^[A-Za-z0-9._-]+$/u;
const HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH = 96;
const HOSTED_VAULT_SHARE_SOURCE_REVISION_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface HostedVaultShareSleepTimesData {
  date: string;
  sleepEndAt: string;
  sleepStartAt: string;
}

export interface HostedVaultShareDailyMetricData {
  date: string;
  metricKey: string;
  unit: string | null;
  value: number;
}

export interface HostedVaultShareWorkoutDayData {
  date: string;
  workoutCount: number;
  workoutMinutes: number;
}

export interface HostedVaultShareHeartRateZoneBucket {
  durationMinutes: number;
  label?: string;
  zone?: number;
}

export interface HostedVaultShareHeartRateZoneDayData {
  date: string;
  zones: HostedVaultShareHeartRateZoneBucket[];
}

export interface HostedVaultShareProfileNameData {
  displayName: string;
}

export type HostedVaultShareDeliveryRecordData =
  | HostedVaultShareDailyMetricData
  | HostedVaultShareHeartRateZoneDayData
  | HostedVaultShareProfileNameData
  | HostedVaultShareSleepTimesData
  | HostedVaultShareWorkoutDayData;

export interface HostedVaultShareDeliveryRecord {
  data: HostedVaultShareDeliveryRecordData;
  occurredAt: string;
  recordKey: string;
  sourceRevision?: string;
}

export interface HostedVaultShareDeliverRequest {
  projectionKind: HostedVaultShareProjectionKind;
  records: HostedVaultShareDeliveryRecord[];
}

/**
 * The deliver response is intentionally a bare status that depends on share configuration
 * alone: the grantor runtime may learn that an active share exists, never fan-out
 * cardinality, duplicate history, or per-record outcomes.
 */
export interface HostedVaultShareDeliverResponse {
  status: "delivered" | "no-active-share";
}

export interface HostedVaultShareActiveProjectionKindsResponse {
  projectionKinds: HostedVaultShareProjectionKind[];
}

export interface HostedVaultShareDeliveryPayload {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  record: HostedVaultShareDeliveryRecord;
  schema: typeof HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA;
  shareId: string;
}

export interface HostedVaultShareRevokePayload {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  revokedAt: string;
  schema: typeof HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA;
  shareId: string;
}

export function isHostedVaultShareProjectionKind(
  value: unknown,
): value is HostedVaultShareProjectionKind {
  return HOSTED_VAULT_SHARE_PROJECTION_KINDS.includes(
    value as HostedVaultShareProjectionKind,
  );
}

export function isHostedVaultShareDailyMetricProjectionKind(
  value: HostedVaultShareProjectionKind,
): value is HostedVaultShareDailyMetricProjectionKind {
  return HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_KINDS.includes(
    value as HostedVaultShareDailyMetricProjectionKind,
  );
}

export function getHostedVaultShareDailyMetricProjectionSpec(
  projectionKind: HostedVaultShareProjectionKind,
): HostedVaultShareDailyMetricProjectionSpec | null {
  return HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.find(
    (spec) => spec.projectionKind === projectionKind,
  ) ?? null;
}

function parseHostedVaultShareProjectionKind(
  value: unknown,
  label: string,
): HostedVaultShareProjectionKind {
  if (isHostedVaultShareProjectionKind(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known vault-share projection kind.`);
}

/**
 * Delivery dedupe separates logical record identity from revision identity: recordKey is
 * the stable destination replacement key, while recordRevision is the stable hash of the
 * validated payload that lets corrected facts append without duplicating exact retries.
 */
export function buildHostedVaultShareDeliveryDedupeKey(input: {
  recordKey: string;
  recordRevision: string;
  shareId: string;
}): string {
  return `vault-share:${input.shareId}:${input.recordKey}:${input.recordRevision}`;
}

export function buildHostedVaultShareRevokeDedupeKey(input: {
  revokedAt: string;
  shareId: string;
}): string {
  return `vault-share-revoke:${input.shareId}:${input.revokedAt}`;
}

export function parseHostedVaultShareDeliveryRecord(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): HostedVaultShareDeliveryRecord {
  const record = requireObject(value, "Vault share delivery record");
  const recordKey = requireRecordKey(
    record.recordKey,
    "Vault share delivery record recordKey",
  );

  const occurredAt = requireIsoTimestamp(
    record.occurredAt,
    "Vault share delivery record occurredAt",
  );

  return {
    data: parseHostedVaultShareDeliveryRecordData(record.data, {
      occurredAt,
      projectionKind,
      recordKey,
    }),
    occurredAt,
    recordKey,
    ...parseHostedVaultShareSourceRevision(record.sourceRevision),
  };
}

function parseHostedVaultShareSourceRevision(value: unknown): { sourceRevision?: string } {
  if (value === undefined) {
    return {};
  }

  const sourceRevision = requireString(
    value,
    "Vault share delivery record sourceRevision",
  );
  if (
    sourceRevision.length > HOSTED_VAULT_SHARE_SOURCE_REVISION_MAX_LENGTH
    || !HOSTED_VAULT_SHARE_SOURCE_REVISION_PATTERN.test(sourceRevision)
  ) {
    throw new TypeError(
      "Vault share delivery record sourceRevision must be an opaque base64url string.",
    );
  }

  return { sourceRevision };
}

function parseHostedVaultShareDeliveryRecordData(
  value: unknown,
  context: {
    occurredAt: string;
    projectionKind: HostedVaultShareProjectionKind;
    recordKey: string;
  },
): HostedVaultShareDeliveryRecordData {
  const dailyMetricSpec = getHostedVaultShareDailyMetricProjectionSpec(
    context.projectionKind,
  );
  if (dailyMetricSpec) {
    return parseHostedVaultShareDailyMetricData(value, context, dailyMetricSpec);
  }

  switch (context.projectionKind) {
    case "heart-rate-zones-days.v0":
      return parseHostedVaultShareHeartRateZoneDayData(value, context);
    case "profile-name.v0":
      return parseHostedVaultShareProfileNameData(value, context);
    case "sleep-times.v0":
      return parseHostedVaultShareSleepTimesData(value, context);
    case "workout-days.v0":
      return parseHostedVaultShareWorkoutDayData(value, context);
  }

  throw new TypeError(
    `Vault share ${context.projectionKind} data parser is not implemented.`,
  );
}

export const HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY = "profile-name";
export const HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH = 120;

function parseHostedVaultShareProfileNameData(
  value: unknown,
  context: { recordKey: string },
): HostedVaultShareProfileNameData {
  const data = requireObject(value, "Vault share profile-name data");

  // One logical record per grantor: the fixed recordKey makes every delivery a
  // replacement of the previous name instead of an accumulating history.
  if (context.recordKey !== HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY) {
    throw new TypeError(
      'Vault share profile-name recordKey must be "profile-name".',
    );
  }

  const displayName = requireString(
    data.displayName,
    "Vault share profile-name data displayName",
  ).trim();

  if (
    displayName.length === 0
    || displayName.length > HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(displayName)
  ) {
    throw new TypeError(
      "Vault share profile-name displayName must be 1-120 characters with no control characters.",
    );
  }

  return { displayName };
}

const HOSTED_VAULT_SHARE_DAY_MAX_MINUTES = 24 * 60;

function parseHostedVaultShareDailyMetricData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
  spec: HostedVaultShareDailyMetricProjectionSpec,
): HostedVaultShareDailyMetricData {
  const data = requireObject(
    value,
    `Vault share ${spec.projectionKind} data`,
  );
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: `Vault share ${spec.projectionKind} data`,
    occurredAt: context.occurredAt,
    occurredAtDescription: `${spec.projectionKind} date at UTC midnight`,
    recordKey: context.recordKey,
  });
  const metricKey = requireString(
    data.metricKey,
    `Vault share ${spec.projectionKind} data metricKey`,
  );

  if (metricKey !== spec.metricKey) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} metricKey must be ${spec.metricKey}.`,
    );
  }

  const unit = readNullableStringValue(
    data.unit,
    `Vault share ${spec.projectionKind} data unit`,
  );
  if (unit !== null && (unit.length > 40 || /[\u0000-\u001f\u007f]/u.test(unit))) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} unit must be at most 40 characters with no control characters.`,
    );
  }

  const valueNumber = requireNumber(
    data.value,
    `Vault share ${spec.projectionKind} data value`,
  );
  if (valueNumber < spec.minValue || valueNumber > spec.maxValue) {
    throw new TypeError(
      `Vault share ${spec.projectionKind} value must be between ${spec.minValue} and ${spec.maxValue}.`,
    );
  }

  return {
    date,
    metricKey,
    unit,
    value: valueNumber,
  };
}

function parseHostedVaultShareWorkoutDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareWorkoutDayData {
  const data = requireObject(value, "Vault share workout-days data");
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: "Vault share workout-days data",
    occurredAt: context.occurredAt,
    occurredAtDescription: "workout date at UTC midnight",
    recordKey: context.recordKey,
  });
  const workoutCount = requireNumber(
    data.workoutCount,
    "Vault share workout-days data workoutCount",
  );
  const workoutMinutes = requireNumber(
    data.workoutMinutes,
    "Vault share workout-days data workoutMinutes",
  );

  if (!Number.isInteger(workoutCount) || workoutCount < 0 || workoutCount > 100) {
    throw new TypeError(
      "Vault share workout-days workoutCount must be an integer between 0 and 100.",
    );
  }
  if (workoutMinutes < 0 || workoutMinutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      "Vault share workout-days workoutMinutes must be between 0 and 1440.",
    );
  }

  return { date, workoutCount, workoutMinutes };
}

function parseHostedVaultShareHeartRateZoneDayData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareHeartRateZoneDayData {
  const data = requireObject(value, "Vault share heart-rate-zones-days data");
  const date = parseHostedVaultShareDailyDate(data.date, {
    dataLabel: "Vault share heart-rate-zones-days data",
    occurredAt: context.occurredAt,
    occurredAtDescription: "heart-rate-zone date at UTC midnight",
    recordKey: context.recordKey,
  });
  const zones = requireArray(
    data.zones,
    "Vault share heart-rate-zones-days data zones",
  ).map((entry, index) => parseHostedVaultShareHeartRateZoneBucket(entry, index));

  if (zones.length === 0 || zones.length > 20) {
    throw new TypeError(
      "Vault share heart-rate-zones-days zones must contain 1-20 entries.",
    );
  }

  return { date, zones };
}

function parseHostedVaultShareHeartRateZoneBucket(
  value: unknown,
  index: number,
): HostedVaultShareHeartRateZoneBucket {
  const data = requireObject(
    value,
    `Vault share heart-rate-zones-days zones[${index}]`,
  );
  const zone = data.zone === undefined
    ? undefined
    : requireNumber(data.zone, `Vault share heart-rate-zones-days zones[${index}] zone`);
  const label = data.label === undefined
    ? undefined
    : parseHostedVaultShareBoundedText(
        data.label,
        `Vault share heart-rate-zones-days zones[${index}] label`,
        80,
      );
  const durationMinutes = requireNumber(
    data.durationMinutes,
    `Vault share heart-rate-zones-days zones[${index}] durationMinutes`,
  );

  if (zone !== undefined && (!Number.isInteger(zone) || zone < 0 || zone > 20)) {
    throw new TypeError(
      `Vault share heart-rate-zones-days zones[${index}] zone must be an integer between 0 and 20.`,
    );
  }
  if (durationMinutes < 0 || durationMinutes > HOSTED_VAULT_SHARE_DAY_MAX_MINUTES) {
    throw new TypeError(
      `Vault share heart-rate-zones-days zones[${index}] durationMinutes must be between 0 and 1440.`,
    );
  }
  if (
    zone === undefined
    && label === undefined
  ) {
    throw new TypeError(
      `Vault share heart-rate-zones-days zones[${index}] must identify the zone.`,
    );
  }

  return {
    ...(label === undefined ? {} : { label }),
    ...(zone === undefined ? {} : { zone }),
    durationMinutes,
  };
}

function parseHostedVaultShareDailyDate(
  value: unknown,
  context: {
    dataLabel: string;
    occurredAt: string;
    occurredAtDescription: string;
    recordKey: string;
  },
): string {
  const date = requireString(value, `${context.dataLabel} date`);

  if (!isStrictIsoDate(date)) {
    throw new TypeError(
      `${context.dataLabel} date must be a real calendar day formatted YYYY-MM-DD.`,
    );
  }

  if (context.recordKey !== date) {
    throw new TypeError(
      `${context.dataLabel.replace(" data", "")} recordKey must equal the data date.`,
    );
  }

  if (context.occurredAt !== `${date}T00:00:00.000Z`) {
    throw new TypeError(
      `${context.dataLabel.replace(" data", "")} occurredAt must be the ${context.occurredAtDescription}.`,
    );
  }

  return date;
}

function parseHostedVaultShareBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const text = requireString(value, label).trim();
  if (text.length === 0 || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(
      `${label} must be 1-${maxLength} characters with no control characters.`,
    );
  }
  return text;
}

const HOSTED_VAULT_SHARE_SLEEP_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseHostedVaultShareSleepTimesData(
  value: unknown,
  context: { occurredAt: string; recordKey: string },
): HostedVaultShareSleepTimesData {
  const data = requireObject(value, "Vault share sleep-times data");
  const date = requireString(data.date, "Vault share sleep-times data date");

  if (!isStrictIsoDate(date)) {
    throw new TypeError(
      "Vault share sleep-times data date must be a real calendar day formatted YYYY-MM-DD.",
    );
  }

  // The record's identity is its night date; rejecting any drift keeps the dedupe key and
  // the destination vault path derived from recordKey byte-identical to the night itself.
  if (context.recordKey !== date) {
    throw new TypeError(
      "Vault share sleep-times recordKey must equal the data date.",
    );
  }

  // occurredAt is the envelope's only plaintext timestamp at rest (mailbox metadata).
  // Pinning it to the night-date midnight keeps exact sleep times out of Postgres and
  // anchors server-side recency filtering on the night itself, not a runtime-chosen time.
  if (context.occurredAt !== `${date}T00:00:00.000Z`) {
    throw new TypeError(
      "Vault share sleep-times occurredAt must be the night date at UTC midnight.",
    );
  }

  const sleepEndAt = requireIsoTimestamp(
    data.sleepEndAt,
    "Vault share sleep-times data sleepEndAt",
  );
  const sleepStartAt = requireIsoTimestamp(
    data.sleepStartAt,
    "Vault share sleep-times data sleepStartAt",
  );
  const windowMs = Date.parse(sleepEndAt) - Date.parse(sleepStartAt);

  // Fails closed on corrupted projections: a sleep window must be a positive interval of
  // plausible length, not reversed and not spanning multiple days.
  if (!(windowMs > 0) || windowMs > HOSTED_VAULT_SHARE_SLEEP_MAX_WINDOW_MS) {
    throw new TypeError(
      "Vault share sleep-times window must end after it starts and span at most 24 hours.",
    );
  }

  return { date, sleepEndAt, sleepStartAt };
}

export function parseHostedVaultShareDeliverRequest(
  value: unknown,
): HostedVaultShareDeliverRequest {
  const request = requireObject(value, "Vault share deliver request");
  const projectionKind = parseHostedVaultShareProjectionKind(
    request.projectionKind,
    "Vault share deliver request projectionKind",
  );
  const records = requireArray(request.records, "Vault share deliver request records");

  if (records.length === 0) {
    throw new TypeError("Vault share deliver request records must not be empty.");
  }

  if (records.length > HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS) {
    throw new TypeError(
      `Vault share deliver request records must contain at most ${HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS} records.`,
    );
  }

  return {
    projectionKind,
    records: records.map((record) =>
      parseHostedVaultShareDeliveryRecord(record, projectionKind),
    ),
  };
}

export function parseHostedVaultShareDeliverResponse(
  value: unknown,
): HostedVaultShareDeliverResponse {
  const record = requireObject(value, "Vault share deliver response");
  const status = requireString(record.status, "Vault share deliver response status");

  if (status !== "delivered" && status !== "no-active-share") {
    throw new TypeError(
      "Vault share deliver response status must be delivered or no-active-share.",
    );
  }

  return { status };
}

export function parseHostedVaultShareActiveProjectionKindsResponse(
  value: unknown,
): HostedVaultShareActiveProjectionKindsResponse {
  const record = requireObject(value, "Vault share active projection kinds response");
  const projectionKinds = requireArray(
    record.projectionKinds,
    "Vault share active projection kinds response projectionKinds",
  );
  const uniqueProjectionKinds: HostedVaultShareProjectionKind[] = [];

  for (const projectionKind of projectionKinds) {
    const parsed = parseHostedVaultShareProjectionKind(
      projectionKind,
      "Vault share active projection kind",
    );
    if (!uniqueProjectionKinds.includes(parsed)) {
      uniqueProjectionKinds.push(parsed);
    }
  }

  return { projectionKinds: uniqueProjectionKinds };
}

export function parseHostedVaultShareDeliveryPayload(
  value: unknown,
): HostedVaultShareDeliveryPayload {
  const payload = requireObject(value, "Vault share delivery payload");
  const schema = requireString(payload.schema, "Vault share delivery payload schema");

  if (schema !== HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA) {
    throw new TypeError(
      `Vault share delivery payload schema must be ${HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA}.`,
    );
  }

  const projectionKind = parseHostedVaultShareProjectionKind(
    payload.projectionKind,
    "Vault share delivery payload projectionKind",
  );

  return {
    grantorMemberId: requireString(
      payload.grantorMemberId,
      "Vault share delivery payload grantorMemberId",
    ),
    projectionKind,
    record: parseHostedVaultShareDeliveryRecord(payload.record, projectionKind),
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: requireString(payload.shareId, "Vault share delivery payload shareId"),
  };
}

export function parseHostedVaultShareRevokePayload(
  value: unknown,
): HostedVaultShareRevokePayload {
  const payload = requireObject(value, "Vault share revoke payload");
  const schema = requireString(payload.schema, "Vault share revoke payload schema");

  if (schema !== HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA) {
    throw new TypeError(
      `Vault share revoke payload schema must be ${HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA}.`,
    );
  }

  return {
    grantorMemberId: requireString(
      payload.grantorMemberId,
      "Vault share revoke payload grantorMemberId",
    ),
    projectionKind: parseHostedVaultShareProjectionKind(
      payload.projectionKind,
      "Vault share revoke payload projectionKind",
    ),
    revokedAt: requireIsoTimestamp(
      payload.revokedAt,
      "Vault share revoke payload revokedAt",
    ),
    schema: HOSTED_VAULT_SHARE_REVOKE_PAYLOAD_SCHEMA,
    shareId: requireString(payload.shareId, "Vault share revoke payload shareId"),
  };
}

function requireRecordKey(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (
    text.length > HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH
    || text.includes("..")
    || !HOSTED_VAULT_SHARE_RECORD_KEY_PATTERN.test(text)
  ) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH} path-safe characters (A-Z, a-z, 0-9, '.', '_', '-') without '..'.`,
    );
  }

  return text;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (!isStrictIsoDateTime(text)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return text;
}

/**
 * Destination-side landing store for consented vault-share deliveries. The runtime
 * importer (`vault-share-import.ts`) is the sole writer; this section owns the pure,
 * fs-free contract shared by that writer and any reader: the schema seam, the store
 * shape, the read-only parser, and the member-major pivot the group-chat reader
 * consumes. Keeping it here (next to the delivery-record parser it reuses) means the
 * writer and the `vault-cli group shared` reader can never drift on the shape.
 */
export const SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA =
  "murph.shared-vault-projections.v1";

/** Relative path of the landing store inside a destination member's vault. */
export const SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH =
  "derived/vault-share/projections.json";

/** Projection kind whose landed record carries a member's display name. */
export const HOSTED_VAULT_SHARE_PROFILE_NAME_PROJECTION_KIND =
  "profile-name.v0" satisfies HostedVaultShareProjectionKind;

export interface SharedVaultShareRecordEntry {
  receivedEventId: string;
  record: HostedVaultShareDeliveryRecord;
  schema: typeof HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA;
  shareId: string;
}

export interface SharedVaultShareGrantorEntry {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  records: SharedVaultShareRecordEntry[];
  shareId: string;
  updatedAt: string;
}

export interface SharedVaultShareProjectionEntry {
  grantors: Record<string, SharedVaultShareGrantorEntry>;
}

export interface SharedVaultShareProjectionsFile {
  projections: Partial<
    Record<HostedVaultShareProjectionKind, SharedVaultShareProjectionEntry>
  >;
  schema: typeof SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA;
  updatedAt: string;
}

export function createEmptySharedVaultShareProjectionStore(): SharedVaultShareProjectionsFile {
  return {
    projections: {},
    schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

/**
 * Newest-first ordering for a grantor's landed records: occurredAt desc, then recordKey,
 * then receivedEventId. The importer's upsert and the reader's pivot both use it so a
 * grantor's records order identically no matter which side touched them last.
 */
export function compareSharedVaultShareRecords(
  left: SharedVaultShareRecordEntry,
  right: SharedVaultShareRecordEntry,
): number {
  return (
    right.record.occurredAt.localeCompare(left.record.occurredAt)
    || right.record.recordKey.localeCompare(left.record.recordKey)
    || right.receivedEventId.localeCompare(left.receivedEventId)
  );
}

/**
 * Read-only, tolerant parse of the landed store JSON. Returns null on any structural
 * mismatch so callers can decide their own recovery (the importer repairs; the reader
 * reports unavailable). Never throws, never mutates.
 */
export function parseSharedVaultShareProjectionStore(
  value: unknown,
): SharedVaultShareProjectionsFile | null {
  if (!isSharedVaultSharePlainRecord(value)) {
    return null;
  }
  if (value.schema !== SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA) {
    return null;
  }
  if (typeof value.updatedAt !== "string") {
    return null;
  }
  if (!isSharedVaultSharePlainRecord(value.projections)) {
    return null;
  }

  const projections: Partial<
    Record<HostedVaultShareProjectionKind, SharedVaultShareProjectionEntry>
  > = {};
  for (const projectionKind of HOSTED_VAULT_SHARE_PROJECTION_KINDS) {
    const projectionValue = value.projections[projectionKind];
    if (projectionValue === undefined) {
      continue;
    }
    const projection = parseSharedVaultShareProjection(projectionValue, projectionKind);
    if (!projection) {
      return null;
    }
    projections[projectionKind] = projection;
  }

  return {
    projections,
    schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
    updatedAt: value.updatedAt,
  };
}

function parseSharedVaultShareProjection(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareProjectionEntry | null {
  if (!isSharedVaultSharePlainRecord(value) || !isSharedVaultSharePlainRecord(value.grantors)) {
    return null;
  }

  const grantors: Record<string, SharedVaultShareGrantorEntry> = {};
  for (const [grantorMemberId, grantorValue] of Object.entries(value.grantors)) {
    const grantor = parseSharedVaultShareGrantor(grantorValue, projectionKind);
    if (!grantor || grantor.grantorMemberId !== grantorMemberId) {
      return null;
    }
    grantors[grantorMemberId] = grantor;
  }

  return { grantors };
}

function parseSharedVaultShareGrantor(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareGrantorEntry | null {
  if (!isSharedVaultSharePlainRecord(value)) {
    return null;
  }
  if (
    typeof value.grantorMemberId !== "string"
    || value.projectionKind !== projectionKind
    || typeof value.shareId !== "string"
    || typeof value.updatedAt !== "string"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  const records: SharedVaultShareRecordEntry[] = [];
  for (const record of value.records) {
    const parsed = parseSharedVaultShareRecordEntry(record, projectionKind);
    if (!parsed) {
      return null;
    }
    records.push(parsed);
  }

  return {
    grantorMemberId: value.grantorMemberId,
    projectionKind,
    records: records
      .sort(compareSharedVaultShareRecords)
      .slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS),
    shareId: value.shareId,
    updatedAt: value.updatedAt,
  };
}

function parseSharedVaultShareRecordEntry(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareRecordEntry | null {
  if (!isSharedVaultSharePlainRecord(value)) {
    return null;
  }
  if (
    typeof value.receivedEventId !== "string"
    || value.schema !== HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA
    || typeof value.shareId !== "string"
  ) {
    return null;
  }

  try {
    return {
      receivedEventId: value.receivedEventId,
      record: parseHostedVaultShareDeliveryRecord(value.record, projectionKind),
      schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
      shareId: value.shareId,
    };
  } catch {
    return null;
  }
}

export interface SharedGroupMemberShareView {
  projectionKind: HostedVaultShareProjectionKind;
  records: HostedVaultShareDeliveryRecord[];
}

/**
 * One group member's consented data as landed in this destination vault: the member's
 * shared display name (null until their `profile-name.v0` record has arrived) plus the
 * records they granted, grouped by projection kind. The `profile-name.v0` projection is
 * consumed as the name join here, never surfaced as a data share.
 */
export interface SharedGroupMemberView {
  displayName: string | null;
  memberId: string;
  shares: SharedGroupMemberShareView[];
}

/**
 * Pure kind-major -> member-major pivot over the landed store: the reader-facing shape.
 * Members are ordered named-first (by display name), then unnamed by member id, and each
 * member's shares follow the projection-kind registry order, so the same store always
 * renders the same view.
 */
export function flattenSharedVaultShareProjectionStore(
  store: SharedVaultShareProjectionsFile,
): SharedGroupMemberView[] {
  const memberIds = new Set<string>();
  for (const projectionKind of HOSTED_VAULT_SHARE_PROJECTION_KINDS) {
    const projection = store.projections[projectionKind];
    if (!projection) {
      continue;
    }
    for (const grantorMemberId of Object.keys(projection.grantors)) {
      memberIds.add(grantorMemberId);
    }
  }

  const views: SharedGroupMemberView[] = [];
  for (const memberId of memberIds) {
    const shares: SharedGroupMemberShareView[] = [];
    for (const projectionKind of HOSTED_VAULT_SHARE_PROJECTION_KINDS) {
      if (projectionKind === HOSTED_VAULT_SHARE_PROFILE_NAME_PROJECTION_KIND) {
        continue;
      }
      const grantor = store.projections[projectionKind]?.grantors[memberId];
      if (!grantor || grantor.records.length === 0) {
        continue;
      }
      shares.push({
        projectionKind,
        records: [...grantor.records]
          .sort(compareSharedVaultShareRecords)
          .map((entry) => entry.record),
      });
    }
    views.push({
      displayName: readSharedVaultShareProfileDisplayName(store, memberId),
      memberId,
      shares,
    });
  }

  return views.sort(compareSharedGroupMemberViews);
}

function readSharedVaultShareProfileDisplayName(
  store: SharedVaultShareProjectionsFile,
  memberId: string,
): string | null {
  const grantor =
    store.projections[HOSTED_VAULT_SHARE_PROFILE_NAME_PROJECTION_KIND]?.grantors[memberId];
  const data = grantor?.records[0]?.record.data;
  if (data && "displayName" in data && typeof data.displayName === "string") {
    return data.displayName;
  }
  return null;
}

function compareSharedGroupMemberViews(
  left: SharedGroupMemberView,
  right: SharedGroupMemberView,
): number {
  if (left.displayName && right.displayName) {
    return (
      left.displayName.localeCompare(right.displayName)
      || left.memberId.localeCompare(right.memberId)
    );
  }
  if (left.displayName) {
    return -1;
  }
  if (right.displayName) {
    return 1;
  }
  return left.memberId.localeCompare(right.memberId);
}

function isSharedVaultSharePlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
