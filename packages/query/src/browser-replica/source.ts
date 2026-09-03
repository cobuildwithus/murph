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
  const personalPatternVocabulary =
    await readBrowserVaultPersonalPatternVocabulary(vaultRoot);

  await yieldToBrowserVaultSourceCancellation(options.signal);
  const metricPoints = buildMetricProjection(sourceVault).metricPoints;
  await yieldToBrowserVaultSourceCancellation(options.signal);
  const vault = createDefaultProjectedVault(sourceVault);

  return { metricPoints, personalPatternVocabulary, vault };
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
