import {
  createBrowserVaultSnapshot,
  readVaultTolerant,
  type BrowserVaultSnapshot,
} from "@murphai/query";

export async function exportHostedBrowserVaultSnapshot(input: {
  sourceVersion: string;
  vaultRoot: string;
}): Promise<BrowserVaultSnapshot> {
  const vault = await readVaultTolerant(input.vaultRoot);

  return createBrowserVaultSnapshot({
    entities: vault.entities,
    metadata: vault.metadata,
    sourceVersion: input.sourceVersion,
  });
}
