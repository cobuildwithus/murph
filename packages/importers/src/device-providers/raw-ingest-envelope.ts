import { createHash } from "node:crypto";

export type WearableRawIngestSourceKind = "poll" | "webhook" | "sdk" | "xml" | "manual";
export type WearableRawIngestDeliveryMode =
  | "full_payload"
  | "notification_only"
  | "scheduled_reconcile";
export type WearableRawIngestEventType = "create" | "update" | "delete" | "deauthorize";

export interface WearableRawIngestEnvelope {
  id: string;
  provider: string;
  schemaVersion: "wearable.raw_ingest.v1";
  userId?: string;
  accountId?: string;
  connectionId?: string;
  sourceKind: WearableRawIngestSourceKind;
  deliveryMode: WearableRawIngestDeliveryMode;
  resourceType?: string;
  resourceId?: string;
  providerEventId?: string;
  eventType?: WearableRawIngestEventType;
  observedAt: string;
  occurredAt?: string;
  windowStart?: string;
  windowEnd?: string;
  cursor?: string;
  signatureVerified?: boolean;
  payloadHash: string;
  payload: unknown;
}

export interface BuildWearableRawIngestEnvelopeInput {
  provider: string;
  payload: unknown;
  userId?: string;
  accountId?: string;
  connectionId?: string;
  sourceKind?: WearableRawIngestSourceKind;
  deliveryMode?: WearableRawIngestDeliveryMode;
  resourceType?: string;
  resourceId?: string;
  providerEventId?: string;
  eventType?: WearableRawIngestEventType;
  observedAt?: string;
  occurredAt?: string;
  windowStart?: string;
  windowEnd?: string;
  cursor?: string;
  signatureVerified?: boolean;
}

export function buildWearableRawIngestEnvelope(
  input: BuildWearableRawIngestEnvelopeInput,
): WearableRawIngestEnvelope {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const payloadHash = sha256Hex(stableStringify(input.payload));
  const id = buildWearableRawIngestEnvelopeId({
    provider: input.provider,
    accountId: input.accountId,
    connectionId: input.connectionId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    providerEventId: input.providerEventId,
    observedAt,
    payloadHash,
  });

  return stripUndefined({
    id,
    provider: input.provider,
    schemaVersion: "wearable.raw_ingest.v1" as const,
    userId: input.userId,
    accountId: input.accountId,
    connectionId: input.connectionId,
    sourceKind: input.sourceKind ?? "poll",
    deliveryMode: input.deliveryMode ?? "full_payload",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    observedAt,
    occurredAt: input.occurredAt,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    cursor: input.cursor,
    signatureVerified: input.signatureVerified,
    payloadHash,
    payload: input.payload,
  });
}

function buildWearableRawIngestEnvelopeId(input: {
  provider: string;
  accountId?: string;
  connectionId?: string;
  resourceType?: string;
  resourceId?: string;
  providerEventId?: string;
  observedAt: string;
  payloadHash: string;
}): string {
  const digest = sha256Hex(stableStringify(input)).slice(0, 24);
  return `wearable_raw_${digest}`;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
