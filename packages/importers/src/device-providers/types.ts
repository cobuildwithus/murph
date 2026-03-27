import type { DeviceBatchImportPayload } from "../core-port.ts";

export interface NormalizedDeviceBatch extends Omit<DeviceBatchImportPayload, "vaultRoot"> {}

export interface DeviceProviderAdapter<TSnapshot = unknown> {
  provider: string;
  normalizeSnapshot(snapshot: TSnapshot): Promise<NormalizedDeviceBatch> | NormalizedDeviceBatch;
}

export interface DeviceProviderSnapshotImportPayload extends DeviceBatchImportPayload {
  snapshot: unknown;
}
