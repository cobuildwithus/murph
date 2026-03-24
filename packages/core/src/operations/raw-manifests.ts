import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  CONTRACT_SCHEMA_VERSION,
  jsonObjectSchema,
  rawImportManifestSchema,
  type JsonObject,
  type RawImportKind,
  type RawImportManifestArtifact,
} from "@healthybob/contracts";

import type { WriteBatch } from "./write-batch.js";
import { normalizeRelativeVaultPath } from "../path-safety.js";

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
  rawDirectory?: string;
  source: string | null;
  artifacts: Array<{
    role: string;
    raw: RawArtifactLike;
  }>;
  provenance: Record<string, unknown>;
}

async function describeRawArtifact(
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
}): string {
  return path.posix.join(
    resolveRawArtifactDirectory(input.artifacts, input.rawDirectory),
    "manifest.json",
  );
}

function sanitizeManifestProvenance(provenance: Record<string, unknown>): JsonObject {
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

export async function stageRawImportManifest({
  batch,
  importId,
  importKind,
  importedAt,
  rawDirectory,
  source,
  artifacts,
  provenance,
}: StageRawImportManifestInput): Promise<string> {
  const resolvedRawDirectory = resolveRawArtifactDirectory(
    artifacts.map(({ raw }) => raw),
    rawDirectory,
  );
  const manifestPath = resolveRawManifestPath({
    artifacts: artifacts.map(({ raw }) => raw),
    rawDirectory: resolvedRawDirectory,
  });
  const manifest = rawImportManifestSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    importId,
    importKind,
    importedAt,
    source,
    rawDirectory: resolvedRawDirectory,
    artifacts: await Promise.all(
      artifacts.map(({ raw, role }) => describeRawArtifact(raw, role)),
    ),
    provenance: sanitizeManifestProvenance(provenance),
  });

  await batch.stageTextWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    allowRaw: true,
    overwrite: false,
    allowExistingMatch: true,
  });

  return manifestPath;
}
