import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import type { WriteBatch } from "./write-batch.js";

interface RawArtifactLike {
  relativePath: string;
  originalFileName: string;
  mediaType: string;
  stagedAbsolutePath: string;
}

interface RawManifestArtifact {
  role: string;
  relativePath: string;
  originalFileName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

interface RawImportManifest {
  schemaVersion: "hb.raw-import-manifest.v1";
  importId: string;
  importKind: "assessment" | "device_batch" | "document" | "meal" | "sample_batch";
  importedAt: string;
  source: string | null;
  rawDirectory: string;
  artifacts: RawManifestArtifact[];
  provenance: Record<string, unknown>;
}

interface StageRawImportManifestInput {
  batch: WriteBatch;
  importId: string;
  importKind: RawImportManifest["importKind"];
  importedAt: string;
  source: string | null;
  artifacts: Array<{
    role: string;
    raw: RawArtifactLike;
  }>;
  provenance: Record<string, unknown>;
}

const RAW_IMPORT_MANIFEST_SCHEMA_VERSION = "hb.raw-import-manifest.v1";

async function describeRawArtifact(
  artifact: RawArtifactLike,
  role: string,
): Promise<RawManifestArtifact> {
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
  const manifest: RawImportManifest = {
    schemaVersion: RAW_IMPORT_MANIFEST_SCHEMA_VERSION,
    importId,
    importKind,
    importedAt,
    source,
    rawDirectory: resolveRawArtifactDirectory(artifacts.map(({ raw }) => raw)),
    artifacts: await Promise.all(
      artifacts.map(({ raw, role }) => describeRawArtifact(raw, role)),
    ),
    provenance,
  };

  await batch.stageTextWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    allowRaw: true,
    overwrite: false,
    allowExistingMatch: true,
  });

  return manifestPath;
}
