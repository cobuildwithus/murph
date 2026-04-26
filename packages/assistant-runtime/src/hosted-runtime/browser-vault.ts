import {
  createBrowserVaultReplica,
  createVaultReadModel,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import {
  readVaultTolerant,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "@murphai/query";

const HOSTED_BROWSER_VAULT_ENTITY_FAMILIES = new Set<CanonicalEntityFamily>([
  "allergy",
  "assessment",
  "condition",
  "event",
  "experiment",
  "family",
  "genetics",
  "goal",
  "journal",
  "protocol",
  "regimen",
  "sample",
]);
const HOSTED_BROWSER_VAULT_BODY_PREVIEW_LIMIT = 280;

export async function exportHostedBrowserVaultReplica(input: {
  sourceBundleHash: string;
  vaultRoot: string;
}): Promise<BrowserVaultReplica> {
  const vault = await readVaultTolerant(input.vaultRoot);
  const projectedVault = createVaultReadModel({
    entities: projectHostedBrowserVaultEntities(vault.entities),
    metadata: vault.metadata,
    vaultRoot: vault.vaultRoot,
  });

  return createBrowserVaultReplica({
    sourceBundleHash: input.sourceBundleHash,
    vault: projectedVault,
  });
}

function projectHostedBrowserVaultEntities(
  entities: readonly CanonicalEntity[],
): CanonicalEntity[] {
  return entities
    .filter((entity) => HOSTED_BROWSER_VAULT_ENTITY_FAMILIES.has(entity.family))
    .map(projectHostedBrowserVaultEntity);
}

function projectHostedBrowserVaultEntity(entity: CanonicalEntity): CanonicalEntity {
  if (entity.family === "journal" || entity.family === "experiment") {
    return {
      ...entity,
      body: truncateHostedBrowserVaultBody(entity.body),
    };
  }

  if (
    entity.family === "allergy" ||
    entity.family === "assessment" ||
    entity.family === "condition" ||
    entity.family === "family" ||
    entity.family === "genetics" ||
    entity.family === "goal" ||
    entity.family === "protocol" ||
    entity.family === "regimen"
  ) {
    return {
      ...entity,
      attributes: {},
      body: null,
      frontmatter: null,
    };
  }

  return entity;
}

function truncateHostedBrowserVaultBody(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length <= HOSTED_BROWSER_VAULT_BODY_PREVIEW_LIMIT) {
    return normalized || null;
  }

  return `${normalized.slice(0, HOSTED_BROWSER_VAULT_BODY_PREVIEW_LIMIT - 3)}...`;
}
