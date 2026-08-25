import type { VaultReadModel } from "./read-model.ts";
import { createVaultReadModel } from "./read-model.ts";
import { isDefaultProjectedQueryEntity } from "./query-visibility.ts";
import { readVaultSourceTolerant } from "./vault-source.ts";

export async function readVault(vaultRoot: string): Promise<VaultReadModel> {
  const { loadProjectedVaultSource } = await import("./query-projection.ts");
  const snapshot = await loadProjectedVaultSource(vaultRoot);

  return createVaultReadModel({
    vaultRoot,
    metadata: snapshot.metadata,
    entities: snapshot.entities,
  });
}

export async function readVaultTolerant(
  vaultRoot: string,
): Promise<VaultReadModel> {
  const snapshot = await readVaultSourceTolerant(vaultRoot);

  return createVaultReadModel({
    vaultRoot,
    metadata: snapshot.metadata,
    entities: snapshot.entities.filter(isDefaultProjectedQueryEntity),
  });
}

/**
 * Explicit raw/debug hydration path. This bypasses the query projection and can
 * include records intentionally excluded from the default product read model.
 */
export async function readVaultRawTolerant(
  vaultRoot: string,
): Promise<VaultReadModel> {
  const snapshot = await readVaultSourceTolerant(vaultRoot);

  return createVaultReadModel({
    vaultRoot,
    metadata: snapshot.metadata,
    entities: snapshot.entities,
  });
}
