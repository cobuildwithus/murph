import * as z from "@murphai/contracts/zod-runtime";

import { assertCanonicalWritePort } from "../core-port.ts";
import type { DeviceBatchImportPayload, DeviceEvidencePartPayload } from "../core-port.ts";
import {
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "../shared.ts";

import { defaultDeviceProviderAdapters } from "./defaults.ts";
import { deriveJunctionCanonicalCoverageEvidence } from "./junction.ts";
import { buildWearableRawIngestReceipt } from "./raw-ingest-receipt.ts";
import { createDeviceProviderRegistry } from "./registry.ts";

import type { DeviceProviderRegistry } from "./registry.ts";

export interface DeviceProviderImporterExecutionOptions {
  corePort?: unknown;
  defaultTimeZone?: string;
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
  {
    defaultTimeZone,
    providerRegistry,
  }: Pick<DeviceProviderImporterExecutionOptions, "providerRegistry"> & {
    defaultTimeZone?: string;
  } = {},
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
  const normalized = await adapter.normalizeSnapshot(snapshot, { defaultTimeZone });
  const sanitizedSnapshot = adapter.sanitizeRawSnapshot
    ? adapter.sanitizeRawSnapshot(snapshot)
    : request.snapshot;
  const observedAt = resolveStableRawReceiptObservedAt(request, normalized);
  const basePayload = stripUndefined({
    vaultRoot: request.vaultRoot,
    provider: normalized.provider,
    accountId: normalized.accountId ?? request.accountId,
    importedAt: observedAt,
    source: normalized.source,
    dataOrigin: normalized.dataOrigin,
    events: normalized.events,
    samples: normalized.samples,
    evidenceParts: normalized.evidenceParts,
    provenance: normalized.provenance,
  });
  const payloadWithEvidence = ensureProviderEvidencePart(basePayload, sanitizedSnapshot);
  const payloadWithSingleEvidenceFallback = attachSingleEvidenceRole(payloadWithEvidence);
  const rawReceipt = buildWearableRawIngestReceipt({
    provider: basePayload.provider,
    payloadForHash: sanitizedSnapshot,
    rawArtifactRoles: (payloadWithSingleEvidenceFallback.evidenceParts ?? []).map((part) => part.role),
    userId: request.userId,
    accountId: basePayload.accountId,
    connectionId: request.connectionId,
    sourceKind: request.sourceKind,
    deliveryMode: request.deliveryMode,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    providerEventId: request.providerEventId,
    eventType: request.eventType,
    observedAt,
    occurredAt: request.occurredAt,
    windowStart: request.windowStart,
    windowEnd: request.windowEnd,
    cursor: request.cursor,
    signatureVerified: request.signatureVerified,
  });
  const ingestReceipt: Record<string, unknown> = { ...rawReceipt };

  return stripUndefined({
    ...payloadWithSingleEvidenceFallback,
    ingestReceipt,
    provenance: stripUndefined({
      ...(payloadWithSingleEvidenceFallback.provenance ?? {}),
      wearableRawReceipt: {
        id: rawReceipt.id,
        deliveryMode: rawReceipt.deliveryMode,
        payloadHash: rawReceipt.payloadHash,
        sourceKind: rawReceipt.sourceKind,
      },
      normalizerVersion: request.normalizerVersion,
    }),
  });
}

interface VaultMetadataReadPort {
  loadVault(input: { vaultRoot?: string }): Promise<{ metadata: { timezone?: string } }>;
}

function isVaultMetadataReadPort(value: unknown): value is VaultMetadataReadPort {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { loadVault?: unknown }).loadVault === "function",
  );
}

async function resolveSnapshotImportDefaultTimeZone(
  input: unknown,
  corePort: unknown,
): Promise<string | undefined> {
  const request = deviceProviderSnapshotImportSchema.safeParse(input);
  if (!request.success || !request.data.vaultRoot || !isVaultMetadataReadPort(corePort)) {
    return undefined;
  }

  const vault = await corePort.loadVault({ vaultRoot: request.data.vaultRoot });
  return vault.metadata.timezone;
}

function attachSingleEvidenceRole(payload: DeviceBatchImportPayload): DeviceBatchImportPayload {
  if ((payload.evidenceParts ?? []).length !== 1) {
    return payload;
  }

  const [evidencePart] = payload.evidenceParts ?? [];
  if (!evidencePart) {
    return payload;
  }

  return {
    ...payload,
    events: (payload.events ?? []).map((event) => event.evidenceRoles?.length
      ? event
      : { ...event, evidenceRoles: [evidencePart.role] }),
  };
}

function ensureProviderEvidencePart(
  payload: DeviceBatchImportPayload,
  rawSnapshot: unknown,
): DeviceBatchImportPayload {
  if ((payload.evidenceParts ?? []).length > 0 || !hasRetainableEvidencePartContent(rawSnapshot)) {
    return payload;
  }

  return {
    ...payload,
    evidenceParts: [buildProviderSnapshotEvidencePart(payload.provider, rawSnapshot)],
  };
}

function buildProviderSnapshotEvidencePart(
  provider: string,
  rawSnapshot: unknown,
): DeviceEvidencePartPayload {
  return {
    role: "provider-snapshot",
    fileName: `${sanitizeEvidencePartFileToken(provider)}-provider-snapshot.json`,
    mediaType: "application/json",
    content: rawSnapshot,
  };
}

function hasRetainableEvidencePartContent(value: unknown): boolean {
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

function sanitizeEvidencePartFileToken(value: string): string {
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

export async function importDeviceProviderSnapshot<TResult = unknown>(
  input: unknown,
  { corePort, defaultTimeZone, providerRegistry }: DeviceProviderImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importDeviceBatch"]);
  const resolvedDefaultTimeZone =
    defaultTimeZone ?? await resolveSnapshotImportDefaultTimeZone(input, corePort);
  const payload = await prepareDeviceProviderSnapshotImport(input, {
    defaultTimeZone: resolvedDefaultTimeZone,
    providerRegistry,
  });
  const result = await writer.importDeviceBatch(payload);
  const resultRecord = readPlainObject(result);
  if (payload.provider !== "junction" || !resultRecord || !Array.isArray(resultRecord.events)) {
    return result as TResult;
  }

  return {
    ...resultRecord,
    junctionCanonicalCoverage: deriveJunctionCanonicalCoverageEvidence(
      resultRecord.events.filter(isEventRecord),
      {
        defaultTimeZone: resolvedDefaultTimeZone,
        providerPulledAt: resolveJunctionCoverageProviderPulledAt(input),
      },
    ),
  } as TResult;
}

function resolveJunctionCoverageProviderPulledAt(input: unknown): string | undefined {
  const request = deviceProviderSnapshotImportSchema.safeParse(input);
  if (!request.success || request.data.provider !== "junction") {
    return undefined;
  }
  const providerPulledAt = readPlainObject(request.data.snapshot)
    ?.canonicalCoverageProviderPulledAt;
  return typeof providerPulledAt === "string" ? providerPulledAt : undefined;
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isEventRecord(value: unknown): value is Parameters<
  typeof deriveJunctionCanonicalCoverageEvidence
>[0][number] {
  const record = readPlainObject(value);
  return Boolean(
    record
    && typeof record.kind === "string"
    && typeof record.occurredAt === "string"
    && typeof record.dayKey === "string",
  );
}
