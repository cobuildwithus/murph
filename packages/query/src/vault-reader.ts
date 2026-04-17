import type { VaultReadModel } from "./read-model.ts";
import { createVaultReadModel } from "./read-model.ts";
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
    entities: snapshot.entities,
  });
}
