import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import {
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import {
  isRawManifestFileName,
  parseRawImportManifest,
} from "./operations/raw-manifests.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";
import { assertValidVault } from "./vault.ts";
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
  retentionEligibleDenseProviderRawTimeseriesCount: number;
}

export interface WearableStorageMigrationResult {
  mutated: boolean;
  hasMore: boolean;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
  compactedReceiptCount: number;
  tombstonedCanonicalArtifactCount: number;
  tombstonedDenseRawArtifactCount: number;
  skippedCount: number;
  touchedPaths: string[];
}

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
  includeRecentDenseRaw?: boolean;
  validateAfter?: boolean;
}

interface RawManifestSnapshot {
  manifest: RawImportManifest;
  relativePath: string;
}

interface RawArtifactReference {
  artifact: RawImportManifestArtifact;
  manifest: RawImportManifest;
  manifestPath: string;
}

interface PreparedRawTombstone {
  artifactClass: "dense_provider_timeseries" | "derived_canonical_records";
  bytesAfter: number;
  bytesBefore: number;
  content: string;
  manifestPaths: string[];
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
  "blood-oxygen",
  "blood_oxygen",
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
const DENSE_RAW_EXACT_ROLES = new Set([
  "blood-oxygen",
  "blood_oxygen",
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
    (artifact) => isDenseRawTimeseriesArtifact(artifact),
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
    retentionEligibleDenseProviderRawTimeseriesCount: denseRawReferences.filter((references) =>
      includeRecentDenseRaw
      || isArtifactOlderThanDenseRetentionWindow(references[0]?.manifest.importedAt ?? "", now)
    ).length,
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
  includeRecentDenseRaw = false,
  validateAfter = true,
}: RunWearableStorageMigrationPassInput): Promise<WearableStorageMigrationResult> {
  const startedAtMs = Date.now();
  let remainingFiles = Math.max(0, Math.trunc(maxFiles));
  let remainingBytes = Math.max(0, Math.trunc(maxBytes));
  let hasMore = false;
  let skippedCount = 0;
  const touchedPaths = new Set<string>();
  let bytesBefore = 0;
  let bytesAfter = 0;
  let compactedReceiptCount = 0;
  let tombstonedCanonicalArtifactCount = 0;
  let tombstonedDenseRawArtifactCount = 0;

  if (remainingFiles > 0 && remainingBytes > 0 && !deadlineExceeded(startedAtMs, deadlineMs)) {
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

  if (remainingFiles > 0 && remainingBytes > 0 && !deadlineExceeded(startedAtMs, deadlineMs)) {
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
    pruneDenseRaw
    && remainingFiles > 0
    && remainingBytes > 0
    && !deadlineExceeded(startedAtMs, deadlineMs)
  ) {
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
    for (const touchedPath of denseRawResult.touchedPaths) {
      touchedPaths.add(touchedPath);
    }
    hasMore ||= denseRawResult.hasMore;
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
    hasMore,
    mutated,
    skippedCount,
    tombstonedCanonicalArtifactCount,
    tombstonedDenseRawArtifactCount,
    touchedPaths: [...touchedPaths].sort(),
  };
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
  predicate: (artifact: RawImportManifestArtifact) => boolean;
  reason: string;
  schemaVersion: string;
  startedAtMs: number;
  vaultRoot: string;
}): Promise<RawTombstoneRunResult> {
  const manifestSnapshots = await readRawManifestSnapshots(input.vaultRoot);
  const groups = collectRawArtifactReferenceGroups(manifestSnapshots, input.predicate)
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
    if (prepared.length > 0 && bytesBefore + largestBytes > input.maxBytes) {
      hasMore = true;
      continue;
    }

    const tombstone = await prepareRawArtifactTombstone({
      artifactClass: input.artifactClass,
      denseRetentionPolicy: input.denseRetentionPolicy,
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
      for (const manifestPath of touchedManifestPaths) {
        const snapshot = manifestSnapshots.find((entry) => entry.relativePath === manifestPath);
        if (!snapshot) {
          throw new Error(`Missing touched raw manifest snapshot for ${manifestPath}.`);
        }
        await batch.stageTextWrite(manifestPath, `${JSON.stringify(snapshot.manifest, null, 2)}\n`, {
          allowRaw: true,
          overwrite: true,
        });
      }
      await emitAuditRecord({
        action: "vault_repair",
        batch,
        changes: [],
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
  if (!artifactPathBelongsToRawDirectory(targetArtifact, firstReference.manifest.rawDirectory)) {
    return null;
  }
  if (
    input.artifactClass === "dense_provider_timeseries"
    && input.denseRetentionPolicy?.includeRecent !== true
    && !isArtifactOlderThanDenseRetentionWindow(firstReference.manifest.importedAt, input.now)
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
  if (await rawPathAppearsInLedgerReference(input.vaultRoot, targetArtifact.relativePath)) {
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

  for (const snapshot of input.manifestSnapshots) {
    for (const artifact of snapshot.manifest.artifacts) {
      if (artifact.relativePath !== targetArtifact.relativePath) {
        continue;
      }
      artifact.byteSize = tombstoneBytes;
      artifact.role = replacementRole;
      artifact.sha256 = tombstoneSha;
    }
  }

  return {
    artifactClass: input.artifactClass,
    bytesAfter: tombstoneBytes,
    bytesBefore: originalByteSize,
    content: tombstoneContent,
    manifestPaths: manifestPathsWithTargetPath,
    targetPath: targetArtifact.relativePath,
  };
}

async function readRawManifestSnapshots(
  vaultRoot: string,
  options: { maxManifestBytes?: number } = {},
): Promise<RawManifestSnapshot[]> {
  const manifestPaths = (await walkVaultFiles(vaultRoot, "raw", { extension: ".json" }))
    .filter((relativePath) => isRawManifestFileName(path.posix.basename(relativePath)));
  const snapshots: RawManifestSnapshot[] = [];

  for (const relativePath of manifestPaths) {
    const resolved = resolveVaultPath(vaultRoot, relativePath);
    const stats = await fs.stat(resolved.absolutePath);
    if (
      options.maxManifestBytes !== undefined
      && stats.size > options.maxManifestBytes
    ) {
      continue;
    }
    try {
      snapshots.push({
        manifest: parseRawImportManifest(JSON.parse(await fs.readFile(resolved.absolutePath, "utf8"))),
        relativePath,
      });
    } catch {
      continue;
    }
  }

  return snapshots;
}

function collectRawArtifactReferenceGroups(
  manifests: readonly RawManifestSnapshot[],
  predicate: (artifact: RawImportManifestArtifact) => boolean,
): RawArtifactReference[][] {
  const referencesByPath = new Map<string, RawArtifactReference[]>();

  for (const snapshot of manifests) {
    for (const artifact of snapshot.manifest.artifacts) {
      if (!predicate(artifact)) {
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

async function rawPathAppearsInLedgerReference(
  vaultRoot: string,
  targetPath: string,
): Promise<boolean> {
  const targetPathVariants = [...new Set([
    targetPath,
    targetPath.replaceAll("/", "\\/"),
  ])];
  for (const directory of ["ledger/events", "ledger/samples", "ledger/metric-samples"]) {
    const files = await walkVaultFiles(vaultRoot, directory, { extension: ".jsonl" });
    for (const file of files) {
      if (await textFileContainsAny(resolveVaultPath(vaultRoot, file).absolutePath, targetPathVariants)) {
        return true;
      }
    }
  }
  return false;
}

async function textFileContainsAny(absolutePath: string, needles: readonly string[]): Promise<boolean> {
  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const overlapLength = Math.max(0, ...needles.map((needle) => needle.length - 1));
  let suffix = "";

  try {
    for await (const chunk of stream) {
      const content = `${suffix}${chunk}`;
      if (needles.some((needle) => content.includes(needle))) {
        return true;
      }
      suffix = overlapLength === 0 ? "" : content.slice(-overlapLength);
    }
    return false;
  } finally {
    stream.destroy();
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

async function statAndHashVaultFile(
  vaultRoot: string,
  relativePath: string,
): Promise<{ byteSize: number; sha256: string } | null> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  if (!(await pathExists(resolved.absolutePath))) {
    return null;
  }
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    return null;
  }
  return {
    byteSize: stats.size,
    sha256: await sha256File(resolved.absolutePath),
  };
}

async function sha256File(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
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
    let hasProviderEvidence = false;
    let hasReceipt = false;
    const artifactsToVerify: RawImportManifestArtifact[] = [];

    for (const artifact of reference.manifest.artifacts) {
      if (!artifactPathBelongsToRawDirectory(artifact, reference.manifest.rawDirectory)) {
        return false;
      }
      if (RAW_RECEIPT_ROLE_PREFIXES.some((prefix) => artifact.role.startsWith(prefix))) {
        hasReceipt = true;
        artifactsToVerify.push(artifact);
        continue;
      }
      const isProviderEvidence =
        artifact.relativePath !== reference.artifact.relativePath
        && !isCanonicalRecordArtifact(artifact);
      if (input.artifactClass === "derived_canonical_records" && isProviderEvidence) {
        hasProviderEvidence = true;
        artifactsToVerify.push(artifact);
      }
    }

    if (!hasReceipt || (input.artifactClass === "derived_canonical_records" && !hasProviderEvidence)) {
      return false;
    }
    for (const artifact of artifactsToVerify) {
      if (!await rawArtifactFileMatchesManifest(input.vaultRoot, artifact)) {
        return false;
      }
    }
  }

  return true;
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

function isCanonicalRecordArtifact(artifact: RawImportManifestArtifact): boolean {
  return artifact.role.startsWith(CANONICAL_RECORDS_ROLE_PREFIX);
}

function isDenseRawTimeseriesArtifact(artifact: RawImportManifestArtifact): boolean {
  const role = artifact.role.toLowerCase();
  return DENSE_RAW_EXACT_ROLES.has(role)
    || role.includes("timeseries")
    && !role.includes("summary")
    && DENSE_RAW_ROLE_TERMS.some((term) => role.includes(term));
}

function replacementRoleForTombstone(
  artifactClass: PreparedRawTombstone["artifactClass"],
): string {
  return artifactClass === "dense_provider_timeseries"
    ? "wearable-storage-pruned:dense-debug"
    : "wearable-storage-pruned:derived-canonical-records";
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
