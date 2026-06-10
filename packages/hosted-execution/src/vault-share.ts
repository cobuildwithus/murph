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
 * fixed-schema projection. Adding a kind means adding a schema and a projector, never
 * widening an existing payload.
 */
export const HOSTED_VAULT_SHARE_PROJECTION_KINDS = [
  "sleep-times.v0",
] as const;

export type HostedVaultShareProjectionKind =
  (typeof HOSTED_VAULT_SHARE_PROJECTION_KINDS)[number];

export const HOSTED_VAULT_SHARE_DELIVERY_MAILBOX_KIND = "vault-share.delivery";

export const HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA =
  "murph.vault-share.delivery.v1";

export const HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHTS = 7;

const HOSTED_VAULT_SHARE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface HostedVaultShareSleepNight {
  date: string;
  sleepEndAt: string;
  sleepStartAt: string;
}

export interface HostedVaultShareDeliverRequest {
  nights: HostedVaultShareSleepNight[];
  projectionKind: HostedVaultShareProjectionKind;
}

export interface HostedVaultShareDeliverResponse {
  appendedCount: number;
  duplicateCount: number;
  status: "delivered" | "no-active-share";
}

export interface HostedVaultShareDeliveryPayload {
  grantorMemberId: string;
  night: HostedVaultShareSleepNight;
  projectionKind: HostedVaultShareProjectionKind;
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

export function parseHostedVaultShareProjectionKind(
  value: unknown,
  label: string,
): HostedVaultShareProjectionKind {
  if (isHostedVaultShareProjectionKind(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known vault-share projection kind.`);
}

export function buildHostedVaultShareDeliveryDedupeKey(input: {
  date: string;
  shareId: string;
}): string {
  return `vault-share:${input.shareId}:${input.date}`;
}

export function parseHostedVaultShareSleepNight(
  value: unknown,
): HostedVaultShareSleepNight {
  const record = requireObject(value, "Vault share sleep night");
  const date = requireString(record.date, "Vault share sleep night date");

  if (!HOSTED_VAULT_SHARE_DATE_PATTERN.test(date)) {
    throw new TypeError("Vault share sleep night date must be formatted YYYY-MM-DD.");
  }

  return {
    date,
    sleepEndAt: requireIsoTimestamp(
      record.sleepEndAt,
      "Vault share sleep night sleepEndAt",
    ),
    sleepStartAt: requireIsoTimestamp(
      record.sleepStartAt,
      "Vault share sleep night sleepStartAt",
    ),
  };
}

export function parseHostedVaultShareDeliverRequest(
  value: unknown,
): HostedVaultShareDeliverRequest {
  const record = requireObject(value, "Vault share deliver request");
  const nights = requireArray(record.nights, "Vault share deliver request nights");

  if (nights.length === 0) {
    throw new TypeError("Vault share deliver request nights must not be empty.");
  }

  if (nights.length > HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHTS) {
    throw new TypeError(
      `Vault share deliver request nights must contain at most ${HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHTS} nights.`,
    );
  }

  return {
    nights: nights.map((night) => parseHostedVaultShareSleepNight(night)),
    projectionKind: parseHostedVaultShareProjectionKind(
      record.projectionKind,
      "Vault share deliver request projectionKind",
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

  return {
    appendedCount: requireNonNegativeCount(
      record.appendedCount,
      "Vault share deliver response appendedCount",
    ),
    duplicateCount: requireNonNegativeCount(
      record.duplicateCount,
      "Vault share deliver response duplicateCount",
    ),
    status,
  };
}

export function parseHostedVaultShareDeliveryPayload(
  value: unknown,
): HostedVaultShareDeliveryPayload {
  const record = requireObject(value, "Vault share delivery payload");
  const schema = requireString(record.schema, "Vault share delivery payload schema");

  if (schema !== HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA) {
    throw new TypeError(
      `Vault share delivery payload schema must be ${HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA}.`,
    );
  }

  return {
    grantorMemberId: requireString(
      record.grantorMemberId,
      "Vault share delivery payload grantorMemberId",
    ),
    night: parseHostedVaultShareSleepNight(record.night),
    projectionKind: parseHostedVaultShareProjectionKind(
      record.projectionKind,
      "Vault share delivery payload projectionKind",
    ),
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: requireString(record.shareId, "Vault share delivery payload shareId"),
  };
}

const HOSTED_VAULT_SHARE_ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (
    !HOSTED_VAULT_SHARE_ISO_TIMESTAMP_PATTERN.test(text)
    || Number.isNaN(Date.parse(text))
  ) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return text;
}

function requireNonNegativeCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}
