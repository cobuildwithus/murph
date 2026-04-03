export {
  importDeviceProviderSnapshot,
  prepareDeviceProviderSnapshotImport,
  type DeviceProviderImporterExecutionOptions,
  type DeviceProviderSnapshotImportInput,
} from "./import-device-provider-snapshot.ts";
export {
  createDeviceProviderRegistry,
  type DeviceProviderRegistry,
} from "./registry.ts";
export {
  defaultDeviceProviderAdapters,
  defaultDeviceProviderDescriptors,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
} from "./defaults.ts";
export {
  normalizeGarminSnapshot,
  garminProviderAdapter,
  type GarminSnapshotInput,
} from "./garmin.ts";
export {
  normalizeOuraSnapshot,
  ouraProviderAdapter,
  type OuraSnapshotInput,
} from "./oura.ts";
export {
  normalizeWhoopSnapshot,
  whoopProviderAdapter,
  type WhoopSnapshotInput,
} from "./whoop.ts";
export type {
  DeviceProviderAdapter,
  DeviceProviderSnapshotImportPayload,
  NormalizedDeviceBatch,
} from "./types.ts";

export {
  createNamedDeviceProviderRegistry,
  normalizeDeviceProviderKey,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  requireDeviceProviderWebhookDescriptor,
  resolveDeviceProviderSourcePriority,
  resolveDeviceProviderDescriptor,
} from "./provider-descriptors.ts";
export type {
  DeviceProviderDescriptor,
  DeviceProviderMetricFamily,
  DeviceProviderNormalizationDescriptor,
  DeviceProviderOAuthDescriptor,
  DeviceProviderSnapshotParserKind,
  DeviceProviderSourcePriorityHints,
  DeviceProviderSyncDescriptor,
  DeviceProviderSyncWindowDescriptor,
  DeviceProviderTransportMode,
  DeviceProviderWebhookDeliveryMode,
  DeviceProviderWebhookDescriptor,
  NamedDeviceProviderRegistry,
  ResolveDeviceProviderSourcePriorityInput,
} from "./provider-descriptors.ts";
