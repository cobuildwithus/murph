import type { MetricPoint } from "../metrics/index.ts";
import { buildMetricProjection } from "../metrics/projection.ts";
import { isDefaultProjectedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel, type VaultReadModel } from "../read-model.ts";
import { readVaultSourceStrict } from "../vault-source.ts";

export interface BrowserVaultReplicaSource {
  metricPoints: MetricPoint[];
  vault: VaultReadModel;
}

export async function readBrowserVaultReplicaSource(
  vaultRoot: string,
  options: { signal?: AbortSignal } = {},
): Promise<BrowserVaultReplicaSource> {
  options.signal?.throwIfAborted();
  const snapshot = await readVaultSourceStrict(vaultRoot, options);
  options.signal?.throwIfAborted();
  const sourceVault = createVaultReadModel({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
    vaultRoot,
  });

  await yieldToBrowserVaultSourceCancellation(options.signal);
  const metricPoints = buildMetricProjection(sourceVault).metricPoints;
  await yieldToBrowserVaultSourceCancellation(options.signal);
  const vault = createDefaultProjectedVault(sourceVault);

  return { metricPoints, vault };
}

export async function readBrowserVaultReplicaVault(
  vaultRoot: string,
  options: { signal?: AbortSignal } = {},
): Promise<VaultReadModel> {
  options.signal?.throwIfAborted();
  const snapshot = await readVaultSourceStrict(vaultRoot, options);
  options.signal?.throwIfAborted();
  return createDefaultProjectedVault(createVaultReadModel({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
    vaultRoot,
  }));
}

function createDefaultProjectedVault(vault: VaultReadModel): VaultReadModel {
  return createVaultReadModel({
    entities: vault.entities.filter(isDefaultProjectedQueryEntity),
    metadata: vault.metadata,
    vaultRoot: vault.vaultRoot,
  });
}

async function yieldToBrowserVaultSourceCancellation(
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  signal.throwIfAborted();
}
