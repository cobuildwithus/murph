import { readFile } from "node:fs/promises";
import path from "node:path";

import type { MetricPoint } from "../metrics/index.ts";
import { buildMetricProjection } from "../metrics/projection.ts";
import { isDefaultProjectedQueryEntity } from "../query-visibility.ts";
import { createVaultReadModel, type VaultReadModel } from "../read-model.ts";
import { readVaultSourceStrict } from "../vault-source.ts";
import {
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  parseDerivedKnowledgeNodeMarkdown,
} from "../knowledge-graph.ts";
import {
  parsePersonalPatternVocabulary,
  PERSONAL_PATTERN_VOCABULARY_SLUG,
  type PersonalPatternVocabulary,
} from "../personal-patterns.ts";

export interface BrowserVaultReplicaSource {
  metricPoints: MetricPoint[];
  personalPatternVocabulary: PersonalPatternVocabulary | null;
  vault: VaultReadModel;
}

export type BrowserVaultReplicaSourceStep =
  | "canonical_source_read"
  | "read_model_construction"
  | "personal_pattern_vocabulary_read"
  | "metric_projection";

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
  observe("personal_pattern_vocabulary_read");
  const personalPatternVocabulary =
    await readBrowserVaultPersonalPatternVocabulary(vaultRoot);
  observe(null);

  await yieldToBrowserVaultSourceCancellation(options.signal);
  observe("metric_projection");
  const metricPoints = buildMetricProjection(sourceVault).metricPoints;
  observe(null);
  await yieldToBrowserVaultSourceCancellation(options.signal);
  // Keep raw wearable evidence until derived calculations finish. Replica
  // serialization applies its own default entity visibility filter.
  return { metricPoints, personalPatternVocabulary, vault: sourceVault };
}

export async function readBrowserVaultPersonalPatternVocabulary(
  vaultRoot: string,
): Promise<PersonalPatternVocabulary | null> {
  const relativePath = path.posix.join(
    DERIVED_KNOWLEDGE_PAGES_ROOT,
    `${PERSONAL_PATTERN_VOCABULARY_SLUG}.md`,
  );
  try {
    const markdown = await readFile(path.join(vaultRoot, relativePath), "utf8");
    const page = parseDerivedKnowledgeNodeMarkdown(relativePath, markdown);
    return page.slug === PERSONAL_PATTERN_VOCABULARY_SLUG
      ? parsePersonalPatternVocabulary(page.body)
      : null;
  } catch {
    return null;
  }
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
