import { z } from "zod";

import { assertCanonicalWritePort } from "../core-port.ts";
import type { DeviceBatchImportPayload, DeviceRawArtifactPayload } from "../core-port.ts";
import {
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "../shared.ts";

import { canonicalizeDeviceBatchPayload } from "./canonical-wearable-records.ts";
import { defaultDeviceProviderAdapters } from "./defaults.ts";
import { buildWearableRawIngestReceipt } from "./raw-ingest-receipt.ts";
import { createDeviceProviderRegistry } from "./registry.ts";

import type { DeviceProviderRegistry } from "./registry.ts";

export interface DeviceProviderImporterExecutionOptions {
  corePort?: unknown;
  providerRegistry?: DeviceProviderRegistry;
}

export interface DeviceProviderSnapshotImportInput {
  provider: string;
  snapshot: unknown;
  vaultRoot?: string;
  userId?: string;
  accountId?: string;
  connectionId?: string;
  sourceKind?: "poll" | "webhook" | "sdk" | "xml" | "manual";
  deliveryMode?: "full_payload" | "notification_only" | "scheduled_reconcile";
  resourceType?: string;
  resourceId?: string;
  providerEventId?: string;
  eventType?: "create" | "update" | "delete" | "deauthorize";
  observedAt?: string;
  occurredAt?: string;
  windowStart?: string;
  windowEnd?: string;
  cursor?: string;
  signatureVerified?: boolean;
  normalizerVersion?: string;
}

const rawIngestSourceKindSchema = z.enum(["poll", "webhook", "sdk", "xml", "manual"]);
const rawIngestDeliveryModeSchema = z.enum(["full_payload", "notification_only", "scheduled_reconcile"]);
const rawIngestEventTypeSchema = z.enum(["create", "update", "delete", "deauthorize"]);

const deviceProviderSnapshotImportSchema = z
  .object({
    provider: requiredTrimmedStringSchema("provider"),
    snapshot: z.unknown(),
    vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
    userId: optionalTrimmedStringSchema("userId"),
    accountId: optionalTrimmedStringSchema("accountId"),
    connectionId: optionalTrimmedStringSchema("connectionId"),
    sourceKind: rawIngestSourceKindSchema.optional(),
    deliveryMode: rawIngestDeliveryModeSchema.optional(),
    resourceType: optionalTrimmedStringSchema("resourceType"),
    resourceId: optionalTrimmedStringSchema("resourceId"),
    providerEventId: optionalTrimmedStringSchema("providerEventId"),
    eventType: rawIngestEventTypeSchema.optional(),
    observedAt: optionalTrimmedStringSchema("observedAt"),
    occurredAt: optionalTrimmedStringSchema("occurredAt"),
    windowStart: optionalTrimmedStringSchema("windowStart"),
    windowEnd: optionalTrimmedStringSchema("windowEnd"),
    cursor: optionalTrimmedStringSchema("cursor"),
    signatureVerified: z.boolean().optional(),
    normalizerVersion: optionalTrimmedStringSchema("normalizerVersion"),
  })
  .passthrough();

function resolveRegistry(registry?: DeviceProviderRegistry): DeviceProviderRegistry {
  return registry ?? createDeviceProviderRegistry(defaultDeviceProviderAdapters);
}

export async function prepareDeviceProviderSnapshotImport(
  input: unknown,
  { providerRegistry }: Pick<DeviceProviderImporterExecutionOptions, "providerRegistry"> = {},
): Promise<DeviceBatchImportPayload> {
  const request = parseInputObject(
    input,
    "device provider snapshot import input",
    deviceProviderSnapshotImportSchema,
  );
  const registry = resolveRegistry(providerRegistry);
  const adapter = registry.get(request.provider);

  if (!adapter) {
    throw new TypeError(`device provider "${request.provider}" is not registered`);
  }

  const snapshot = adapter.parseSnapshot
    ? adapter.parseSnapshot(request.snapshot)
    : request.snapshot;
  const normalized = await adapter.normalizeSnapshot(snapshot);
  const rawSnapshot = adapter.sanitizeRawSnapshot
    ? adapter.sanitizeRawSnapshot(snapshot)
    : request.snapshot;
  const rawObservedAt = resolveStableRawReceiptObservedAt(request, normalized);
  const basePayload = stripUndefined({
    vaultRoot: request.vaultRoot,
    provider: normalized.provider,
    accountId: normalized.accountId ?? request.accountId,
    importedAt: rawObservedAt,
    source: normalized.source,
    dataOrigin: normalized.dataOrigin,
    events: normalized.events,
    samples: normalized.samples,
    rawArtifacts: normalized.rawArtifacts,
    rawIngestReceipts: normalized.rawIngestReceipts,
    canonicalWearableRecords: normalized.canonicalWearableRecords,
    provenance: normalized.provenance,
  });
  const payloadWithRawEvidence = ensureProviderRawArtifact(basePayload, rawSnapshot);
  const payloadWithLegacyRawRole = attachSingleLegacyRawArtifactRole(payloadWithRawEvidence);
  const rawReceipt = buildWearableRawIngestReceipt({
    provider: basePayload.provider,
    payloadForHash: rawSnapshot,
    rawArtifactRoles: (payloadWithLegacyRawRole.rawArtifacts ?? []).map((artifact) => artifact.role),
    userId: request.userId,
    accountId: basePayload.accountId,
    connectionId: request.connectionId,
    sourceKind: request.sourceKind,
    deliveryMode: request.deliveryMode,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    providerEventId: request.providerEventId,
    eventType: request.eventType,
    observedAt: rawObservedAt,
    occurredAt: request.occurredAt,
    windowStart: request.windowStart,
    windowEnd: request.windowEnd,
    cursor: request.cursor,
    signatureVerified: request.signatureVerified,
  });
  const canonicalWearableRecords = canonicalizeDeviceBatchPayload(payloadWithLegacyRawRole, {
    rawReceipt,
    connectionId: request.connectionId,
    normalizerVersion: request.normalizerVersion,
    observedAt: rawReceipt.observedAt,
  });

  const payloadForCore = omitDefaultJunctionTimeseriesEvents(payloadWithLegacyRawRole);

  return stripUndefined({
    ...payloadForCore,
    rawArtifacts: [
      ...(payloadForCore.rawArtifacts ?? []),
      buildRawReceiptArtifact(rawReceipt),
    ],
    rawIngestReceipts: [rawReceipt],
    canonicalWearableRecords,
    provenance: stripUndefined({
      ...(payloadWithLegacyRawRole.provenance ?? {}),
      wearableRawReceipt: {
        id: rawReceipt.id,
        deliveryMode: rawReceipt.deliveryMode,
        payloadHash: rawReceipt.payloadHash,
        sourceKind: rawReceipt.sourceKind,
      },
      canonicalWearableRecordCount: canonicalWearableRecords.length,
      normalizerVersion: request.normalizerVersion,
    }),
  });
}

function omitDefaultJunctionTimeseriesEvents(payload: DeviceBatchImportPayload): DeviceBatchImportPayload {
  const filteredEvents = (payload.events ?? []).filter((event) => !isJunctionTimeseriesObservationEvent(event));

  if (filteredEvents.length === (payload.events ?? []).length) {
    return payload;
  }

  return stripUndefined({
    ...payload,
    events: filteredEvents,
  });
}

function isJunctionTimeseriesObservationEvent(event: NonNullable<DeviceBatchImportPayload["events"]>[number]): boolean {
  return (
    event.kind === "observation" &&
    event.externalRef?.system === "junction" &&
    (event.rawArtifactRoles ?? []).some((role) => role.startsWith("junction-timeseries-"))
  );
}

function attachSingleLegacyRawArtifactRole(payload: DeviceBatchImportPayload): DeviceBatchImportPayload {
  if ((payload.rawArtifacts ?? []).length !== 1) {
    return payload;
  }

  const [rawArtifact] = payload.rawArtifacts ?? [];
  if (!rawArtifact) {
    return payload;
  }

  return {
    ...payload,
    events: (payload.events ?? []).map((event) => event.rawArtifactRoles?.length
      ? event
      : { ...event, rawArtifactRoles: [rawArtifact.role] }),
  };
}

function ensureProviderRawArtifact(
  payload: DeviceBatchImportPayload,
  rawSnapshot: unknown,
): DeviceBatchImportPayload {
  if ((payload.rawArtifacts ?? []).length > 0 || !hasRetainableRawArtifactContent(rawSnapshot)) {
    return payload;
  }

  return {
    ...payload,
    rawArtifacts: [buildProviderRawSnapshotArtifact(payload.provider, rawSnapshot)],
  };
}

function buildProviderRawSnapshotArtifact(
  provider: string,
  rawSnapshot: unknown,
): DeviceRawArtifactPayload {
  return {
    role: "provider-snapshot",
    fileName: `${sanitizeRawArtifactFileToken(provider)}-provider-snapshot.json`,
    mediaType: "application/json",
    content: rawSnapshot,
  };
}

function hasRetainableRawArtifactContent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return true;
}

function sanitizeRawArtifactFileToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "provider";
}

function resolveStableRawReceiptObservedAt(
  request: DeviceProviderSnapshotImportInput,
  payload: DeviceBatchImportPayload,
): string {
  return firstValidTimestamp(
    request.observedAt,
    request.occurredAt,
    request.windowEnd,
    request.windowStart,
    earliestPayloadTimestamp(payload),
    payload.importedAt,
  ) ?? new Date(0).toISOString();
}

function earliestPayloadTimestamp(payload: DeviceBatchImportPayload): string | undefined {
  return firstValidTimestamp(
    ...(payload.events ?? []).flatMap((event) => [
      event.recordedAt,
      event.occurredAt,
    ]),
    ...(payload.samples ?? []).flatMap((sample) => [
      sample.recordedAt,
      sample.sample.recordedAt,
      sample.sample.occurredAt,
      sample.sample.startAt,
      sample.sample.endAt,
    ]),
  );
}

function firstValidTimestamp(...candidates: Array<string | undefined>): string | undefined {
  const validCandidates = candidates
    .filter((candidate): candidate is string =>
      typeof candidate === "string" && Number.isFinite(Date.parse(candidate))
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return validCandidates[0];
}

function buildRawReceiptArtifact(
  rawReceipt: ReturnType<typeof buildWearableRawIngestReceipt>,
): DeviceRawArtifactPayload {
  return {
    role: `wearable-raw-receipt:${rawReceipt.id}`,
    fileName: `${rawReceipt.provider}-raw-ingest-receipt-${rawReceipt.id}.json`,
    mediaType: "application/json",
    content: rawReceipt,
    metadata: {
      schemaVersion: rawReceipt.schemaVersion,
      payloadHash: rawReceipt.payloadHash,
    },
  };
}

export async function importDeviceProviderSnapshot<TResult = unknown>(
  input: unknown,
  { corePort, providerRegistry }: DeviceProviderImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importDeviceBatch"]);
  const payload = await prepareDeviceProviderSnapshotImport(input, { providerRegistry });
  return (await writer.importDeviceBatch(payload)) as TResult;
}
