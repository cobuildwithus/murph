import {
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION,
  healthCommonsCatalogSchema,
  healthCommonsSourceArtifactIndexSchema,
  healthCommonsSourceIndexSchema,
  type HealthCommonsArtifactManifest,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsChangeRecord,
  type HealthCommonsEvidenceAppraisal,
  type HealthCommonsPageFrontmatter,
  type HealthCommonsRedirect,
  type HealthCommonsSourceArtifactIndex,
  type HealthCommonsSourceIndex,
  type HealthCommonsSourceIndexEntry,
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
    evidenceAppraisals: content.evidenceAppraisals,
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

  assertUniqueSourceIdentities(content.pages);
  const findingIds = collectSourceFindingIds(content.pages, keys);
  const standaloneAppraisalMatches = validateEvidenceAppraisals(
    content.evidenceAppraisals,
    keys,
    pagesByKey,
    findingIds,
  );

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
    for (const group of page.frontmatter.researchLandscape?.groups ?? []) {
      for (const sourceKey of group.sourceKeys) {
        const sourceBaseKey = stripRevision(sourceKey);
        assertTargetExists(keys, sourceKey, `${page.frontmatter.key} researchLandscape group ${group.id}`);
        const hasStandaloneAppraisal = standaloneAppraisalMatches.has(
          evidenceAppraisalMatchKey(sourceBaseKey, page.frontmatter.key, group.id),
        );

        if (!hasStandaloneAppraisal) {
          throw new Error(
            `${page.frontmatter.key} researchLandscape group ${group.id} source ${sourceKey} lacks matching evidence-appraisal edge.`,
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

  assertSourceFindingArtifactReferences(content.pages, artifactIds);
  warnDuplicateRecipeHashes(content.pages);
}

export function buildHealthCommonsSourceIndex(catalog: HealthCommonsCatalog): HealthCommonsSourceIndex {
  const artifactIdsBySource = collectArtifactIdsBySource(catalog.artifactManifests);
  const sources = catalog.entities
    .filter((entity) => entity.entityType === "source_artifact")
    .map((entity): HealthCommonsSourceIndexEntry => {
      const identifiers = collectSourceIdentifierFields(entity);
      const artifactIds = artifactIdsBySource.get(entity.key) ?? [];
      const findingIds = (entity.sourceFindings ?? []).map((finding) => finding.findingId).sort();
      const extractionStatus = findingIds.length > 0
        ? "findings_available"
        : artifactIds.length > 0
          ? "artifacts_available"
          : "metadata_only";

      return {
        sourceKey: entity.key,
        relativePath: entity.relativePath,
        title: entity.title,
        sourceKind: entity.source?.kind ?? null,
        identityKind: entity.sourceIdentity?.identityKind ?? null,
        canonicalIdBasis: entity.sourceIdentity?.canonicalIdBasis ?? null,
        identifiers,
        canonicalUrl: entity.sourceIdentity?.canonicalUrl ?? identifiers.url ?? entity.source?.url ?? null,
        sourceUrl: entity.source?.url ?? null,
        identityAliases: [...(entity.sourceIdentity?.identityAliases ?? [])].sort(),
        identityKeys: collectSourceIdentityKeys(entity),
        artifactIds,
        findingIds,
        metadataFetchedAt: null,
        extractionStatus,
        sourceRevisionId: entity.revision.pageRevisionId,
      };
    })
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));

  const identityLookup = buildIdentityLookup(sources);

  return healthCommonsSourceIndexSchema.parse({
    schemaVersion: HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION,
    generatedFromCatalogHash: catalog.catalogHash,
    sources,
    identityLookup,
    duplicateIdentities: identityLookup.filter((entry) => entry.sourceKeys.length > 1),
  });
}

export function buildHealthCommonsSourceArtifactIndex(
  catalog: HealthCommonsCatalog,
): HealthCommonsSourceArtifactIndex {
  const artifacts = collectArtifactPointers(catalog.artifactManifests)
    .flatMap(({ artifact, manifestKey }) => {
      if (!artifact.sourceKey) {
        return [];
      }
      return [{
        ...artifact,
        manifestKey,
        sourceKey: stripRevision(artifact.sourceKey),
      }];
    })
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey) || left.artifactId.localeCompare(right.artifactId));

  const artifactIdsBySource = new Map<string, string[]>();
  for (const artifact of artifacts) {
    const artifactIds = artifactIdsBySource.get(artifact.sourceKey) ?? [];
    artifactIds.push(artifact.artifactId);
    artifactIdsBySource.set(artifact.sourceKey, artifactIds);
  }

  const sources = [...artifactIdsBySource.entries()]
    .map(([sourceKey, artifactIds]) => ({
      sourceKey,
      artifactIds: artifactIds.sort(),
    }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));

  return healthCommonsSourceArtifactIndexSchema.parse({
    schemaVersion: HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION,
    generatedFromCatalogHash: catalog.catalogHash,
    artifacts,
    sources,
  });
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

function collectSourceFindingIds(
  pages: readonly HealthCommonsSourcePage[],
  keys: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const findingIds = new Map<string, string>();

  for (const page of pages) {
    for (const finding of page.frontmatter.sourceFindings ?? []) {
      const existingPageKey = findingIds.get(finding.findingId);
      if (existingPageKey) {
        throw new Error(`Duplicate source finding ${finding.findingId} on ${existingPageKey} and ${page.frontmatter.key}.`);
      }
      const declaredSourceKey = stripRevision(finding.sourceKey ?? page.frontmatter.key);
      assertTargetExists(keys, declaredSourceKey, `${page.frontmatter.key} sourceFindings ${finding.findingId} sourceKey`);
      findingIds.set(finding.findingId, page.frontmatter.key);
    }
  }

  return new Set(findingIds.keys());
}

function assertSourceFindingArtifactReferences(
  pages: readonly HealthCommonsSourcePage[],
  artifactIds: ReadonlyMap<string, string>,
): void {
  for (const page of pages) {
    for (const finding of page.frontmatter.sourceFindings ?? []) {
      if (finding.extractedFromArtifactId && !artifactIds.has(finding.extractedFromArtifactId)) {
        throw new Error(
          `${page.frontmatter.key} sourceFindings ${finding.findingId} extractedFromArtifactId points to missing artifact ${finding.extractedFromArtifactId}.`,
        );
      }
    }
  }
}

function validateEvidenceAppraisals(
  appraisals: readonly HealthCommonsEvidenceAppraisal[],
  keys: ReadonlyMap<string, string>,
  pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>,
  findingIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const appraisalKeys = new Map<string, string>();
  const appraisalMatches = new Set<string>();

  for (const appraisal of appraisals) {
    const existingKeyPath = appraisalKeys.get(appraisal.key);
    if (existingKeyPath) {
      throw new Error(`Duplicate evidence appraisal key ${appraisal.key} in ${existingKeyPath} and ${keys.get(appraisal.targetKey) ?? appraisal.targetKey}.`);
    }
    appraisalKeys.set(appraisal.key, keys.get(appraisal.targetKey) ?? appraisal.targetKey);

    assertTargetExists(keys, appraisal.sourceKey, `evidence appraisal ${appraisal.key} sourceKey`);
    assertTargetExists(keys, appraisal.targetKey, `evidence appraisal ${appraisal.key} targetKey`);

    const targetPage = pagesByKey.get(stripRevision(appraisal.targetKey));
    if (targetPage && targetPage.frontmatter.entityType !== appraisal.targetKind) {
      throw new Error(
        `Evidence appraisal ${appraisal.key} targetKind ${appraisal.targetKind} does not match ${appraisal.targetKey} entityType ${targetPage.frontmatter.entityType}.`,
      );
    }

    for (const endpointKey of appraisal.endpointKeys ?? []) {
      assertTargetExists(keys, endpointKey, `evidence appraisal ${appraisal.key} endpointKeys`);
    }
    for (const findingKey of appraisal.findingKeys ?? []) {
      assertFindingExists(findingIds, findingKey, `evidence appraisal ${appraisal.key} findingKeys`);
    }

    appraisalMatches.add(evidenceAppraisalMatchKey(appraisal.sourceKey, appraisal.targetKey, appraisal.groupId));
  }

  return appraisalMatches;
}

function evidenceAppraisalMatchKey(sourceKey: string, targetKey: string, groupId: string): string {
  return `${stripRevision(sourceKey)}\u0000${stripRevision(targetKey)}\u0000${groupId}`;
}

function assertFindingExists(findingIds: ReadonlySet<string>, target: string, context: string): void {
  if (!findingIds.has(stripRevision(target))) {
    throw new Error(`${context} points to missing health commons source finding ${target}.`);
  }
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

function assertUniqueSourceIdentities(pages: readonly HealthCommonsSourcePage[]): void {
  const firstSeenByIdentity = new Map<string, HealthCommonsSourcePage>();

  for (const page of pages) {
    if (page.frontmatter.entityType !== "source_artifact") {
      continue;
    }

    for (const identityKey of collectSourceIdentityKeys(page.frontmatter)) {
      const firstSeen = firstSeenByIdentity.get(identityKey);
      if (!firstSeen) {
        firstSeenByIdentity.set(identityKey, page);
        continue;
      }
      if (firstSeen.frontmatter.key === page.frontmatter.key) {
        continue;
      }
      if (hasExplicitSourceIdentityDuplicateRelation(firstSeen.frontmatter, page.frontmatter)) {
        continue;
      }

      throw new Error(
        `Duplicate source identity ${identityKey} across ${firstSeen.frontmatter.key} (${firstSeen.relativePath}) and ${page.frontmatter.key} (${page.relativePath}). Add an explicit duplicate_source_identity/same_work_as relation or canonicalize the source page before fetching again.`,
      );
    }
  }
}

const SOURCE_IDENTITY_DUPLICATE_RELATION_TYPES = new Set([
  "alias_of",
  "duplicate_source_identity",
  "duplicate_source",
  "mirror_of",
  "publication_for",
  "readable_mirror",
  "registry_for",
  "same_work_as",
  "source_variant",
]);

function hasExplicitSourceIdentityDuplicateRelation(
  left: HealthCommonsPageFrontmatter,
  right: HealthCommonsPageFrontmatter,
): boolean {
  return hasSourceIdentityDuplicateRelation(left, right.key) || hasSourceIdentityDuplicateRelation(right, left.key);
}

function hasSourceIdentityDuplicateRelation(page: HealthCommonsPageFrontmatter, targetKey: string): boolean {
  return (page.relations ?? []).some((relation) =>
    SOURCE_IDENTITY_DUPLICATE_RELATION_TYPES.has(relation.type)
    && stripRevision(relation.target) === targetKey
  );
}

function collectSourceIdentityKeys(frontmatter: HealthCommonsPageFrontmatter): string[] {
  const identityKeys = new Set<string>();
  const source = frontmatter.source;
  const sourceIdentity = frontmatter.sourceIdentity;

  addIdentityKey(identityKeys, "pmid", source?.pmid);
  addIdentityKey(identityKeys, "doi", source?.doi);
  addIdentityKey(identityKeys, "url", source?.url);

  addIdentityKey(identityKeys, "pmid", sourceIdentity?.identifiers?.pmid);
  addIdentityKey(identityKeys, "pmcid", sourceIdentity?.identifiers?.pmcid);
  addIdentityKey(identityKeys, "doi", sourceIdentity?.identifiers?.doi);
  addIdentityKey(identityKeys, "registry_id", sourceIdentity?.identifiers?.registryId);
  addIdentityKey(identityKeys, "url", sourceIdentity?.identifiers?.url);
  addIdentityKey(identityKeys, "url", sourceIdentity?.canonicalUrl);

  for (const alias of sourceIdentity?.identityAliases ?? []) {
    const normalizedAlias = normalizeIdentityAlias(alias);
    if (normalizedAlias) {
      identityKeys.add(normalizedAlias);
    }
  }

  return [...identityKeys].sort();
}

function collectSourceIdentifierFields(frontmatter: HealthCommonsPageFrontmatter) {
  const identifiers = compactIdentifiers({
    pmid: frontmatter.sourceIdentity?.identifiers?.pmid ?? frontmatter.source?.pmid,
    pmcid: frontmatter.sourceIdentity?.identifiers?.pmcid,
    doi: frontmatter.sourceIdentity?.identifiers?.doi ?? frontmatter.source?.doi,
    registryId: frontmatter.sourceIdentity?.identifiers?.registryId,
    url: frontmatter.sourceIdentity?.identifiers?.url ?? frontmatter.sourceIdentity?.canonicalUrl ?? frontmatter.source?.url,
  });

  return identifiers;
}

function compactIdentifiers(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value.trim().length > 0),
  );
}

function addIdentityKey(identityKeys: Set<string>, kind: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  const normalizedValue = normalizeIdentityValue(kind, value);
  if (normalizedValue) {
    identityKeys.add(`${kind}:${normalizedValue}`);
  }
}

function normalizeIdentityAlias(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const prefixed = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/u);
  if (!prefixed) {
    return `alias:${normalizeAlias(trimmed)}`;
  }

  const rawPrefix = prefixed[1]?.toLowerCase();
  const rawValue = prefixed[2]?.trim();
  if (!rawPrefix || !rawValue) {
    return null;
  }

  const kind = rawPrefix === "pubmed"
    ? "pmid"
    : rawPrefix === "registry"
      ? "registry_id"
      : rawPrefix;
  const normalizedValue = normalizeIdentityValue(kind, rawValue);
  return normalizedValue ? `${kind}:${normalizedValue}` : null;
}

function normalizeIdentityValue(kind: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (kind === "doi") {
    return normalizeDoi(trimmed);
  }
  if (kind === "url") {
    return normalizeUrl(trimmed);
  }
  if (kind === "pmid") {
    return trimmed.replace(/\D/gu, "");
  }
  if (kind === "pmcid") {
    return trimmed.toLowerCase().replace(/^pmcid:/u, "");
  }
  if (kind === "registry_id") {
    return trimmed.toLowerCase().replace(/^registry:/u, "").replace(/^registry_id:/u, "");
  }

  return normalizeAlias(trimmed);
}

function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^doi:/iu, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
    .toLowerCase();
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.searchParams.sort();
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/u, "");
  }
}

function buildIdentityLookup(sources: readonly HealthCommonsSourceIndexEntry[]) {
  const sourceKeysByIdentity = new Map<string, Set<string>>();

  for (const source of sources) {
    for (const identityKey of source.identityKeys) {
      const sourceKeys = sourceKeysByIdentity.get(identityKey) ?? new Set<string>();
      sourceKeys.add(source.sourceKey);
      sourceKeysByIdentity.set(identityKey, sourceKeys);
    }
  }

  return [...sourceKeysByIdentity.entries()]
    .map(([identityKey, sourceKeys]) => ({
      identityKey,
      sourceKeys: [...sourceKeys].sort(),
    }))
    .sort((left, right) => left.identityKey.localeCompare(right.identityKey));
}

function collectArtifactIdsBySource(manifests: readonly HealthCommonsArtifactManifest[]): Map<string, string[]> {
  const artifactIdsBySource = new Map<string, string[]>();

  for (const { artifact } of collectArtifactPointers(manifests)) {
    if (!artifact.sourceKey) {
      continue;
    }
    const sourceKey = stripRevision(artifact.sourceKey);
    const artifactIds = artifactIdsBySource.get(sourceKey) ?? [];
    artifactIds.push(artifact.artifactId);
    artifactIdsBySource.set(sourceKey, artifactIds);
  }

  for (const artifactIds of artifactIdsBySource.values()) {
    artifactIds.sort();
  }

  return artifactIdsBySource;
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
