import {
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
  type JunctionResourceName,
} from "@murphai/contracts";

import { JUNCTION_CONNECT_SOURCE_TARGETS } from "./config/junction-connect-sources.ts";
import {
  DEVICE_SYNC_METADATA_DELETE,
  DEVICE_SYNC_METADATA_MAX_STRING_LENGTH,
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
export const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY =
  "junctionExtendedHistoryCoverage";
export const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION = 1;
export const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS = Object.freeze([
  "whoop_v2",
  "map_my_fitness",
  "ultrahuman",
  "dexcom",
  "renpho",
  "runkeeper",
  "samsung_health",
  "tandem_source",
  "beurer_api",
  "strava",
  "freestyle_libre_ble",
  "omron",
  "accuchek_ble",
  "eight_sleep",
  "fitbit",
  "freestyle_libre",
  "garmin",
  "hammerhead",
  "ihealth",
  "oura",
  "peloton",
  "wahoo",
  "contour_ble",
  "withings",
  "google_fit",
  "zwift",
  "onetouch_ble",
  "abbott_libreview",
  "dexcom_v3",
  "kardia",
  "cronometer",
  "polar",
  "apple_health_kit",
] as const);
export const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_RESOURCES = Object.freeze([
  "vo2_max",
  "body_temperature_delta",
  "body_temperature",
  "basal_body_temperature",
  "caffeine",
  "heart_rate_recovery_one_minute",
  "sleep_breathing_disturbance",
  "afib_burden",
  "blood_pressure",
  "note",
  "insulin_injection",
  "carbohydrates",
  "workout_duration",
  "weight",
  "fat",
  "body_mass_index",
  "lean_body_mass",
  "waist_circumference",
] as const satisfies readonly JunctionResourceName[]);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_SOURCE_INDEX = new Map(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS.map((providerSlug, index) =>
    [providerSlug, index] as const
  ),
);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_RESOURCE_INDEX:
  ReadonlyMap<string, number> = new Map(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_RESOURCES.map((resource, index) =>
    [resource, index] as const
  ),
);
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BIT_COUNT =
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS.length
  * JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_RESOURCES.length;
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BYTE_COUNT = Math.ceil(
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BIT_COUNT / 8,
);
const JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS =
  Object.freeze([
    JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
    JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  ] as const);

const JUNCTION_RECONCILED_HISTORICAL_METADATA_KEYS = Object.freeze([
  ...Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS),
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY,
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
    const metadata = { ...result.metadata };

    const compactCoverageMerge = mergeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      hostedMetadata: input.hostedMetadata,
      localMetadata: input.localMetadata,
      preserveLocal: input.localConnectionStateUnpublished,
    });
    if (compactCoverageMerge.encoded === null) {
      delete metadata[JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY];
    } else {
      metadata[JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY] =
        compactCoverageMerge.encoded;
    }

    // Legacy lists are read-only migration inputs. Once their current-version
    // bits exist in the matrix, the same metadata owner removes the lists.
    for (const metadataKey of JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
      const selectedLegacyCoverage = readJunctionBloodPressureHistoryBackfillCoverage(
        metadata[metadataKey],
      );
      if (
        compactCoverageMerge.encoded !== null
        && selectedLegacyCoverage !== null
        && selectedLegacyCoverage.version
          <= JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION
      ) {
        delete metadata[metadataKey];
      }
    }

    return {
      metadata,
      preservedLocalProgress:
        result.preservedLocalProgress || compactCoverageMerge.preservedLocalCoverage,
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

interface JunctionBloodPressureHistoryBackfillCoverage {
  providerSlugs: string[];
  version: number;
}

interface JunctionExtendedTimeseriesHistoryBackfillCoverage {
  bytes: Uint8Array;
}

interface JunctionExtendedTimeseriesHistoryBackfillCoordinate {
  bitIndex: number;
  providerSlug: string;
  resource: string;
}

interface JunctionExtendedTimeseriesHistoryBackfillCoverageMerge {
  encoded: string | null;
  preservedLocalCoverage: boolean;
}

const BASE64URL_CANONICAL_PATTERN = /^[A-Za-z0-9_-]+$/u;

if (
  JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_SOURCE_INDEX.size
    !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS.length
  || JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_RESOURCE_INDEX.size
    !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_RESOURCES.length
  || JSON.stringify(JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS)
    !== JSON.stringify(JUNCTION_CONNECT_SOURCE_TARGETS.map((target) => target.providerSlug))
  || JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES.some(
    (resource) => !JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_RESOURCE_INDEX.has(resource),
  )
) {
  throw new TypeError(
    "Junction extended-history coverage v1 coordinates drifted; bump the encoding version.",
  );
}

/**
 * The matrix uses the ordered Junction source/resource catalogs as its durable
 * coordinate system. Bump the encoding version before changing either order.
 */
export function isJunctionExtendedTimeseriesHistoryBackfillCoverageCoordinate(
  resource: string,
  providerSlug: string,
): boolean {
  return resolveJunctionExtendedTimeseriesHistoryBackfillCoordinate({
    providerSlug,
    resource,
    version: JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
  }) !== null;
}

export function addJunctionExtendedTimeseriesHistoryBackfillCoverage(input: {
  existingMetadata: Record<string, unknown>;
  providerSlug: string;
  resource: string;
  version: number;
}): Record<string, unknown> | null {
  const coordinate = resolveJunctionExtendedTimeseriesHistoryBackfillCoordinate(input);
  if (
    !coordinate
    || !canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
      input.existingMetadata,
      input.resource,
      input.version,
    )
  ) {
    return null;
  }

  const coverage = readLogicalJunctionExtendedTimeseriesHistoryBackfillCoverage(
    input.existingMetadata,
    input.version,
  ) ?? createEmptyJunctionExtendedTimeseriesHistoryBackfillCoverage();
  setJunctionExtendedTimeseriesHistoryBackfillCoverageBit(coverage, coordinate.bitIndex);
  const encoded = encodeJunctionExtendedTimeseriesHistoryBackfillCoverage(
    coverage,
    input.version,
  );
  if (!encoded) {
    return null;
  }

  const metadataPatch: Record<string, unknown> = {
    [JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY]: encoded,
  };
  for (const metadataKey of JUNCTION_LEGACY_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
    const legacyCoverage = readJunctionBloodPressureHistoryBackfillCoverage(
      input.existingMetadata[metadataKey],
    );
    if (legacyCoverage !== null && legacyCoverage.version <= input.version) {
      metadataPatch[metadataKey] = DEVICE_SYNC_METADATA_DELETE;
    }
  }
  return metadataPatch;
}

export function hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  providerSlug: string,
  resource: string,
  version: number,
): boolean {
  const coordinate = resolveJunctionExtendedTimeseriesHistoryBackfillCoordinate({
    providerSlug,
    resource,
    version,
  });
  const coverage = readLogicalJunctionExtendedTimeseriesHistoryBackfillCoverage(
    metadata,
    version,
  );
  return coordinate !== null
    && coverage !== null
    && hasJunctionExtendedTimeseriesHistoryBackfillCoverageBit(coverage, coordinate.bitIndex);
}

export function canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  resource: string,
  version: number,
): boolean {
  if (!Number.isSafeInteger(version) || version < 1) {
    return false;
  }
  const storedVersion = readJunctionExtendedTimeseriesHistoryBackfillCoverageEncodingVersion(
    metadata[JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY],
  );
  if (
    storedVersion !== null
    && storedVersion > version
  ) {
    return false;
  }
  const legacyMetadataKey =
    resolveLegacyJunctionExtendedTimeseriesHistoryBackfillCoverageMetadataKey(resource);
  const legacyCoverage = legacyMetadataKey
    ? readJunctionBloodPressureHistoryBackfillCoverage(metadata[legacyMetadataKey])
    : null;
  return legacyCoverage === null || legacyCoverage.version <= version;
}

function resolveJunctionExtendedTimeseriesHistoryBackfillCoordinate(input: {
  providerSlug: string;
  resource: string;
  version: number;
}): JunctionExtendedTimeseriesHistoryBackfillCoordinate | null {
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    return null;
  }
  const providerSlug = input.providerSlug.trim().toLowerCase();
  const sourceIndex = JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_SOURCE_INDEX.get(
    providerSlug as typeof JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS[number],
  );
  const resourceIndex = JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_RESOURCE_INDEX.get(
    input.resource as typeof JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_RESOURCES[number],
  );
  if (sourceIndex === undefined || resourceIndex === undefined) {
    return null;
  }
  return {
    bitIndex:
      resourceIndex * JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_V1_SOURCE_SLUGS.length
      + sourceIndex,
    providerSlug,
    resource: input.resource,
  };
}

function resolveLegacyJunctionExtendedTimeseriesHistoryBackfillCoverageMetadataKey(
  resource: string,
): string | null {
  if (resource === "blood_pressure") {
    return JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY;
  }
  if (resource === "note") {
    return JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY;
  }
  return null;
}

function createEmptyJunctionExtendedTimeseriesHistoryBackfillCoverage():
  JunctionExtendedTimeseriesHistoryBackfillCoverage {
  return { bytes: new Uint8Array(JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BYTE_COUNT) };
}

function readLogicalJunctionExtendedTimeseriesHistoryBackfillCoverage(
  metadata: Record<string, unknown>,
  version: number,
): JunctionExtendedTimeseriesHistoryBackfillCoverage | null {
  const compactVersion = readJunctionExtendedTimeseriesHistoryBackfillCoverageEncodingVersion(
    metadata[JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY],
  );
  if (
    compactVersion !== null
    && compactVersion > version
  ) {
    return null;
  }

  const compactCoverage = readJunctionExtendedTimeseriesHistoryBackfillCoverage(
    metadata[JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY],
    version,
  );
  const coverage = compactCoverage
    ? { bytes: compactCoverage.bytes.slice() }
    : createEmptyJunctionExtendedTimeseriesHistoryBackfillCoverage();
  let hasCoverage = compactCoverage !== null;

  for (const resource of ["blood_pressure", "note"] as const) {
    const metadataKey = resolveLegacyJunctionExtendedTimeseriesHistoryBackfillCoverageMetadataKey(
      resource,
    );
    const legacyCoverage = metadataKey
      ? readJunctionBloodPressureHistoryBackfillCoverage(metadata[metadataKey])
      : null;
    if (legacyCoverage?.version !== version) {
      continue;
    }
    for (const providerSlug of legacyCoverage.providerSlugs) {
      const coordinate = resolveJunctionExtendedTimeseriesHistoryBackfillCoordinate({
        providerSlug,
        resource,
        version: legacyCoverage.version,
      });
      if (coordinate) {
        setJunctionExtendedTimeseriesHistoryBackfillCoverageBit(coverage, coordinate.bitIndex);
        hasCoverage = true;
      }
    }
  }
  return hasCoverage ? coverage : null;
}

function readJunctionExtendedTimeseriesHistoryBackfillCoverage(
  value: unknown,
  version: number,
): JunctionExtendedTimeseriesHistoryBackfillCoverage | null {
  if (
    typeof value !== "string"
    || value.length > DEVICE_SYNC_METADATA_MAX_STRING_LENGTH
    || !value.startsWith(`m${version}|`)
  ) {
    return null;
  }
  const encodedBytes = value.slice(`m${version}|`.length);
  if (!BASE64URL_CANONICAL_PATTERN.test(encodedBytes) || encodedBytes.length % 4 === 1) {
    return null;
  }
  const decoded = Buffer.from(encodedBytes, "base64url");
  if (
    decoded.length !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BYTE_COUNT
    || decoded.toString("base64url") !== encodedBytes
  ) {
    return null;
  }
  const unusedBitCount =
    JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BYTE_COUNT * 8
    - JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BIT_COUNT;
  if (
    unusedBitCount > 0
    && (decoded[decoded.length - 1] & (0xff << (8 - unusedBitCount))) !== 0
  ) {
    return null;
  }
  return { bytes: new Uint8Array(decoded) };
}

function readJunctionExtendedTimeseriesHistoryBackfillCoverageEncodingVersion(
  value: unknown,
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^m([1-9]\d*)\|/u.exec(value);
  const version = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(version) ? version : null;
}

function encodeJunctionExtendedTimeseriesHistoryBackfillCoverage(
  coverage: JunctionExtendedTimeseriesHistoryBackfillCoverage,
  version: number,
): string | null {
  if (
    coverage.bytes.length !== JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_BYTE_COUNT
    || !coverage.bytes.some((byte) => byte !== 0)
  ) {
    return null;
  }
  const encoded = `m${version}|${
    Buffer.from(coverage.bytes).toString("base64url")
  }`;
  return encoded.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? encoded : null;
}

function hasJunctionExtendedTimeseriesHistoryBackfillCoverageBit(
  coverage: JunctionExtendedTimeseriesHistoryBackfillCoverage,
  bitIndex: number,
): boolean {
  const byteIndex = Math.floor(bitIndex / 8);
  return (coverage.bytes[byteIndex] & (1 << (bitIndex % 8))) !== 0;
}

function setJunctionExtendedTimeseriesHistoryBackfillCoverageBit(
  coverage: JunctionExtendedTimeseriesHistoryBackfillCoverage,
  bitIndex: number,
): void {
  const byteIndex = Math.floor(bitIndex / 8);
  coverage.bytes[byteIndex] |= 1 << (bitIndex % 8);
}

function mergeJunctionExtendedTimeseriesHistoryBackfillCoverage(input: {
  hostedMetadata: Record<string, unknown>;
  localMetadata: Record<string, unknown>;
  preserveLocal: boolean;
}): JunctionExtendedTimeseriesHistoryBackfillCoverageMerge {
  const hostedValue = input.hostedMetadata[
    JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY
  ];
  const localValue = input.localMetadata[
    JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_METADATA_KEY
  ];
  const hostedVersion = readJunctionExtendedTimeseriesHistoryBackfillCoverageEncodingVersion(
    hostedValue,
  );
  const localVersion = input.preserveLocal
    ? readJunctionExtendedTimeseriesHistoryBackfillCoverageEncodingVersion(localValue)
    : null;
  if (
    localVersion !== null
    && localVersion > JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION
    && (hostedVersion === null || localVersion > hostedVersion)
  ) {
    return {
      encoded: typeof localValue === "string" ? localValue : null,
      preservedLocalCoverage: true,
    };
  }
  if (
    hostedVersion !== null
    && hostedVersion > JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION
  ) {
    return {
      encoded: typeof hostedValue === "string" ? hostedValue : null,
      preservedLocalCoverage: false,
    };
  }

  const hostedCoverage = readLogicalJunctionExtendedTimeseriesHistoryBackfillCoverage(
    input.hostedMetadata,
    JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
  );
  const localCoverage = input.preserveLocal
    ? readLogicalJunctionExtendedTimeseriesHistoryBackfillCoverage(
      input.localMetadata,
      JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
    )
    : null;
  const mergedCoverage = hostedCoverage
    ? { bytes: hostedCoverage.bytes.slice() }
    : createEmptyJunctionExtendedTimeseriesHistoryBackfillCoverage();
  if (localCoverage) {
    for (let index = 0; index < mergedCoverage.bytes.length; index += 1) {
      mergedCoverage.bytes[index] |= localCoverage.bytes[index];
    }
  }
  return {
    encoded: encodeJunctionExtendedTimeseriesHistoryBackfillCoverage(
      mergedCoverage,
      JUNCTION_EXTENDED_TIMESERIES_HISTORY_COVERAGE_POLICY_VERSION,
    ),
    preservedLocalCoverage:
      localCoverage !== null
      && doesJunctionExtendedTimeseriesCoverageAdvance(localCoverage, hostedCoverage),
  };
}

function readJunctionBloodPressureHistoryBackfillCoverage(
  value: unknown,
): JunctionBloodPressureHistoryBackfillCoverage | null {
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
  return encodeJunctionBloodPressureHistoryBackfillCoverage(coverage) === value ? coverage : null;
}

function encodeJunctionBloodPressureHistoryBackfillCoverage(
  coverage: JunctionBloodPressureHistoryBackfillCoverage,
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

function doesJunctionExtendedTimeseriesCoverageAdvance(
  local: JunctionExtendedTimeseriesHistoryBackfillCoverage,
  hosted: JunctionExtendedTimeseriesHistoryBackfillCoverage | null,
): boolean {
  if (!hosted) {
    return true;
  }
  return local.bytes.some((byte, index) => (byte & ~hosted.bytes[index]) !== 0);
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
