import {
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  healthCommonsCatalogSchema,
  type HealthCommonsArtifactManifest,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsChangeRecord,
  type HealthCommonsPageFrontmatter,
  type HealthCommonsRedirect,
} from "@murphai/contracts";

import { readHealthCommonsContent, type HealthCommonsContentSet, type HealthCommonsSourcePage } from "./load.ts";
import { sha256StableJson } from "./normalize.ts";

export interface BuildHealthCommonsCatalogOptions {
  contentRoot: string;
}

export async function buildHealthCommonsCatalog(
  options: BuildHealthCommonsCatalogOptions,
): Promise<HealthCommonsCatalog> {
  const content = await readHealthCommonsContent(options.contentRoot);
  return buildHealthCommonsCatalogFromContent(content);
}

export function buildHealthCommonsCatalogFromContent(
  content: HealthCommonsContentSet,
): HealthCommonsCatalog {
  validateHealthCommonsContent(content);

  const entities = content.pages.map((page) => toCatalogEntity(page));
  const catalogWithoutHash = {
    schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
    entities,
    redirects: content.redirects,
    changes: content.changes,
    artifactManifests: content.artifactManifests,
  };
  const catalogHash = sha256StableJson(catalogWithoutHash);

  return healthCommonsCatalogSchema.parse({
    ...catalogWithoutHash,
    catalogHash,
  });
}

export function validateHealthCommonsContent(content: HealthCommonsContentSet): void {
  const keys = new Map<string, string>();
  const aliases = new Map<string, string>();
  const pagesByKey = new Map<string, HealthCommonsSourcePage>();

  for (const page of content.pages) {
    const existingPath = keys.get(page.frontmatter.key);
    if (existingPath) {
      throw new Error(`Duplicate health commons key ${page.frontmatter.key} in ${existingPath} and ${page.relativePath}.`);
    }
    keys.set(page.frontmatter.key, page.relativePath);
    pagesByKey.set(page.frontmatter.key, page);

    for (const alias of page.frontmatter.aliases ?? []) {
      const normalizedAlias = normalizeAlias(alias);
      const existingAliasKey = aliases.get(normalizedAlias);
      if (existingAliasKey && existingAliasKey !== page.frontmatter.key) {
        throw new Error(`Duplicate health commons alias "${alias}" on ${existingAliasKey} and ${page.frontmatter.key}. Use a disambiguation page instead.`);
      }
      aliases.set(normalizedAlias, page.frontmatter.key);
    }
  }

  for (const page of content.pages) {
    for (const relation of page.frontmatter.relations ?? []) {
      assertTargetExists(keys, relation.target, `${page.frontmatter.key} relation ${relation.type}`);
    }
    for (const option of page.frontmatter.options ?? []) {
      assertTargetExists(keys, option.key, `${page.frontmatter.key} disambiguation option`);
    }
    for (const claim of page.frontmatter.claims ?? []) {
      for (const sourceKey of claim.sourceKeys ?? []) {
        assertTargetExists(keys, sourceKey, `${page.frontmatter.key} claim ${claim.claimId}`);
      }
    }
    for (const appraisal of page.frontmatter.protocolEvidence ?? []) {
      assertTargetExists(keys, appraisal.protocolKey, `${page.frontmatter.key} protocolEvidence ${appraisal.groupId} protocolKey`);
      for (const endpointKey of appraisal.endpointKeys ?? []) {
        assertTargetExists(keys, endpointKey, `${page.frontmatter.key} protocolEvidence ${appraisal.groupId} endpointKeys`);
      }
    }
    for (const group of page.frontmatter.researchLandscape?.groups ?? []) {
      for (const sourceKey of group.sourceKeys) {
        assertTargetExists(keys, sourceKey, `${page.frontmatter.key} researchLandscape group ${group.id}`);
        const sourcePage = pagesByKey.get(stripRevision(sourceKey));
        const hasMatchingAppraisal = sourcePage?.frontmatter.protocolEvidence?.some((appraisal) =>
          appraisal.protocolKey === page.frontmatter.key && appraisal.groupId === group.id
        ) ?? false;

        if (!hasMatchingAppraisal) {
          throw new Error(
            `${page.frontmatter.key} researchLandscape group ${group.id} source ${sourceKey} lacks matching protocolEvidence appraisal.`,
          );
        }
      }
    }
    for (const plan of page.frontmatter.testPlans ?? []) {
      assertTargetExists(keys, plan.primaryBiomarkerKey, `${page.frontmatter.key} test plan ${plan.planId}`);
      for (const biomarkerKey of plan.secondaryBiomarkerKeys ?? []) {
        assertTargetExists(keys, biomarkerKey, `${page.frontmatter.key} test plan ${plan.planId}`);
      }
    }
    const onboardingTestPlanId = page.frontmatter.experimentOnboarding?.planDefaults?.testPlanId;
    if (
      onboardingTestPlanId
      && !(page.frontmatter.testPlans ?? []).some((plan) => plan.planId === onboardingTestPlanId)
    ) {
      throw new Error(
        `${page.frontmatter.key} experimentOnboarding planDefaults.testPlanId points to missing test plan ${onboardingTestPlanId}.`,
      );
    }
    if (page.frontmatter.lineage?.forkOf) {
      assertTargetExists(keys, page.frontmatter.lineage.forkOf, `${page.frontmatter.key} lineage forkOf`);
    }
    for (const sourcePersonKey of page.frontmatter.attribution?.sourcePersonKeys ?? []) {
      assertTargetExists(keys, sourcePersonKey, `${page.frontmatter.key} attribution sourcePersonKeys`);
    }
  }

  for (const redirect of content.redirects) {
    if (keys.has(redirect.from)) {
      throw new Error(`Redirect source ${redirect.from} is also an active health commons page.`);
    }
    assertTargetExists(keys, redirect.to, `redirect ${redirect.from}`);
  }

  for (const change of content.changes) {
    assertTargetExists(keys, change.entityKey, `change ${change.changeId}`);
    for (const sourceKey of change.sourceKeys ?? []) {
      assertTargetExists(keys, sourceKey, `change ${change.changeId}`);
    }
  }

  const artifactIds = new Map<string, string>();
  for (const manifest of content.artifactManifests) {
    for (const artifact of manifest.artifacts) {
      const existingManifest = artifactIds.get(artifact.artifactId);
      if (existingManifest) {
        throw new Error(`Duplicate artifactId ${artifact.artifactId} in ${existingManifest} and ${manifest.manifestKey}.`);
      }
      artifactIds.set(artifact.artifactId, manifest.manifestKey);
      if (artifact.sourceKey) {
        assertTargetExists(keys, artifact.sourceKey, `artifact ${artifact.artifactId}`);
      }
    }
  }

  warnDuplicateRecipeHashes(content.pages);
}

function toCatalogEntity(page: HealthCommonsSourcePage): HealthCommonsCatalogEntity {
  const revision = computeRevision(page.frontmatter, page.body);
  return {
    ...page.frontmatter,
    body: page.body,
    relativePath: page.relativePath,
    revision,
  };
}

function computeRevision(frontmatter: HealthCommonsPageFrontmatter, body: string) {
  const pageRevisionId = sha256StableJson({ body, frontmatter });

  if (frontmatter.entityType !== "protocol_variant") {
    return {
      pageRevisionId,
      recipeHash: null,
      runSpecRevisionId: null,
    };
  }

  const recipeHash = frontmatter.protocol
    ? sha256StableJson({ protocol: frontmatter.protocol, safety: frontmatter.safety })
    : null;
  const runSpecRevisionInput = {
    protocol: frontmatter.protocol ?? null,
    safety: frontmatter.safety ?? null,
    testPlans: frontmatter.testPlans ?? [],
    ...(frontmatter.experimentOnboarding === undefined
      ? {}
      : { experimentOnboarding: frontmatter.experimentOnboarding }),
  };
  const runSpecRevisionId = sha256StableJson(runSpecRevisionInput);

  return {
    pageRevisionId,
    recipeHash,
    runSpecRevisionId,
  };
}

function assertTargetExists(keys: ReadonlyMap<string, string>, target: string, context: string): void {
  if (!keys.has(stripRevision(target))) {
    throw new Error(`${context} points to missing health commons target ${target}.`);
  }
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function warnDuplicateRecipeHashes(pages: readonly HealthCommonsSourcePage[]): void {
  const byRecipeHash = new Map<string, HealthCommonsSourcePage[]>();

  for (const page of pages) {
    if (page.frontmatter.entityType !== "protocol_variant") {
      continue;
    }
    const protocol = page.frontmatter.protocol;
    if (!protocol) {
      continue;
    }
    const recipeHash = sha256StableJson({ protocol, safety: page.frontmatter.safety ?? null });
    const existing = byRecipeHash.get(recipeHash) ?? [];
    existing.push(page);
    byRecipeHash.set(recipeHash, existing);
  }

  for (const [recipeHash, entries] of byRecipeHash.entries()) {
    if (entries.length <= 1) {
      continue;
    }

    const keys = entries.map((entry) => entry.frontmatter.key).sort();
    const allExplicitlyRelated = entries.every((entry) => {
      const relationTargets = new Set((entry.frontmatter.relations ?? []).map((relation) => stripRevision(relation.target)));
      return keys.every((key) => key === entry.frontmatter.key || relationTargets.has(key));
    });

    if (!allExplicitlyRelated) {
      throw new Error(`Duplicate protocol recipeHash ${recipeHash} across ${keys.join(", ")}. Add aliases/redirects or explicit relations before adding duplicates.`);
    }
  }
}

export function collectArtifactPointers(manifests: readonly HealthCommonsArtifactManifest[]) {
  return manifests.flatMap((manifest) =>
    manifest.artifacts.map((artifact) => ({
      artifact,
      manifestKey: manifest.manifestKey,
    })),
  );
}

export function sortChangesById(changes: readonly HealthCommonsChangeRecord[]): HealthCommonsChangeRecord[] {
  return [...changes].sort((left, right) => left.changeId.localeCompare(right.changeId));
}

export function sortRedirects(redirects: readonly HealthCommonsRedirect[]): HealthCommonsRedirect[] {
  return [...redirects].sort((left, right) => left.from.localeCompare(right.from));
}
