import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import type {
  RawImportManifest,
  RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { walkVaultFiles } from "./fs.ts";
import {
  acquireCanonicalWriteLock,
  withCanonicalWriteLockScope,
} from "./operations/canonical-write-lock.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  isRawManifestFileName,
  parseRawImportManifest,
} from "./operations/raw-manifests.ts";
import {
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";
import { assertValidVault } from "./vault.ts";
import { hashWearableRawPayload } from "./wearable-raw-payload-hash.ts";

export const LEGACY_WEARABLE_RAW_ENVELOPE_ROLE_PREFIX = "wearable-raw-envelope:";

export interface DetectLegacyWearableReceiptCompactionInput {
  vaultRoot: string;
  maxCandidateBytes?: number;
  maxManifestBytes?: number;
}

export interface LegacyWearableReceiptCompactionDetection {
  hasWork: boolean;
  suspectedCount: number;
  largestSuspectByteSize?: number;
}

export interface CompactLegacyWearableReceiptEnvelopesInput {
  vaultRoot: string;
  maxBytesRead?: number;
  maxCandidatesScanned?: number;
  maxEnvelopes?: number;
  maxCandidateBytes?: number;
  maxEvidenceArtifactBytes?: number;
  maxEvidenceRoles?: number;
  maxEvidenceTotalBytes?: number;
  deadlineMs?: number;
  now?: Date;
  validateAfter?: boolean;
}

export interface CompactLegacyWearableReceiptEnvelopesResult {
  mutated: boolean;
  compactedCount: number;
  skippedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  hasMore: boolean;
  oversizedEnvelopeSkippedCount: number;
  oversizedEvidenceSkippedCount: number;
  scannedCount: number;
  touchedPaths: string[];
}

interface RawManifestSnapshot {
  manifest: RawImportManifest;
  relativePath: string;
}

interface LegacyEnvelopeReference {
  artifact: RawImportManifestArtifact;
  manifest: RawImportManifest;
  manifestPath: string;
}

interface PreparedLegacyEnvelopeCompaction {
  bytesAfter: number;
  bytesBefore: number;
  envelopeContent: string;
  envelopePath: string;
  manifestPaths: string[];
}

type PrepareLegacyEnvelopeCompactionResult =
  | {
      kind: "prepared";
      compaction: PreparedLegacyEnvelopeCompaction;
    }
  | {
      kind: "skip";
      reason: "invalid" | "oversized_envelope" | "oversized_evidence";
    }
  | {
      kind: "deadline";
    };

interface LegacyWearableCompactionBudget {
  deadlineMs: number | undefined;
  maxEvidenceArtifactBytes: number;
  maxEvidenceRoles: number;
  maxEvidenceTotalBytes: number;
  totalReadBudget: CumulativeReadBudget | undefined;
  startedAtMs: number;
}

interface CumulativeReadBudget {
  maxBytes: number;
  usedBytes: number;
}

type ReadManifestArtifactFileOutcome =
  | {
      kind: "read";
      file: {
        byteSize: number;
        content: string;
        sha256: string;
      };
    }
  | {
      kind:
        | "cumulative_budget_exhausted"
        | "invalid"
        | "oversized"
        | "total_budget_exhausted";
    };

const DEFAULT_MAX_ENVELOPES = 25;
const DEFAULT_MAX_CANDIDATES_SCANNED = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_CANDIDATE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_BYTES_READ = 512 * 1024 * 1024;
const DEFAULT_MAX_DETECTION_CANDIDATE_BYTES = 1024 * 1024;
const DEFAULT_MAX_EVIDENCE_ROLES = 64;

export async function detectLegacyWearableReceiptCompaction({
  vaultRoot,
  maxCandidateBytes = DEFAULT_MAX_DETECTION_CANDIDATE_BYTES,
  maxManifestBytes,
}: DetectLegacyWearableReceiptCompactionInput): Promise<LegacyWearableReceiptCompactionDetection> {
  const manifests = await readRawManifestSnapshots(vaultRoot, { maxManifestBytes });
  let suspectedCount = 0;
  let largestSuspectByteSize: number | undefined;

  for (const { manifest } of manifests) {
    for (const artifact of manifest.artifacts) {
      if (!isLegacyWearableRawEnvelopeArtifact(artifact)) {
        continue;
      }
      const payloadStatus = await readLegacyWearableEnvelopePayloadStatus({
        artifact,
        manifest,
        maxCandidateBytes,
        vaultRoot,
      });
      if (payloadStatus !== "payload_bearing") {
        continue;
      }

      suspectedCount += 1;
      largestSuspectByteSize = Math.max(
        largestSuspectByteSize ?? 0,
        artifact.byteSize,
      );
    }
  }

  return {
    hasWork: suspectedCount > 0,
    largestSuspectByteSize,
    suspectedCount,
  };
}

export async function compactLegacyWearableReceiptEnvelopes({
  vaultRoot,
  ...input
}: CompactLegacyWearableReceiptEnvelopesInput): Promise<CompactLegacyWearableReceiptEnvelopesResult> {
  return await withCanonicalWriteLockScope(vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(vaultRoot);

    try {
      return await compactLegacyWearableReceiptEnvelopesLocked({
        ...input,
        vaultRoot,
      });
    } finally {
      await lock.release();
    }
  });
}

async function compactLegacyWearableReceiptEnvelopesLocked({
  vaultRoot,
  maxBytesRead = DEFAULT_MAX_BYTES_READ,
  maxCandidatesScanned = DEFAULT_MAX_CANDIDATES_SCANNED,
  maxEnvelopes = DEFAULT_MAX_ENVELOPES,
  maxCandidateBytes = DEFAULT_MAX_CANDIDATE_BYTES,
  maxEvidenceArtifactBytes = maxCandidateBytes,
  maxEvidenceRoles = DEFAULT_MAX_EVIDENCE_ROLES,
  maxEvidenceTotalBytes = maxCandidateBytes,
  deadlineMs,
  now = new Date(),
  validateAfter = true,
}: CompactLegacyWearableReceiptEnvelopesInput): Promise<CompactLegacyWearableReceiptEnvelopesResult> {
  const startedAtMs = Date.now();
  const budget: LegacyWearableCompactionBudget = {
    deadlineMs,
    maxEvidenceArtifactBytes,
    maxEvidenceRoles,
    maxEvidenceTotalBytes,
    totalReadBudget:
      maxBytesRead > 0
        ? { maxBytes: maxBytesRead, usedBytes: 0 }
        : undefined,
    startedAtMs,
  };
  const manifestSnapshots = await readRawManifestSnapshots(vaultRoot);
  const candidates = collectLegacyEnvelopeCandidates(manifestSnapshots);
  const prepared: PreparedLegacyEnvelopeCompaction[] = [];
  const touchedManifestPaths = new Set<string>();
  let skippedCount = 0;
  let oversizedEnvelopeSkippedCount = 0;
  let oversizedEvidenceSkippedCount = 0;
  let scannedCount = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  let hasMore = false;

  for (let index = 0; index < candidates.length; index += 1) {
    if (legacyWearableCompactionDeadlineExceeded(budget)) {
      hasMore = true;
      break;
    }
    if (prepared.length >= maxEnvelopes) {
      hasMore = true;
      break;
    }
    if (scannedCount >= maxCandidatesScanned) {
      hasMore = true;
      break;
    }

    const references = candidates[index];
    if (!references) {
      continue;
    }
    const [firstReference] = references;
    if (!firstReference) {
      continue;
    }
    const payloadStatus = await readLegacyWearableEnvelopePayloadStatus({
      artifact: firstReference.artifact,
      manifest: firstReference.manifest,
      maxCandidateBytes: Math.min(maxCandidateBytes, DEFAULT_MAX_DETECTION_CANDIDATE_BYTES),
      vaultRoot,
    });
    if (payloadStatus === "deadline") {
      hasMore = true;
      break;
    }
    if (payloadStatus !== "payload_bearing") {
      skippedCount += 1;
      continue;
    }
    scannedCount += 1;

    const preparedCompaction = await prepareLegacyEnvelopeCompaction({
      budget,
      maxCandidateBytes,
      references,
      vaultRoot,
    });
    if (preparedCompaction.kind === "deadline") {
      hasMore = true;
      break;
    }
    if (preparedCompaction.kind === "skip") {
      skippedCount += 1;
      if (preparedCompaction.reason === "oversized_envelope") {
        oversizedEnvelopeSkippedCount += 1;
      } else if (preparedCompaction.reason === "oversized_evidence") {
        oversizedEvidenceSkippedCount += 1;
      }
      continue;
    }

    const { compaction } = preparedCompaction;
    prepared.push(compaction);
    bytesBefore += compaction.bytesBefore;
    bytesAfter += compaction.bytesAfter;
    for (const manifestPath of compaction.manifestPaths) {
      touchedManifestPaths.add(manifestPath);
    }
  }

  if (prepared.length === 0) {
    return {
      bytesAfter: 0,
      bytesBefore: 0,
      compactedCount: 0,
      hasMore,
      mutated: false,
      oversizedEnvelopeSkippedCount,
      oversizedEvidenceSkippedCount,
      scannedCount,
      skippedCount,
      touchedPaths: [],
    };
  }

  const touchedPaths = [
    ...new Set([
      ...prepared.map((compaction) => compaction.envelopePath),
      ...touchedManifestPaths,
    ]),
  ].sort();

  await runCanonicalWrite({
    vaultRoot,
    operationType: "legacy_wearable_receipt_compaction",
    summary: "Compact legacy wearable raw envelope receipts",
    hostedCanonicalWritePort: null,
    hostedCanonicalWriteReceiptDirectory: null,
    occurredAt: now,
    mutate: async ({ batch }) => {
      for (const compaction of prepared) {
        await batch.stageTextWrite(compaction.envelopePath, compaction.envelopeContent, {
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
        vaultRoot,
        action: "vault_repair",
        batch,
        changes: [],
        commandName: "core.compactLegacyWearableReceiptEnvelopes",
        occurredAt: now,
        summary:
          `Compacted ${prepared.length} legacy wearable raw envelope receipt(s); ` +
          `bytesBefore=${bytesBefore}; bytesAfter=${bytesAfter}; ` +
          "proof=payload_hash_match; job=legacy-wearable-receipt-compaction-v1.",
      });
    },
  });

  await assertTouchedCompactionArtifactsMatchManifests({
    envelopePaths: prepared.map((compaction) => compaction.envelopePath),
    manifestSnapshots,
    touchedManifestPaths,
    vaultRoot,
  });

  if (validateAfter) {
    await assertValidVault({
      vaultRoot,
      errorCode: "LEGACY_WEARABLE_RECEIPT_COMPACTION_INVALID_VAULT",
      message: "Legacy wearable receipt compaction produced an invalid vault.",
    });
  }

  return {
    bytesAfter,
    bytesBefore,
    compactedCount: prepared.length,
    hasMore,
    mutated: true,
    oversizedEnvelopeSkippedCount,
    oversizedEvidenceSkippedCount,
    scannedCount,
    skippedCount,
    touchedPaths,
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
        manifest: parseRawImportManifest(
          JSON.parse(await fs.readFile(resolved.absolutePath, "utf8")),
        ),
        relativePath,
      });
    } catch {
      continue;
    }
  }

  return snapshots;
}

function collectLegacyEnvelopeCandidates(
  manifests: readonly RawManifestSnapshot[],
): LegacyEnvelopeReference[][] {
  const byEnvelopePath = new Map<string, LegacyEnvelopeReference[]>();

  for (const snapshot of manifests) {
    for (const artifact of snapshot.manifest.artifacts) {
      if (!isLegacyWearableRawEnvelopeArtifact(artifact)) {
        continue;
      }
      const normalizedPath = normalizeRelativeVaultPath(artifact.relativePath);
      const references = byEnvelopePath.get(normalizedPath) ?? [];
      references.push({
        artifact,
        manifest: snapshot.manifest,
        manifestPath: snapshot.relativePath,
      });
      byEnvelopePath.set(normalizedPath, references);
    }
  }

  return [...byEnvelopePath.entries()]
    .sort(([leftPath, leftReferences], [rightPath, rightReferences]) => {
      const byteSizeDelta = readLargestLegacyEnvelopeReferenceByteSize(rightReferences)
        - readLargestLegacyEnvelopeReferenceByteSize(leftReferences);
      return byteSizeDelta || leftPath.localeCompare(rightPath);
    })
    .map(([, references]) =>
      references.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath))
    );
}

function readLargestLegacyEnvelopeReferenceByteSize(
  references: readonly LegacyEnvelopeReference[],
): number {
  return references.reduce(
    (largest, reference) => Math.max(largest, reference.artifact.byteSize),
    0,
  );
}

async function readLegacyWearableEnvelopePayloadStatus(input: {
  artifact: RawImportManifestArtifact;
  manifest: RawImportManifest;
  maxCandidateBytes: number;
  vaultRoot: string;
}): Promise<"deadline" | "not_payload_bearing" | "payload_bearing"> {
  if (!artifactPathBelongsToRawDirectory(input.artifact, input.manifest.rawDirectory)) {
    return "not_payload_bearing";
  }
  if (input.artifact.byteSize > input.maxCandidateBytes) {
    return "payload_bearing";
  }

  const envelopeRead = await readManifestArtifactFileOutcome(
    input.vaultRoot,
    input.artifact,
    { maxBytes: input.maxCandidateBytes },
  );
  if (envelopeRead.kind === "total_budget_exhausted") {
    return "deadline";
  }
  if (envelopeRead.kind !== "read") {
    return "not_payload_bearing";
  }

  const envelope = parseJsonObject(envelopeRead.file.content);
  return envelope !== null && hasOwn(envelope, "payload")
    ? "payload_bearing"
    : "not_payload_bearing";
}

async function prepareLegacyEnvelopeCompaction(input: {
  budget: LegacyWearableCompactionBudget;
  maxCandidateBytes: number;
  references: readonly LegacyEnvelopeReference[];
  vaultRoot: string;
}): Promise<PrepareLegacyEnvelopeCompactionResult> {
  const [firstReference] = input.references;
  if (!firstReference || !legacyEnvelopeManifestReferencesAgree(input.references)) {
    return { kind: "skip", reason: "invalid" };
  }

  const envelopeArtifact = firstReference.artifact;
  if (envelopeArtifact.byteSize > input.maxCandidateBytes) {
    return { kind: "skip", reason: "oversized_envelope" };
  }
  if (!artifactPathBelongsToRawDirectory(envelopeArtifact, firstReference.manifest.rawDirectory)) {
    return { kind: "skip", reason: "invalid" };
  }

  if (legacyWearableCompactionDeadlineExceeded(input.budget)) {
    return { kind: "deadline" };
  }

  const envelopeRead = await readManifestArtifactFileOutcome(
    input.vaultRoot,
    envelopeArtifact,
    {
      maxBytes: input.maxCandidateBytes,
      totalBudget: input.budget.totalReadBudget,
    },
  );
  if (envelopeRead.kind === "total_budget_exhausted") {
    return { kind: "deadline" };
  }
  if (envelopeRead.kind === "oversized") {
    return { kind: "skip", reason: "oversized_envelope" };
  }
  if (envelopeRead.kind !== "read") {
    return { kind: "skip", reason: "invalid" };
  }
  const { file: envelopeFile } = envelopeRead;

  const envelope = parseJsonObject(envelopeFile.content);
  if (!envelope || !hasOwn(envelope, "payload")) {
    return { kind: "skip", reason: "invalid" };
  }

  const payloadHash = envelope.payloadHash;
  if (typeof payloadHash !== "string") {
    return { kind: "skip", reason: "invalid" };
  }

  try {
    if (hashWearableRawPayload(envelope.payload) !== payloadHash) {
      return { kind: "skip", reason: "invalid" };
    }
  } catch {
    return { kind: "skip", reason: "invalid" };
  }

  const rawArtifactRoles = readStringArray(envelope.rawArtifactRoles);
  if (
    !rawArtifactRoles
    || rawArtifactRoles.length === 0
    || rawArtifactRoles.length > input.budget.maxEvidenceRoles
  ) {
    return { kind: "skip", reason: "invalid" };
  }

  const evidenceByManifest: Array<Map<string, RawImportManifestArtifact>> = [];
  for (const reference of input.references) {
    const evidenceIndex = indexManifestArtifactsByRole(reference.manifest);
    if (!evidenceIndex) {
      return { kind: "skip", reason: "invalid" };
    }
    evidenceByManifest.push(evidenceIndex);
  }

  const proof = await verifyLegacyEnvelopeEvidenceProof({
    budget: input.budget,
    evidenceByManifest,
    manifestReferences: input.references,
    payloadHash,
    rawArtifactRoles,
    vaultRoot: input.vaultRoot,
  });
  if (proof === "deadline") {
    return { kind: "deadline" };
  }
  if (proof === "oversized_evidence") {
    return { kind: "skip", reason: "oversized_evidence" };
  }
  if (proof !== "valid") {
    return { kind: "skip", reason: "invalid" };
  }

  const compactedEnvelope = omitTopLevelPayload(envelope);
  const envelopeContent = `${JSON.stringify(compactedEnvelope, null, 2)}\n`;
  const envelopeBytes = Buffer.byteLength(envelopeContent, "utf8");
  const envelopeSha256 = sha256Hex(Buffer.from(envelopeContent, "utf8"));

  for (const reference of input.references) {
    updateManifestArtifactDigest(reference.manifest, reference.artifact, {
      byteSize: envelopeBytes,
      sha256: envelopeSha256,
    });
  }

  return {
    kind: "prepared",
    compaction: {
      bytesAfter: envelopeBytes,
      bytesBefore: envelopeFile.byteSize,
      envelopeContent,
      envelopePath: envelopeArtifact.relativePath,
      manifestPaths: input.references.map((reference) => reference.manifestPath),
    },
  };
}

function legacyEnvelopeManifestReferencesAgree(
  references: readonly LegacyEnvelopeReference[],
): boolean {
  const [firstReference] = references;
  if (!firstReference) {
    return false;
  }

  return references.every((reference) =>
    reference.artifact.relativePath === firstReference.artifact.relativePath
    && reference.artifact.byteSize === firstReference.artifact.byteSize
    && reference.artifact.sha256 === firstReference.artifact.sha256
  );
}

async function verifyLegacyEnvelopeEvidenceProof(input: {
  budget: LegacyWearableCompactionBudget;
  evidenceByManifest: Array<Map<string, RawImportManifestArtifact>>;
  manifestReferences: readonly LegacyEnvelopeReference[];
  payloadHash: string;
  rawArtifactRoles: readonly string[];
  vaultRoot: string;
}): Promise<"deadline" | "invalid" | "oversized_evidence" | "valid"> {
  const cumulativeBudget: CumulativeReadBudget = {
    maxBytes: input.budget.maxEvidenceTotalBytes,
    usedBytes: 0,
  };
  let hasProof = false;

  for (const role of input.rawArtifactRoles) {
    if (legacyWearableCompactionDeadlineExceeded(input.budget)) {
      return "deadline";
    }

    let proofFile: { byteSize: number; content: string; sha256: string } | null = null;
    const roleCanProvePayload = isProviderEvidenceProofRole(role);

    for (let index = 0; index < input.evidenceByManifest.length; index += 1) {
      if (legacyWearableCompactionDeadlineExceeded(input.budget)) {
        return "deadline";
      }

      const artifact = input.evidenceByManifest[index]?.get(role);
      const manifest = input.manifestReferences[index]?.manifest;
      if (
        !artifact
        || !manifest
        || !artifactPathBelongsToRawDirectory(artifact, manifest.rawDirectory)
      ) {
        return "invalid";
      }

      const evidenceRead = await readManifestArtifactFileOutcome(
        input.vaultRoot,
        artifact,
        {
          cumulativeBudget,
          maxBytes: input.budget.maxEvidenceArtifactBytes,
          totalBudget: input.budget.totalReadBudget,
        },
      );
      if (evidenceRead.kind === "total_budget_exhausted") {
        return "deadline";
      }
      if (
        evidenceRead.kind === "cumulative_budget_exhausted"
        || evidenceRead.kind === "oversized"
      ) {
        return "oversized_evidence";
      }
      if (evidenceRead.kind !== "read") {
        return "invalid";
      }
      if (index === 0 && roleCanProvePayload) {
        proofFile = evidenceRead.file;
      }
    }

    if (!roleCanProvePayload) {
      continue;
    }

    if (!proofFile) {
      return "invalid";
    }
    const proofValue = parseEvidenceJsonOrText(proofFile.content);
    try {
      hasProof ||= hashWearableRawPayload(proofValue) === input.payloadHash;
    } catch {
      return "invalid";
    }
  }

  return hasProof ? "valid" : "invalid";
}

function indexManifestArtifactsByRole(
  manifest: RawImportManifest,
): Map<string, RawImportManifestArtifact> | null {
  const byRole = new Map<string, RawImportManifestArtifact>();

  for (const artifact of manifest.artifacts) {
    if (byRole.has(artifact.role)) {
      return null;
    }
    byRole.set(artifact.role, artifact);
  }

  return byRole;
}

async function readManifestArtifactFile(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
  options: {
    cumulativeBudget?: CumulativeReadBudget;
    maxBytes?: number;
    totalBudget?: CumulativeReadBudget;
  } = {},
): Promise<{ byteSize: number; content: string; sha256: string } | null> {
  const outcome = await readManifestArtifactFileOutcome(vaultRoot, artifact, options);
  return outcome.kind === "read" ? outcome.file : null;
}

async function readManifestArtifactFileOutcome(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
  options: {
    cumulativeBudget?: CumulativeReadBudget;
    maxBytes?: number;
    totalBudget?: CumulativeReadBudget;
  } = {},
): Promise<ReadManifestArtifactFileOutcome> {
  const resolved = resolveVaultPath(vaultRoot, artifact.relativePath);

  try {
    if (options.maxBytes !== undefined && artifact.byteSize > options.maxBytes) {
      return { kind: "oversized" };
    }
    if (options.totalBudget && artifact.byteSize > options.totalBudget.maxBytes) {
      return { kind: "oversized" };
    }
    if (
      options.cumulativeBudget
      && options.cumulativeBudget.usedBytes + artifact.byteSize
        > options.cumulativeBudget.maxBytes
    ) {
      return { kind: "cumulative_budget_exhausted" };
    }
    if (
      options.totalBudget
      && options.totalBudget.usedBytes + artifact.byteSize > options.totalBudget.maxBytes
    ) {
      return { kind: "total_budget_exhausted" };
    }

    const stats = await fs.stat(resolved.absolutePath);
    if (options.maxBytes !== undefined && stats.size > options.maxBytes) {
      return { kind: "oversized" };
    }
    if (options.totalBudget && stats.size > options.totalBudget.maxBytes) {
      return { kind: "oversized" };
    }
    if (
      options.cumulativeBudget
      && options.cumulativeBudget.usedBytes + stats.size > options.cumulativeBudget.maxBytes
    ) {
      return { kind: "cumulative_budget_exhausted" };
    }
    if (
      options.totalBudget
      && options.totalBudget.usedBytes + stats.size > options.totalBudget.maxBytes
    ) {
      return { kind: "total_budget_exhausted" };
    }

    const contentBuffer = await fs.readFile(resolved.absolutePath);
    if (options.maxBytes !== undefined && contentBuffer.byteLength > options.maxBytes) {
      return { kind: "oversized" };
    }
    if (
      options.totalBudget
      && contentBuffer.byteLength > options.totalBudget.maxBytes
    ) {
      return { kind: "oversized" };
    }
    if (
      options.cumulativeBudget
      && options.cumulativeBudget.usedBytes + contentBuffer.byteLength
        > options.cumulativeBudget.maxBytes
    ) {
      return { kind: "cumulative_budget_exhausted" };
    }
    if (
      options.totalBudget
      && options.totalBudget.usedBytes + contentBuffer.byteLength
        > options.totalBudget.maxBytes
    ) {
      return { kind: "total_budget_exhausted" };
    }
    if (options.cumulativeBudget) {
      options.cumulativeBudget.usedBytes += contentBuffer.byteLength;
    }
    if (options.totalBudget) {
      options.totalBudget.usedBytes += contentBuffer.byteLength;
    }

    const actual = {
      byteSize: contentBuffer.byteLength,
      content: contentBuffer.toString("utf8"),
      sha256: sha256Hex(contentBuffer),
    };

    if (actual.byteSize !== artifact.byteSize || actual.sha256 !== artifact.sha256) {
      return { kind: "invalid" };
    }

    return { file: actual, kind: "read" };
  } catch {
    return { kind: "invalid" };
  }
}

async function assertTouchedCompactionArtifactsMatchManifests(input: {
  envelopePaths: readonly string[];
  manifestSnapshots: readonly RawManifestSnapshot[];
  touchedManifestPaths: ReadonlySet<string>;
  vaultRoot: string;
}): Promise<void> {
  const envelopePaths = new Set(input.envelopePaths);

  for (const manifestPath of input.touchedManifestPaths) {
    const snapshot = input.manifestSnapshots.find((entry) => entry.relativePath === manifestPath);
    if (!snapshot) {
      throw new Error(`Missing touched raw manifest snapshot for ${manifestPath}.`);
    }
    const parsedManifest = parseRawImportManifest(
      JSON.parse(await fs.readFile(resolveVaultPath(input.vaultRoot, manifestPath).absolutePath, "utf8")),
    );
    for (const artifact of parsedManifest.artifacts) {
      if (envelopePaths.has(artifact.relativePath)) {
        const actual = await readManifestArtifactFile(input.vaultRoot, artifact);
        if (!actual) {
          throw new Error(`Compacted wearable receipt no longer matches manifest ${manifestPath}.`);
        }
      }
    }
  }
}

function updateManifestArtifactDigest(
  manifest: RawImportManifest,
  target: RawImportManifestArtifact,
  digest: { byteSize: number; sha256: string },
): void {
  for (const artifact of manifest.artifacts) {
    if (
      artifact.relativePath === target.relativePath
      && artifact.role === target.role
    ) {
      artifact.byteSize = digest.byteSize;
      artifact.sha256 = digest.sha256;
    }
  }
}

function isLegacyWearableRawEnvelopeArtifact(
  artifact: RawImportManifestArtifact,
): boolean {
  return artifact.role.startsWith(LEGACY_WEARABLE_RAW_ENVELOPE_ROLE_PREFIX);
}

function isProviderEvidenceProofRole(role: string): boolean {
  return !role.startsWith(LEGACY_WEARABLE_RAW_ENVELOPE_ROLE_PREFIX)
    && !role.startsWith("wearable-raw-receipt:")
    && !role.startsWith("wearable-canonical-records:");
}

function artifactPathBelongsToRawDirectory(
  artifact: RawImportManifestArtifact,
  rawDirectory: string,
): boolean {
  const artifactDirectory = path.posix.dirname(normalizeRelativeVaultPath(artifact.relativePath));
  return artifactDirectory === normalizeRelativeVaultPath(rawDirectory);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  return isRecord(parsed) ? parsed : null;
}

function parseEvidenceJsonOrText(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function omitTopLevelPayload(record: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "payload") {
      continue;
    }
    Object.defineProperty(compacted, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return compacted;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return [...value];
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function legacyWearableCompactionDeadlineExceeded(
  budget: LegacyWearableCompactionBudget,
): boolean {
  return budget.deadlineMs !== undefined
    && Date.now() - budget.startedAtMs >= budget.deadlineMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
