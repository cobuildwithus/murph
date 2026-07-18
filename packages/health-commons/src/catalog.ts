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
      if (page.frontmatter.entityType !== "source_artifact") {
        throw new Error(`Duplicate health commons key ${page.frontmatter.key} in ${existingPath} and ${page.relativePath}.`);
      }
    } else {
      keys.set(page.frontmatter.key, page.relativePath);
      pagesByKey.set(page.frontmatter.key, page);
    }

    for (const alias of page.frontmatter.aliases ?? []) {
      const normalizedAlias = normalizeAlias(alias);
      const existingAliasKey = aliases.get(normalizedAlias);
      const existingAliasPage = existingAliasKey ? pagesByKey.get(existingAliasKey) : undefined;
      if (
        existingAliasKey
        && existingAliasKey !== page.frontmatter.key
        && (
          page.frontmatter.entityType !== "source_artifact"
          || existingAliasPage?.frontmatter.entityType !== "source_artifact"
        )
      ) {
        throw new Error(`Duplicate health commons alias "${alias}" on ${existingAliasKey} and ${page.frontmatter.key}. Use a disambiguation page instead.`);
      }
      if (!existingAliasKey) {
        aliases.set(normalizedAlias, page.frontmatter.key);
      }
    }
  }

  assertUniqueSourceIdentities(content.pages);
  collectSourceFindingIds(content.pages, keys, pagesByKey);
  validateEvidenceAppraisals(
    content.evidenceAppraisals,
    keys,
    pagesByKey,
  );

  for (const page of content.pages) {
    for (const relation of page.frontmatter.relations ?? []) {
      assertTargetExists(keys, relation.target, `${page.frontmatter.key} relation ${relation.type}`);
      if (
        relation.type === "primary_biomarker"
        || relation.type === "secondary_biomarker"
        || relation.type === "safety_outcome"
      ) {
        assertTargetEntityType(
          pagesByKey,
          relation.target,
          "biomarker",
          `${page.frontmatter.key} relation ${relation.type}`,
        );
      }
      if (
        relation.type === "default_measurement_method"
        || relation.type === "optional_measurement_method"
        || relation.type === "measurement_upgrade"
      ) {
        assertTargetEntityType(
          pagesByKey,
          relation.target,
          "measurement_method",
          `${page.frontmatter.key} relation ${relation.type}`,
        );
      }
      if (relation.type === "measures" && page.frontmatter.entityType === "measurement_method") {
        assertTargetEntityType(
          pagesByKey,
          relation.target,
          "biomarker",
          `${page.frontmatter.key} relation measures`,
        );
      }
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
      if (group.summary.includes("Standalone evidence-appraisal edges for")) {
        throw new Error(
          `${page.frontmatter.key} researchLandscape group ${group.id} uses generated placeholder summary text.`,
        );
      }
      for (const sourceKey of group.sourceKeys) {
        assertTargetExists(keys, sourceKey, `${page.frontmatter.key} researchLandscape group ${group.id}`);
      }
    }
    for (const plan of page.frontmatter.testPlans ?? []) {
      assertTargetExists(keys, plan.primaryBiomarkerKey, `${page.frontmatter.key} test plan ${plan.planId}`);
      assertTargetEntityType(
        pagesByKey,
        plan.primaryBiomarkerKey,
        "biomarker",
        `${page.frontmatter.key} test plan ${plan.planId} primaryBiomarkerKey`,
      );
      for (const biomarkerKey of plan.secondaryBiomarkerKeys ?? []) {
        if (resolveHealthCommonsKey(keys, biomarkerKey)) {
          assertTargetEntityType(
            pagesByKey,
            biomarkerKey,
            "biomarker",
            `${page.frontmatter.key} test plan ${plan.planId} secondaryBiomarkerKeys`,
          );
        }
      }
      for (const safetyOutcomeKey of plan.safetyOutcomeKeys ?? []) {
        if (resolveHealthCommonsKey(keys, safetyOutcomeKey)) {
          assertTargetEntityType(
            pagesByKey,
            safetyOutcomeKey,
            "biomarker",
            `${page.frontmatter.key} test plan ${plan.planId} safetyOutcomeKeys`,
          );
        }
      }
    }
    for (const signal of page.frontmatter.expectedSignalDescriptions ?? []) {
      assertTargetExists(keys, signal.biomarkerKey, `${page.frontmatter.key} expected signal description`);
      assertTargetEntityType(
        pagesByKey,
        signal.biomarkerKey,
        "biomarker",
        `${page.frontmatter.key} expected signal description`,
      );
    }
    for (const measuredBiomarkerKey of page.frontmatter.measurementMethod?.measuredBiomarkerKeys ?? []) {
      assertTargetExists(keys, measuredBiomarkerKey, `${page.frontmatter.key} measurementMethod.measuredBiomarkerKeys`);
      assertTargetEntityType(
        pagesByKey,
        measuredBiomarkerKey,
        "biomarker",
        `${page.frontmatter.key} measurementMethod.measuredBiomarkerKeys`,
      );
    }
    for (const output of page.frontmatter.measurementMethod?.outputs ?? []) {
      if (!output.mapsToBiomarkerKey) {
        continue;
      }
      assertTargetExists(keys, output.mapsToBiomarkerKey, `${page.frontmatter.key} measurementMethod output ${output.outputId}`);
      assertTargetEntityType(
        pagesByKey,
        output.mapsToBiomarkerKey,
        "biomarker",
        `${page.frontmatter.key} measurementMethod output ${output.outputId}`,
      );
    }
    for (const path of page.frontmatter.measurementPlan?.paths ?? []) {
      for (const methodKey of path.methodKeys) {
        assertTargetExists(keys, methodKey, `${page.frontmatter.key} measurementPlan path ${path.pathId} methodKeys`);
        assertTargetEntityType(
          pagesByKey,
          methodKey,
          "measurement_method",
          `${page.frontmatter.key} measurementPlan path ${path.pathId} methodKeys`,
        );
      }
      for (const outcomeKey of path.outcomeKeys ?? []) {
        assertTargetExists(keys, outcomeKey, `${page.frontmatter.key} measurementPlan path ${path.pathId} outcomeKeys`);
        assertTargetEntityType(
          pagesByKey,
          outcomeKey,
          "biomarker",
          `${page.frontmatter.key} measurementPlan path ${path.pathId} outcomeKeys`,
        );
      }
      for (const safetyOutcomeKey of path.safetyOutcomeKeys ?? []) {
        assertTargetExists(keys, safetyOutcomeKey, `${page.frontmatter.key} measurementPlan path ${path.pathId} safetyOutcomeKeys`);
        assertTargetEntityType(
          pagesByKey,
          safetyOutcomeKey,
          "biomarker",
          `${page.frontmatter.key} measurementPlan path ${path.pathId} safetyOutcomeKeys`,
        );
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
    validateExperimentOnboardingAdaptationPolicy(page, keys, pagesByKey);
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
        continue;
      }
      artifactIds.set(artifact.artifactId, manifest.manifestKey);
      if (artifact.sourceKey) {
        assertTargetExists(keys, artifact.sourceKey, `artifact ${artifact.artifactId}`);
        assertTargetEntityType(pagesByKey, artifact.sourceKey, "source_artifact", `artifact ${artifact.artifactId} sourceKey`);
      }
    }
  }

  const artifactSourceKeys = collectArtifactSourceKeys(content.artifactManifests);
  assertSourceFindingArtifactReferences(content.pages, artifactIds, artifactSourceKeys);
  warnDuplicateRecipeHashes(content.pages);
}

export function buildHealthCommonsSourceIndex(catalog: HealthCommonsCatalog): HealthCommonsSourceIndex {
  const artifactIdsBySource = collectArtifactIdsBySource(catalog.artifactManifests);
  const sources = catalog.entities
    .filter((entity) => entity.entityType === "source_artifact")
    .map((entity): HealthCommonsSourceIndexEntry => {
      const identifiers = sanitizeSourceIndexIdentifiers(collectSourceIdentifierFields(entity));
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
        canonicalUrl: sanitizeSourceIndexUrl(entity.sourceIdentity?.canonicalUrl ?? identifiers.url ?? entity.source?.url ?? null),
        sourceUrl: sanitizeSourceIndexUrl(entity.source?.url ?? null),
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
    expectedSignalDescriptions: frontmatter.expectedSignalDescriptions ?? [],
    ...(frontmatter.measurementPlan === undefined
      ? {}
      : { measurementPlan: frontmatter.measurementPlan }),
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
  pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>,
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
      assertTargetEntityType(pagesByKey, declaredSourceKey, "source_artifact", `${page.frontmatter.key} sourceFindings ${finding.findingId} sourceKey`);
      if (declaredSourceKey !== page.frontmatter.key) {
        throw new Error(
          `${page.frontmatter.key} sourceFindings ${finding.findingId} belongs to ${declaredSourceKey}; source-owned findings must live on their owning source page.`,
        );
      }
      findingIds.set(finding.findingId, page.frontmatter.key);
    }
  }

  return new Set(findingIds.keys());
}

function assertSourceFindingArtifactReferences(
  pages: readonly HealthCommonsSourcePage[],
  artifactIds: ReadonlyMap<string, string>,
  artifactSourceKeys: ReadonlyMap<string, string>,
): void {
  for (const page of pages) {
    for (const finding of page.frontmatter.sourceFindings ?? []) {
      if (!finding.extractedFromArtifactId) {
        continue;
      }
      if (!artifactIds.has(finding.extractedFromArtifactId)) {
        continue;
      }

      const findingSourceKey = stripRevision(finding.sourceKey ?? page.frontmatter.key);
      const artifactSourceKey = artifactSourceKeys.get(finding.extractedFromArtifactId);
      if (!artifactSourceKey) {
        continue;
      }
      if (artifactSourceKey !== findingSourceKey) {
        throw new Error(
          `${page.frontmatter.key} sourceFindings ${finding.findingId} extractedFromArtifactId ${finding.extractedFromArtifactId} belongs to ${artifactSourceKey}, not ${findingSourceKey}.`,
        );
      }
    }
  }
}

function validateEvidenceAppraisals(
  appraisals: readonly HealthCommonsEvidenceAppraisal[],
  keys: ReadonlyMap<string, string>,
  pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>,
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
    assertTargetEntityType(pagesByKey, appraisal.sourceKey, "source_artifact", `evidence appraisal ${appraisal.key} sourceKey`);
    assertTargetExists(keys, appraisal.targetKey, `evidence appraisal ${appraisal.key} targetKey`);

    const targetPage = pagesByKey.get(stripRevision(appraisal.targetKey));
    if (targetPage && targetPage.frontmatter.entityType !== appraisal.targetKind) {
      throw new Error(
        `Evidence appraisal ${appraisal.key} targetKind ${appraisal.targetKind} does not match ${appraisal.targetKey} entityType ${targetPage.frontmatter.entityType}.`,
      );
    }
    for (const endpointKey of appraisal.endpointKeys ?? []) {
      if (keys.has(stripRevision(endpointKey))) {
        assertTargetEntityType(pagesByKey, endpointKey, "biomarker", `evidence appraisal ${appraisal.key} endpointKeys`);
      }
    }
    appraisalMatches.add(evidenceAppraisalMatchKey(appraisal.sourceKey, appraisal.targetKey, appraisal.groupId));
  }

  return appraisalMatches;
}

function evidenceAppraisalMatchKey(sourceKey: string, targetKey: string, groupId: string): string {
  return `${stripRevision(sourceKey)}\u0000${stripRevision(targetKey)}\u0000${groupId}`;
}

function assertTargetExists(keys: ReadonlyMap<string, string>, target: string, context: string): void {
  if (!resolveHealthCommonsKey(keys, target)) {
    throw new Error(`${context} points to missing health commons target ${target}.`);
  }
}

function resolveHealthCommonsKey<TValue>(
  keys: ReadonlyMap<string, TValue>,
  target: string,
): string | null {
  const strippedTarget = stripRevision(target);
  if (keys.has(strippedTarget)) {
    return strippedTarget;
  }
  if (!strippedTarget.startsWith("source_artifact:doi-")) {
    return null;
  }

  const slashNormalized = strippedTarget.replace(/\//gu, "-");
  if (keys.has(slashNormalized)) {
    return slashNormalized;
  }

  const doiPrefix = "source_artifact:doi-";
  const fullyNormalized = `${doiPrefix}${strippedTarget.slice(doiPrefix.length).replace(/[./]/gu, "-")}`;
  return keys.has(fullyNormalized) ? fullyNormalized : null;
}

function assertTargetEntityType(
  pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>,
  target: string,
  expectedEntityType: HealthCommonsPageFrontmatter["entityType"],
  context: string,
): void {
  const resolvedTarget = resolveHealthCommonsKey(pagesByKey, target);
  const page = resolvedTarget ? pagesByKey.get(resolvedTarget) : undefined;
  if (!page) {
    return;
  }
  if (page.frontmatter.entityType !== expectedEntityType) {
    throw new Error(
      `${context} must point to ${expectedEntityType}, but ${target} is ${page.frontmatter.entityType}.`,
    );
  }
}

function validateExperimentOnboardingAdaptationPolicy(
  page: HealthCommonsSourcePage,
  keys: ReadonlyMap<string, string>,
  pagesByKey: ReadonlyMap<string, HealthCommonsSourcePage>,
): void {
  const onboarding = page.frontmatter.experimentOnboarding;
  if (!onboarding) {
    return;
  }

  const policy = onboarding.adaptationPolicy;
  const setupSlotIds = new Set((onboarding.setupSlots ?? []).map((slot) => slot.id));
  const testPlanIds = new Set((page.frontmatter.testPlans ?? []).map((plan) => plan.planId));

  if (policy) {
    for (const field of policy.fields) {
      assertSetupSlotIdsExist(
        setupSlotIds,
        field.sourceSlotIds ?? [],
        `${page.frontmatter.key} experimentOnboarding adaptationPolicy field ${field.id} sourceSlotIds`,
      );
    }

    assertSetupSlotIdsExist(
      setupSlotIds,
      policy.reusableSetup?.sourceSlotIds ?? [],
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy reusableSetup sourceSlotIds`,
    );
  }

  const measurementPlan = policy?.measurementPlan;
  if (!measurementPlan) {
    return;
  }

  if (measurementPlan.testPlanId && !testPlanIds.has(measurementPlan.testPlanId)) {
    throw new Error(
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy.measurementPlan.testPlanId points to missing test plan ${measurementPlan.testPlanId}.`,
    );
  }

  for (const signalKey of measurementPlan.requiredSignals ?? []) {
    assertTargetExists(
      keys,
      signalKey,
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy.measurementPlan.requiredSignals`,
    );
    assertTargetEntityType(
      pagesByKey,
      signalKey,
      "biomarker",
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy.measurementPlan.requiredSignals`,
    );
  }
  for (const signalKey of measurementPlan.optionalSignals ?? []) {
    assertTargetExists(
      keys,
      signalKey,
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy.measurementPlan.optionalSignals`,
    );
    assertTargetEntityType(
      pagesByKey,
      signalKey,
      "biomarker",
      `${page.frontmatter.key} experimentOnboarding adaptationPolicy.measurementPlan.optionalSignals`,
    );
  }
}

function assertSetupSlotIdsExist(
  setupSlotIds: ReadonlySet<string>,
  sourceSlotIds: readonly string[],
  context: string,
): void {
  for (const sourceSlotId of sourceSlotIds) {
    if (!setupSlotIds.has(sourceSlotId)) {
      throw new Error(`${context} points to missing setup slot ${sourceSlotId}.`);
    }
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
        `Duplicate Health Commons source identity "${identityKey}" for ${firstSeen.frontmatter.key} and ${page.frontmatter.key}. Add a same-work relation when this duplication is intentional.`,
      );
    }
  }
}

const SOURCE_IDENTITY_DUPLICATE_RELATION_TYPES = new Set([
  "alias_of",
  "duplicate_source_identity",
  "mirror_of",
  "publication_for",
  "readable_mirror",
  "registry_for",
  "same_work_as",
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
  addIdentityKey(identityKeys, "title_hash", sourceIdentity?.identifiers?.titleHash);
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
  const derivedIdentifiers = deriveIdentifierFieldsFromIdentityKeys(collectSourceIdentityKeys(frontmatter));
  const identifiers = compactIdentifiers({
    ...derivedIdentifiers,
    pmid: frontmatter.sourceIdentity?.identifiers?.pmid ?? frontmatter.source?.pmid ?? derivedIdentifiers.pmid,
    pmcid: frontmatter.sourceIdentity?.identifiers?.pmcid ?? derivedIdentifiers.pmcid,
    doi: frontmatter.sourceIdentity?.identifiers?.doi ?? frontmatter.source?.doi ?? derivedIdentifiers.doi,
    registryId: frontmatter.sourceIdentity?.identifiers?.registryId ?? derivedIdentifiers.registryId,
    titleHash: frontmatter.sourceIdentity?.identifiers?.titleHash ?? derivedIdentifiers.titleHash,
    url: frontmatter.sourceIdentity?.identifiers?.url ?? frontmatter.sourceIdentity?.canonicalUrl ?? frontmatter.source?.url ?? derivedIdentifiers.url,
  });

  return identifiers;
}

function deriveIdentifierFieldsFromIdentityKeys(identityKeys: readonly string[]): Record<string, string> {
  const identifiers: Record<string, string> = {};

  for (const identityKey of identityKeys) {
    const separatorIndex = identityKey.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const kind = identityKey.slice(0, separatorIndex);
    const value = identityKey.slice(separatorIndex + 1);
    if (!value) {
      continue;
    }

    if (kind === "pmid" && !identifiers.pmid) {
      identifiers.pmid = value;
    } else if (kind === "pmcid" && !identifiers.pmcid) {
      identifiers.pmcid = value;
    } else if (kind === "doi" && !identifiers.doi) {
      identifiers.doi = value;
    } else if (kind === "registry_id" && !identifiers.registryId) {
      identifiers.registryId = value;
    } else if (kind === "title_hash" && !identifiers.titleHash) {
      identifiers.titleHash = value;
    } else if (kind === "url" && !identifiers.url) {
      identifiers.url = value;
    }
  }

  return identifiers;
}

function compactIdentifiers(input: Record<string, string | null | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        return [];
      }
      return [[key, value]];
    }),
  );
}

function sanitizeSourceIndexIdentifiers(input: Record<string, string>): Record<string, string> {
  return compactIdentifiers({
    ...input,
    url: sanitizeSourceIndexUrl(input.url),
  });
}

function addIdentityKey(identityKeys: Set<string>, kind: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  const normalizedValue = normalizeIdentityValue(kind, value);
  if (normalizedValue) {
    identityKeys.add(`${kind}:${normalizedValue}`);
  }

  if (kind === "url" && value) {
    for (const derivedIdentityKey of deriveIdentityKeysFromUrl(value)) {
      identityKeys.add(derivedIdentityKey);
    }
  }
}

function deriveIdentityKeysFromUrl(value: string): string[] {
  const identityKeys = new Set<string>();
  const addDerived = (kind: string, rawValue: string | undefined) => {
    if (!rawValue) {
      return;
    }
    const normalizedValue = normalizeIdentityValue(kind, rawValue);
    if (normalizedValue) {
      identityKeys.add(kind + ":" + normalizedValue);
    }
  };

  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    const path = decodeURIComponent(url.pathname);

    if (host === "pubmed.ncbi.nlm.nih.gov") {
      addDerived("pmid", path.match(/^\/?(\d+)(?:\/|$)/u)?.[1]);
    }
    if (host === "pmc.ncbi.nlm.nih.gov" || host === "ncbi.nlm.nih.gov") {
      addDerived("pmcid", path.match(/(PMC\d+)/iu)?.[1]);
    }
    if (host === "doi.org" || host === "dx.doi.org") {
      addDerived("doi", path.replace(/^\/+/u, ""));
    }
    if (host === "clinicaltrials.gov") {
      addDerived("registry_id", path.match(/(NCT\d+)/iu)?.[1]);
    }
  } catch {
    return [];
  }

  return [...identityKeys].sort();
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
  if (kind === "title_hash") {
    const normalized = trimmed.toLowerCase().replace(/^title[-_]hash:/u, "");
    return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
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

const TRACKING_URL_SEARCH_PARAMS = new Set(["dclid", "fbclid", "gclid", "mc_cid", "mc_eid"]);
const SENSITIVE_URL_SEARCH_PARAMS = new Set([
  "access_token",
  "auth",
  "authorization",
  "code",
  "id_token",
  "password",
  "sig",
  "signature",
  "token",
]);

function sanitizeSourceIndexUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (url.username || url.password) {
      throw new Error("must not contain username or password");
    }
    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.toLowerCase();
      if (
        SENSITIVE_URL_SEARCH_PARAMS.has(normalizedKey)
        || normalizedKey.endsWith("_token")
        || normalizedKey.startsWith("x-amz-")
        || normalizedKey.startsWith("x-goog-")
      ) {
        throw new Error(`must not contain sensitive query parameter ${key}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("must not contain")) {
      throw new Error(`Source index URL ${error.message}.`);
    }
    throw new Error("Source index URL must be a valid URL.");
  }

  return normalizeUrl(value);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/iu.test(key) || TRACKING_URL_SEARCH_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
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
    .map(([identityKey, sourceKeys]) => {
      const sortedSourceKeys = [...sourceKeys].sort();
      return {
        identityKey,
        sourceKeys: sortedSourceKeys,
        canonicalSourceKey: sortedSourceKeys.length === 1 ? sortedSourceKeys[0] : null,
      };
    })
    .sort((left, right) => left.identityKey.localeCompare(right.identityKey));
}

function collectArtifactSourceKeys(manifests: readonly HealthCommonsArtifactManifest[]): Map<string, string> {
  const sourceKeyByArtifactId = new Map<string, string>();

  for (const { artifact } of collectArtifactPointers(manifests)) {
    if (!artifact.sourceKey) {
      continue;
    }
    if (!sourceKeyByArtifactId.has(artifact.artifactId)) {
      sourceKeyByArtifactId.set(artifact.artifactId, stripRevision(artifact.sourceKey));
    }
  }

  return sourceKeyByArtifactId;
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
