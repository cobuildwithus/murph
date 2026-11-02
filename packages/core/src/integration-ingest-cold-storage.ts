import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  HostedColdHistoryUnavailableError,
  readHostedColdIngestReferences,
  readHostedMediaReferenceCatalogueValue,
  parseHostedColdIngestReference,
  resolveHostedMediaReferenceCataloguePath,
} from "@murphai/runtime-state/node";
import { statAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { prepareFileAtomic } from "./atomic-write.ts";

const materializers = new AsyncLocalStorage<{
  vaultRoot: string;
  materialize: (relativePaths: readonly string[]) => Promise<unknown>;
}>();

// Invocation-scoped authority; never retain a member's store in a global map.
export function withIntegrationIngestMaterializer<T>(
  vaultRoot: string,
  materialize: (relativePaths: readonly string[]) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  return materializers.run({ vaultRoot: path.resolve(vaultRoot), materialize }, run);
}

export async function materializeIntegrationIngestHistory(
  vaultRoot: string,
  logicalPaths?: readonly string[],
): Promise<void> {
  const references = await readHostedColdIngestReferences(vaultRoot);
  const requested = logicalPaths ? new Set(logicalPaths) : null;
  for (const reference of references) {
    if (requested && !requested.has(reference.relativePath.slice(0, -3))) continue;
    const matches = async () => {
      const integrity = await statAndHashVaultFile(vaultRoot, reference.relativePath);
      return integrity?.byteSize === reference.byteSize && integrity.sha256 === reference.sha256;
    };
    try {
      if (await matches()) continue;
      const scope = materializers.getStore();
      if (scope?.vaultRoot !== path.resolve(vaultRoot)) throw new HostedColdHistoryUnavailableError();
      await scope.materialize([reference.relativePath]);
      if (!await matches()) throw new HostedColdHistoryUnavailableError();
    } catch (cause) {
      throw new HostedColdHistoryUnavailableError({ cause });
    }
  }
}

// Called by the archived append owner under the canonical write lock. Detach
// only after verification and before changing bytes, so a crash leaves either a
// valid referenced shard or an intact inline shard. Old snapshots keep their object.
export async function thawIntegrationIngestHistoryForAppend(
  vaultRoot: string,
  logicalPath: string,
): Promise<void> {
  await materializeIntegrationIngestHistory(vaultRoot, [logicalPath]);
  const catalogue = await readHostedMediaReferenceCatalogueValue(vaultRoot);
  const entries = catalogue.entries.filter((entry) =>
    parseHostedColdIngestReference(entry)?.relativePath !== `${logicalPath}.br`);
  if (entries.length === catalogue.entries.length) return;
  try {
    await prepareFileAtomic(resolveHostedMediaReferenceCataloguePath(vaultRoot), async (tempPath) => {
      await writeFile(tempPath, `${JSON.stringify({ ...catalogue, entries }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    });
  } catch (cause) {
    throw new HostedColdHistoryUnavailableError({ cause });
  }
}
