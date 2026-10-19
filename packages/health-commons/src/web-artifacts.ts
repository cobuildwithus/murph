import type {
  HealthCommonsCatalog,
  HealthCommonsBiomarkerFallbackRange,
  HealthCommonsBiomarkerPrivateMetricBinding,
  HealthCommonsBiomarkerDesiredDirection,
  HealthCommonsCatalogEntity,
  HealthCommonsEntityType,
  HealthCommonsEvidenceAppraisal,
  HealthCommonsGoalTemplate,
  HealthCommonsRedirect,
  HealthCommonsRelation,
  HealthCommonsSafety,
} from "@murphai/contracts";

import {
  buildHealthCommonsWebBiomarkerOverview,
  buildHealthCommonsWebBiomarkerResearch,
  buildHealthCommonsWebBiomarkerShell,
  resolveHealthCommonsWebBiomarkerShortName,
  resolveHealthCommonsWebBiomarkerMetricFields,
  type HealthCommonsWebBiomarkerProjectionArtifact,
  type HealthCommonsWebBiomarkerProjectionKey,
} from "./biomarker-web-artifacts.ts";
import {
  extractHealthCommonsGoalSources,
  type HealthCommonsGoalSource,
} from "./goal-sources.ts";

export {
  HEALTH_COMMONS_WEB_BIOMARKER_OVERVIEW_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_BIOMARKER_RESEARCH_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_BIOMARKER_SHELL_SCHEMA_VERSION,
} from "./biomarker-web-artifacts.ts";
export type { HealthCommonsWebBiomarkerOverview, HealthCommonsWebBiomarkerResearch, HealthCommonsWebBiomarkerShell } from "./biomarker-web-artifacts.ts";

export const HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION =
  "murph.commons.web.route-index.v1" as const;
export const HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION =
  "murph.commons.web.route-bundle.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION =
  "murph.commons.web.biomarker-index.v4" as const;
export const HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION =
  "murph.commons.web.goal-index.v2" as const;
export const HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION =
  "murph.commons.web.goal-page.v2" as const;

export type HealthCommonsWebProjectionKey =
  | "goal.page"
  | HealthCommonsWebBiomarkerProjectionKey;

const SOURCE_SNIPPET_FINDING_MAX_LENGTH = 1_000;
const ROUTE_BUNDLE_REVERSE_RELATION_TYPES = new Set<string>([
  "alias_of",
  "contraindicates",
  "default_measurement_method",
  "measures",
  "measurement_upgrade",
  "optional_measurement_method",
  "primary_biomarker",
  "secondary_biomarker",
  "safety_outcome",
]);

export interface HealthCommonsWebRouteIndexEntry {
  aliases: string[];
  bundlePath: string;
  entityType: HealthCommonsEntityType;
  key: string;
  projections?: Partial<Record<HealthCommonsWebProjectionKey, string>>;
  routeId: string;
  slug: string;
}

export interface HealthCommonsWebRouteIndex {
  catalogHash: string;
  routes: HealthCommonsWebRouteIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebRevisionRef {
  pageRevisionId: string;
  recipeHash?: string | null;
  runSpecRevisionId?: string | null;
  workflowSpecRevisionId?: string | null;
}

export type HealthCommonsWebGoalRevisionRef = HealthCommonsWebRevisionRef & {
  workflowSpecRevisionId: string;
};

export interface HealthCommonsWebReverseRelation {
  relation: HealthCommonsRelation;
  sourceKey: string;
}

export interface HealthCommonsWebSourceSnippet {
  citation?: string | null;
  finding?: string | null;
  key: string;
  title: string;
  url?: string | null;
  year?: number | null;
}

export interface HealthCommonsWebRouteBundle {
  catalogHash: string;
  entitiesByKey: Record<string, HealthCommonsCatalogEntity>;
  evidenceAppraisals: HealthCommonsEvidenceAppraisal[];
  primaryKey: string;
  redirects: HealthCommonsRedirect[];
  reverseEdges: HealthCommonsWebReverseRelation[];
  revisionManifest: Record<string, HealthCommonsWebRevisionRef>;
  route: {
    aliases: string[];
    entityType: HealthCommonsEntityType;
    routeId: string;
    slug: string;
  };
  schemaVersion: typeof HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION;
  sourceSnippets: Record<string, HealthCommonsWebSourceSnippet>;
}

export interface HealthCommonsWebBiomarkerIndexEntry {
  aliases: string[];
  bundlePath: string;
  categories: string[];
  desiredDirection: HealthCommonsBiomarkerDesiredDirection | null;
  fallbackRanges: HealthCommonsWebBiomarkerFallbackRange[];
  privateMetricBindings: HealthCommonsBiomarkerPrivateMetricBinding[];
  valuePrecision: number;
  hidden: boolean;
  key: string;
  published: boolean;
  quality: string | null;
  revision: HealthCommonsWebRevisionRef;
  routeId: string;
  shortName: string;
  slug: string;
  sortRank?: number | null;
  status: string | null;
  summary: string | null;
  title: string;
  unit: string | null;
}

export type HealthCommonsWebBiomarkerFallbackRange = Pick<
  HealthCommonsBiomarkerFallbackRange,
  | "applicability"
  | "eligibleSpecimenKinds"
  | "label"
  | "lowerBound"
  | "unit"
  | "upperBound"
>;

export interface HealthCommonsWebBiomarkerIndex {
  biomarkers: HealthCommonsWebBiomarkerIndexEntry[];
  catalogHash: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebGoalIndexEntry {
  aliases: string[];
  bundlePath: string;
  category: HealthCommonsGoalTemplate["category"];
  goalPhrase: string;
  key: string;
  outcomeKind: HealthCommonsGoalTemplate["outcomeKind"];
  pagePath: string;
  parentGoalKey: string | null;
  quality: string;
  revision: HealthCommonsWebGoalRevisionRef;
  routeId: string;
  safetyTier: HealthCommonsSafety["cautionLevel"];
  slug: string;
  startPrompt: string;
  status: string;
  sources: HealthCommonsGoalSource[];
  successSignals: HealthCommonsGoalTemplate["successSignals"];
  summary: string;
  title: string;
  workflow: HealthCommonsGoalTemplate["workflow"];
}

export interface HealthCommonsWebGoalIndex {
  catalogHash: string;
  goals: HealthCommonsWebGoalIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebGoalPage {
  aliases: string[];
  body: string;
  catalogHash: string;
  goal: Omit<HealthCommonsGoalTemplate, "evidenceSourceKeys">;
  key: string;
  revision: HealthCommonsWebGoalRevisionRef;
  route: {
    aliases: string[];
    entityType: "goal_template";
    routeId: string;
    slug: string;
  };
  safety: HealthCommonsSafety;
  schemaVersion: typeof HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION;
  sources: HealthCommonsGoalSource[];
  summary: string;
  title: string;
}

export type HealthCommonsWebProjectionArtifact =
  | HealthCommonsWebBiomarkerProjectionArtifact
  | HealthCommonsWebGoalPage;

export interface HealthCommonsWebGeneratedArtifacts {
  biomarkerIndex: HealthCommonsWebBiomarkerIndex;
  goalIndex: HealthCommonsWebGoalIndex;
  projectionArtifacts: Map<string, HealthCommonsWebProjectionArtifact>;
  routeBundles: Map<string, HealthCommonsWebRouteBundle>;
  routeIndex: HealthCommonsWebRouteIndex;
}

const WEB_BUNDLE_ENTITY_TYPES = new Set<HealthCommonsEntityType>([
  "biomarker",
  "goal_template",
  "measurement_method",
]);

function projectionPathsForPublishedBiomarkerRoute(
  entity: HealthCommonsCatalogEntity,
  routeId: string,
): Partial<Record<HealthCommonsWebProjectionKey, string>> | undefined {
  if (
    entity.entityType !== "biomarker"
    || !isPublishedBiomarkerIndexEntity(entity)
  ) {
    return undefined;
  }

  return {
    "biomarker.shell": `shell/biomarkers/${routeId}.json`,
    "biomarker.overview": `pages/biomarkers/${routeId}/overview.json`,
    "biomarker.research": `pages/biomarkers/${routeId}/research.json`,
  };
}

export function buildHealthCommonsWebGeneratedArtifacts(
  catalog: HealthCommonsCatalog,
): HealthCommonsWebGeneratedArtifacts {
  const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const redirectsByTarget = new Map<string, HealthCommonsRedirect[]>();

  for (const redirect of catalog.redirects) {
    const target = resolveRedirectTarget(redirect.to, catalog.redirects);
    const existing = redirectsByTarget.get(target) ?? [];
    existing.push(redirect);
    redirectsByTarget.set(target, existing);
  }

  const routeBundles = new Map<string, HealthCommonsWebRouteBundle>();
  const routeEntries: HealthCommonsWebRouteIndexEntry[] = [];
  const routeEntryKeys = new Map<string, HealthCommonsWebRouteIndexEntry>();

  for (const entity of catalog.entities) {
    if (!WEB_BUNDLE_ENTITY_TYPES.has(entity.entityType)) {
      continue;
    }
    if (!isPublicWebBundleEntity(entity)) {
      continue;
    }

    const routeIds = buildEntityRouteIds(entity, redirectsByTarget.get(entity.key) ?? []);
    const routeId = selectPrimaryRouteId(entity, routeIds);
    const bundlePath = bundlePathForEntity(entity.entityType, routeId);
    const aliases = routeIds.filter((candidate) => candidate !== routeId);
    const projections = projectionPathsForRoute(entity, routeId)
      ?? projectionPathsForPublishedBiomarkerRoute(entity, routeId);
    if (routeBundles.has(bundlePath)) {
      throw new Error(`Duplicate Health Commons web bundle path generated for ${bundlePath}.`);
    }
    const bundle = buildRouteBundle({
      catalog,
      entitiesByKey,
      primary: entity,
      redirects: catalog.redirects,
      routeAliases: aliases,
      routeId,
    });

    routeBundles.set(bundlePath, bundle);
    for (const alias of routeIds) {
      const entry = {
        aliases,
        bundlePath,
        entityType: entity.entityType,
        key: entity.key,
        ...(projections ? { projections } : {}),
        routeId: alias,
        slug: entity.slug,
      };
      const routeEntryKey = `${entry.entityType}:${entry.routeId}`;
      const existing = routeEntryKeys.get(routeEntryKey);
      if (existing) {
        throw new Error(
          `Duplicate Health Commons web route id generated for ${routeEntryKey}: ${existing.key} (${existing.bundlePath}) and ${entry.key} (${entry.bundlePath}).`,
        );
      }

      routeEntryKeys.set(routeEntryKey, entry);
      routeEntries.push(entry);
    }
  }

  routeEntries.sort(compareRouteEntries);
  const projectionArtifacts = new Map<string, HealthCommonsWebProjectionArtifact>();

  addGoalPageArtifacts(routeBundles, entitiesByKey, projectionArtifacts);

  for (const bundle of routeBundles.values()) {
    if (bundle.route.entityType !== "biomarker") {
      continue;
    }
    const biomarker = entitiesByKey.get(bundle.primaryKey);
    if (
      biomarker?.entityType !== "biomarker"
      || !isPublishedBiomarkerIndexEntity(biomarker)
    ) {
      continue;
    }

    const buildInput = {
      biomarker,
      catalogHash: catalog.catalogHash,
      entitiesByKey,
      routeAliases: bundle.route.aliases,
      routeId: bundle.route.routeId,
    };

    projectionArtifacts.set(
      `shell/biomarkers/${bundle.route.routeId}.json`,
      buildHealthCommonsWebBiomarkerShell(buildInput),
    );
    projectionArtifacts.set(
      `pages/biomarkers/${bundle.route.routeId}/overview.json`,
      buildHealthCommonsWebBiomarkerOverview(buildInput),
    );
    projectionArtifacts.set(
      `pages/biomarkers/${bundle.route.routeId}/research.json`,
      buildHealthCommonsWebBiomarkerResearch(buildInput),
    );
  }

  return {
    biomarkerIndex: {
      biomarkers: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "biomarker")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!entity) {
            return [];
          }
          return [{
            aliases: bundle.route.aliases,
            bundlePath: bundlePathForEntity(bundle.route.entityType, bundle.route.routeId),
            categories: entity.categories ?? [],
            desiredDirection: entity.biomarker?.direction?.desired ?? null,
            ...resolveHealthCommonsWebBiomarkerMetricFields(entity),
            fallbackRanges: entity.referenceGuidance?.fallbackRanges?.map((range) => ({
              applicability: range.applicability,
              eligibleSpecimenKinds: range.eligibleSpecimenKinds,
              label: range.label,
              ...(range.lowerBound ? { lowerBound: range.lowerBound } : {}),
              unit: range.unit,
              ...(range.upperBound ? { upperBound: range.upperBound } : {}),
            })) ?? [],
            hidden: entity.hidden === true,
            key: entity.key,
            published: isPublishedBiomarkerIndexEntity(entity),
            quality: entity.quality ?? null,
            revision: revisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            slug: entity.slug,
            sortRank: entity.sortRank ?? null,
            shortName: resolveHealthCommonsWebBiomarkerShortName(entity),
            status: entity.status ?? null,
            summary: entity.summary ?? null,
            title: entity.biomarker?.displayName ?? entity.title,
            unit: entity.biomarker?.unit ?? entity.unit ?? null,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      catalogHash: catalog.catalogHash,
      schemaVersion: HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
    },
    goalIndex: {
      catalogHash: catalog.catalogHash,
      goals: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "goal_template")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!isPublicGoalTemplate(entity)) {
            return [];
          }

          return [{
            aliases: entity.aliases ?? [],
            bundlePath: bundlePathForEntity(entity.entityType, bundle.route.routeId),
            category: entity.goal.category,
            goalPhrase: entity.goal.goalPhrase,
            key: entity.key,
            outcomeKind: entity.goal.outcomeKind,
            pagePath: goalPagePathForRouteId(bundle.route.routeId),
            parentGoalKey: entity.goal.parentGoalKey ?? null,
            quality: entity.quality,
            revision: goalRevisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            safetyTier: entity.safety.cautionLevel,
            slug: entity.slug,
            startPrompt: entity.goal.startPrompt,
            status: entity.status,
            sources: extractHealthCommonsGoalSources(entity.body),
            successSignals: entity.goal.successSignals,
            summary: entity.summary,
            title: entity.title,
            workflow: entity.goal.workflow,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      schemaVersion: HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION,
    },
    projectionArtifacts,
    routeBundles,
    routeIndex: {
      catalogHash: catalog.catalogHash,
      routes: routeEntries,
      schemaVersion: HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
    },
  };
}

function isPublicWebBundleEntity(entity: HealthCommonsCatalogEntity): boolean {
  if (entity.entityType === "goal_template") {
    return isPublicGoalTemplate(entity);
  }
  return true;
}

function addGoalPageArtifacts(
  routeBundles: ReadonlyMap<string, HealthCommonsWebRouteBundle>,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
  projectionArtifacts: Map<string, HealthCommonsWebProjectionArtifact>,
): void {
  for (const bundle of routeBundles.values()) {
    if (bundle.route.entityType !== "goal_template") {
      continue;
    }
    const goal = entitiesByKey.get(bundle.primaryKey);
    if (!isPublicGoalTemplate(goal)) {
      continue;
    }
    projectionArtifacts.set(
      goalPagePathForRouteId(bundle.route.routeId),
      buildGoalPage({ bundle, goal }),
    );
  }
}

function buildGoalPage(input: {
  bundle: HealthCommonsWebRouteBundle;
  goal: HealthCommonsCatalogEntity & {
    entityType: "goal_template";
    goal: HealthCommonsGoalTemplate;
    quality: string;
    safety: HealthCommonsSafety;
    status: string;
    summary: string;
  };
}): HealthCommonsWebGoalPage {
  return {
    aliases: input.goal.aliases ?? [],
    body: input.goal.body,
    catalogHash: input.bundle.catalogHash,
    goal: toWebGoalTemplate(input.goal.goal),
    key: input.goal.key,
    revision: goalRevisionRefForEntity(input.goal),
    route: {
      aliases: input.bundle.route.aliases,
      entityType: "goal_template",
      routeId: input.bundle.route.routeId,
      slug: input.goal.slug,
    },
    safety: input.goal.safety,
    schemaVersion: HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION,
    sources: extractHealthCommonsGoalSources(input.goal.body),
    summary: input.goal.summary,
    title: input.goal.title,
  };
}

function toWebGoalTemplate(
  goal: HealthCommonsGoalTemplate,
): Omit<HealthCommonsGoalTemplate, "evidenceSourceKeys"> {
  const { evidenceSourceKeys: _legacyEvidenceSourceKeys, ...webGoal } = goal;
  return webGoal;
}

function buildRouteBundle(input: {
  catalog: HealthCommonsCatalog;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  primary: HealthCommonsCatalogEntity;
  redirects: readonly HealthCommonsRedirect[];
  routeAliases: readonly string[];
  routeId: string;
}): HealthCommonsWebRouteBundle {
  const closureKeys = collectRouteClosureKeys(input.primary, input.catalog, input.entitiesByKey);
  const reverseEdges = collectRouteReverseEdges(input.catalog, new Set([input.primary.key]));
  for (const edge of reverseEdges) {
    const sourceKey = stripRevision(edge.sourceKey);
    if (input.entitiesByKey.has(sourceKey)) {
      closureKeys.add(sourceKey);
    }
  }
  const entities = [...closureKeys]
    .flatMap((key) => {
      const entity = input.entitiesByKey.get(key);
      return entity ? [entity] : [];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
  const entitiesByKey = Object.fromEntries(
    entities.map((entity) => [
      entity.key,
      prepareEntityForWebBundle(entity, { primary: entity.key === input.primary.key }),
    ]),
  );
  const evidenceAppraisals = input.catalog.evidenceAppraisals
    .filter((appraisal) =>
      stripRevision(appraisal.targetKey) === input.primary.key ||
      (
        closureKeys.has(stripRevision(appraisal.sourceKey)) &&
        closureKeys.has(stripRevision(appraisal.targetKey))
      )
    )
    .sort((left, right) => left.key.localeCompare(right.key));
  const redirects = input.redirects
    .filter((redirect) =>
      closureKeys.has(stripRevision(redirect.from)) ||
      closureKeys.has(stripRevision(redirect.to)) ||
      resolveRedirectTarget(redirect.to, input.redirects) === input.primary.key
    )
    .sort((left, right) => left.from.localeCompare(right.from));

  return {
    catalogHash: input.catalog.catalogHash,
    entitiesByKey,
    evidenceAppraisals,
    primaryKey: input.primary.key,
    redirects,
    reverseEdges,
    revisionManifest: Object.fromEntries(
      entities.map((entity) => [entity.key, revisionRefForEntity(entity)]),
    ),
    route: {
      aliases: [...input.routeAliases],
      entityType: input.primary.entityType,
      routeId: input.routeId,
      slug: input.primary.slug,
    },
    schemaVersion: HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION,
    sourceSnippets: Object.fromEntries(
      entities
        .filter((entity) => entity.entityType === "source_artifact")
        .map((entity) => [entity.key, sourceSnippetForEntity(entity)]),
    ),
  };
}

function projectionPathsForRoute(
  entity: HealthCommonsCatalogEntity,
  routeId: string,
): Partial<Record<HealthCommonsWebProjectionKey, string>> | null {
  if (isPublicGoalTemplate(entity)) {
    return {
      "goal.page": goalPagePathForRouteId(routeId),
    };
  }

  return null;
}

function collectRouteReverseEdges(
  catalog: HealthCommonsCatalog,
  targetKeys: ReadonlySet<string>,
): HealthCommonsWebReverseRelation[] {
  return catalog.entities
    .flatMap((entity) =>
      (entity.relations ?? [])
        .filter((relation) =>
          ROUTE_BUNDLE_REVERSE_RELATION_TYPES.has(relation.type) &&
          targetKeys.has(stripRevision(relation.target))
        )
        .map((relation) => ({
          relation,
          sourceKey: entity.key,
        }))
    )
    .sort((left, right) =>
      `${left.sourceKey}:${left.relation.type}:${left.relation.target}`.localeCompare(
        `${right.sourceKey}:${right.relation.type}:${right.relation.target}`,
      )
    );
}

function collectRouteClosureKeys(
  primary: HealthCommonsCatalogEntity,
  catalog: HealthCommonsCatalog,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): Set<string> {
  const keys = new Set<string>([primary.key]);
  const addKey = (key: string | null | undefined) => {
    if (!key) {
      return;
    }
    const stripped = stripRevision(key);
    const entity = entitiesByKey.get(stripped);
    if (!entity) {
      return;
    }
    keys.add(stripped);
  };

  for (const relation of primary.relations ?? []) {
    addKey(relation.target);
  }

  for (const claim of primary.claims ?? []) {
    for (const sourceKey of claim.sourceKeys ?? []) {
      addKey(sourceKey);
    }
  }

  for (const group of primary.researchLandscape?.groups ?? []) {
    for (const sourceKey of group.sourceKeys) {
      addKey(sourceKey);
    }
  }

  for (const path of primary.measurementPlan?.paths ?? []) {
    for (const key of path.methodKeys) {
      addKey(key);
    }
    for (const key of path.outcomeKeys ?? []) {
      addKey(key);
    }
    for (const key of path.safetyOutcomeKeys ?? []) {
      addKey(key);
    }
  }

  addGoalClosureKeys(primary, addKey);

  for (const appraisal of catalog.evidenceAppraisals) {
    if (stripRevision(appraisal.targetKey) === primary.key) {
      addKey(appraisal.sourceKey);
    }
  }

  return keys;
}

function addGoalClosureKeys(
  primary: HealthCommonsCatalogEntity,
  addKey: (key: string | null | undefined) => void,
): void {
  if (primary.entityType !== "goal_template" || !primary.goal) {
    return;
  }
  addKey(primary.goal.parentGoalKey);
  for (const sourceKey of primary.goal.evidenceSourceKeys) {
    addKey(sourceKey);
  }
}

function prepareEntityForWebBundle(
  entity: HealthCommonsCatalogEntity,
  options: { primary: boolean },
): HealthCommonsCatalogEntity {
  const finding = extractPublicStudyFinding(entity.body);
  const base = {
    aliases: entity.aliases ?? [],
    categories: entity.categories ?? [],
    entityType: entity.entityType,
    hidden: entity.hidden,
    key: entity.key,
    preferredRouteId: entity.preferredRouteId,
    quality: entity.quality,
    relativePath: entity.relativePath,
    relations: entity.entityType === "source_artifact" ? [] : entity.relations ?? [],
    researchEvidence: entity.researchEvidence,
    revision: entity.revision,
    schemaVersion: entity.schemaVersion,
    slug: entity.slug,
    source: entity.source,
    status: entity.status,
    summary: entity.summary,
    title: entity.title,
  };

  if (entity.entityType === "source_artifact") {
    return {
      ...base,
      body: finding ? `**Findings:** ${finding}` : "",
      evidenceBucket: readPassthroughString(entity, "evidenceBucket"),
      murphV1Priority: readPassthroughString(entity, "murphV1Priority"),
      protocolTakeaway: readPassthroughString(entity, "protocolTakeaway"),
      whyItMatters: readPassthroughString(entity, "whyItMatters"),
    } as HealthCommonsCatalogEntity;
  }

  const publicEntity = {
    ...base,
    body: options.primary ? entity.body : entity.summary ?? "",
    attribution: options.primary ? entity.attribution : undefined,
    biomarker: entity.biomarker,
    claims: entity.claims,
    communityOutcomeSummary: entity.communityOutcomeSummary,
    expectedSignalDescriptions: entity.expectedSignalDescriptions,
    experimentOnboarding: entity.experimentOnboarding,
    goal: entity.goal,
    interpretationFrame: entity.interpretationFrame,
    lineage: options.primary ? entity.lineage : undefined,
    measurementContexts: entity.measurementContexts,
    measurementMethod: entity.measurementMethod,
    measurementPlan: entity.measurementPlan,
    media: readPassthroughUnknown(entity, "media"),
    mechanismChain: entity.mechanismChain,
    options: entity.options,
    profileImageUrl: readPassthroughString(entity, "profileImageUrl"),
    protocol: entity.protocol,
    researchLandscape: entity.researchLandscape,
    safety: entity.safety,
    sourceIdentity: entity.sourceIdentity,
    testPlans: entity.testPlans,
    unit: entity.unit,
    whyItWorks: entity.whyItWorks,
  };

  return Object.fromEntries(
    Object.entries(publicEntity).filter((entry) => entry[1] !== undefined),
  ) as HealthCommonsCatalogEntity;
}

function readPassthroughString(
  entity: HealthCommonsCatalogEntity,
  key: string,
): string | undefined {
  const value = (entity as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readPassthroughUnknown(
  entity: HealthCommonsCatalogEntity,
  key: string,
): unknown {
  return (entity as Record<string, unknown>)[key];
}

function sourceSnippetForEntity(
  entity: HealthCommonsCatalogEntity,
): HealthCommonsWebSourceSnippet {
  return {
    citation: entity.source?.citation ?? null,
    finding: extractPublicStudyFinding(entity.body) ?? null,
    key: entity.key,
    title: entity.source?.title ?? entity.title,
    url: entity.source?.url ?? null,
    year: entity.source?.year ?? null,
  };
}

function revisionRefForEntity(entity: HealthCommonsCatalogEntity): HealthCommonsWebRevisionRef {
  return {
    pageRevisionId: entity.revision.pageRevisionId,
    recipeHash: entity.revision.recipeHash ?? null,
    runSpecRevisionId: entity.revision.runSpecRevisionId ?? null,
    workflowSpecRevisionId: entity.revision.workflowSpecRevisionId ?? null,
  };
}

function goalRevisionRefForEntity(
  entity: HealthCommonsCatalogEntity,
): HealthCommonsWebGoalRevisionRef {
  const workflowSpecRevisionId = entity.revision.workflowSpecRevisionId;
  if (!workflowSpecRevisionId) {
    throw new Error(`Goal ${entity.key} is missing workflowSpecRevisionId.`);
  }

  return {
    ...revisionRefForEntity(entity),
    workflowSpecRevisionId,
  };
}

function buildEntityRouteIds(
  entity: HealthCommonsCatalogEntity,
  redirects: readonly HealthCommonsRedirect[],
): string[] {
  return uniqueStrings([
    entity.preferredRouteId,
    toTrailingRouteId(entity.slug),
    ...redirects.map((redirect) => toRouteIdFromKey(redirect.from)),
  ]);
}

function selectPrimaryRouteId(
  entity: HealthCommonsCatalogEntity | null,
  routeIds: readonly string[],
): string {
  if (entity?.preferredRouteId && routeIds.includes(entity.preferredRouteId)) {
    return entity.preferredRouteId;
  }

  return routeIds[0] ?? toTrailingRouteId(entity?.slug ?? "");
}

function bundlePathForEntity(entityType: HealthCommonsEntityType, routeId: string): string {
  return `bundles/${entityType}/${routeId}.json`;
}

function goalPagePathForRouteId(routeId: string): string {
  return `pages/goals/${routeId}.json`;
}

function isPublicGoalTemplate(
  entity: HealthCommonsCatalogEntity | undefined,
): entity is HealthCommonsCatalogEntity & {
  entityType: "goal_template";
  goal: HealthCommonsGoalTemplate;
  quality: string;
  safety: HealthCommonsSafety;
  status: string;
  summary: string;
} {
  return entity?.entityType === "goal_template"
    && entity.goal !== undefined
    && entity.goal.indexable
    && entity.hidden !== true
    && entity.safety !== undefined
    && entity.summary !== undefined
    && entity.quality !== undefined
    && entity.quality !== "stub"
    && isPublicStatus(entity.status);
}

function isPublishedBiomarkerIndexEntity(
  entity: HealthCommonsCatalogEntity | undefined,
): entity is HealthCommonsCatalogEntity & { entityType: "biomarker" } {
  return entity?.entityType === "biomarker"
    && isPublicStatus(entity.status)
    && entity.hidden !== true
    && hasCompleteBiomarkerAbout(entity)
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && entity.communityOutcomeSummary !== undefined;
}

const BIOMARKER_ABOUT_SLOT_TITLES: readonly (readonly string[])[] = [
  ["why murph uses it", "why people care", "why it matters"],
  [
    "how to measure it",
    "how it's measured",
    "how its measured",
    "how to read it",
    "how to read a trend",
    "lab vs wearable",
  ],
  ["what can fool it", "what moves it"],
];

function hasCompleteBiomarkerAbout(entity: HealthCommonsCatalogEntity): boolean {
  const titles = new Set(
    (entity.biomarker?.explainerCards ?? []).map((card) => normalizeAboutTitle(card.title)),
  );

  return BIOMARKER_ABOUT_SLOT_TITLES.every((slotTitles) =>
    slotTitles.some((title) => titles.has(title))
  );
}

function normalizeAboutTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function isPublicStatus(status: string | undefined): boolean {
  return status === "field-testing"
    || status === "reviewed"
    || status === "community";
}

function compareRouteEntries(
  left: HealthCommonsWebRouteIndexEntry,
  right: HealthCommonsWebRouteIndexEntry,
): number {
  const entityDelta = left.entityType.localeCompare(right.entityType);
  if (entityDelta !== 0) {
    return entityDelta;
  }

  return left.routeId.localeCompare(right.routeId);
}

function resolveRedirectTarget(
  value: string,
  redirects: readonly HealthCommonsRedirect[],
): string {
  let current = stripRevision(value);
  const seen = new Set<string>();
  const redirectsBySource = new Map(
    redirects.map((redirect) => [stripRevision(redirect.from), stripRevision(redirect.to)]),
  );

  while (redirectsBySource.has(current) && !seen.has(current)) {
    seen.add(current);
    current = redirectsBySource.get(current) ?? current;
  }

  return current;
}

function toRouteIdFromKey(key: string): string {
  return stripRevision(key).replace(/^[^:]+:/u, "").split("/").at(-1) ?? key;
}

function toTrailingRouteId(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.length > 0
  ))];
}

function extractStudyFinding(body: string): string | undefined {
  const lines = body.split("\n");
  const findingsLabel = /^\*\*Findings:\*\*\s*/u;
  const labeledSection = /^\*\*[A-Z][^*]+:\*\*/u;
  const startIndex = lines.findIndex((line) => findingsLabel.test(line.trim()));

  if (startIndex === -1) {
    return undefined;
  }

  const findingLines: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index]?.trim() ?? "";
    const line = index === startIndex ? rawLine.replace(findingsLabel, "").trim() : rawLine;

    if (!line) {
      if (findingLines.length > 0) {
        break;
      }
      continue;
    }

    if (index > startIndex && labeledSection.test(line)) {
      break;
    }

    findingLines.push(line);
  }

  const finding = findingLines.join(" ").replace(/\s+/gu, " ").trim();
  return finding || undefined;
}

function extractPublicStudyFinding(body: string): string | undefined {
  const finding = extractStudyFinding(body);
  if (!finding) {
    return undefined;
  }

  if (finding.length <= SOURCE_SNIPPET_FINDING_MAX_LENGTH) {
    return finding;
  }

  return `${finding.slice(0, SOURCE_SNIPPET_FINDING_MAX_LENGTH - 3).trimEnd()}...`;
}
