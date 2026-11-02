import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import {
  HostedColdHistoryUnavailableError,
  readHostedColdIngestReferences,
} from "@murphai/runtime-state/node";
import { statAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { VaultError } from "./errors.ts";

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
    } catch {
      throw new HostedColdHistoryUnavailableError();
    }
  }
}

export async function assertIntegrationIngestHistoryWritable(
  vaultRoot: string,
  logicalPath: string,
): Promise<void> {
  if ((await readHostedColdIngestReferences(vaultRoot)).some((entry) => entry.relativePath === `${logicalPath}.br`)) {
    throw new VaultError("INTEGRATION_INGEST_COLD_MONTH_CLOSED",
      "Referenced cold integration-ingest months are immutable.");
  }
}
