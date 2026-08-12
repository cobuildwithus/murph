import { DEVICE_SYNC_METADATA_MAX_STRING_LENGTH } from "./metadata.ts";

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
export const JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY =
  "junctionWeightHistoryBackfillCoverage";
export const JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_VERSION = 1;
const JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_PREFIX = "v";

const JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS = Object.freeze([
  JUNCTION_BLOOD_PRESSURE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_NOTE_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
  JUNCTION_WEIGHT_HISTORY_BACKFILL_COVERAGE_METADATA_KEY,
] as const);

const JUNCTION_RECONCILED_HISTORICAL_METADATA_KEYS = Object.freeze([
  ...Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS),
  ...JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS,
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

    let preservedLocalCoverage = false;
    for (const metadataKey of JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_METADATA_KEYS) {
      const hostedCoverage = readJunctionExtendedTimeseriesHistoryBackfillCoverage(
        input.hostedMetadata[metadataKey],
      );
      const localCoverage = input.localConnectionStateUnpublished
        ? readJunctionExtendedTimeseriesHistoryBackfillCoverage(input.localMetadata[metadataKey])
        : null;
      const mergedCoverage = mergeJunctionExtendedTimeseriesHistoryBackfillCoverage(
        hostedCoverage,
        localCoverage,
      );
      const selectedCoverage = readJunctionExtendedTimeseriesHistoryBackfillCoverage(
        mergedCoverage,
      );
      preservedLocalCoverage ||= localCoverage !== null
        && selectedCoverage !== null
        && doesJunctionExtendedTimeseriesCoverageAdvance(localCoverage, hostedCoverage)
        && selectedCoverage.version === localCoverage.version
        && localCoverage.providerSlugs.every(
          (providerSlug) => selectedCoverage.providerSlugs.includes(providerSlug),
        );

      if (mergedCoverage === null) {
        delete metadata[metadataKey];
      } else {
        metadata[metadataKey] = mergedCoverage;
      }
    }

    return {
      metadata,
      preservedLocalProgress: result.preservedLocalProgress || preservedLocalCoverage,
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

type JunctionExtendedTimeseriesHistoryBackfillCoverage =
  JunctionBloodPressureHistoryBackfillCoverage;

export function addJunctionExtendedTimeseriesHistoryBackfillCoverage(input: {
  existingValue: unknown;
  providerSlug: string;
  version: number;
}): string | null {
  return addJunctionBloodPressureHistoryBackfillCoverage(input);
}

export function hasJunctionExtendedTimeseriesHistoryBackfillCoverage(
  value: unknown,
  providerSlug: string,
  version: number,
): boolean {
  return hasJunctionBloodPressureHistoryBackfillCoverage(value, providerSlug, version);
}

export function canCurrentRuntimeMutateJunctionExtendedTimeseriesHistoryBackfillCoverage(
  value: unknown,
  version: number,
): boolean {
  return canCurrentRuntimeMutateJunctionBloodPressureHistoryBackfillCoverage(value, version);
}

export function addJunctionBloodPressureHistoryBackfillCoverage(input: {
  existingValue: unknown;
  providerSlug: string;
  version: number;
}): string | null {
  const providerSlug = input.providerSlug.trim().toLowerCase();
  if (
    !Number.isSafeInteger(input.version)
    || input.version < 1
    || !isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug)
  ) {
    return null;
  }

  const existing = readJunctionBloodPressureHistoryBackfillCoverage(input.existingValue);
  if (existing !== null && existing.version > input.version) {
    return encodeJunctionBloodPressureHistoryBackfillCoverage(existing);
  }
  const preservedExisting = existing?.version === input.version ? existing : null;
  const providerSlugs = preservedExisting
    ? [...preservedExisting.providerSlugs, providerSlug]
    : [providerSlug];
  return encodeJunctionBloodPressureHistoryBackfillCoverage({
    providerSlugs,
    version: preservedExisting?.version ?? input.version,
  });
}

export function hasJunctionBloodPressureHistoryBackfillCoverage(
  value: unknown,
  providerSlug: string,
  version: number,
): boolean {
  const coverage = readJunctionBloodPressureHistoryBackfillCoverage(value);
  return coverage?.version === version
    && coverage.providerSlugs.includes(providerSlug.trim().toLowerCase());
}

export function canCurrentRuntimeMutateJunctionBloodPressureHistoryBackfillCoverage(
  value: unknown,
  version: number,
): boolean {
  if (!Number.isSafeInteger(version) || version < 1) {
    return false;
  }
  const coverage = readJunctionBloodPressureHistoryBackfillCoverage(value);
  return coverage === null || coverage.version <= version;
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
  const version = Number(versionPart.slice(JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_PREFIX.length));
  if (
    !versionPart.startsWith(JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_PREFIX)
    || !Number.isSafeInteger(version)
    || version < 1
    || providerSlugs.some((providerSlug) => !isSafeJunctionHistoricalBackfillEvidenceSource(providerSlug))
  ) {
    return null;
  }

  const coverage = { providerSlugs, version };
  return encodeJunctionBloodPressureHistoryBackfillCoverage(coverage) === value ? coverage : null;
}

function readJunctionExtendedTimeseriesHistoryBackfillCoverage(
  value: unknown,
): JunctionExtendedTimeseriesHistoryBackfillCoverage | null {
  return readJunctionBloodPressureHistoryBackfillCoverage(value);
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
  const encoded = `${JUNCTION_EXTENDED_TIMESERIES_HISTORY_BACKFILL_COVERAGE_PREFIX}${coverage.version}|${providerSlugs.join(",")}`;
  return encoded.length <= DEVICE_SYNC_METADATA_MAX_STRING_LENGTH ? encoded : null;
}

function mergeJunctionBloodPressureHistoryBackfillCoverage(
  hosted: JunctionBloodPressureHistoryBackfillCoverage | null,
  local: JunctionBloodPressureHistoryBackfillCoverage | null,
): string | null {
  if (!hosted) {
    return local ? encodeJunctionBloodPressureHistoryBackfillCoverage(local) : null;
  }
  if (!local || hosted.version > local.version) {
    return encodeJunctionBloodPressureHistoryBackfillCoverage(hosted);
  }
  if (local.version > hosted.version) {
    return encodeJunctionBloodPressureHistoryBackfillCoverage(local);
  }
  return encodeJunctionBloodPressureHistoryBackfillCoverage({
    providerSlugs: [...hosted.providerSlugs, ...local.providerSlugs],
    version: hosted.version,
  }) ?? encodeJunctionBloodPressureHistoryBackfillCoverage(hosted);
}

function mergeJunctionExtendedTimeseriesHistoryBackfillCoverage(
  hosted: JunctionExtendedTimeseriesHistoryBackfillCoverage | null,
  local: JunctionExtendedTimeseriesHistoryBackfillCoverage | null,
): string | null {
  return mergeJunctionBloodPressureHistoryBackfillCoverage(hosted, local);
}

function doesJunctionBloodPressureCoverageAdvance(
  local: JunctionBloodPressureHistoryBackfillCoverage,
  hosted: JunctionBloodPressureHistoryBackfillCoverage | null,
): boolean {
  return !hosted
    || local.version > hosted.version
    || (
      local.version === hosted.version
      && local.providerSlugs.some((providerSlug) => !hosted.providerSlugs.includes(providerSlug))
    );
}

function doesJunctionExtendedTimeseriesCoverageAdvance(
  local: JunctionExtendedTimeseriesHistoryBackfillCoverage,
  hosted: JunctionExtendedTimeseriesHistoryBackfillCoverage | null,
): boolean {
  return doesJunctionBloodPressureCoverageAdvance(local, hosted);
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
