import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import type {
  RawImportManifest,
  RawImportManifestArtifact,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { walkVaultFiles } from "./fs.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
import {
  isRawManifestFileName,
  parseRawImportManifest,
} from "./operations/raw-manifests.ts";
import {
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";
import { hashWearableRawPayload } from "./wearable-raw-payload-hash.ts";

export const LEGACY_WEARABLE_RAW_ENVELOPE_ROLE_PREFIX = "wearable-raw-envelope:";

export interface DetectLegacyWearableReceiptCompactionInput {
  vaultRoot: string;
  maxManifestBytes?: number;
}

export interface LegacyWearableReceiptCompactionDetection {
  hasWork: boolean;
  suspectedCount: number;
  largestSuspectByteSize?: number;
}

export interface CompactLegacyWearableReceiptEnvelopesInput {
  vaultRoot: string;
  maxEnvelopes?: number;
  maxCandidateBytes?: number;
  deadlineMs?: number;
  now?: Date;
}

export interface CompactLegacyWearableReceiptEnvelopesResult {
  mutated: boolean;
  compactedCount: number;
  skippedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  hasMore: boolean;
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

const DEFAULT_MAX_ENVELOPES = 25;
const DEFAULT_MAX_CANDIDATE_BYTES = 100 * 1024 * 1024;

export async function detectLegacyWearableReceiptCompaction({
  vaultRoot,
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
  maxEnvelopes = DEFAULT_MAX_ENVELOPES,
  maxCandidateBytes = DEFAULT_MAX_CANDIDATE_BYTES,
  deadlineMs,
  now = new Date(),
}: CompactLegacyWearableReceiptEnvelopesInput): Promise<CompactLegacyWearableReceiptEnvelopesResult> {
  const startedAtMs = Date.now();
  const manifestSnapshots = await readRawManifestSnapshots(vaultRoot);
  const candidates = collectLegacyEnvelopeCandidates(manifestSnapshots);
  const prepared: PreparedLegacyEnvelopeCompaction[] = [];
  const touchedManifestPaths = new Set<string>();
  let skippedCount = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  let hasMore = false;

  for (let index = 0; index < candidates.length; index += 1) {
    if (deadlineMs !== undefined && Date.now() - startedAtMs >= deadlineMs) {
      hasMore = true;
      break;
    }
    if (prepared.length >= maxEnvelopes) {
      hasMore = true;
      break;
    }

    const compaction = await prepareLegacyEnvelopeCompaction({
      maxCandidateBytes,
      references: candidates[index] as LegacyEnvelopeReference[],
      vaultRoot,
    });
    if (!compaction) {
      skippedCount += 1;
      continue;
    }

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
        changes: touchedPaths.map((relativePath) => ({
          op: "update",
          path: relativePath,
        })),
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

  return {
    bytesAfter,
    bytesBefore,
    compactedCount: prepared.length,
    hasMore,
    mutated: true,
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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, references]) =>
      references.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath))
    );
}

async function prepareLegacyEnvelopeCompaction(input: {
  maxCandidateBytes: number;
  references: readonly LegacyEnvelopeReference[];
  vaultRoot: string;
}): Promise<PreparedLegacyEnvelopeCompaction | null> {
  const [firstReference] = input.references;
  if (!firstReference || !legacyEnvelopeManifestReferencesAgree(input.references)) {
    return null;
  }

  const envelopeArtifact = firstReference.artifact;
  if (
    envelopeArtifact.byteSize > input.maxCandidateBytes
    || !artifactPathBelongsToRawDirectory(envelopeArtifact, firstReference.manifest.rawDirectory)
  ) {
    return null;
  }

  const envelopeFile = await readManifestArtifactFile(input.vaultRoot, envelopeArtifact);
  if (!envelopeFile) {
    return null;
  }

  const envelope = parseJsonObject(envelopeFile.content);
  if (!envelope || !hasOwn(envelope, "payload")) {
    return null;
  }

  const payloadHash = envelope.payloadHash;
  if (typeof payloadHash !== "string") {
    return null;
  }

  try {
    if (hashWearableRawPayload(envelope.payload) !== payloadHash) {
      return null;
    }
  } catch {
    return null;
  }

  const rawArtifactRoles = readStringArray(envelope.rawArtifactRoles);
  if (!rawArtifactRoles || rawArtifactRoles.length === 0) {
    return null;
  }

  const evidenceByManifest = input.references.map((reference) =>
    indexManifestArtifactsByRole(reference.manifest),
  );
  if (evidenceByManifest.some((index) => index === null)) {
    return null;
  }

  const hasProof = await verifyLegacyEnvelopeEvidenceProof({
    evidenceByManifest: evidenceByManifest as Array<Map<string, RawImportManifestArtifact>>,
    manifestReferences: input.references,
    payloadHash,
    rawArtifactRoles,
    vaultRoot: input.vaultRoot,
  });
  if (!hasProof) {
    return null;
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
    bytesAfter: envelopeBytes,
    bytesBefore: envelopeFile.byteSize,
    envelopeContent,
    envelopePath: envelopeArtifact.relativePath,
    manifestPaths: input.references.map((reference) => reference.manifestPath),
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
  evidenceByManifest: Array<Map<string, RawImportManifestArtifact>>;
  manifestReferences: readonly LegacyEnvelopeReference[];
  payloadHash: string;
  rawArtifactRoles: readonly string[];
  vaultRoot: string;
}): Promise<boolean> {
  let hasProof = false;

  for (const role of input.rawArtifactRoles) {
    for (let index = 0; index < input.evidenceByManifest.length; index += 1) {
      const artifact = input.evidenceByManifest[index]?.get(role);
      const manifest = input.manifestReferences[index]?.manifest;
      if (
        !artifact
        || !manifest
        || !artifactPathBelongsToRawDirectory(artifact, manifest.rawDirectory)
        || !(await readManifestArtifactFile(input.vaultRoot, artifact))
      ) {
        return false;
      }
    }

    if (!isProviderEvidenceProofRole(role)) {
      continue;
    }

    const proofArtifact = input.evidenceByManifest[0]?.get(role);
    if (!proofArtifact) {
      return false;
    }
    const proofFile = await readManifestArtifactFile(input.vaultRoot, proofArtifact);
    if (!proofFile) {
      return false;
    }
    const proofValue = parseEvidenceJsonOrText(proofFile.content);
    try {
      hasProof ||= hashWearableRawPayload(proofValue) === input.payloadHash;
    } catch {
      return false;
    }
  }

  return hasProof;
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
): Promise<{ byteSize: number; content: string; sha256: string } | null> {
  const resolved = resolveVaultPath(vaultRoot, artifact.relativePath);

  try {
    const contentBuffer = await fs.readFile(resolved.absolutePath);
    const actual = {
      byteSize: contentBuffer.byteLength,
      content: contentBuffer.toString("utf8"),
      sha256: sha256Hex(contentBuffer),
    };

    if (actual.byteSize !== artifact.byteSize || actual.sha256 !== artifact.sha256) {
      return null;
    }

    return actual;
  } catch {
    return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
