import path from "node:path";
import { clinicalFhirManifestPathSchema, clinicalRawManifestSchema } from "@murphai/clinical-records";
import { readJsonFile } from "./fs.ts";
import { safeStatAndHashVaultFile } from "./raw-artifact-integrity.ts";
import type { ValidationIssue } from "./types.ts";

export function clinicalRawSnapshotDirectory(relativePath: string): string | null {
  const directory = relativePath.split("/").slice(0, 5).join("/");
  return clinicalFhirManifestPathSchema.safeParse(`${directory}/manifest.json`).success
    ? directory : null;
}

export function groupClinicalRawSnapshotFiles(rawFiles: readonly string[]): Map<string, string[]> {
  const snapshots = new Map<string, string[]>();
  for (const relativePath of rawFiles) {
    const directory = clinicalRawSnapshotDirectory(relativePath);
    if (directory === null) continue;
    const files = snapshots.get(directory) ?? [];
    files.push(relativePath);
    snapshots.set(directory, files);
  }
  return snapshots;
}

/** Clinical interpretation stays with the importer; this checks stored evidence. */
export async function validateClinicalRawSnapshot(
  vaultRoot: string,
  manifestPath: string,
  rawFiles: readonly string[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const invalid = (message: string, artifactPath = manifestPath) => {
    issues.push({ severity: "error", code: "RAW_MANIFEST_INVALID", message, path: artifactPath });
  };
  let parsed: ReturnType<typeof clinicalRawManifestSchema.safeParse>;
  try {
    parsed = clinicalRawManifestSchema.safeParse(await readJsonFile(vaultRoot, manifestPath));
  } catch {
    invalid("Clinical raw manifest could not be read.");
    return issues;
  }
  if (!parsed.success) {
    invalid("Clinical raw manifest does not satisfy the clinical manifest contract.");
    return issues;
  }
  const manifest = parsed.data;
  const directory = path.posix.dirname(manifestPath);
  if (directory !== `raw/clinical/fhir/${manifest.connectionId}/${manifest.retrievalJobId}`) {
    invalid("Clinical raw manifest path does not match its connection and retrieval identity.");
    return issues;
  }
  const artifacts: Array<{ relativePath: string; sha256: string; byteSize?: number }> =
    manifest.resourceFiles.map(file => ({ relativePath: `${directory}/${file.relativePath}`, sha256: file.sha256 }));
  for (const attachment of manifest.documentAttachments ?? []) {
    if (attachment.status === "downloaded") {
      artifacts.push({ relativePath: `${directory}/${attachment.relativePath}`, sha256: attachment.sha256, byteSize: attachment.byteLength });
    }
  }
  const boundFiles = new Set([manifestPath, ...artifacts.map(artifact => artifact.relativePath)]);
  for (const relativePath of rawFiles) {
    if (relativePath.startsWith(`${directory}/`) && !boundFiles.has(relativePath)) {
      invalid("Clinical raw artifact is not bound by its snapshot manifest.", relativePath);
    }
  }
  if (manifest.schemaVersion === "murph.clinical-raw-manifest.v3" && manifest.batch?.previous) {
    artifacts.push({ relativePath: manifest.batch.previous.manifestPath, sha256: manifest.batch.previous.sha256 });
  }
  for (const artifact of artifacts) {
    const actual = await safeStatAndHashVaultFile(vaultRoot, artifact.relativePath);
    if (actual.kind === "invalid") {
      issues.push({ severity: "error", code: actual.code, message: actual.message, path: artifact.relativePath });
    } else if (actual.kind === "missing") {
      issues.push({ severity: "error", code: "RAW_REFERENCE_MISSING", message: "Clinical manifest evidence is missing.", path: artifact.relativePath });
    } else if (actual.integrity.sha256 !== artifact.sha256
      || (artifact.byteSize !== undefined && actual.integrity.byteSize !== artifact.byteSize)) {
      invalid("Clinical manifest evidence bytes or sha256 do not match.", artifact.relativePath);
    }
  }
  return issues;
}
