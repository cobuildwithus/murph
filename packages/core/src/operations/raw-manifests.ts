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

function resolveRawArtifactDirectory(artifacts: readonly { relativePath: string }[]): string {
  if (artifacts.length === 0) {
    throw new TypeError("raw import manifest requires at least one raw artifact");
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

  return firstDirectory;
}

export function resolveRawManifestPath(artifacts: readonly { relativePath: string }[]): string {
  return path.posix.join(resolveRawArtifactDirectory(artifacts), "manifest.json");
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
  source,
  artifacts,
  provenance,
}: StageRawImportManifestInput): Promise<string> {
  const manifestPath = resolveRawManifestPath(artifacts.map(({ raw }) => raw));
  const manifest = rawImportManifestSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    importId,
    importKind,
    importedAt,
    source,
    rawDirectory: resolveRawArtifactDirectory(artifacts.map(({ raw }) => raw)),
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
