import { createHash } from "node:crypto";

import type {
  DeviceBatchImportPayload,
  DeviceDataOrigin,
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceSamplePayload,
} from "../core-port.ts";
import {
  normalizeWearableMetricValue,
  resolveWearableCanonicalMetricKey,
  type WearableCanonicalMetricKey,
} from "./metric-catalog.ts";
import { stableStringify, type WearableRawIngestEnvelope } from "./raw-ingest-envelope.ts";

export type CanonicalWearableRecordKind = "observation" | "sample" | "session" | "tombstone";
export type CanonicalWearableSchemaVersion = "wearable.canonical_record.v1";

export type { DeviceDataOrigin } from "../core-port.ts";

export interface CanonicalWearableSource {
  provider: string;
  connectionId?: string;
  dataSourceId: string;
  rawEnvelopeId?: string;
  providerResourceType?: string;
  providerResourceId?: string;
  providerAccountIdHash?: string;
  normalizerVersion: string;
  externalRef?: DeviceExternalRefPayload;
  origin?: DeviceDataOrigin;
  rawArtifactRoles: readonly string[];
}

interface CanonicalWearableRecordBase {
  id: string;
  kind: CanonicalWearableRecordKind;
  schemaVersion: CanonicalWearableSchemaVersion;
  dayKey?: string;
  observedAt: string;
  recordedAt?: string;
  occurredAt?: string;
  timeZone?: string;
  source: CanonicalWearableSource;
}

export interface CanonicalWearableObservationRecord extends CanonicalWearableRecordBase {
  kind: "observation";
  metric: WearableCanonicalMetricKey;
  unit: string;
  value: number;
  title?: string;
  note?: string;
}

export interface CanonicalWearableSampleRecord extends CanonicalWearableRecordBase {
  kind: "sample";
  metric: WearableCanonicalMetricKey;
  unit: string;
  value: number;
}

export interface CanonicalWearableSessionRecord extends CanonicalWearableRecordBase {
  kind: "session";
  sessionKind: string;
  durationMinutes?: number;
  endAt?: string;
  startAt?: string;
  title?: string;
  metrics?: Record<string, number>;
}

export interface CanonicalWearableTombstoneRecord extends CanonicalWearableRecordBase {
  kind: "tombstone";
  providerResourceType: string;
  providerResourceId: string;
  deletedAt: string;
  reason?: string;
}

export type CanonicalWearableRecord =
  | CanonicalWearableObservationRecord
  | CanonicalWearableSampleRecord
  | CanonicalWearableSessionRecord
  | CanonicalWearableTombstoneRecord;

export interface CanonicalizeDeviceBatchOptions {
  rawEnvelope?: WearableRawIngestEnvelope;
  connectionId?: string;
  dataOrigin?: DeviceDataOrigin;
  normalizerVersion?: string;
  observedAt?: string;
}

type CanonicalizeContext = Required<Pick<CanonicalizeDeviceBatchOptions, "observedAt" | "normalizerVersion">> &
  Pick<CanonicalizeDeviceBatchOptions, "connectionId" | "dataOrigin" | "rawEnvelope">;

export function canonicalizeDeviceBatchPayload(
  payload: DeviceBatchImportPayload,
  options: CanonicalizeDeviceBatchOptions = {},
): CanonicalWearableRecord[] {
  const observedAt = options.observedAt ?? payload.importedAt ?? new Date().toISOString();
  const normalizerVersion = options.normalizerVersion ?? "device-provider-normalizer.v1";

  return [
    ...(payload.events ?? []).flatMap((event) => canonicalizeEvent(event, payload, {
      observedAt,
      normalizerVersion,
      rawEnvelope: options.rawEnvelope,
      connectionId: options.connectionId,
      dataOrigin: options.dataOrigin,
    })),
    ...(payload.samples ?? []).flatMap((sample) => canonicalizeSample(sample, payload, {
      observedAt,
      normalizerVersion,
      rawEnvelope: options.rawEnvelope,
      connectionId: options.connectionId,
      dataOrigin: options.dataOrigin,
    })),
  ];
}

function canonicalizeEvent(
  event: DeviceEventPayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): CanonicalWearableRecord[] {
  if (isDeletionEvent(event)) {
    return [buildTombstoneRecord(event, payload, context)];
  }

  if (event.kind === "activity_session" || event.kind === "sleep_session") {
    return [buildSessionRecord(event, payload, context)];
  }

  const metric = readStringField(event.fields, "metric");
  const value = readFiniteNumberField(event.fields, "value");
  const normalizedMetric = metric && value !== null
    ? normalizeWearableMetricValue(metric, value, readStringField(event.fields, "unit"))
    : null;

  if (!normalizedMetric) {
    return [];
  }

  const record: CanonicalWearableObservationRecord = stripUndefined({
    id: buildCanonicalRecordId("observation", payload, event, {
      metric: normalizedMetric.key,
      value: normalizedMetric.value,
      envelopeId: context.rawEnvelope?.id,
    }),
    kind: "observation" as const,
    schemaVersion: "wearable.canonical_record.v1" as const,
    dayKey: event.dayKey,
    observedAt: context.observedAt,
    recordedAt: event.recordedAt,
    occurredAt: event.occurredAt,
    timeZone: event.timeZone,
    source: buildCanonicalSource(payload, event, event.externalRef, event.rawArtifactRoles, context),
    metric: normalizedMetric.key,
    unit: normalizedMetric.unit,
    value: normalizedMetric.value,
    title: event.title,
    note: event.note,
  });

  return [record];
}

function canonicalizeSample(
  sample: DeviceSamplePayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): CanonicalWearableRecord[] {
  const sleepStageRecord = canonicalizeSleepStageSample(sample, payload, context);

  if (sleepStageRecord) {
    return [sleepStageRecord];
  }

  const canonicalMetric = resolveWearableCanonicalMetricKey(sample.stream);
  const value = readFiniteNumber(sample.sample.value);

  if (!canonicalMetric || value === null) {
    return [];
  }

  const record: CanonicalWearableSampleRecord = stripUndefined({
    id: buildCanonicalRecordId("sample", payload, sample, {
      metric: canonicalMetric,
      value,
      envelopeId: context.rawEnvelope?.id,
    }),
    kind: "sample" as const,
    schemaVersion: "wearable.canonical_record.v1" as const,
    dayKey: sample.dayKey,
    observedAt: context.observedAt,
    recordedAt: sample.recordedAt ?? sample.sample.recordedAt,
    occurredAt: sample.sample.occurredAt,
    timeZone: sample.timeZone,
    source: buildCanonicalSource(payload, sample, sample.externalRef, [], context),
    metric: canonicalMetric,
    unit: sample.unit,
    value,
  });

  return [record];
}

function canonicalizeSleepStageSample(
  sample: DeviceSamplePayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): CanonicalWearableSampleRecord | null {
  if (sample.stream !== "sleep_stage") {
    return null;
  }

  const canonicalMetric = mapSleepStageToCanonicalMetric(sample.sample.stage);
  const value = readFiniteNumber(sample.sample.durationMinutes);

  if (!canonicalMetric || value === null) {
    return null;
  }

  return stripUndefined({
    id: buildCanonicalRecordId("sample", payload, sample, {
      metric: canonicalMetric,
      stage: sample.sample.stage,
      value,
      envelopeId: context.rawEnvelope?.id,
    }),
    kind: "sample" as const,
    schemaVersion: "wearable.canonical_record.v1" as const,
    dayKey: sample.dayKey,
    observedAt: context.observedAt,
    recordedAt: sample.recordedAt ?? sample.sample.recordedAt,
    occurredAt: sample.sample.occurredAt,
    timeZone: sample.timeZone,
    source: buildCanonicalSource(payload, sample, sample.externalRef, [], context),
    metric: canonicalMetric,
    unit: "minutes",
    value,
  });
}

function buildSessionRecord(
  event: DeviceEventPayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): CanonicalWearableSessionRecord {
  return stripUndefined({
    id: buildCanonicalRecordId("session", payload, event, {
      envelopeId: context.rawEnvelope?.id,
    }),
    kind: "session" as const,
    schemaVersion: "wearable.canonical_record.v1" as const,
    dayKey: event.dayKey,
    observedAt: context.observedAt,
    recordedAt: event.recordedAt,
    occurredAt: event.occurredAt,
    timeZone: event.timeZone,
    source: buildCanonicalSource(payload, event, event.externalRef, event.rawArtifactRoles, context),
    sessionKind: event.kind,
    durationMinutes: readFiniteNumberField(event.fields, "durationMinutes") ?? undefined,
    endAt: readStringField(event.fields, "endAt") ?? undefined,
    startAt: readStringField(event.fields, "startAt") ?? undefined,
    title: event.title,
    metrics: extractNumericFields(event.fields),
  });
}

function buildTombstoneRecord(
  event: DeviceEventPayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): CanonicalWearableTombstoneRecord {
  const providerResourceType = readStringField(event.fields, "resourceType")
    ?? event.externalRef?.resourceType
    ?? "unknown";
  const providerResourceId = readStringField(event.fields, "resourceId")
    ?? event.externalRef?.resourceId
    ?? "unknown";

  return stripUndefined({
    id: buildCanonicalRecordId("tombstone", payload, event, {
      envelopeId: context.rawEnvelope?.id,
      providerResourceType,
      providerResourceId,
    }),
    kind: "tombstone" as const,
    schemaVersion: "wearable.canonical_record.v1" as const,
    dayKey: event.dayKey,
    observedAt: context.observedAt,
    recordedAt: event.recordedAt,
    occurredAt: event.occurredAt,
    timeZone: event.timeZone,
    source: buildCanonicalSource(payload, event, event.externalRef, event.rawArtifactRoles, context),
    providerResourceType,
    providerResourceId,
    deletedAt: event.occurredAt,
    reason: readStringField(event.fields, "sourceEventType") ?? event.note,
  });
}

function buildCanonicalSource(
  payload: DeviceBatchImportPayload,
  record: DeviceEventPayload | DeviceSamplePayload,
  externalRef: DeviceExternalRefPayload | undefined,
  rawArtifactRoles: readonly string[] | undefined,
  context: CanonicalizeContext,
): CanonicalWearableSource {
  const provider = payload.provider;
  const providerResourceType = externalRef?.resourceType;
  const providerResourceId = externalRef?.resourceId;
  const providerAccountIdHash = payload.accountId ? sha256Hex(payload.accountId).slice(0, 24) : undefined;
  const origin = resolveDeviceDataOrigin(record, payload, context);
  const dataSourceId = buildDataSourceId({
    provider,
    connectionId: context.connectionId,
    providerAccountIdHash,
    origin,
  });

  return stripUndefined({
    provider,
    connectionId: context.connectionId,
    dataSourceId,
    rawEnvelopeId: context.rawEnvelope?.id,
    providerResourceType,
    providerResourceId,
    providerAccountIdHash,
    normalizerVersion: context.normalizerVersion,
    externalRef,
    origin,
    rawArtifactRoles: rawArtifactRoles ?? [],
  });
}

function isDeletionEvent(event: DeviceEventPayload): boolean {
  return readStringField(event.fields, "metric") === "external-resource-deleted"
    || readBooleanField(event.fields, "deleted") === true
    || event.externalRef?.facet === "deleted";
}

function buildCanonicalRecordId(
  kind: CanonicalWearableRecordKind,
  payload: DeviceBatchImportPayload,
  record: unknown,
  extra: Record<string, unknown>,
): string {
  const digest = sha256Hex(stableStringify({
    kind,
    provider: payload.provider,
    accountId: payload.accountId,
    record,
    extra,
  })).slice(0, 24);

  return `wearable_${kind}_${digest}`;
}

function buildDataSourceId(input: {
  provider: string;
  connectionId?: string;
  providerAccountIdHash?: string;
  origin?: DeviceDataOrigin;
}): string {
  const digest = sha256Hex(stableStringify(stripUndefined({
    provider: input.provider,
    connectionId: input.connectionId,
    providerAccountIdHash: input.providerAccountIdHash,
    origin: buildDataSourceOriginIdentity(input.origin),
  }))).slice(0, 16);
  return `wearable_source_${digest}`;
}

function resolveDeviceDataOrigin(
  record: DeviceEventPayload | DeviceSamplePayload,
  payload: DeviceBatchImportPayload,
  context: CanonicalizeContext,
): DeviceDataOrigin | undefined {
  return normalizeDeviceDataOrigin(record.dataOrigin)
    ?? normalizeDeviceDataOrigin(payload.dataOrigin)
    ?? normalizeDeviceDataOrigin(context.dataOrigin);
}

function normalizeDeviceDataOrigin(value: DeviceDataOrigin | undefined): DeviceDataOrigin | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = stripUndefined({
    version: 1 as const,
    aggregatorProvider: normalizeOriginString(value.aggregatorProvider),
    sourceProviderSlug: normalizeOriginString(value.sourceProviderSlug),
    sourceType: normalizeOriginString(value.sourceType),
    sourceInstanceId: normalizeNullableOriginString(value.sourceInstanceId),
    observedAtRaw: normalizeOriginString(value.observedAtRaw),
    timeZoneOffsetMinutes: normalizeNullableFiniteNumber(value.timeZoneOffsetMinutes),
    timestampSemantics: normalizeTimestampSemantics(value.timestampSemantics),
    originConfidence: normalizeOriginConfidence(value.originConfidence),
    normalizerVersion: normalizeOriginString(value.normalizerVersion),
  });

  return hasMeaningfulDeviceDataOriginContent(normalized) ? normalized : undefined;
}

function hasMeaningfulDeviceDataOriginContent(origin: DeviceDataOrigin): boolean {
  return Object.entries(origin).some(([key, value]) => key !== "version" && value !== null);
}

function buildDataSourceOriginIdentity(origin: DeviceDataOrigin | undefined): Record<string, unknown> | undefined {
  if (!origin) {
    return undefined;
  }

  const identity = stripUndefined({
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    sourceInstanceId: origin.sourceInstanceId,
  });

  return Object.keys(identity).length > 0 ? identity : undefined;
}

function normalizeOriginString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableOriginString(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null;
  }

  return normalizeOriginString(value);
}

function normalizeNullableFiniteNumber(value: number | null | undefined): number | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTimestampSemantics(
  value: DeviceDataOrigin["timestampSemantics"] | undefined,
): DeviceDataOrigin["timestampSemantics"] | undefined {
  return value === "utc" || value === "offset" || value === "floating" || value === "unknown"
    ? value
    : undefined;
}

function normalizeOriginConfidence(
  value: DeviceDataOrigin["originConfidence"] | undefined,
): DeviceDataOrigin["originConfidence"] | undefined {
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
    ? value
    : undefined;
}

function mapSleepStageToCanonicalMetric(stage: unknown): WearableCanonicalMetricKey | null {
  if (typeof stage !== "string") {
    return null;
  }

  switch (stage.trim().toLowerCase()) {
    case "awake":
      return "awakeMinutes";
    case "light":
      return "lightMinutes";
    case "deep":
      return "deepMinutes";
    case "rem":
      return "remMinutes";
    default:
      return null;
  }
}

function readStringField(fields: Record<string, unknown> | undefined, key: string): string | null {
  const value = fields?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBooleanField(fields: Record<string, unknown> | undefined, key: string): boolean | null {
  const value = fields?.[key];
  return typeof value === "boolean" ? value : null;
}

function readFiniteNumberField(fields: Record<string, unknown> | undefined, key: string): number | null {
  return readFiniteNumber(fields?.[key]);
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function extractNumericFields(fields: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!fields) {
    return undefined;
  }

  const entries = Object.entries(fields).flatMap(([key, value]) => {
    const numeric = readFiniteNumber(value);
    return numeric === null ? [] : [[key, numeric] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
