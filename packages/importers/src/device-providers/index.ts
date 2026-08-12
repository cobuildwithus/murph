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
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
} from "./defaults.ts";
export {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
  canNormalizeJunctionSleepCycleRecordToCompactStages,
  classifyJunctionSummaryNormalizationEvidence,
  classifyJunctionWorkoutDurationCompanionCoverage,
  identifyJunctionBloodPressureProviderRecords,
  JUNCTION_WORKOUT_FEATURE_MAX_MEASUREMENTS,
  JUNCTION_WORKOUT_FEATURE_MAX_SPLIT_MEASUREMENTS,
  JUNCTION_WORKOUT_FEATURE_MAX_SPLITS,
  JUNCTION_WORKOUT_STREAM_MAX_POINTS,
  JunctionWorkoutStreamLimitError,
  junctionProviderAdapter,
  normalizeJunctionResourceName,
  normalizeJunctionSnapshot,
  parseJunctionWorkoutFeatureEnvelope,
  reduceJunctionWorkoutStream,
  type JunctionSnapshotInput,
  type JunctionBloodPressureProviderRecordIdentityEvidence,
  type JunctionSummaryNormalizationEvidence,
  type JunctionSummaryNormalizationEvidenceWindow,
  type JunctionSummaryResource,
  type JunctionWorkoutDurationCompanionCoverage,
  type JunctionWorkoutFeatureEnvelope,
  type JunctionWorkoutFeatureMeasurement,
  type JunctionWorkoutFeatureSplit,
  type ReduceJunctionWorkoutStreamInput,
} from "./junction.ts";
export {
  normalizeJunctionSourceProviderSlug,
  readJunctionSourceProviderSlug,
  resolveJunctionOrigin,
  type JunctionOriginFallback,
} from "./junction-origin.ts";
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
  resolveDeviceProviderConnectionDescriptor,
  resolveDeviceProviderSourcePriority,
  resolveDeviceProviderDescriptor,
} from "./provider-descriptors.ts";
export type {
  DeviceConnectionFlowKind,
  DeviceProviderConnectionDescriptor,
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
  buildWearableRawIngestReceipt,
  stableStringify,
} from "./raw-ingest-receipt.ts";
export type {
  BuildWearableRawIngestReceiptInput,
  WearableRawIngestDeliveryMode,
  WearableRawIngestReceipt,
  WearableRawIngestEventType,
  WearableRawIngestSourceKind,
} from "./raw-ingest-receipt.ts";
