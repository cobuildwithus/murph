import { createHash } from "node:crypto";

export type WearableRawIngestJsonValue =
  | null
  | boolean
  | number
  | string
  | WearableRawIngestJsonValue[]
  | { [key: string]: WearableRawIngestJsonValue };

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
  rawArtifactRoles: string[];
  rawArtifactCount: number;
}

export interface BuildWearableRawIngestEnvelopeInput {
  provider: string;
  payload: unknown;
  rawArtifactRoles?: readonly string[];
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
  const payload = normalizeWearableRawIngestJsonPayload(input.payload);
  const payloadHash = sha256Hex(stableStringify(payload));
  const rawArtifactRoles = normalizeRawArtifactRoles(input.rawArtifactRoles);
  const id = buildWearableRawIngestEnvelopeId({
    provider: input.provider,
    accountId: input.accountId,
    connectionId: input.connectionId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    providerEventId: input.providerEventId,
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
    rawArtifactRoles,
    rawArtifactCount: rawArtifactRoles.length,
  });
}

function normalizeRawArtifactRoles(rawArtifactRoles: readonly string[] | undefined): string[] {
  return [...(rawArtifactRoles ?? [])];
}

function buildWearableRawIngestEnvelopeId(input: {
  provider: string;
  accountId?: string;
  connectionId?: string;
  resourceType?: string;
  resourceId?: string;
  providerEventId?: string;
  payloadHash: string;
}): string {
  const digest = sha256Hex(stableStringify(input)).slice(0, 24);
  return `wearable_raw_${digest}`;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(normalizeWearableRawIngestJsonPayload(value)));
}

function normalizeWearableRawIngestJsonPayload(value: unknown): WearableRawIngestJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Wearable raw ingest payload must contain only finite JSON numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeWearableRawIngestJsonPayload);
  }
  if (isPlainJsonObject(value)) {
    const normalized: Array<[string, WearableRawIngestJsonValue]> = [];
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        normalized.push([key, normalizeWearableRawIngestJsonPayload(entry)]);
      }
    }
    return Object.fromEntries(normalized) as { [key: string]: WearableRawIngestJsonValue };
  }

  throw new TypeError("Wearable raw ingest payload must be JSON-serializable.");
}

function sortJsonValue(value: WearableRawIngestJsonValue): WearableRawIngestJsonValue {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
