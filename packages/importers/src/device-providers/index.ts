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
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
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
  normalizeStravaSnapshot,
  stravaProviderAdapter,
  type StravaSnapshotInput,
} from "./strava.ts";
export {
  normalizeWhoopSnapshot,
  whoopProviderAdapter,
  type WhoopSnapshotInput,
} from "./whoop.ts";
export type {
  DeviceProviderAdapter,
  DeviceProviderSnapshotImportPayload,
  NormalizedDeviceBatch,
  WearableIngestContext,
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

export {
  canonicalizeDeviceBatchPayload,
} from "./canonical-wearable-records.ts";
export type {
  CanonicalWearableObservationRecord,
  CanonicalWearableRecord,
  CanonicalWearableRecordKind,
  CanonicalWearableSampleRecord,
  CanonicalWearableSchemaVersion,
  CanonicalWearableSessionRecord,
  CanonicalWearableSource,
  CanonicalWearableTombstoneRecord,
} from "./canonical-wearable-records.ts";
export {
  resolveWearableCanonicalMetricKey,
  resolveWearableMetricCatalogEntry,
  resolveWearableMetricTolerance,
  wearableCanonicalMetricKeys,
  wearableMetricCatalog,
} from "./metric-catalog.ts";
export type {
  WearableCanonicalMetricKey,
  WearableMetricCatalogEntry,
  WearableMetricRecordKind,
} from "./metric-catalog.ts";
export {
  buildWearableRawIngestEnvelope,
  stableStringify,
} from "./raw-ingest-envelope.ts";
export type {
  BuildWearableRawIngestEnvelopeInput,
  WearableRawIngestDeliveryMode,
  WearableRawIngestEnvelope,
  WearableRawIngestEventType,
  WearableRawIngestSourceKind,
} from "./raw-ingest-envelope.ts";
