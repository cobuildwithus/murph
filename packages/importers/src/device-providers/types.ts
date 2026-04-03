import type { DeviceBatchImportPayload } from "../core-port.ts";
import type { DeviceProviderDescriptor } from "./provider-descriptors.ts";

export interface NormalizedDeviceBatch extends Omit<DeviceBatchImportPayload, "vaultRoot"> {}

export interface DeviceProviderAdapter<TSnapshot = unknown> extends DeviceProviderDescriptor {
  parseSnapshot?(snapshot: unknown): TSnapshot;
  normalizeSnapshot(snapshot: TSnapshot): Promise<NormalizedDeviceBatch> | NormalizedDeviceBatch;
}

export interface DeviceProviderSnapshotImportPayload extends DeviceBatchImportPayload {
  snapshot: unknown;
}
