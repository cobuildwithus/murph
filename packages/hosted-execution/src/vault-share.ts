import {
  isStrictIsoDate,
  isStrictIsoDateTime,
} from "@murphai/contracts";

import {
  requireArray,
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
export const HOSTED_VAULT_SHARE_PROJECTION_KINDS = [
  "sleep-times.v0",
] as const;

export type HostedVaultShareProjectionKind =
  (typeof HOSTED_VAULT_SHARE_PROJECTION_KINDS)[number];

export const HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA =
  "murph.vault-share.delivery.v1";

export const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS = 7;

const HOSTED_VAULT_SHARE_RECORD_KEY_MAX_LENGTH = 128;
const HOSTED_VAULT_SHARE_RECORD_KEY_PATTERN = /^[A-Za-z0-9._-]+$/u;

export interface HostedVaultShareSleepTimesData {
  date: string;
  sleepEndAt: string;
  sleepStartAt: string;
}

export type HostedVaultShareDeliveryRecordData = HostedVaultShareSleepTimesData;

export interface HostedVaultShareDeliveryRecord {
  data: HostedVaultShareDeliveryRecordData;
  occurredAt: string;
  recordKey: string;
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

export interface HostedVaultShareDeliveryPayload {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  record: HostedVaultShareDeliveryRecord;
  schema: typeof HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA;
  shareId: string;
}

export function isHostedVaultShareProjectionKind(
  value: unknown,
): value is HostedVaultShareProjectionKind {
  return HOSTED_VAULT_SHARE_PROJECTION_KINDS.includes(
    value as HostedVaultShareProjectionKind,
  );
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

export function buildHostedVaultShareDeliveryDedupeKey(input: {
  recordKey: string;
  shareId: string;
}): string {
  return `vault-share:${input.shareId}:${input.recordKey}`;
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
  };
}

function parseHostedVaultShareDeliveryRecordData(
  value: unknown,
  context: {
    occurredAt: string;
    projectionKind: HostedVaultShareProjectionKind;
    recordKey: string;
  },
): HostedVaultShareDeliveryRecordData {
  switch (context.projectionKind) {
    case "sleep-times.v0":
      return parseHostedVaultShareSleepTimesData(value, context);
  }
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
