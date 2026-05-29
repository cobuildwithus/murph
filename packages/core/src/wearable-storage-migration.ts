import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  jsonObjectSchema,
  type JsonObject,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { walkVaultFiles } from "./fs.ts";
import { readJsonlRecords } from "./jsonl.ts";
import {
  isRawManifestFileName,
  parseRawImportManifest,
} from "./operations/raw-manifests.ts";
import {
  acquireCanonicalWriteLock,
  withCanonicalWriteLockScope,
} from "./operations/canonical-write-lock.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  normalizeRelativeVaultPath,
  resolveVaultPath,
  resolveVaultPathOnDisk,
} from "./path-safety.ts";
import { statAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { assertValidVault } from "./vault.ts";
import { VaultError } from "./errors.ts";
import {
  compactLegacyWearableReceiptEnvelopes,
  detectLegacyWearableReceiptCompaction,
} from "./wearable-receipts.ts";

export interface WearableStorageMigrationDetection {
  hasWork: boolean;
  suspectedBytes: number;
  legacyReceiptPayloadCount: number;
  legacyCanonicalArtifactCount: number;
  denseProviderSampleShardCount: number;
  denseProviderRawTimeseriesCount: number;
  retentionEligibleDenseProviderRawTimeseriesBytes: number;
  retentionEligibleDenseProviderRawTimeseriesCount: number;
}

export interface WearableStorageMigrationResult {
  mutated: boolean;
  hasMore: boolean;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
  compactedReceiptCount: number;
  denseRawBytesAfter: number;
  denseRawBytesBefore: number;
  denseRawBytesFreed: number;
  tombstonedCanonicalArtifactCount: number;
  tombstonedDenseRawArtifactCount: number;
  skippedCount: number;
  touchedPaths: string[];
}

export type WearableStorageMigrationRepairClass =
  | "dense_raw_timeseries"
  | "legacy_canonical_artifacts"
  | "legacy_receipts";

export interface DetectWearableStorageMigrationCandidatesInput {
  vaultRoot: string;
  includeRecentDenseRaw?: boolean;
  maxManifestBytes?: number;
  now?: Date;
}

export interface RunWearableStorageMigrationPassInput {
  vaultRoot: string;
  maxFiles?: number;
  maxBytes?: number;
  deadlineMs?: number;
  now?: Date;
  pruneDenseRaw?: boolean;
  repairClasses?: readonly WearableStorageMigrationRepairClass[];
  includeRecentDenseRaw?: boolean;
  validateAfter?: boolean;
}

export interface PruneWearableDenseRawTimeseriesInput {
  vaultRoot: string;
  maxFiles?: number;
  maxBytes?: number;
  deadlineMs?: number;
  now?: Date;
  validateAfter?: boolean;
}

interface RawManifestSnapshot {
  manifest: RawImportManifest;
  relativePath: string;
}

interface RawManifestReadResult {
  invalidDirectories: Set<string>;
  snapshots: RawManifestSnapshot[];
}

type LedgerRawReferenceScan =
  | { kind: "ok"; rawPaths: ReadonlySet<string> }
  | { kind: "unsafe" };

interface RawArtifactReference {
  artifact: RawImportManifestArtifact;
  manifest: RawImportManifest;
  manifestPath: string;
}

type RawArtifactTombstonePredicate = (
  artifact: RawImportManifestArtifact,
  manifest: RawImportManifest,
) => boolean;

interface RawArtifactRetentionMetadata {
  artifactClass: "dense_provider_timeseries" | "sparse_provider_timeseries";
  resourceCategory: "timeseries";
  retentionClass: "debug_temporary" | "provider_evidence";
}

interface PreparedRawTombstone {
  artifactClass: "dense_provider_timeseries" | "derived_canonical_records";
  bytesAfter: number;
  bytesBefore: number;
  content: string;
  manifestPaths: string[];
  replacementArtifact: Pick<RawImportManifestArtifact, "byteSize" | "role" | "sha256">;
  targetPath: string;
}

interface RawTombstoneRunResult {
  hasMore: boolean;
  skippedCount: number;
  tombstonedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  touchedPaths: string[];
}

interface DenseSampleShardCandidate {
  relativePath: string;
  byteSize: number;
}

const DEFAULT_MAX_FILES = 25;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const CANONICAL_RECORDS_ROLE_PREFIX = "wearable-canonical-records:";
const RAW_RECEIPT_ROLE_PREFIXES = Object.freeze([
  "wearable-raw-envelope:",
  "wearable-raw-receipt:",
]);
const WEARABLE_STORAGE_TOMBSTONE_ROLE_PREFIX = "wearable-storage-pruned:";
const WEARABLE_STORAGE_TOMBSTONE_SCHEMA_VERSIONS = new Set([
  "wearable.dense_provider_timeseries_pruned.v1",
  "wearable.legacy_canonical_records_pruned.v1",
]);
const WEARABLE_RECEIPT_SCHEMA_VERSIONS = new Set([
  "wearable.raw_ingest.v1",
  "wearable.raw_ingest_receipt.v1",
]);
const MAX_TOMBSTONE_CONTENT_PROBE_BYTES = 16 * 1024;
const DENSE_SAMPLE_STREAMS = new Set([
  "heart_rate",
  "hrv",
  "respiratory_rate",
  "sleep_stage",
  "spo2",
  "steps",
  "temperature",
]);
const DENSE_RAW_ROLE_TERMS = Object.freeze([
  "active-calories",
  "active_calories",
  "blood-oxygen",
  "blood_oxygen",
  "calories-active",
  "calories_active",
  "distance",
  "heartrate",
  "heart-rate",
  "heart_rate",
  "hrv",
  "respiratory-rate",
  "respiratory_rate",
  "sleep-stage",
  "sleep_stage",
  "spo2",
  "steps",
  "temperature",
]);
const DENSE_RAW_TIMESERIES_ONLY_TERMS = new Set([
  "active-calories",
  "active_calories",
  "calories-active",
  "calories_active",
  "distance",
]);
const DENSE_RAW_EXACT_ROLES = new Set(
  DENSE_RAW_ROLE_TERMS.filter((term) => !DENSE_RAW_TIMESERIES_ONLY_TERMS.has(term)),
);

export async function detectWearableStorageMigrationCandidates({
  includeRecentDenseRaw = false,
  now = new Date(),
  vaultRoot,
  maxManifestBytes,
}: DetectWearableStorageMigrationCandidatesInput): Promise<WearableStorageMigrationDetection> {
  const [receiptDetection, manifests, sampleShardCandidates] = await Promise.all([
    detectLegacyWearableReceiptCompaction({ vaultRoot, maxManifestBytes }),
    readRawManifestSnapshots(vaultRoot, { maxManifestBytes }),
    collectDenseSampleShardCandidates(vaultRoot),
  ]);
  const canonicalReferences = collectRawArtifactReferenceGroups(
    manifests,
    (artifact) => isCanonicalRecordArtifact(artifact),
  );
  const denseRawReferences = collectRawArtifactReferenceGroups(
    manifests,
    (artifact, manifest) => isDenseRawTimeseriesArtifact(artifact, manifest),
  );
  const retentionEligibleDenseRawReferences = denseRawReferences.filter((references) =>
    includeRecentDenseRaw
    || isDenseRawReferenceGroupOlderThanRetentionWindow(references, now)
  );
  const canonicalBytes = sumLargestReferenceBytes(canonicalReferences);
  const denseRawBytes = sumLargestReferenceBytes(denseRawReferences);
  const denseSampleBytes = sampleShardCandidates.reduce(
    (total, candidate) => total + candidate.byteSize,
    0,
  );

  return {
    denseProviderRawTimeseriesCount: denseRawReferences.length,
    denseProviderSampleShardCount: sampleShardCandidates.length,
    retentionEligibleDenseProviderRawTimeseriesBytes:
      sumLargestReferenceBytes(retentionEligibleDenseRawReferences),
    retentionEligibleDenseProviderRawTimeseriesCount: retentionEligibleDenseRawReferences.length,
    hasWork:
      receiptDetection.hasWork
      || canonicalReferences.length > 0
      || denseRawReferences.length > 0,
    legacyCanonicalArtifactCount: canonicalReferences.length,
    legacyReceiptPayloadCount: receiptDetection.suspectedCount,
    suspectedBytes: canonicalBytes + denseRawBytes + denseSampleBytes,
  };
}

export async function runWearableStorageMigrationPass({
  vaultRoot,
  maxFiles = DEFAULT_MAX_FILES,
  maxBytes = DEFAULT_MAX_BYTES,
  deadlineMs,
  now = new Date(),
  pruneDenseRaw = false,
  repairClasses,
  includeRecentDenseRaw = false,
  validateAfter = true,
}: RunWearableStorageMigrationPassInput): Promise<WearableStorageMigrationResult> {
  const enabledRepairClasses = resolveWearableStorageMigrationRepairClasses({
    pruneDenseRaw,
    repairClasses,
  });
  const shouldCompactReceipts = enabledRepairClasses.has("legacy_receipts");
  const shouldTombstoneCanonicalArtifacts = enabledRepairClasses.has(
    "legacy_canonical_artifacts",
  );
  const shouldTombstoneDenseRaw = pruneDenseRaw
    && enabledRepairClasses.has("dense_raw_timeseries");
  const startedAtMs = Date.now();
  let remainingFiles = Math.max(0, Math.trunc(maxFiles));
  let remainingBytes = Math.max(0, Math.trunc(maxBytes));
  let hasMore = false;
  let skippedCount = 0;
  const touchedPaths = new Set<string>();
  let bytesBefore = 0;
  let bytesAfter = 0;
  let compactedReceiptCount = 0;
  let denseRawBytesAfter = 0;
  let denseRawBytesBefore = 0;
  let tombstonedCanonicalArtifactCount = 0;
  let tombstonedDenseRawArtifactCount = 0;
  let attemptedReceiptCompaction = false;
  let attemptedCanonicalTombstones = false;
  let attemptedDenseRawTombstones = false;

  if (
    shouldCompactReceipts
    && remainingFiles > 0
    && remainingBytes > 0
    && !deadlineExceeded(startedAtMs, deadlineMs)
  ) {
    attemptedReceiptCompaction = true;
    const receiptResult = await compactLegacyWearableReceiptEnvelopes({
      deadlineMs: remainingDeadlineMs(startedAtMs, deadlineMs),
      maxBytesRead: remainingBytes,
      maxCandidateBytes: remainingBytes,
      maxEnvelopes: remainingFiles,
      maxEvidenceArtifactBytes: remainingBytes,
      maxEvidenceTotalBytes: remainingBytes,
      now,
      validateAfter: false,
      vaultRoot,
    });
    compactedReceiptCount = receiptResult.compactedCount;
    skippedCount += receiptResult.skippedCount;
    bytesBefore += receiptResult.bytesBefore;
    bytesAfter += receiptResult.bytesAfter;
    remainingFiles -= receiptResult.compactedCount;
    remainingBytes = Math.max(0, remainingBytes - receiptResult.bytesBefore);
    for (const touchedPath of receiptResult.touchedPaths) {
      touchedPaths.add(touchedPath);
    }
    hasMore ||= receiptResult.hasMore;
  }

  if (
    shouldTombstoneCanonicalArtifacts
    && remainingFiles > 0
    && remainingBytes > 0
    && !deadlineExceeded(startedAtMs, deadlineMs)
  ) {
    attemptedCanonicalTombstones = true;
    const canonicalResult = await tombstoneRawArtifactClass({
      artifactClass: "derived_canonical_records",
      deadlineMs,
      maxBytes: remainingBytes,
      maxFiles: remainingFiles,
      now,
      predicate: isCanonicalRecordArtifact,
      reason: "derived_duplicate_not_canonical_evidence",
      schemaVersion: "wearable.legacy_canonical_records_pruned.v1",
      startedAtMs,
      vaultRoot,
    });
    tombstonedCanonicalArtifactCount = canonicalResult.tombstonedCount;
    skippedCount += canonicalResult.skippedCount;
    bytesBefore += canonicalResult.bytesBefore;
    bytesAfter += canonicalResult.bytesAfter;
    remainingFiles -= canonicalResult.tombstonedCount;
    remainingBytes = Math.max(0, remainingBytes - canonicalResult.bytesBefore);
    for (const touchedPath of canonicalResult.touchedPaths) {
      touchedPaths.add(touchedPath);
    }
    hasMore ||= canonicalResult.hasMore;
  }

  if (
    shouldTombstoneDenseRaw
    && remainingFiles > 0
    && remainingBytes > 0
    && !deadlineExceeded(startedAtMs, deadlineMs)
  ) {
    attemptedDenseRawTombstones = true;
    const denseRawResult = await tombstoneRawArtifactClass({
      artifactClass: "dense_provider_timeseries",
      denseRetentionPolicy: {
        includeRecent: includeRecentDenseRaw,
      },
      deadlineMs,
      maxBytes: remainingBytes,
      maxFiles: remainingFiles,
      now,
      predicate: isDenseRawTimeseriesArtifact,
      reason: "dense_provider_debug_timeseries_pruned_after_product_facts",
      schemaVersion: "wearable.dense_provider_timeseries_pruned.v1",
      startedAtMs,
      vaultRoot,
    });
    tombstonedDenseRawArtifactCount = denseRawResult.tombstonedCount;
    skippedCount += denseRawResult.skippedCount;
    bytesBefore += denseRawResult.bytesBefore;
    bytesAfter += denseRawResult.bytesAfter;
    denseRawBytesBefore = denseRawResult.bytesBefore;
    denseRawBytesAfter = denseRawResult.bytesAfter;
    for (const touchedPath of denseRawResult.touchedPaths) {
      touchedPaths.add(touchedPath);
    }
    hasMore ||= denseRawResult.hasMore;
  }

  if (
    !hasMore
    && (
      !attemptedReceiptCompaction
      || !attemptedCanonicalTombstones
      || (shouldTombstoneDenseRaw && !attemptedDenseRawTombstones)
    )
  ) {
    const detection = await detectWearableStorageMigrationCandidates({
      includeRecentDenseRaw,
      now,
      vaultRoot,
    });
    if (
      shouldCompactReceipts
      && !attemptedReceiptCompaction
      && detection.legacyReceiptPayloadCount > 0
    ) {
      hasMore = true;
    }
    if (
      shouldTombstoneCanonicalArtifacts
      && !attemptedCanonicalTombstones
      && detection.legacyCanonicalArtifactCount > 0
    ) {
      hasMore = true;
    }
    if (
      shouldTombstoneDenseRaw
      && !attemptedDenseRawTombstones
      && detection.retentionEligibleDenseProviderRawTimeseriesCount > 0
    ) {
      hasMore = true;
    }
  }

  const mutated =
    compactedReceiptCount > 0
    || tombstonedCanonicalArtifactCount > 0
    || tombstonedDenseRawArtifactCount > 0;

  if (mutated && validateAfter) {
    await assertValidVault({
      errorCode: "WEARABLE_STORAGE_MIGRATION_INVALID_VAULT",
      message: "Wearable storage migration produced an invalid vault.",
      vaultRoot,
    });
  }

  return {
    bytesAfter,
    bytesBefore,
    bytesFreed: Math.max(0, bytesBefore - bytesAfter),
    compactedReceiptCount,
    denseRawBytesAfter,
    denseRawBytesBefore,
    denseRawBytesFreed: Math.max(0, denseRawBytesBefore - denseRawBytesAfter),
    hasMore,
    mutated,
    skippedCount,
    tombstonedCanonicalArtifactCount,
    tombstonedDenseRawArtifactCount,
    touchedPaths: [...touchedPaths].sort(),
  };
}

export async function pruneWearableDenseRawTimeseries({
  vaultRoot,
  maxFiles,
  maxBytes,
  deadlineMs,
  now,
  validateAfter,
}: PruneWearableDenseRawTimeseriesInput): Promise<WearableStorageMigrationResult> {
  return await runWearableStorageMigrationPass({
    deadlineMs,
    includeRecentDenseRaw: false,
    maxBytes,
    maxFiles,
    now,
    pruneDenseRaw: true,
    repairClasses: ["dense_raw_timeseries"],
    validateAfter,
    vaultRoot,
  });
}

async function tombstoneRawArtifactClass(input: {
  artifactClass: PreparedRawTombstone["artifactClass"];
  denseRetentionPolicy?: {
    includeRecent: boolean;
  };
  deadlineMs?: number;
  maxBytes: number;
  maxFiles: number;
  now: Date;
  predicate: RawArtifactTombstonePredicate;
  reason: string;
  schemaVersion: string;
  startedAtMs: number;
  vaultRoot: string;
}): Promise<RawTombstoneRunResult> {
  return await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);

    try {
      return await tombstoneRawArtifactClassLocked(input);
    } finally {
      await lock.release();
    }
  });
}

async function tombstoneRawArtifactClassLocked(input: {
  artifactClass: PreparedRawTombstone["artifactClass"];
  denseRetentionPolicy?: {
    includeRecent: boolean;
  };
  deadlineMs?: number;
  maxBytes: number;
  maxFiles: number;
  now: Date;
  predicate: RawArtifactTombstonePredicate;
  reason: string;
  schemaVersion: string;
  startedAtMs: number;
  vaultRoot: string;
}): Promise<RawTombstoneRunResult> {
  const manifestReadResult = await readRawManifestReadResult(input.vaultRoot);
  const manifestSnapshots = manifestReadResult.snapshots;
  const ledgerRawReferences = await collectLedgerRawReferences(input.vaultRoot);
  const groups = collectRawArtifactReferenceGroups(manifestSnapshots, input.predicate)
    .filter((references) => isRawTombstoneReferenceGroupInScope({
      artifactClass: input.artifactClass,
      denseRetentionPolicy: input.denseRetentionPolicy,
      now: input.now,
      references,
    }))
    .sort((left, right) => largestReferenceByteSize(right) - largestReferenceByteSize(left));
  const prepared: PreparedRawTombstone[] = [];
  const touchedManifestPaths = new Set<string>();
  let skippedCount = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  let hasMore = false;

  for (const references of groups) {
    if (deadlineExceeded(input.startedAtMs, input.deadlineMs)) {
      hasMore = true;
      break;
    }
    if (prepared.length >= input.maxFiles) {
      hasMore = true;
      break;
    }
    const largestBytes = largestReferenceByteSize(references);
    if (bytesBefore + largestBytes > input.maxBytes) {
      hasMore = true;
      continue;
    }

    const tombstone = await prepareRawArtifactTombstone({
      artifactClass: input.artifactClass,
      denseRetentionPolicy: input.denseRetentionPolicy,
      invalidManifestDirectories: manifestReadResult.invalidDirectories,
      ledgerRawReferences,
      manifestSnapshots,
      now: input.now,
      reason: input.reason,
      references,
      schemaVersion: input.schemaVersion,
      vaultRoot: input.vaultRoot,
    });
    if (!tombstone) {
      skippedCount += 1;
      continue;
    }
    if (deadlineExceeded(input.startedAtMs, input.deadlineMs)) {
      hasMore = true;
      break;
    }

    prepared.push(tombstone);
    bytesBefore += tombstone.bytesBefore;
    bytesAfter += tombstone.bytesAfter;
    for (const manifestPath of tombstone.manifestPaths) {
      touchedManifestPaths.add(manifestPath);
    }
  }

  if (prepared.length === 0) {
    return {
      bytesAfter: 0,
      bytesBefore: 0,
      hasMore,
      skippedCount,
      tombstonedCount: 0,
      touchedPaths: [],
    };
  }

  const touchedPaths = [
    ...new Set([
      ...prepared.map((tombstone) => tombstone.targetPath),
      ...touchedManifestPaths,
    ]),
  ].sort();
  const manifestUpdates = buildRawTombstoneManifestUpdates({
    manifestSnapshots,
    prepared,
  });

  await runCanonicalWrite({
    hostedCanonicalWritePort: null,
    hostedCanonicalWriteReceiptDirectory: null,
    occurredAt: input.now,
    operationType: `wearable_storage_${input.artifactClass}_tombstone`,
    summary: `Tombstone ${input.artifactClass} wearable raw artifacts`,
    vaultRoot: input.vaultRoot,
    mutate: async ({ batch }) => {
      for (const tombstone of prepared) {
        await batch.stageTextWrite(tombstone.targetPath, tombstone.content, {
          allowRaw: true,
          overwrite: true,
        });
      }
      for (const [manifestPath, manifest] of manifestUpdates) {
        await batch.stageTextWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
          allowRaw: true,
          overwrite: true,
        });
      }
      await emitAuditRecord({
        action: "vault_repair",
        batch,
        changes: touchedPaths.map((touchedPath) => ({ op: "update", path: touchedPath })),
        commandName: "core.runWearableStorageMigrationPass",
        occurredAt: input.now,
        summary:
          `Tombstoned ${prepared.length} ${input.artifactClass} artifact(s); ` +
          `bytesBefore=${bytesBefore}; bytesAfter=${bytesAfter}.`,
        vaultRoot: input.vaultRoot,
      });
    },
  });

  await assertRawManifestArtifactsMatchFiles({
    manifestPaths: touchedManifestPaths,
    targetPaths: new Set(prepared.map((tombstone) => tombstone.targetPath)),
    vaultRoot: input.vaultRoot,
  });

  return {
    bytesAfter,
    bytesBefore,
    hasMore,
    skippedCount,
    tombstonedCount: prepared.length,
    touchedPaths,
  };
}

async function prepareRawArtifactTombstone(input: {
  artifactClass: PreparedRawTombstone["artifactClass"];
  denseRetentionPolicy?: {
    includeRecent: boolean;
  };
  invalidManifestDirectories: ReadonlySet<string>;
  ledgerRawReferences: LedgerRawReferenceScan;
  manifestSnapshots: readonly RawManifestSnapshot[];
  now: Date;
  reason: string;
  references: readonly RawArtifactReference[];
  schemaVersion: string;
  vaultRoot: string;
}): Promise<PreparedRawTombstone | null> {
  const [firstReference] = input.references;
  if (!firstReference || !rawArtifactReferencesAgree(input.references)) {
    return null;
  }
  const targetArtifact = firstReference.artifact;
  if (input.invalidManifestDirectories.has(path.posix.dirname(targetArtifact.relativePath))) {
    return null;
  }
  if (!artifactPathBelongsToRawDirectory(targetArtifact, firstReference.manifest.rawDirectory)) {
    return null;
  }
  if (
    input.artifactClass === "dense_provider_timeseries"
    && input.denseRetentionPolicy?.includeRecent !== true
    && !isDenseRawReferenceGroupOlderThanRetentionWindow(input.references, input.now)
  ) {
    return null;
  }
  if (!await manifestsHaveRequiredEvidenceFiles({
    artifactClass: input.artifactClass,
    references: input.references,
    vaultRoot: input.vaultRoot,
  })) {
    return null;
  }
  const actual = await statAndHashVaultFile(input.vaultRoot, targetArtifact.relativePath);
  if (
    !actual
    || actual.byteSize !== targetArtifact.byteSize
    || actual.sha256 !== targetArtifact.sha256
  ) {
    return null;
  }
  if (
    input.ledgerRawReferences.kind === "unsafe"
    || input.ledgerRawReferences.rawPaths.has(targetArtifact.relativePath)
  ) {
    return null;
  }

  const originalByteSize = targetArtifact.byteSize;
  const originalSha256 = targetArtifact.sha256;
  const manifestPathsWithTargetPath = collectManifestPathsForRawArtifactPreimage({
    manifestSnapshots: input.manifestSnapshots,
    originalByteSize,
    originalRole: targetArtifact.role,
    originalSha256,
    targetPath: targetArtifact.relativePath,
  });
  if (!manifestPathsWithTargetPath) {
    return null;
  }

  const tombstoneContent = `${JSON.stringify({
    schemaVersion: input.schemaVersion,
    artifactClass: input.artifactClass,
    reason: input.reason,
    originalRole: targetArtifact.role,
    originalByteSize,
    originalSha256,
    prunedAt: input.now.toISOString(),
  }, null, 2)}\n`;
  const tombstoneBytes = Buffer.byteLength(tombstoneContent, "utf8");
  const tombstoneSha = sha256Buffer(Buffer.from(tombstoneContent, "utf8"));
  const replacementRole = replacementRoleForTombstone(input.artifactClass);

  return {
    artifactClass: input.artifactClass,
    bytesAfter: tombstoneBytes,
    bytesBefore: originalByteSize,
    content: tombstoneContent,
    manifestPaths: manifestPathsWithTargetPath,
    replacementArtifact: {
      byteSize: tombstoneBytes,
      role: replacementRole,
      sha256: tombstoneSha,
    },
    targetPath: targetArtifact.relativePath,
  };
}

function buildRawTombstoneManifestUpdates(input: {
  manifestSnapshots: readonly RawManifestSnapshot[];
  prepared: readonly PreparedRawTombstone[];
}): Map<string, RawImportManifest> {
  const updates = new Map<string, RawImportManifest>();

  for (const tombstone of input.prepared) {
    for (const manifestPath of tombstone.manifestPaths) {
      let manifest = updates.get(manifestPath);
      if (!manifest) {
        const snapshot = input.manifestSnapshots.find((entry) => entry.relativePath === manifestPath);
        if (!snapshot) {
          throw new Error(`Missing touched raw manifest snapshot for ${manifestPath}.`);
        }
        manifest = structuredClone(snapshot.manifest);
        updates.set(manifestPath, manifest);
      }

      for (const artifact of manifest.artifacts) {
        if (artifact.relativePath !== tombstone.targetPath) {
          continue;
        }
        artifact.byteSize = tombstone.replacementArtifact.byteSize;
        artifact.role = tombstone.replacementArtifact.role;
        artifact.sha256 = tombstone.replacementArtifact.sha256;
      }
      updateRawTombstoneManifestProvenance({
        manifest,
        tombstone,
      });
    }
  }

  return updates;
}

function updateRawTombstoneManifestProvenance(input: {
  manifest: RawImportManifest;
  tombstone: PreparedRawTombstone;
}): void {
  const rawArtifacts = readRecordArray(input.manifest.provenance.rawArtifacts);
  if (!rawArtifacts) {
    return;
  }

  let updated = false;
  const nextRawArtifacts: JsonObject[] = rawArtifacts.map((entry) => {
    if (entry.relativePath !== input.tombstone.targetPath) {
      return jsonObjectSchema.parse(entry);
    }

    updated = true;
    const replacement: Record<string, unknown> = {
      ...entry,
      byteSize: input.tombstone.replacementArtifact.byteSize,
      role: input.tombstone.replacementArtifact.role,
      sha256: input.tombstone.replacementArtifact.sha256,
    };
    delete replacement.metadata;
    return jsonObjectSchema.parse(replacement);
  });

  if (updated) {
    input.manifest.provenance.rawArtifacts = nextRawArtifacts;
  }
}

async function readRawManifestSnapshots(
  vaultRoot: string,
  options: { maxManifestBytes?: number } = {},
): Promise<RawManifestSnapshot[]> {
  return (await readRawManifestReadResult(vaultRoot, options)).snapshots;
}

async function readRawManifestReadResult(
  vaultRoot: string,
  options: { maxManifestBytes?: number } = {},
): Promise<RawManifestReadResult> {
  const manifestPaths = (await walkVaultFiles(vaultRoot, "raw", { extension: ".json" }))
    .filter((relativePath) => isRawManifestFileName(path.posix.basename(relativePath)));
  const snapshots: RawManifestSnapshot[] = [];
  const invalidDirectories = new Set<string>();

  for (const relativePath of manifestPaths) {
    try {
      const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath);
      const stats = await fs.lstat(resolved.absolutePath);
      if (!stats.isFile()) {
        invalidDirectories.add(path.posix.dirname(relativePath));
        continue;
      }
      if (
        options.maxManifestBytes !== undefined
        && stats.size > options.maxManifestBytes
      ) {
        continue;
      }
      snapshots.push({
        manifest: parseRawImportManifest(JSON.parse(await fs.readFile(resolved.absolutePath, "utf8"))),
        relativePath,
      });
    } catch {
      invalidDirectories.add(path.posix.dirname(relativePath));
      continue;
    }
  }

  return {
    invalidDirectories,
    snapshots,
  };
}

function collectRawArtifactReferenceGroups(
  manifests: readonly RawManifestSnapshot[],
  predicate: (artifact: RawImportManifestArtifact, manifest: RawImportManifest) => boolean,
): RawArtifactReference[][] {
  const referencesByPath = new Map<string, RawArtifactReference[]>();

  for (const snapshot of manifests) {
    for (const artifact of snapshot.manifest.artifacts) {
      if (!predicate(artifact, snapshot.manifest)) {
        continue;
      }
      const relativePath = normalizeRelativeVaultPath(artifact.relativePath);
      const references = referencesByPath.get(relativePath) ?? [];
      references.push({
        artifact,
        manifest: snapshot.manifest,
        manifestPath: snapshot.relativePath,
      });
      referencesByPath.set(relativePath, references);
    }
  }

  return [...referencesByPath.values()].map((references) =>
    references.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath))
  );
}

async function collectDenseSampleShardCandidates(
  vaultRoot: string,
): Promise<DenseSampleShardCandidate[]> {
  const sampleLedgerDirectory = VAULT_LAYOUT.sampleLedgerDirectory;
  const samplePaths = await walkVaultFiles(vaultRoot, sampleLedgerDirectory, { extension: ".jsonl" });
  const candidates: DenseSampleShardCandidate[] = [];

  for (const relativePath of samplePaths) {
    const stream = sampleStreamFromLedgerPath(relativePath);
    if (!stream || !DENSE_SAMPLE_STREAMS.has(stream)) {
      continue;
    }
    const resolved = resolveVaultPath(vaultRoot, relativePath);
    const stats = await fs.stat(resolved.absolutePath);
    candidates.push({
      byteSize: stats.size,
      relativePath,
    });
  }

  return candidates;
}

async function collectLedgerRawReferences(
  vaultRoot: string,
): Promise<LedgerRawReferenceScan> {
  const rawPaths = new Set<string>();
  for (const directory of ["ledger/events", "ledger/samples", "ledger/metric-samples"]) {
    const files = await walkVaultFiles(vaultRoot, directory, { extension: ".jsonl" });
    for (const file of files) {
      let records: Awaited<ReturnType<typeof readJsonlRecords>>;
      try {
        records = await readJsonlRecords({
          vaultRoot,
          relativePath: file,
        });
      } catch (error) {
        if (error instanceof VaultError && error.code === "VAULT_INVALID_JSONL") {
          return { kind: "unsafe" };
        }
        throw error;
      }
      for (const record of records) {
        collectRawPathStrings(record, rawPaths);
      }
    }
  }
  return { kind: "ok", rawPaths };
}

function collectRawPathStrings(value: unknown, rawPaths: Set<string>): void {
  if (typeof value === "string") {
    if (value === "raw" || value.startsWith("raw/")) {
      rawPaths.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRawPathStrings(item, rawPaths);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectRawPathStrings(item, rawPaths);
    }
  }
}

async function assertRawManifestArtifactsMatchFiles(input: {
  manifestPaths: ReadonlySet<string>;
  targetPaths: ReadonlySet<string>;
  vaultRoot: string;
}): Promise<void> {
  for (const manifestPath of input.manifestPaths) {
    const manifest = parseRawImportManifest(
      JSON.parse(await fs.readFile(resolveVaultPath(input.vaultRoot, manifestPath).absolutePath, "utf8")),
    );
    for (const artifact of manifest.artifacts) {
      if (!input.targetPaths.has(artifact.relativePath)) {
        continue;
      }
      const actual = await statAndHashVaultFile(input.vaultRoot, artifact.relativePath);
      if (
        !actual
        || actual.byteSize !== artifact.byteSize
        || actual.sha256 !== artifact.sha256
      ) {
        throw new Error(`Wearable storage migration artifact no longer matches manifest ${manifestPath}.`);
      }
    }
  }
}

function rawArtifactReferencesAgree(references: readonly RawArtifactReference[]): boolean {
  const [firstReference] = references;
  if (!firstReference) {
    return false;
  }
  return references.every((reference) =>
    reference.artifact.relativePath === firstReference.artifact.relativePath
    && reference.artifact.byteSize === firstReference.artifact.byteSize
    && reference.artifact.role === firstReference.artifact.role
    && reference.artifact.sha256 === firstReference.artifact.sha256
  );
}

async function manifestsHaveRequiredEvidenceFiles(input: {
  artifactClass: PreparedRawTombstone["artifactClass"];
  references: readonly RawArtifactReference[];
  vaultRoot: string;
}): Promise<boolean> {
  for (const reference of input.references) {
    const providerEvidenceArtifacts: RawImportManifestArtifact[] = [];
    const receiptArtifacts: RawImportManifestArtifact[] = [];

    for (const artifact of reference.manifest.artifacts) {
      if (!artifactPathBelongsToRawDirectory(artifact, reference.manifest.rawDirectory)) {
        return false;
      }
      if (RAW_RECEIPT_ROLE_PREFIXES.some((prefix) => artifact.role.startsWith(prefix))) {
        receiptArtifacts.push(artifact);
        continue;
      }
      const isProviderEvidence =
        artifact.relativePath !== reference.artifact.relativePath
        && !isCanonicalRecordArtifact(artifact)
        && !isWearableStorageTombstoneArtifact(artifact);
      if (input.artifactClass === "derived_canonical_records" && isProviderEvidence) {
        providerEvidenceArtifacts.push(artifact);
      }
    }

    if (
      receiptArtifacts.length === 0
      || (input.artifactClass === "derived_canonical_records" && providerEvidenceArtifacts.length === 0)
    ) {
      return false;
    }
    for (const artifact of providerEvidenceArtifacts) {
      if (!await rawArtifactIsUsableEvidenceFile(input.vaultRoot, artifact)) {
        return false;
      }
    }
    const coveredRoles = new Set<string>();
    for (const artifact of receiptArtifacts) {
      const receiptRoles = await readReceiptCoveredRoles(input.vaultRoot, artifact);
      if (!receiptRoles) {
        return false;
      }
      for (const role of receiptRoles) {
        coveredRoles.add(role);
      }
    }
    if (input.artifactClass === "dense_provider_timeseries") {
      if (!coveredRoles.has(reference.artifact.role)) {
        return false;
      }
    } else {
      for (const providerEvidence of providerEvidenceArtifacts) {
        if (!coveredRoles.has(providerEvidence.role)) {
          return false;
        }
      }
    }
  }

  return true;
}

async function readReceiptCoveredRoles(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
): Promise<Set<string> | null> {
  if (!await rawArtifactIsUsableEvidenceFile(vaultRoot, artifact)) {
    return null;
  }
  try {
    const raw = JSON.parse(
      await fs.readFile(resolveVaultPath(vaultRoot, artifact.relativePath).absolutePath, "utf8"),
    );
    if (!isPlainRecord(raw)) {
      return null;
    }
    if (!isRecognizedWearableReceipt(raw)) {
      return null;
    }
    const rawArtifactRoles = readStringArray(raw.rawArtifactRoles);
    if (!rawArtifactRoles || rawArtifactRoles.length === 0) {
      return null;
    }
    return new Set(rawArtifactRoles);
  } catch {
    return null;
  }
}

function isRecognizedWearableReceipt(raw: Record<string, unknown>): boolean {
  return typeof raw.schemaVersion === "string"
    && WEARABLE_RECEIPT_SCHEMA_VERSIONS.has(raw.schemaVersion)
    && typeof raw.payloadHash === "string"
    && Number.isInteger(raw.rawArtifactCount)
    && Array.isArray(raw.rawArtifactRoles)
    && raw.rawArtifactCount === raw.rawArtifactRoles.length;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return null;
    }
    strings.push(entry.trim());
  }
  return strings;
}

async function rawArtifactFileMatchesManifest(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
): Promise<boolean> {
  const actual = await statAndHashVaultFile(vaultRoot, artifact.relativePath);
  return actual !== null
    && actual.byteSize === artifact.byteSize
    && actual.sha256 === artifact.sha256;
}

async function rawArtifactIsUsableEvidenceFile(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
): Promise<boolean> {
  if (!await rawArtifactFileMatchesManifest(vaultRoot, artifact)) {
    return false;
  }
  return !await rawArtifactContentIsWearableStorageTombstone(vaultRoot, artifact);
}

async function rawArtifactContentIsWearableStorageTombstone(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
): Promise<boolean> {
  if (isWearableStorageTombstoneArtifact(artifact)) {
    return true;
  }
  if (artifact.byteSize > MAX_TOMBSTONE_CONTENT_PROBE_BYTES) {
    return false;
  }
  try {
    const raw = JSON.parse(
      await fs.readFile(resolveVaultPath(vaultRoot, artifact.relativePath).absolutePath, "utf8"),
    );
    return isPlainRecord(raw)
      && typeof raw.schemaVersion === "string"
      && WEARABLE_STORAGE_TOMBSTONE_SCHEMA_VERSIONS.has(raw.schemaVersion);
  } catch {
    return false;
  }
}

function isCanonicalRecordArtifact(artifact: RawImportManifestArtifact): boolean {
  return artifact.role.startsWith(CANONICAL_RECORDS_ROLE_PREFIX);
}

function isDenseRawTimeseriesArtifact(
  artifact: RawImportManifestArtifact,
  manifest?: RawImportManifest,
): boolean {
  const metadata = manifest
    ? readRawArtifactProvenanceMetadata(artifact, manifest)
    : null;
  const retentionMetadata = parseRawArtifactRetentionMetadata(metadata);
  if (retentionMetadata) {
    return retentionMetadata.artifactClass === "dense_provider_timeseries"
      && retentionMetadata.resourceCategory === "timeseries"
      && retentionMetadata.retentionClass === "debug_temporary";
  }

  const role = artifact.role.toLowerCase();
  return DENSE_RAW_EXACT_ROLES.has(role)
    || role.includes("timeseries")
    && !role.includes("summary")
    && DENSE_RAW_ROLE_TERMS.some((term) => role.includes(term));
}

function readRawArtifactProvenanceMetadata(
  artifact: RawImportManifestArtifact,
  manifest: RawImportManifest,
): Record<string, unknown> | null {
  const rawArtifacts = readRecordArray(manifest.provenance.rawArtifacts);
  if (!rawArtifacts) {
    return null;
  }

  for (const entry of rawArtifacts) {
    if (
      entry.role !== artifact.role
      || entry.relativePath !== artifact.relativePath
      || entry.sha256 !== artifact.sha256
    ) {
      continue;
    }
    return isPlainRecord(entry.metadata) ? entry.metadata : null;
  }

  return null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const records: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) {
      return null;
    }
    records.push(entry);
  }
  return records;
}

function parseRawArtifactRetentionMetadata(
  metadata: Record<string, unknown> | null,
): RawArtifactRetentionMetadata | null {
  if (metadata === null) {
    return null;
  }
  const { artifactClass, resourceCategory, retentionClass } = metadata;
  if (
    (artifactClass !== "dense_provider_timeseries" && artifactClass !== "sparse_provider_timeseries")
    || resourceCategory !== "timeseries"
    || (retentionClass !== "debug_temporary" && retentionClass !== "provider_evidence")
  ) {
    return null;
  }

  return {
    artifactClass,
    resourceCategory,
    retentionClass,
  };
}

function replacementRoleForTombstone(
  artifactClass: PreparedRawTombstone["artifactClass"],
): string {
  return artifactClass === "dense_provider_timeseries"
    ? `${WEARABLE_STORAGE_TOMBSTONE_ROLE_PREFIX}dense-debug`
    : `${WEARABLE_STORAGE_TOMBSTONE_ROLE_PREFIX}derived-canonical-records`;
}

function isWearableStorageTombstoneArtifact(artifact: RawImportManifestArtifact): boolean {
  return artifact.role.startsWith(WEARABLE_STORAGE_TOMBSTONE_ROLE_PREFIX);
}

function artifactPathBelongsToRawDirectory(
  artifact: RawImportManifestArtifact,
  rawDirectory: string,
): boolean {
  const artifactDirectory = path.posix.dirname(normalizeRelativeVaultPath(artifact.relativePath));
  return artifactDirectory === normalizeRelativeVaultPath(rawDirectory);
}

function largestReferenceByteSize(references: readonly RawArtifactReference[]): number {
  return references.reduce(
    (largest, reference) => Math.max(largest, reference.artifact.byteSize),
    0,
  );
}

function sumLargestReferenceBytes(groups: readonly RawArtifactReference[][]): number {
  return groups.reduce((total, references) => total + largestReferenceByteSize(references), 0);
}

function collectManifestPathsForRawArtifactPreimage(input: {
  manifestSnapshots: readonly RawManifestSnapshot[];
  originalByteSize: number;
  originalRole: string;
  originalSha256: string;
  targetPath: string;
}): string[] | null {
  const manifestPaths = new Set<string>();

  for (const snapshot of input.manifestSnapshots) {
    for (const artifact of snapshot.manifest.artifacts) {
      if (artifact.relativePath !== input.targetPath) {
        continue;
      }
      if (
        artifact.byteSize !== input.originalByteSize
        || artifact.role !== input.originalRole
        || artifact.sha256 !== input.originalSha256
      ) {
        return null;
      }
      manifestPaths.add(snapshot.relativePath);
    }
  }

  return [...manifestPaths].sort();
}

function sampleStreamFromLedgerPath(relativePath: string): string | null {
  const parts = normalizeRelativeVaultPath(relativePath).split("/");
  if (
    parts.length < 5
    || parts[0] !== "ledger"
    || parts[1] !== "samples"
  ) {
    return null;
  }
  return parts[2] ?? null;
}

function isArtifactOlderThanDenseRetentionWindow(importedAt: string, now: Date): boolean {
  const importedMs = Date.parse(importedAt);
  if (!Number.isFinite(importedMs)) {
    return false;
  }
  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  return now.getTime() - importedMs >= retentionMs;
}

function isDenseRawReferenceGroupOlderThanRetentionWindow(
  references: readonly RawArtifactReference[],
  now: Date,
): boolean {
  return references.length > 0
    && references.every((reference) =>
      isArtifactOlderThanDenseRetentionWindow(reference.manifest.importedAt, now)
    );
}

function isRawTombstoneReferenceGroupInScope(input: {
  artifactClass: PreparedRawTombstone["artifactClass"];
  denseRetentionPolicy?: {
    includeRecent: boolean;
  };
  now: Date;
  references: readonly RawArtifactReference[];
}): boolean {
  return input.artifactClass !== "dense_provider_timeseries"
    || input.denseRetentionPolicy?.includeRecent === true
    || isDenseRawReferenceGroupOlderThanRetentionWindow(input.references, input.now);
}

function resolveWearableStorageMigrationRepairClasses(input: {
  pruneDenseRaw: boolean;
  repairClasses?: readonly WearableStorageMigrationRepairClass[];
}): ReadonlySet<WearableStorageMigrationRepairClass> {
  if (input.repairClasses) {
    return new Set(input.repairClasses);
  }

  const repairClasses = new Set<WearableStorageMigrationRepairClass>([
    "legacy_canonical_artifacts",
    "legacy_receipts",
  ]);
  if (input.pruneDenseRaw) {
    repairClasses.add("dense_raw_timeseries");
  }
  return repairClasses;
}

function deadlineExceeded(startedAtMs: number, deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && Date.now() - startedAtMs >= deadlineMs;
}

function remainingDeadlineMs(startedAtMs: number, deadlineMs: number | undefined): number | undefined {
  if (deadlineMs === undefined) {
    return undefined;
  }
  return Math.max(0, deadlineMs - (Date.now() - startedAtMs));
}

function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
