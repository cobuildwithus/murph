import { resolveJunctionDeviceConnectRouteByProviderSlug } from "./config/connect-routes.ts";
import { JUNCTION_CONNECT_SOURCE_TARGETS } from "./config/junction-connect-sources.ts";
import {
  DEVICE_SYNC_METADATA_MAX_STRING_LENGTH,
  mergeStoredDeviceSyncMetadataPatch,
  sanitizeStoredDeviceSyncMetadata,
} from "./metadata.ts";

export type JunctionHistoricalBackfillStatus = "complete" | "exhausted" | "retrying";

export const JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION = 3;
const JUNCTION_HISTORICAL_BACKFILL_CURRENT_STATUS_PREFIX =
  `coverage_v${JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION}_`;
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_ENCODING_VERSION = 2;
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_PREFIX =
  `e${JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_ENCODING_VERSION}`;
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_BLOCKED_SOURCES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_RESOURCE_BITS = Object.freeze({
  activity: 1,
  sleep: 2,
  sleep_cycle: 4,
} as const);
const JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_ALL_BITS = 7;

export type JunctionHistoricalBackfillEvidenceResource =
  keyof typeof JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_RESOURCE_BITS;

export interface JunctionHistoricalBackfillEvidence {
  resourcesByProvider: Record<string, number>;
  windowEnd: string;
  windowStart: string;
}

interface JunctionHistoricalBackfillProgress {
  coverageVersion: number;
  emptyAttempts: number;
  lastEmptyAt: string | null;
  status: JunctionHistoricalBackfillStatus;
  windowEnd: string;
  windowStart: string;
}

export const JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS = Object.freeze({
  status: "junctionHistoricalBackfillStatus",
  emptyAttempts: "junctionHistoricalBackfillEmptyAttempts",
  lastEmptyAt: "junctionHistoricalBackfillLastEmptyAt",
  windowStart: "junctionHistoricalBackfillWindowStart",
  windowEnd: "junctionHistoricalBackfillWindowEnd",
  evidence: "junctionHistoricalBackfillEvidence",
} as const);

export const JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY =
  "junctionBloodPressureHistoryBackfillCoverage";
export const JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY =
  "junctionNoteHistoryBackfillCoverage";
const JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_PREFIX = "v";
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION = 1;
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX =
  `m${JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION}|`;
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_CAPACITY = 64;
const JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCES = Object.freeze([
  "afib_burden",
  "basal_body_temperature",
  "body_temperature",
  "body_temperature_delta",
  "caffeine",
  "heart_rate_recovery_one_minute",
  "mindfulness_minutes",
  "sleep_breathing_disturbance",
  "vo2_max",
  "water",
] as const);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS = Object.freeze([
  "blood_pressure",
  "note",
  ...JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCES,
] as const);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME = new Map<string, number>([
  ["blood_pressure", 1],
  ["note", 2],
  ...JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCES.map(
    (resource) => [resource, 1] as const,
  ),
]);
const JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCE_SET = new Set<string>(
  JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCES,
);

export type JunctionSparseDailyTimeseriesHistoryBackfillResource =
  (typeof JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCES)[number];

// Append-only slot identities keep persisted matrix bits stable even if the
// connect catalog is reordered. Removed routes retain their slot; new routes
// must claim the next unused slot.
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOTS = Object.freeze([
  "whoop",
  "mapmyfitness",
  "ultrahuman",
  "dexcom-g6-and-older",
  "renpho",
  "runkeeper",
  "samsung-health",
  "tandem-source",
  "beurer",
  "strava",
  "freestyle-libre-ble",
  "omron",
  "accuchek",
  "eight-sleep",
  "fitbit",
  "freestyle-libre",
  "garmin",
  "hammerhead",
  "ihealth",
  "oura",
  "peloton",
  "wahoo",
  "contour-ble",
  "withings",
  "google-fit",
  "zwift",
  "onetouch",
  "abbott-libreview",
  "dexcom",
  "kardia",
  "cronometer",
  "polar",
  "apple-health",
] as const);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_ID_SET = new Set<string>(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOTS,
);

if (
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOTS.length
    > JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_CAPACITY
  || JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_ID_SET.size
    !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOTS.length
  || JUNCTION_CONNECT_SOURCE_TARGETS.some((target) =>
    !JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_ID_SET.has(target.connectSourceId)
  )
) {
  throw new TypeError("Junction extended-history coverage requires an append-only source slot.");
}

export function isJunctionSparseDailyTimeseriesHistoryBackfillResource(
  resource: string,
): resource is JunctionSparseDailyTimeseriesHistoryBackfillResource {
  return JUNCTION_SPARSE_DAILY_TIMESERIES_HISTORY_BACKFILL_RESOURCE_SET.has(resource);
}

const JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS = Object.freeze([
  JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
] as const);

const JUNCTION_RECONCILED_HISTORICAL_METADATA_KEYS = Object.freeze([
  ...Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS),
  ...JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS,
]);

export function readJunctionHistoricalBackfillProgress(
  metadata: Record<string, unknown>,
): JunctionHistoricalBackfillProgress | null {
  const statusState = readJunctionHistoricalBackfillStatus(
    metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status],
  );
  const windowStart = readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]);
  const windowEnd = readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]);

  if (!statusState || !windowStart || !windowEnd) {
    return null;
  }
  return {
    coverageVersion: statusState.coverageVersion,
    emptyAttempts: readMetadataNumber(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts]),
    lastEmptyAt: readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]),
    status: statusState.status,
    windowEnd,
    windowStart,
  };
}

export function canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(
  metadata: Record<string, unknown>,
): boolean {
  const coverageVersion = readJunctionHistoricalBackfillCoverageVersion(
    metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status],
  );
  return coverageVersion === null
    || coverageVersion <= JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION;
}

function shouldPreserveLocalJunctionHistoricalBackfillProgress(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
}): boolean {
  if (!input.localConnectionStateUnpublished) {
    return false;
  }
  const localEvidence = readJunctionHistoricalBackfillEvidence(
    input.localMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
  );
  const hostedEvidence = readJunctionHistoricalBackfillEvidence(
    input.hostedMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
  );
  const localEvidenceAdvanced = hasAdditionalJunctionHistoricalBackfillEvidence(
    localEvidence,
    hostedEvidence,
  );
  const localProgress = readJunctionHistoricalBackfillProgress(input.localMetadata);
  if (!localProgress) {
    return localEvidenceAdvanced;
  }

  const hostedProgress = readJunctionHistoricalBackfillProgress(input.hostedMetadata);
  if (!hostedProgress) {
    return true;
  }

  if (
    localProgress.windowStart !== hostedProgress.windowStart
    || localProgress.windowEnd !== hostedProgress.windowEnd
  ) {
    return false;
  }

  if (localProgress.coverageVersion !== hostedProgress.coverageVersion) {
    return localProgress.coverageVersion > hostedProgress.coverageVersion;
  }

  if (localProgress.status === "retrying") {
    if (hostedProgress.status !== "retrying") {
      return false;
    }

    const retryComparison = compareJunctionRetryProgress(localProgress, hostedProgress);
    return retryComparison > 0 || (retryComparison === 0 && localEvidenceAdvanced);
  }

  if (localProgress.status === "complete") {
    return hostedProgress.status !== "complete"
      || (hostedProgress.status === "complete" && localEvidenceAdvanced);
  }

  return hostedProgress.status === "retrying"
    || (hostedProgress.status === "exhausted" && localEvidenceAdvanced);
}

export function mergeHostedJunctionHistoricalBackfillMetadata(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
}): { metadata: Record<string, unknown>; preservedLocalProgress: boolean } {
  const finalize = (result: {
    metadata: Record<string, unknown>;
    preservedLocalProgress: boolean;
  }): { metadata: Record<string, unknown>; preservedLocalProgress: boolean } => {
    const mergedCoverage = mergeJunctionExtendedTimeseriesHistoryCoverageMetadata({
      hostedMetadata: input.hostedMetadata,
      localConnectionStateUnpublished: input.localConnectionStateUnpublished,
      localMetadata: input.localMetadata,
      selectedMetadata: result.metadata,
    });

    return {
      metadata: mergedCoverage.metadata,
      preservedLocalProgress:
        result.preservedLocalProgress || mergedCoverage.preservedLocalCoverage,
    };
  };

  if (!canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(input.hostedMetadata)) {
    return finalize({
      metadata: { ...input.hostedMetadata },
      preservedLocalProgress: false,
    });
  }

  if (
    input.localConnectionStateUnpublished
    && !canCurrentRuntimeMutateJunctionHistoricalBackfillProgress(input.localMetadata)
  ) {
    return finalize({
      metadata: { ...input.hostedMetadata, ...input.localMetadata },
      preservedLocalProgress: true,
    });
  }

  const preserveLocalProgressMetadata = shouldPreserveLocalJunctionHistoricalBackfillProgress(input);
  const localEvidence = readJunctionHistoricalBackfillEvidence(
    input.localMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
  );
  const hostedEvidence = readJunctionHistoricalBackfillEvidence(
    input.hostedMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
  );
  const selectedProgress = readJunctionHistoricalBackfillProgress(
    preserveLocalProgressMetadata ? input.localMetadata : input.hostedMetadata,
  );
  const mergedEvidence = selectJunctionHistoricalBackfillEvidence({
    hostedEvidence,
    hostedValue: input.hostedMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
    localEvidence,
    localValue: input.localMetadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence],
    preferLocal: preserveLocalProgressMetadata,
    selectedProgress,
  });
  const selectedEvidence = readJunctionHistoricalBackfillEvidence(mergedEvidence);
  const preservedLocalProgress = preserveLocalProgressMetadata || (
    input.localConnectionStateUnpublished
    && doesSelectedJunctionEvidenceIncludeLocalProgress(
      selectedEvidence,
      localEvidence,
      hostedEvidence,
    )
  );

  if (!preserveLocalProgressMetadata) {
    const metadata: Record<string, unknown> = {};
    if (mergedEvidence) {
      metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence] = mergedEvidence;
    }
    for (const [key, value] of Object.entries(input.hostedMetadata)) {
      if (
        key !== JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence
        && !Object.prototype.hasOwnProperty.call(metadata, key)
      ) {
        metadata[key] = value;
      }
    }
    return finalize({ metadata, preservedLocalProgress });
  }

  const metadata: Record<string, unknown> = {};

  for (const key of Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS)) {
    if (key === JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence) {
      if (mergedEvidence) {
        metadata[key] = mergedEvidence;
      }
    } else if (Object.prototype.hasOwnProperty.call(input.localMetadata, key)) {
      metadata[key] = input.localMetadata[key];
    }
  }

  for (const [key, value] of Object.entries(input.hostedMetadata)) {
    if (
      key !== JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence
      && !Object.prototype.hasOwnProperty.call(metadata, key)
    ) {
      metadata[key] = value;
    }
  }

  return finalize({ metadata, preservedLocalProgress });
}

/** Preserve provider-owned progress during a guarded replacement inside the store transaction. */
export function mergeGuardedJunctionHistoricalBackfillMetadata(input: {
  existingMetadata: Record<string, unknown>;
  replacementMetadata: Record<string, unknown>;
}): Record<string, unknown> {
  const existingHistoricalMetadata: Record<string, unknown> = {};
  for (const key of JUNCTION_RECONCILED_HISTORICAL_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input.existingMetadata, key)) {
      existingHistoricalMetadata[key] = input.existingMetadata[key];
    }
  }

  const mergedMetadata = mergeHostedJunctionHistoricalBackfillMetadata({
    hostedMetadata: input.replacementMetadata,
    localConnectionStateUnpublished: true,
    localMetadata: existingHistoricalMetadata,
  }).metadata;
  const metadata: Record<string, unknown> = {};

  for (const key of JUNCTION_RECONCILED_HISTORICAL_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(mergedMetadata, key)) {
      metadata[key] = mergedMetadata[key];
    }
  }
  for (const [key, value] of Object.entries(input.replacementMetadata)) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
      metadata[key] = value;
    }
  }

  return metadata;
}

type JunctionExtendedTimeseriesHistoryResource =
  (typeof JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS)[number];

interface JunctionLegacyExtendedTimeseriesHistoryCoverage {
  providerSlugs: string[];
  version: number;
}

interface JunctionExtendedTimeseriesHistoryCoverageMatrix {
  bytes: Uint8Array;
  version: number;
}

export interface JunctionExtendedTimeseriesHistoryCoverageUpdate {
  metadataKey:
    | typeof JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY
    | typeof JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY;
  value: string;
}

const JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH = Math.ceil(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_CAPACITY
    * JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS.length
    / 8,
);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOT_BY_ID = new Map<string, number>(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOTS.map((sourceId, index) => [sourceId, index]),
);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOT_BY_NAME = new Map<string, number>(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS.map((resource, index) => [resource, index]),
);

if (
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOT_BY_NAME.size
    !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS.length
  || JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME.size
    !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS.length
  || JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX.length
    + JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH * 2
    > DEVICE_SYNC_METADATA_MAX_STRING_LENGTH
) {
  throw new TypeError("Junction extended-history coverage exceeds its fixed metadata matrix.");
}

export function addJunctionExtendedTimeseriesHistoryBackfillCoverage(input: {
  metadata: Record<string, unknown>;
  providerSlug: string;
  resource: string;
  version: number;
}): JunctionExtendedTimeseriesHistoryCoverageUpdate | null {
  if (!canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
    input.metadata,
    input.resource,
    input.version,
  )) {
    return null;
  }

  const bitIndex = resolveJunctionExtendedTimeseriesHistoryCoverageBitIndex(
    input.providerSlug,
    input.resource,
  );
  const metadataKey = selectJunctionExtendedTimeseriesHistoryCoverageMetadataKey([
    input.metadata,
  ]);
  if (bitIndex === null || metadataKey === null) {
    return null;
  }

  const coverage = readJunctionExtendedTimeseriesHistoryCoverageFacts(input.metadata);
  setJunctionExtendedTimeseriesHistoryCoverageBit(coverage.bytes, bitIndex);
  const value = encodeJunctionExtendedTimeseriesHistoryCoverageMatrix(coverage);
  if (!value) {
    return null;
  }

  const update = { metadataKey, value };
  return canRetainJunctionExtendedTimeseriesHistoryCoverageUpdate(input.metadata, update)
    ? update
    : null;
}

export function hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
  version: number,
): boolean {
  if (version !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME.get(resource)) {
    return false;
  }
  const bitIndex = resolveJunctionExtendedTimeseriesHistoryCoverageBitIndex(
    providerSlug,
    resource,
  );
  return bitIndex !== null
    && hasJunctionExtendedTimeseriesHistoryCoverageBit(
      readJunctionExtendedTimeseriesHistoryCoverageFacts(metadata).bytes,
      bitIndex,
    );
}

export function canRepresentJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
  version: number,
): boolean {
  return addJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata,
    providerSlug,
    resource,
    version,
  }) !== null;
}

function canRetainJunctionExtendedTimeseriesHistoryCoverageUpdate(
  metadata: Record<string, unknown>,
  update: JunctionExtendedTimeseriesHistoryCoverageUpdate,
): boolean {
  const existing = sanitizeStoredDeviceSyncMetadata(metadata);
  const merged = mergeStoredDeviceSyncMetadataPatch(existing, {
    [update.metadataKey]: update.value,
  });
  return merged[update.metadataKey] === update.value
    && Object.keys(existing).every((key) => Object.hasOwn(merged, key));
}

export function canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  resource: string,
  version: number,
): boolean {
  if (
    version !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME.get(resource)
    || !JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOT_BY_NAME.has(resource)
  ) {
    return false;
  }

  for (const metadataKey of JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
    const matrixVersion = readJunctionExtendedTimeseriesHistoryCoverageMatrixVersion(
      metadata[metadataKey],
    );
    if (
      matrixVersion !== null
      && matrixVersion !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION
    ) {
      return false;
    }
  }

  const legacyMetadataKey = resource === "blood_pressure"
    ? JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY
    : resource === "note"
    ? JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY
    : null;
  const legacyVersion = legacyMetadataKey
    ? readJunctionLegacyExtendedTimeseriesHistoryCoverageVersion(metadata[legacyMetadataKey])
    : null;
  return legacyVersion === null || legacyVersion <= version;
}

function readJunctionLegacyExtendedTimeseriesHistoryCoverage(
  value: unknown,
): JunctionLegacyExtendedTimeseriesHistoryCoverage | null {
  if (typeof value !== "string" || !value || value.length > DEVICE_SYNC_METADATA_MAX_STRING_LENGTH) {
    return null;
  }

  const separatorIndex = value.indexOf("|");
  if (separatorIndex <= 1 || separatorIndex === value.length - 1) {
    return null;
  }
  const versionPart = value.slice(0, separatorIndex);
  const providerSlugs = value.slice(separatorIndex + 1).split(",");
  const version = Number(versionPart.slice(JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_PREFIX.length));
  if (
    !versionPart.startsWith(JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_PREFIX)
    || !Number.isSafeInteger(version)
    || version < 1
    || providerSlugs.some((providerSlug) => !isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug))
  ) {
    return null;
  }

  const coverage = { providerSlugs, version };
  return encodeJunctionLegacyExtendedTimeseriesHistoryCoverage(coverage) === value
    ? coverage
    : null;
}

function readJunctionLegacyExtendedTimeseriesHistoryCoverageVersion(
  value: unknown,
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^v([1-9]\d*)\|/u.exec(value);
  if (!match) {
    return null;
  }
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function encodeJunctionLegacyExtendedTimeseriesHistoryCoverage(
  coverage: JunctionLegacyExtendedTimeseriesHistoryCoverage,
): string | null {
  if (!Number.isSafeInteger(coverage.version) || coverage.version < 1) {
    return null;
  }
  const providerSlugs = [...new Set(coverage.providerSlugs)]
    .filter(isSafeJunctionHistoricalBackfillEvidenceSource)
    .sort((left, right) => left.localeCompare(right));
  if (providerSlugs.length === 0) {
    return null;
  }
  const encoded = `${JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_PREFIX}${coverage.version}|${providerSlugs.join(",")}`;
  return encoded.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? encoded : null;
}

function readJunctionExtendedTimeseriesHistoryCoverageMatrix(
  value: unknown,
): JunctionExtendedTimeseriesHistoryCoverageMatrix | null {
  if (
    typeof value !== "string"
    || !value.startsWith(JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX)
    || value.length !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX.length
      + JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH * 2
  ) {
    return null;
  }
  const hex = value.slice(JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX.length);
  if (!/^[0-9a-f]+$/u.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return {
    bytes,
    version: JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION,
  };
}

function readJunctionExtendedTimeseriesHistoryCoverageMatrixVersion(
  value: unknown,
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^m([1-9]\d*)\|/u.exec(value);
  if (!match) {
    return null;
  }
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function encodeJunctionExtendedTimeseriesHistoryCoverageMatrix(
  coverage: JunctionExtendedTimeseriesHistoryCoverageMatrix,
): string | null {
  if (
    coverage.version !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION
    || coverage.bytes.length !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH
  ) {
    return null;
  }
  const encoded = `${JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_PREFIX}${[...coverage.bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  return encoded.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? encoded : null;
}

function readJunctionExtendedTimeseriesHistoryCoverageFacts(
  metadata: Record<string, unknown>,
): JunctionExtendedTimeseriesHistoryCoverageMatrix {
  const coverage = createEmptyJunctionExtendedTimeseriesHistoryCoverageMatrix();
  for (const metadataKey of JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
    const matrix = readJunctionExtendedTimeseriesHistoryCoverageMatrix(metadata[metadataKey]);
    if (matrix) {
      unionJunctionExtendedTimeseriesHistoryCoverage(coverage.bytes, matrix.bytes);
      continue;
    }
    const legacy = readJunctionLegacyExtendedTimeseriesHistoryCoverage(metadata[metadataKey]);
    const resource = metadataKey === JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY
      ? "blood_pressure"
      : "note";
    if (
      !legacy
      || legacy.version
        !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME.get(resource)
    ) {
      continue;
    }
    for (const providerSlug of legacy.providerSlugs) {
      const bitIndex = resolveJunctionExtendedTimeseriesHistoryCoverageBitIndex(
        providerSlug,
        resource,
      );
      if (bitIndex !== null) {
        setJunctionExtendedTimeseriesHistoryCoverageBit(coverage.bytes, bitIndex);
      }
    }
  }
  return coverage;
}

function createEmptyJunctionExtendedTimeseriesHistoryCoverageMatrix():
  JunctionExtendedTimeseriesHistoryCoverageMatrix {
  return {
    bytes: new Uint8Array(JUNCTION_EXTENDED_TIMESERIES_HISTORY_MATRIX_BYTE_LENGTH),
    version: JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_ENCODING_VERSION,
  };
}

function resolveJunctionExtendedTimeseriesHistoryCoverageBitIndex(
  providerSlug: string,
  resource: string,
): number | null {
  const sourceId = resolveJunctionDeviceConnectRouteByProviderSlug(providerSlug)
    ?.source.connectSourceId;
  const sourceSlot = sourceId === undefined
    ? undefined
    : JUNCTION_EXTENDED_TIMESERIES_HISTORY_SOURCE_SLOT_BY_ID.get(sourceId);
  const resourceSlot = JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOT_BY_NAME.get(resource);
  return sourceSlot === undefined || resourceSlot === undefined
    ? null
    : sourceSlot * JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_SLOTS.length
      + resourceSlot;
}

function setJunctionExtendedTimeseriesHistoryCoverageBit(
  bytes: Uint8Array,
  bitIndex: number,
): void {
  const byteIndex = Math.floor(bitIndex / 8);
  bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (bitIndex % 8));
}

function hasJunctionExtendedTimeseriesHistoryCoverageBit(
  bytes: Uint8Array,
  bitIndex: number,
): boolean {
  return ((bytes[Math.floor(bitIndex / 8)] ?? 0) & (1 << (bitIndex % 8))) !== 0;
}

function unionJunctionExtendedTimeseriesHistoryCoverage(
  target: Uint8Array,
  source: Uint8Array,
): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = (target[index] ?? 0) | (source[index] ?? 0);
  }
}

function doesJunctionExtendedTimeseriesHistoryCoverageInclude(
  selected: Uint8Array,
  expected: Uint8Array,
): boolean {
  return expected.every((byte, index) => ((selected[index] ?? 0) & byte) === byte);
}

function hasAnyJunctionExtendedTimeseriesHistoryCoverage(bytes: Uint8Array): boolean {
  return bytes.some((byte) => byte !== 0);
}

function isJunctionExtendedTimeseriesHistoryCoverageSlotWritable(
  value: unknown,
  metadataKey: string,
): boolean {
  if (value === undefined) {
    return true;
  }
  if (readJunctionExtendedTimeseriesHistoryCoverageMatrix(value)) {
    return true;
  }
  const legacy = readJunctionLegacyExtendedTimeseriesHistoryCoverage(value);
  const resource = metadataKey === JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY
    ? "blood_pressure"
    : "note";
  const currentVersion = JUNCTION_EXTENDED_TIMESERIES_HISTORY_RESOURCE_VERSION_BY_NAME.get(
    resource,
  );
  if (!legacy || currentVersion === undefined || legacy.version > currentVersion) {
    return false;
  }
  return legacy.providerSlugs.every((providerSlug) =>
    resolveJunctionExtendedTimeseriesHistoryCoverageBitIndex(providerSlug, resource) !== null
  );
}

function selectJunctionExtendedTimeseriesHistoryCoverageMetadataKey(
  metadataSources: readonly Record<string, unknown>[],
): JunctionExtendedTimeseriesHistoryCoverageUpdate["metadataKey"] | null {
  const candidates = JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS
    .filter((metadataKey) =>
      metadataSources.every((metadata) =>
        isJunctionExtendedTimeseriesHistoryCoverageSlotWritable(
          metadata[metadataKey],
          metadataKey,
        )
      )
    );
  return candidates.find((metadataKey) =>
    metadataSources.some((metadata) =>
      readJunctionExtendedTimeseriesHistoryCoverageMatrix(metadata[metadataKey]) !== null
    )
  )
    ?? candidates.find((metadataKey) =>
      metadataSources.some((metadata) => metadata[metadataKey] !== undefined)
    )
    ?? candidates[0]
    ?? null;
}

function mergeJunctionExtendedTimeseriesHistoryCoverageMetadata(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
  selectedMetadata: Record<string, unknown>;
}): { metadata: Record<string, unknown>; preservedLocalCoverage: boolean } {
  const metadata = { ...input.selectedMetadata };
  const hostedCoverage = readJunctionExtendedTimeseriesHistoryCoverageFacts(
    input.hostedMetadata,
  );
  const localCoverage = input.localConnectionStateUnpublished
    ? readJunctionExtendedTimeseriesHistoryCoverageFacts(input.localMetadata)
    : createEmptyJunctionExtendedTimeseriesHistoryCoverageMatrix();
  const mergedCoverage = createEmptyJunctionExtendedTimeseriesHistoryCoverageMatrix();
  unionJunctionExtendedTimeseriesHistoryCoverage(mergedCoverage.bytes, hostedCoverage.bytes);
  unionJunctionExtendedTimeseriesHistoryCoverage(mergedCoverage.bytes, localCoverage.bytes);
  const metadataSources = input.localConnectionStateUnpublished
    ? [input.hostedMetadata, input.localMetadata]
    : [input.hostedMetadata];
  const metadataKey = selectJunctionExtendedTimeseriesHistoryCoverageMetadataKey(
    metadataSources,
  );
  const encoded = hasAnyJunctionExtendedTimeseriesHistoryCoverage(mergedCoverage.bytes)
    ? encodeJunctionExtendedTimeseriesHistoryCoverageMatrix(mergedCoverage)
    : null;

  if (metadataKey && encoded) {
    metadata[metadataKey] = encoded;
    for (const legacyMetadataKey of JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
      if (
        legacyMetadataKey !== metadataKey
        && metadataSources.every((source) =>
          isJunctionExtendedTimeseriesHistoryCoverageSlotWritable(
            source[legacyMetadataKey],
            legacyMetadataKey,
          )
        )
      ) {
        delete metadata[legacyMetadataKey];
      }
    }
  }

  const localCoverageAdvanced = input.localConnectionStateUnpublished
    && hasAnyJunctionExtendedTimeseriesHistoryCoverage(localCoverage.bytes)
    && !doesJunctionExtendedTimeseriesHistoryCoverageInclude(
      hostedCoverage.bytes,
      localCoverage.bytes,
    );
  const localOpaqueValuePreserved = input.localConnectionStateUnpublished
    && JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS.some(
      (key) =>
        input.localMetadata[key] !== undefined
        && input.localMetadata[key] !== input.hostedMetadata[key]
        && metadata[key] === input.localMetadata[key],
    );
  return {
    metadata,
    preservedLocalCoverage: localOpaqueValuePreserved || (
      localCoverageAdvanced
      && encoded !== null
      && doesJunctionExtendedTimeseriesHistoryCoverageInclude(
        readJunctionExtendedTimeseriesHistoryCoverageFacts(metadata).bytes,
        localCoverage.bytes,
      )
    ),
  };
}

export function encodeJunctionHistoricalBackfillStatus(
  status: JunctionHistoricalBackfillStatus,
): string {
  return `${JUNCTION_HISTORICAL_BACKFILL_CURRENT_STATUS_PREFIX}${status}`;
}

export function readJunctionHistoricalBackfillStatus(
  value: unknown,
): { coverageVersion: number; status: JunctionHistoricalBackfillStatus } | null {
  if (value === "complete" || value === "exhausted" || value === "retrying") {
    return { coverageVersion: 0, status: value };
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = /^coverage_v([1-9]\d*)_(complete|exhausted|retrying)$/u.exec(value);
  if (!match) {
    return null;
  }

  const coverageVersion = Number(match[1]);
  const status = match[2] as JunctionHistoricalBackfillStatus;
  return Number.isSafeInteger(coverageVersion) ? { coverageVersion, status } : null;
}

function readJunctionHistoricalBackfillCoverageVersion(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^coverage_v([1-9]\d*)_/u.exec(value);
  if (!match) {
    return null;
  }

  const coverageVersion = Number(match[1]);
  return Number.isSafeInteger(coverageVersion) ? coverageVersion : null;
}

export function addJunctionHistoricalBackfillEvidence(input: {
  existingValue: unknown;
  providerSlug: string;
  resource: JunctionHistoricalBackfillEvidenceResource;
  windowEnd: string;
  windowStart: string;
}): string | null {
  const existing = readJunctionHistoricalBackfillEvidence(input.existingValue);
  const resourcesByProvider = existing
      && existing.windowStart === input.windowStart
      && existing.windowEnd === input.windowEnd
    ? { ...existing.resourcesByProvider }
    : {};
  const providerSlug = input.providerSlug.trim().toLowerCase();
  if (!isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug)) {
    return null;
  }

  resourcesByProvider[providerSlug] =
    (resourcesByProvider[providerSlug] ?? 0)
    | JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_RESOURCE_BITS[input.resource];
  return encodeJunctionHistoricalBackfillEvidence({
    resourcesByProvider,
    windowEnd: input.windowEnd,
    windowStart: input.windowStart,
  });
}

export function readJunctionHistoricalBackfillEvidence(
  value: unknown,
): JunctionHistoricalBackfillEvidence | null {
  if (typeof value !== "string" || !value || value.length > DEVICE_SYNC_METADATA_MAX_STRING_LENGTH) {
    return null;
  }

  const parts = value.split("|");
  if (parts.length !== 4 || parts[0] !== JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_PREFIX) {
    return null;
  }
  const [, windowStart, windowEnd, encodedProviders] = parts;
  if (!isCanonicalIsoTimestamp(windowStart) || !isCanonicalIsoTimestamp(windowEnd)) {
    return null;
  }
  if (Date.parse(windowStart) >= Date.parse(windowEnd) || !encodedProviders) {
    return null;
  }

  const resourcesByProvider: Record<string, number> = {};
  for (const entry of encodedProviders.split(",")) {
    const separatorIndex = entry.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      return null;
    }
    const providerSlug = entry.slice(0, separatorIndex);
    const mask = Number(entry.slice(separatorIndex + 1));
    if (
      !isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug)
      || Object.prototype.hasOwnProperty.call(resourcesByProvider, providerSlug)
      || !Number.isInteger(mask)
      || mask <= 0
      || (mask & ~JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_ALL_BITS) !== 0
    ) {
      return null;
    }
    resourcesByProvider[providerSlug] = mask;
  }

  const evidence = { resourcesByProvider, windowEnd, windowStart };
  return encodeJunctionHistoricalBackfillEvidence(evidence) === value ? evidence : null;
}

export function hasJunctionHistoricalBackfillEvidence(
  evidence: JunctionHistoricalBackfillEvidence | null,
  providerSlug: string,
  resource: JunctionHistoricalBackfillEvidenceResource,
  windowStart: string,
  windowEnd: string,
): boolean {
  if (!evidence || evidence.windowStart !== windowStart || evidence.windowEnd !== windowEnd) {
    return false;
  }
  const mask = evidence.resourcesByProvider[providerSlug] ?? 0;
  return (mask & JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_RESOURCE_BITS[resource]) !== 0;
}

function encodeJunctionHistoricalBackfillEvidence(
  evidence: JunctionHistoricalBackfillEvidence,
): string | null {
  if (
    !isCanonicalIsoTimestamp(evidence.windowStart)
    || !isCanonicalIsoTimestamp(evidence.windowEnd)
    || Date.parse(evidence.windowStart) >= Date.parse(evidence.windowEnd)
  ) {
    return null;
  }

  const encodedProviders = Object.entries(evidence.resourcesByProvider)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([providerSlug, mask]) =>
      isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug)
        && Number.isInteger(mask)
        && mask > 0
        && (mask & ~JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_ALL_BITS) === 0
        ? [`${providerSlug}:${mask}`]
        : []
    )
    .join(",");
  if (!encodedProviders) {
    return null;
  }

  const encoded = [
    JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_PREFIX,
    evidence.windowStart,
    evidence.windowEnd,
    encodedProviders,
  ].join("|");
  return encoded.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? encoded : null;
}

function mergeJunctionHistoricalBackfillEvidence(
  left: JunctionHistoricalBackfillEvidence | null,
  right: JunctionHistoricalBackfillEvidence | null,
): string | null {
  if (!left) {
    return right ? encodeJunctionHistoricalBackfillEvidence(right) : null;
  }
  if (!right) {
    return encodeJunctionHistoricalBackfillEvidence(left);
  }
  if (left.windowStart !== right.windowStart || left.windowEnd !== right.windowEnd) {
    return null;
  }

  const resourcesByProvider = { ...right.resourcesByProvider };
  for (const [providerSlug, mask] of Object.entries(left.resourcesByProvider)) {
    resourcesByProvider[providerSlug] = (resourcesByProvider[providerSlug] ?? 0) | mask;
  }
  return encodeJunctionHistoricalBackfillEvidence({
    resourcesByProvider,
    windowEnd: left.windowEnd,
    windowStart: left.windowStart,
  });
}

function selectJunctionHistoricalBackfillEvidence(input: {
  hostedEvidence: JunctionHistoricalBackfillEvidence | null;
  hostedValue: unknown;
  localEvidence: JunctionHistoricalBackfillEvidence | null;
  localValue: unknown;
  preferLocal: boolean;
  selectedProgress: JunctionHistoricalBackfillProgress | null;
}): string | null {
  if (input.selectedProgress) {
    if (input.selectedProgress.coverageVersion > JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION) {
      const preferredValue = input.preferLocal ? input.localValue : input.hostedValue;
      return typeof preferredValue === "string" ? preferredValue : null;
    }

    return mergeJunctionHistoricalBackfillEvidence(
      evidenceMatchesProgress(input.localEvidence, input.selectedProgress)
        ? input.localEvidence
        : null,
      evidenceMatchesProgress(input.hostedEvidence, input.selectedProgress)
        ? input.hostedEvidence
        : null,
    );
  }

  const merged = mergeJunctionHistoricalBackfillEvidence(
    input.localEvidence,
    input.hostedEvidence,
  );
  if (merged) {
    return merged;
  }

  const preferredEvidence = input.preferLocal ? input.localEvidence : input.hostedEvidence;
  return preferredEvidence ? encodeJunctionHistoricalBackfillEvidence(preferredEvidence) : null;
}

function evidenceMatchesProgress(
  evidence: JunctionHistoricalBackfillEvidence | null,
  progress: JunctionHistoricalBackfillProgress,
): boolean {
  return evidence?.windowStart === progress.windowStart
    && evidence.windowEnd === progress.windowEnd;
}

function hasAdditionalJunctionHistoricalBackfillEvidence(
  local: JunctionHistoricalBackfillEvidence | null,
  hosted: JunctionHistoricalBackfillEvidence | null,
): boolean {
  if (!local) {
    return false;
  }
  if (!hosted) {
    return true;
  }
  if (local.windowStart !== hosted.windowStart || local.windowEnd !== hosted.windowEnd) {
    return false;
  }
  return Object.entries(local.resourcesByProvider).some(([providerSlug, localMask]) =>
    (localMask & ~(hosted.resourcesByProvider[providerSlug] ?? 0)) !== 0
  );
}

function doesSelectedJunctionEvidenceIncludeLocalProgress(
  selected: JunctionHistoricalBackfillEvidence | null,
  local: JunctionHistoricalBackfillEvidence | null,
  hosted: JunctionHistoricalBackfillEvidence | null,
): boolean {
  if (
    !selected
    || !local
    || selected.windowStart !== local.windowStart
    || selected.windowEnd !== local.windowEnd
  ) {
    return false;
  }
  if (!hosted || hosted.windowStart !== local.windowStart || hosted.windowEnd !== local.windowEnd) {
    return true;
  }
  return hasAdditionalJunctionHistoricalBackfillEvidence(local, hosted);
}

function isCanonicalIsoTimestamp(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isSafeJunctionHistoricalBackfillEvidenceSource(value: string): boolean {
  return JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_SOURCE_PATTERN.test(value)
    && !JUNCTION_HISTORICAL_BACKFILL_EVIDENCE_BLOCKED_SOURCES.has(value);
}

function compareJunctionRetryProgress(
  left: JunctionHistoricalBackfillProgress,
  right: JunctionHistoricalBackfillProgress,
): number {
  if (left.emptyAttempts !== right.emptyAttempts) {
    return left.emptyAttempts - right.emptyAttempts;
  }

  const leftLastEmptyAtMs = left.lastEmptyAt ? Date.parse(left.lastEmptyAt) : NaN;
  const rightLastEmptyAtMs = right.lastEmptyAt ? Date.parse(right.lastEmptyAt) : NaN;
  if (!Number.isFinite(leftLastEmptyAtMs) || !Number.isFinite(rightLastEmptyAtMs)) {
    return 0;
  }

  return leftLastEmptyAtMs - rightLastEmptyAtMs;
}

function readMetadataNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readMetadataString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
