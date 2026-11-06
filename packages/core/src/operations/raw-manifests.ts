import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  CONTRACT_SCHEMA_VERSION,
  jsonObjectSchema,
  rawImportManifestSchema,
  type JsonObject,
  type RawAssetOwner,
  type RawImportKind,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import type { WriteBatch } from "./write-batch.ts";
import { VaultError } from "../errors.ts";
import { normalizeOpaquePathSegment, normalizeRelativeVaultPath, resolveVaultPathOnDisk } from "../path-safety.ts";
import { inferRawAssetOwnerFromDirectory, rawDirectoryMatchesOwner } from "../raw.ts";
import { toIsoTimestamp } from "../time.ts";

interface RawArtifactLike {
  relativePath: string;
  originalFileName: string;
  mediaType: string;
  stagedAbsolutePath: string;
}

interface StageRawImportManifestInput {
  batch: WriteBatch;
  importId: string;
  importKind: RawImportKind;
  importedAt: string;
  owner: RawAssetOwner;
  rawDirectory?: string;
  source: string | null;
  artifacts: Array<{
    role: string;
    raw: RawArtifactLike;
  }>;
  provenance: Record<string, unknown>;
  operatorMetadata?: Record<string, unknown>;
}

export interface BuildRawImportManifestInput {
  importId: string;
  importKind: RawImportKind;
  importedAt: string;
  owner: RawAssetOwner;
  rawDirectory?: string;
  source: string | null;
  artifacts: readonly RawImportManifestArtifact[];
  provenance: Record<string, unknown>;
}

const RAW_MANIFEST_OPERATOR_METADATA_KEY = "operatorMetadata";
const LEGACY_RAW_MANIFEST_BASENAME = "manifest.json";

function normalizeRawManifestImportKey(importId: string): string {
  return normalizeOpaquePathSegment(importId, "Raw import manifest importId")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-");
}

function normalizeRawManifestTimestampKey(importedAt: string): string {
  return toIsoTimestamp(importedAt, "importedAt")
    .replace(/[-:.]/gu, "")
    .replace(/[^A-Za-z0-9_-]+/gu, "-");
}

export function isRawManifestFileName(fileName: string): boolean {
  return (
    fileName === LEGACY_RAW_MANIFEST_BASENAME
    || (fileName.startsWith("manifest.") && fileName.endsWith(".json"))
  );
}

export function resolveRawManifestBasename(input: {
  importId?: string;
  importedAt?: string;
}): string {
  if (!input.importId || !input.importedAt) {
    return LEGACY_RAW_MANIFEST_BASENAME;
  }

  return `manifest.${normalizeRawManifestImportKey(input.importId)}.${normalizeRawManifestTimestampKey(input.importedAt)}.json`;
}

export async function describeRawArtifact(
  artifact: RawArtifactLike,
  role: string,
): Promise<RawImportManifestArtifact> {
  const content = await fs.readFile(artifact.stagedAbsolutePath);

  return {
    role,
    relativePath: artifact.relativePath,
    originalFileName: artifact.originalFileName,
    mediaType: artifact.mediaType,
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function resolveRawArtifactDirectory(
  artifacts: readonly { relativePath: string }[],
  rawDirectory?: string,
): string {
  const normalizedRawDirectory =
    typeof rawDirectory === "string" && rawDirectory.trim().length > 0
      ? normalizeRelativeVaultPath(rawDirectory)
      : null;

  if (artifacts.length === 0) {
    if (normalizedRawDirectory) {
      return normalizedRawDirectory;
    }

    throw new TypeError("raw import manifest requires either a rawDirectory or at least one raw artifact");
  }

  const [firstDirectory, ...remainingDirectories] = artifacts.map((artifact) =>
    path.posix.dirname(artifact.relativePath),
  );

  if (!firstDirectory) {
    throw new TypeError("raw import manifest requires a stable raw directory");
  }

  for (const directory of remainingDirectories) {
    if (directory !== firstDirectory) {
      throw new TypeError("raw import manifest artifacts must share a single raw directory");
    }
  }

  if (normalizedRawDirectory && normalizedRawDirectory !== firstDirectory) {
    throw new TypeError("raw import manifest rawDirectory must match the staged raw artifacts");
  }

  return firstDirectory;
}

export function resolveRawManifestPath(input: {
  artifacts: readonly { relativePath: string }[];
  rawDirectory?: string;
  importId?: string;
  importedAt?: string;
}): string {
  return path.posix.join(
    resolveRawArtifactDirectory(input.artifacts, input.rawDirectory),
    resolveRawManifestBasename({
      importId: input.importId,
      importedAt: input.importedAt,
    }),
  );
}

function sanitizeManifestJsonObject(provenance: Record<string, unknown>): JsonObject {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(provenance);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new TypeError(`raw import manifest provenance must be JSON-serializable${detail}`);
  }

  if (serialized === undefined) {
    throw new TypeError("raw import manifest provenance must be JSON-serializable");
  }

  return jsonObjectSchema.parse(JSON.parse(serialized));
}

function composeManifestProvenance(input: {
  provenance: Record<string, unknown>;
  operatorMetadata?: Record<string, unknown>;
}): JsonObject {
  const provenance = sanitizeManifestJsonObject(input.provenance);

  if (RAW_MANIFEST_OPERATOR_METADATA_KEY in provenance) {
    throw new TypeError(
      `raw import manifest provenance reserves "${RAW_MANIFEST_OPERATOR_METADATA_KEY}" for caller metadata`,
    );
  }

  const operatorMetadata = input.operatorMetadata
    ? sanitizeManifestJsonObject(input.operatorMetadata)
    : undefined;

  if (!operatorMetadata || Object.keys(operatorMetadata).length === 0) {
    return provenance;
  }

  return {
    ...provenance,
    [RAW_MANIFEST_OPERATOR_METADATA_KEY]: operatorMetadata,
  };
}

export function buildRawImportManifest({
  importId,
  importKind,
  importedAt,
  owner,
  rawDirectory,
  source,
  artifacts,
  provenance,
}: BuildRawImportManifestInput): RawImportManifest {
  const normalizedArtifacts = artifacts.map((artifact) => ({
    ...artifact,
    relativePath: normalizeRelativeVaultPath(artifact.relativePath),
  }));
  const resolvedRawDirectory = resolveRawArtifactDirectory(normalizedArtifacts, rawDirectory);

  if (!rawDirectoryMatchesOwner(resolvedRawDirectory, owner)) {
    throw new TypeError(
      `raw import manifest rawDirectory "${resolvedRawDirectory}" does not match owner ${owner.kind}:${owner.id}.`,
    );
  }

  return rawImportManifestSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    importId,
    importKind,
    importedAt,
    source,
    owner,
    rawDirectory: resolvedRawDirectory,
    artifacts: normalizedArtifacts,
    provenance: sanitizeManifestJsonObject(provenance),
  });
}

export function parseRawImportManifest(manifest: unknown): RawImportManifest {
  return rawImportManifestSchema.parse(manifest);
}

export async function stageRawImportManifest({
  batch,
  importId,
  importKind,
  importedAt,
  owner,
  rawDirectory,
  source,
  artifacts,
  provenance,
  operatorMetadata,
}: StageRawImportManifestInput): Promise<string> {
  const manifest = buildRawImportManifest({
    importId,
    importKind,
    importedAt,
    owner,
    rawDirectory,
    source,
    artifacts: await Promise.all(
      artifacts.map(({ raw, role }) => describeRawArtifact(raw, role)),
    ),
    provenance: composeManifestProvenance({
      provenance,
      operatorMetadata,
    }),
  });

  const manifestPath = resolveRawManifestPath({
    artifacts: manifest.artifacts,
    rawDirectory: manifest.rawDirectory,
    importId: manifest.importId,
    importedAt: manifest.importedAt,
  });

  await batch.stageTextWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    allowRaw: true,
    overwrite: false,
    allowExistingMatch: true,
  });

  return manifestPath;
}

/** Canonical manifest identity, not a retained remote cleanup pointer, authorizes
 * restoring photo bytes. Call under the canonical lock when installing bytes. */
export async function canonicalRawArtifactMatches(input: {
  vaultRoot: string;
  relativePath: string;
  sha256: string;
  byteSize: number;
  mimeType: string | null;
}): Promise<boolean> {
  const artifacts = await readCanonicalRawArtifacts(input);
  const artifact = artifacts[0];
  return artifacts.length === 1 && artifact !== undefined && artifact.role !== "privacy_tombstone"
    && artifact.sha256 === input.sha256 && artifact.byteSize === input.byteSize && artifact.mediaType === input.mimeType;
}

/** Retirement remains authoritative after the hosted cleanup pointer is gone. */
export async function canonicalRawArtifactIsPrivacyTombstone(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<boolean> {
  return (await readCanonicalRawArtifacts(input)).some(artifact => artifact.role === "privacy_tombstone");
}

async function readCanonicalRawArtifacts(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<RawImportManifestArtifact[]> {
  const rawDirectory = path.posix.dirname(normalizeRelativeVaultPath(input.relativePath));
  const owner = inferRawAssetOwnerFromDirectory(rawDirectory);
  if (!owner) return [];
  const directory = await resolveVaultPathOnDisk(input.vaultRoot, rawDirectory);
  let names: string[];
  try {
    names = await fs.readdir(directory.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const artifacts: RawImportManifestArtifact[] = [];
  for (const name of names.filter(isRawManifestFileName)) {
    const resolved = await resolveVaultPathOnDisk(input.vaultRoot, path.posix.join(rawDirectory, name));
    let content: string;
    try {
      content = await fs.readFile(resolved.absolutePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new VaultError("CANONICAL_WRITE_LOCKED", "A canonical raw manifest is being replaced.");
      }
      throw error;
    }
    const manifest = rawImportManifestSchema.parse(JSON.parse(content));
    if (manifest.rawDirectory !== rawDirectory || manifest.owner.kind !== owner.kind || manifest.owner.id !== owner.id) continue;
    for (const artifact of manifest.artifacts) {
      if (artifact.relativePath === input.relativePath) artifacts.push(artifact);
    }
  }
  return artifacts;
}
