import type { MetricPoint } from "../metrics/index.ts";
import { buildMetricProjection } from "../metrics/projection.ts";
import { isDefaultProjectedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel, type VaultReadModel } from "../read-model.ts";
import { readVaultSourceStrict } from "../vault-source.ts";

export interface BrowserVaultReplicaSource {
  metricPoints: MetricPoint[];
  vault: VaultReadModel;
}

export type BrowserVaultReplicaSourceStep =
  | "canonical_source_read"
  | "read_model_construction"
  | "metric_projection"
  | "default_entity_projection";

export async function readBrowserVaultReplicaSource(
  vaultRoot: string,
  options: {
    // Synchronous, best-effort operation boundaries; null marks completion.
    onSourceStep?: (step: BrowserVaultReplicaSourceStep | null) => void;
    signal?: AbortSignal;
  } = {},
): Promise<BrowserVaultReplicaSource> {
  const observe = (step: BrowserVaultReplicaSourceStep | null): void => {
    try {
      options.onSourceStep?.(step);
    } catch {
      // Optional diagnostics must not change source reads or cancellation.
    }
  };
  options.signal?.throwIfAborted();
  observe("canonical_source_read");
  const snapshot = await readVaultSourceStrict(vaultRoot, options);
  observe(null);
  options.signal?.throwIfAborted();
  observe("read_model_construction");
  const sourceVault = createVaultReadModel({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
    vaultRoot,
  });
  observe(null);
  await yieldToBrowserVaultSourceCancellation(options.signal);
  observe("metric_projection");
  const metricPoints = buildMetricProjection(sourceVault).metricPoints;
  observe(null);
  await yieldToBrowserVaultSourceCancellation(options.signal);
  observe("default_entity_projection");
  const vault = createDefaultProjectedVault(sourceVault);
  observe(null);

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
