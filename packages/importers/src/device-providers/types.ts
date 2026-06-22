import type { DeviceBatchImportPayload, DeviceEvidencePartPayload } from "../core-port.ts";
import type { DeviceProviderDescriptor } from "./provider-descriptors.ts";
import type {
  WearableRawIngestDeliveryMode,
  WearableRawIngestEventType,
  WearableRawIngestSourceKind,
} from "./raw-ingest-receipt.ts";

export interface NormalizedDeviceBatch extends Omit<DeviceBatchImportPayload, "vaultRoot" | "evidenceParts"> {
  evidenceParts?: DeviceEvidencePartPayload[];
  rawArtifacts?: DeviceEvidencePartPayload[];
}

export interface DeviceProviderAdapter<TSnapshot = unknown> extends DeviceProviderDescriptor {
  parseSnapshot?(snapshot: unknown): TSnapshot;
  sanitizeRawSnapshot?(snapshot: TSnapshot): unknown;
  normalizeSnapshot(snapshot: TSnapshot): Promise<NormalizedDeviceBatch> | NormalizedDeviceBatch;
}

export interface WearableIngestContext {
  userId?: string;
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
  normalizerVersion?: string;
}

export interface DeviceProviderSnapshotImportPayload extends DeviceBatchImportPayload, WearableIngestContext {
  snapshot: unknown;
}
