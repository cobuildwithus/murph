import type {
  DeviceBatchImportPayload,
  DeviceEventPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
} from "../core-port.js";

export interface NormalizedDeviceBatch {
  provider: string;
  accountId?: string;
  importedAt?: string;
  source?: string;
  events?: DeviceEventPayload[];
  samples?: DeviceSamplePayload[];
  rawArtifacts?: DeviceRawArtifactPayload[];
  provenance?: Record<string, unknown>;
}

export interface DeviceProviderAdapter<TSnapshot = unknown> {
  provider: string;
  normalizeSnapshot(snapshot: TSnapshot): Promise<NormalizedDeviceBatch> | NormalizedDeviceBatch;
}

export interface DeviceProviderSnapshotImportPayload extends DeviceBatchImportPayload {
  snapshot: unknown;
}
