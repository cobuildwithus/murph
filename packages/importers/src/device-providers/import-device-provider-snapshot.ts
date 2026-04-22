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
import { buildWearableRawIngestEnvelope } from "./raw-ingest-envelope.ts";
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
  const basePayload = stripUndefined({
    vaultRoot: request.vaultRoot,
    ...normalized,
    accountId: normalized.accountId ?? request.accountId,
  });
  const rawEnvelope = buildWearableRawIngestEnvelope({
    provider: basePayload.provider,
    payload: request.snapshot,
    userId: request.userId,
    accountId: basePayload.accountId,
    connectionId: request.connectionId,
    sourceKind: request.sourceKind,
    deliveryMode: request.deliveryMode,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    providerEventId: request.providerEventId,
    eventType: request.eventType,
    observedAt: request.observedAt ?? basePayload.importedAt,
    occurredAt: request.occurredAt,
    windowStart: request.windowStart,
    windowEnd: request.windowEnd,
    cursor: request.cursor,
    signatureVerified: request.signatureVerified,
  });
  const payloadWithLegacyRawRole = attachSingleLegacyRawArtifactRole(basePayload);
  const canonicalWearableRecords = canonicalizeDeviceBatchPayload(payloadWithLegacyRawRole, {
    rawEnvelope,
    connectionId: request.connectionId,
    normalizerVersion: request.normalizerVersion,
    observedAt: rawEnvelope.observedAt,
  });

  return stripUndefined({
    ...payloadWithLegacyRawRole,
    rawArtifacts: [
      ...(payloadWithLegacyRawRole.rawArtifacts ?? []),
      buildRawEnvelopeArtifact(rawEnvelope),
      buildCanonicalWearableRecordsArtifact(basePayload.provider, rawEnvelope.id, canonicalWearableRecords),
    ],
    rawIngestEnvelopes: [rawEnvelope],
    canonicalWearableRecords,
    provenance: stripUndefined({
      ...(payloadWithLegacyRawRole.provenance ?? {}),
      wearableRawEnvelope: {
        id: rawEnvelope.id,
        deliveryMode: rawEnvelope.deliveryMode,
        payloadHash: rawEnvelope.payloadHash,
        sourceKind: rawEnvelope.sourceKind,
      },
      canonicalWearableRecordCount: canonicalWearableRecords.length,
      normalizerVersion: request.normalizerVersion,
    }),
  });
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

function buildRawEnvelopeArtifact(
  rawEnvelope: ReturnType<typeof buildWearableRawIngestEnvelope>,
): DeviceRawArtifactPayload {
  return {
    role: `wearable-raw-envelope:${rawEnvelope.id}`,
    fileName: `${rawEnvelope.provider}-raw-ingest-envelope-${rawEnvelope.id}.json`,
    mediaType: "application/json",
    content: rawEnvelope,
    metadata: {
      schemaVersion: rawEnvelope.schemaVersion,
      payloadHash: rawEnvelope.payloadHash,
    },
  };
}

function buildCanonicalWearableRecordsArtifact(
  provider: string,
  rawEnvelopeId: string,
  records: readonly unknown[],
): DeviceRawArtifactPayload {
  return {
    role: `wearable-canonical-records:${rawEnvelopeId}`,
    fileName: `${provider}-canonical-wearable-records-${rawEnvelopeId}.json`,
    mediaType: "application/json",
    content: {
      schemaVersion: "wearable.canonical_record_batch.v1",
      rawEnvelopeId,
      records,
    },
    metadata: {
      schemaVersion: "wearable.canonical_record_batch.v1",
      rawEnvelopeId,
      recordCount: records.length,
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
