import { createHash } from "node:crypto";
import {
  hashWearableRawPayload,
  stableStringifyWearableRawPayload,
  type WearableRawPayloadJsonValue,
} from "@murphai/core";

export type WearableRawIngestJsonValue = WearableRawPayloadJsonValue;

export type WearableRawIngestSourceKind = "poll" | "webhook" | "sdk" | "xml" | "manual";
export type WearableRawIngestDeliveryMode =
  | "full_payload"
  | "notification_only"
  | "scheduled_reconcile";
export type WearableRawIngestEventType = "create" | "update" | "delete" | "deauthorize";

export interface WearableRawIngestReceipt {
  id: string;
  provider: string;
  schemaVersion: "wearable.raw_ingest_receipt.v1";
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

export interface BuildWearableRawIngestReceiptInput {
  provider: string;
  payloadForHash: unknown;
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

export function buildWearableRawIngestReceipt(
  input: BuildWearableRawIngestReceiptInput,
): WearableRawIngestReceipt {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const payloadHash = hashWearableRawPayload(input.payloadForHash);
  const rawArtifactRoles = normalizeRawArtifactRoles(input.rawArtifactRoles);
  const id = buildWearableRawIngestReceiptId({
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
    schemaVersion: "wearable.raw_ingest_receipt.v1" as const,
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

function buildWearableRawIngestReceiptId(input: {
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
  return stableStringifyWearableRawPayload(value);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
