import { readHostedMediaReferenceCatalogueValue } from "@murphai/runtime-state/node";
import { canonicalRawArtifactMatches } from "./operations/raw-manifests.ts";
import { statAndHashVaultFile, type RawArtifactIntegrity } from "./raw-artifact-integrity.ts";

/** Local bytes always win, including mismatches. Hosted metadata is evidence of
 * retained storage only when the local file is absent; it is never a local read. */
export async function resolveRetainedRawArtifact(vaultRoot: string, relativePath: string): Promise<{
  source: "local" | "hosted";
  integrity: RawArtifactIntegrity;
} | null> {
  const local = await statAndHashVaultFile(vaultRoot, relativePath);
  if (local) return { source: "local", integrity: local };
  if (!relativePath.startsWith("raw/meals/") && !relativePath.startsWith("raw/measurements/")) return null;
  const catalogue = await readHostedMediaReferenceCatalogueValue(vaultRoot);
  const entry = catalogue.entries.find(value => value.relativePath === relativePath);
  if (!entry || entry.pendingUpload === true
    || (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.now())
    || !await canonicalRawArtifactMatches({ vaultRoot, ...entry })) return null;
  return { source: "hosted", integrity: { byteSize: entry.byteSize, sha256: entry.sha256 } };
}
