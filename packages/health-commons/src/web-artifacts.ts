import type {
  HealthCommonsCatalog,
  HealthCommonsCatalogEntity,
  HealthCommonsEntityType,
  HealthCommonsEvidenceAppraisal,
  HealthCommonsRedirect,
  HealthCommonsRelation,
  HealthCommonsResearchEvidence,
  HealthCommonsResearchLandscapeGroup,
  HealthCommonsSource,
} from "@murphai/contracts";

export const HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION =
  "murph.commons.web.route-index.v1" as const;
export const HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION =
  "murph.commons.web.route-bundle.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION =
  "murph.commons.web.experiment-index.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION =
  "murph.commons.web.biomarker-index.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION =
  "murph.commons.web.experiment-research-tab.v1" as const;

const SOURCE_SNIPPET_FINDING_MAX_LENGTH = 1_000;
const NORWEGIAN_4X4_ROUTE_ID = "norwegian-4x4";
const PARTICIPANT_STAT_LABEL = "DIRECT HUMAN PARTICIPANTS";
const ROUTE_BUNDLE_REVERSE_RELATION_TYPES = new Set<string>([
  "alias_of",
  "child_family",
  "contraindicates",
  "default_measurement_method",
  "measures",
  "measurement_upgrade",
  "optional_measurement_method",
  "parent_family",
  "primary_biomarker",
  "related_protocol",
  "secondary_biomarker",
  "safety_outcome",
]);

export interface HealthCommonsWebRouteIndexEntry {
  aliases: string[];
  bundlePath: string;
  entityType: HealthCommonsEntityType;
  key: string;
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
}

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

export interface HealthCommonsWebExperimentIndexEntry {
  aliases: string[];
  baselineDays: number;
  bundlePath: string;
  categories: string[];
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  hidden: boolean;
  image: string | null;
  key: string;
  quality: string | null;
  revision: HealthCommonsWebRevisionRef;
  routeId: string;
  slug: string;
  status: string | null;
  studyCount: number;
  summary: string | null;
  title: string;
}

export interface HealthCommonsWebExperimentIndex {
  catalogHash: string;
  experiments: HealthCommonsWebExperimentIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsWebBiomarkerIndexEntry {
  aliases: string[];
  bundlePath: string;
  categories: string[];
  hidden: boolean;
  key: string;
  published: boolean;
  quality: string | null;
  revision: HealthCommonsWebRevisionRef;
  routeId: string;
  slug: string;
  status: string | null;
  summary: string | null;
  title: string;
  unit: string | null;
}

export interface HealthCommonsWebBiomarkerIndex {
  biomarkers: HealthCommonsWebBiomarkerIndexEntry[];
  catalogHash: string;
  schemaVersion: typeof HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION;
}

export type HealthCommonsWebExperimentResearchStudyType =
  | "OBS"
  | "RCT"
  | "INT"
  | "N1"
  | "MECH"
  | "MA"
  | "REV"
  | "GUIDE"
  | "SRC";

export type HealthCommonsWebExperimentResearchStance =
  | "supports"
  | "mixed"
  | "does_not_confirm"
  | "contradicts"
  | "safety_boundary"
  | "context_only";

export type HealthCommonsWebExperimentResearchScope =
  | "direct_protocol"
  | "same_mechanism"
  | "clinical_supervised"
  | "adjacent_variant"
  | "measurement_context"
  | "general_guideline";

export type HealthCommonsWebExperimentResearchResult =
  | "positive"
  | "mixed"
  | "no_clear_advantage"
  | "negative"
  | "not_efficacy_evidence";

export interface HealthCommonsWebExperimentResearchStudy {
  authors: string;
  caveat?: string;
  designLabel?: string;
  displayPriority?: number;
  duration?: string;
  finding?: string;
  findingKind?: "finding" | "why_it_matters" | "protocol_takeaway";
  groupId?: string;
  headline?: string;
  implication?: string;
  includedStudyCount?: number;
  journal: string;
  participantCountKind?: "reported" | "approximate" | "range";
  participants?: number;
  population?: string;
  result?: HealthCommonsWebExperimentResearchResult;
  scope?: HealthCommonsWebExperimentResearchScope;
  stance?: HealthCommonsWebExperimentResearchStance;
  title: string;
  type: HealthCommonsWebExperimentResearchStudyType;
  url?: string;
  year?: number;
}

export interface HealthCommonsWebExperimentResearchGroup {
  defaultOpen?: boolean;
  id: string;
  label: string;
  stance: HealthCommonsWebExperimentResearchStance;
  studies: HealthCommonsWebExperimentResearchStudy[];
  summary: string;
}

export interface HealthCommonsWebExperimentResearchStat {
  label: string;
  value: number | string;
}

export interface HealthCommonsWebExperimentResearchLandscape {
  bottomLine: string;
  confidenceLabel: "early" | "moderate" | "strong" | "mixed" | "limited";
  mainCaveat: string;
  primaryClaim: string;
}

export interface HealthCommonsWebExperimentResearchTab {
  catalogHash: string;
  description: string;
  key: string;
  protocolKeepInMind: string[];
  researchGroups?: HealthCommonsWebExperimentResearchGroup[];
  researchLandscape?: HealthCommonsWebExperimentResearchLandscape;
  researchStats: HealthCommonsWebExperimentResearchStat[];
  revision: HealthCommonsWebRevisionRef;
  route: {
    aliases: string[];
    entityType: "protocol_variant";
    routeId: string;
    slug: string;
  };
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION;
  studies: HealthCommonsWebExperimentResearchStudy[];
  title: string;
}

export interface HealthCommonsWebGeneratedArtifacts {
  biomarkerIndex: HealthCommonsWebBiomarkerIndex;
  experimentIndex: HealthCommonsWebExperimentIndex;
  experimentResearchTabs: Map<string, HealthCommonsWebExperimentResearchTab>;
  routeBundles: Map<string, HealthCommonsWebRouteBundle>;
  routeIndex: HealthCommonsWebRouteIndex;
}

const WEB_BUNDLE_ENTITY_TYPES = new Set<HealthCommonsEntityType>([
  "biomarker",
  "measurement_method",
  "protocol_variant",
]);

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

    const routeIds = buildEntityRouteIds(entity, redirectsByTarget.get(entity.key) ?? []);
    const routeId = selectPrimaryRouteId(entity, routeIds);
    const bundlePath = bundlePathForEntity(entity.entityType, routeId);
    const aliases = routeIds.filter((candidate) => candidate !== routeId);
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
  const experimentResearchTabs = new Map<string, HealthCommonsWebExperimentResearchTab>();

  for (const bundle of routeBundles.values()) {
    if (bundle.route.entityType !== "protocol_variant") {
      continue;
    }
    const protocol = entitiesByKey.get(bundle.primaryKey);
    if (!isPublicProtocolVariant(protocol)) {
      continue;
    }

    experimentResearchTabs.set(
      experimentResearchTabPathForRouteId(bundle.route.routeId),
      buildExperimentResearchTab({
        bundle,
        entitiesByKey,
        protocol,
      }),
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
            hidden: entity.hidden === true,
            key: entity.key,
            published: isPublishedBiomarkerIndexEntity(entity),
            quality: entity.quality ?? null,
            revision: revisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            slug: entity.slug,
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
    experimentIndex: {
      catalogHash: catalog.catalogHash,
      experiments: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "protocol_variant")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!entity) {
            return [];
          }
          return [{
            aliases: bundle.route.aliases,
            baselineDays: entity.testPlans?.[0]?.baselineDays ?? 0,
            bundlePath: bundlePathForEntity(bundle.route.entityType, bundle.route.routeId),
            categories: entity.categories ?? [],
            category: formatProtocolCategory(entity),
            description: entity.summary ?? summarizeBody(entity.body),
            durationDays: entity.testPlans?.[0]?.durationDays ?? protocolSpecDurationDays(entity),
            evidenceLabel: formatEvidenceLabel(entity),
            evidenceLevel: qualityToEvidenceLevel(entity.quality ?? null),
            hidden: entity.hidden === true,
            image: resolveProtocolPageImage(entity),
            key: entity.key,
            quality: entity.quality ?? null,
            revision: revisionRefForEntity(entity),
            routeId: bundle.route.routeId,
            slug: entity.slug,
            status: entity.status ?? null,
            studyCount: countRouteBundleStudySources(bundle, entitiesByKey),
            summary: entity.summary ?? null,
            title: entity.title,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION,
    },
    experimentResearchTabs,
    routeBundles,
    routeIndex: {
      catalogHash: catalog.catalogHash,
      routes: routeEntries,
      schemaVersion: HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
    },
  };
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

function buildExperimentResearchTab(input: {
  bundle: HealthCommonsWebRouteBundle;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  protocol: HealthCommonsCatalogEntity;
}): HealthCommonsWebExperimentResearchTab {
  const evidenceAppraisals = input.bundle.evidenceAppraisals.filter((appraisal) =>
    stripRevision(appraisal.targetKey) === input.protocol.key
  );
  const directlyCitedSources = (input.protocol.relations ?? [])
    .filter((relation) => relation.type === "cites")
    .flatMap((relation) => {
      const source = input.entitiesByKey.get(stripRevision(relation.target));
      return source?.entityType === "source_artifact" ? [source] : [];
    });
  const appraisalSources = evidenceAppraisals.flatMap((appraisal) => {
    const source = input.entitiesByKey.get(stripRevision(appraisal.sourceKey));
    return source?.entityType === "source_artifact" ? [source] : [];
  });
  const landscapeSources = (input.protocol.researchLandscape?.groups ?? []).flatMap((group) =>
    group.sourceKeys.flatMap((sourceKey) => {
      const source = input.entitiesByKey.get(stripRevision(sourceKey));
      return source?.entityType === "source_artifact" ? [source] : [];
    })
  );
  const citedSources = uniqueEntities([
    ...directlyCitedSources,
    ...appraisalSources,
    ...landscapeSources,
  ]);
  const displaySources = citedSources.filter(isDisplaySource);
  const countedResearchSources = displaySources.filter(isCountedResearchSource);
  const studies = sortStudySourcesForDisplay(displaySources)
    .map((source) => toResearchStudy(
      source,
      findProtocolEvidenceAppraisal(evidenceAppraisals, source.key, input.protocol.key),
    ));
  const researchGroupBuild = toResearchGroups({
    citedStudySources: displaySources,
    evidenceAppraisals,
    protocol: input.protocol,
  });
  const hasCompleteResearchGroupCoverage =
    researchGroupBuild.groups.length > 0
    && researchGroupBuild.coveredSourceCount === researchGroupBuild.totalSourceCount;

  return {
    catalogHash: input.bundle.catalogHash,
    description: input.protocol.summary ?? summarizeBody(input.protocol.body),
    key: input.protocol.key,
    protocolKeepInMind: input.protocol.protocol?.keepInMind ?? [],
    ...(input.protocol.researchLandscape
      ? {
          researchLandscape: {
            bottomLine: input.protocol.researchLandscape.bottomLine
              ?? "The evidence base is mixed enough to read by category.",
            confidenceLabel: input.protocol.researchLandscape.confidenceLabel ?? "limited",
            mainCaveat: input.protocol.researchLandscape.mainCaveat
              ?? "Adjacent and safety sources should calibrate the claim rather than become direct proof.",
            primaryClaim: input.protocol.researchLandscape.primaryClaim
              ?? "Use the highest-quality direct sources to set the main claim.",
          },
          ...(hasCompleteResearchGroupCoverage
            ? { researchGroups: researchGroupBuild.groups }
            : {}),
        }
      : {}),
    researchStats: toResearchStats({
      countedResearchSources,
      displaySources,
      evidenceAppraisals,
      protocolKey: input.protocol.key,
      routeId: input.bundle.route.routeId,
    }),
    revision: revisionRefForEntity(input.protocol),
    route: {
      aliases: input.bundle.route.aliases,
      entityType: "protocol_variant",
      routeId: input.bundle.route.routeId,
      slug: input.protocol.slug,
    },
    schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION,
    studies,
    title: input.protocol.title,
  };
}

interface BuiltResearchGroups {
  coveredSourceCount: number;
  groups: HealthCommonsWebExperimentResearchGroup[];
  totalSourceCount: number;
}

function toResearchGroups({
  citedStudySources,
  evidenceAppraisals,
  protocol,
}: {
  citedStudySources: readonly HealthCommonsCatalogEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocol: HealthCommonsCatalogEntity;
}): BuiltResearchGroups {
  const landscapeGroups = protocol.researchLandscape?.groups ?? [];

  if (landscapeGroups.length === 0) {
    return {
      coveredSourceCount: 0,
      groups: [],
      totalSourceCount: citedStudySources.length,
    };
  }

  const sourcesByKey = new Map(citedStudySources.map((source) => [source.key, source]));
  const coveredSourceKeys = new Set<string>();
  const groups = landscapeGroups.flatMap((group) => {
    const studies = orderGroupStudySources(group, sourcesByKey, protocol.key, evidenceAppraisals)
      .flatMap((source) => {
        const appraisal = findGroupProtocolEvidenceAppraisal(
          evidenceAppraisals,
          source,
          protocol.key,
          group.id,
        );
        return appraisal ? [[source, appraisal] as const] : [];
      })
      .map(([source, appraisal]) => {
        coveredSourceKeys.add(source.key);
        return toResearchStudy(source, appraisal);
      });

    if (studies.length === 0) {
      return [];
    }

    return [{
      ...(group.defaultOpen === undefined ? {} : { defaultOpen: group.defaultOpen }),
      id: group.id,
      label: group.label,
      stance: group.stance,
      studies,
      summary: group.summary,
    }];
  });

  return {
    coveredSourceCount: coveredSourceKeys.size,
    groups,
    totalSourceCount: citedStudySources.length,
  };
}

function orderGroupStudySources(
  group: HealthCommonsResearchLandscapeGroup,
  sourcesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): HealthCommonsCatalogEntity[] {
  const fromLandscapeOrder = group.sourceKeys.flatMap((sourceKey) => {
    const source = sourcesByKey.get(stripRevision(sourceKey));
    return source ? [source] : [];
  });

  return fromLandscapeOrder.sort((left, right) => {
    const leftPriority = findStudyDisplayPriority(left, group.id, protocolKey, evidenceAppraisals);
    const rightPriority = findStudyDisplayPriority(right, group.id, protocolKey, evidenceAppraisals);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return findLandscapeSourceIndex(group.sourceKeys, left.key)
      - findLandscapeSourceIndex(group.sourceKeys, right.key);
  });
}

function findLandscapeSourceIndex(sourceKeys: readonly string[], key: string): number {
  return sourceKeys.findIndex((sourceKey) => stripRevision(sourceKey) === key);
}

function findStudyDisplayPriority(
  entity: HealthCommonsCatalogEntity,
  groupId: string,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): number {
  return findGroupProtocolEvidenceAppraisal(evidenceAppraisals, entity, protocolKey, groupId)
    ?.displayPriority ?? Number.MAX_SAFE_INTEGER;
}

function findGroupProtocolEvidenceAppraisal(
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
  entity: HealthCommonsCatalogEntity,
  protocolKey: string,
  groupId: string,
): HealthCommonsEvidenceAppraisal | undefined {
  const normalizedSourceKey = stripRevision(entity.key);
  const normalizedProtocolKey = stripRevision(protocolKey);
  return evidenceAppraisals.find((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
    && appraisal.groupId === groupId
  );
}

function findProtocolEvidenceAppraisal(
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
  sourceKey: string,
  protocolKey: string,
): HealthCommonsEvidenceAppraisal | undefined {
  const normalizedSourceKey = stripRevision(sourceKey);
  const normalizedProtocolKey = stripRevision(protocolKey);
  const matchingAppraisals = evidenceAppraisals.filter((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
  );

  return matchingAppraisals.length === 1 ? matchingAppraisals[0] : undefined;
}

function toResearchStudy(
  entity: HealthCommonsCatalogEntity,
  appraisal?: HealthCommonsEvidenceAppraisal,
): HealthCommonsWebExperimentResearchStudy {
  const source = entity.source;
  const evidence = entity.researchEvidence;
  const extractedFinding = extractPublicStudyFinding(entity.body);
  const fallbackFinding = extractedFinding
    ? undefined
    : buildStudyFindingFallback(entity, appraisal);

  return omitUndefined({
    authors: source?.authors ?? "Health Commons",
    caveat: appraisal?.caveat,
    designLabel: evidence?.designLabel ?? (evidence
      ? formatResearchDesignLabel(evidence.designKind)
      : undefined),
    displayPriority: appraisal?.displayPriority,
    duration: evidence?.durationLabel,
    finding: extractedFinding ?? fallbackFinding?.text,
    findingKind: extractedFinding ? "finding" : fallbackFinding?.kind,
    groupId: appraisal?.groupId,
    headline: appraisal?.headline,
    implication: appraisal?.implication,
    includedStudyCount: evidence?.includedStudyCount,
    journal: source?.journal ?? formatSourceSurfaceLabel(entity, source),
    participantCountKind: evidence?.participantCountKind,
    participants: evidence?.participantCount,
    population: evidence?.populationLabel,
    result: appraisal?.result,
    scope: appraisal?.scope,
    stance: appraisal?.stance,
    title: source?.title ?? entity.title,
    type: researchEvidenceToStudyType(evidence, source),
    url: source?.url,
    year: source?.year,
  });
}

function sortStudySourcesForDisplay(
  sources: readonly HealthCommonsCatalogEntity[],
): HealthCommonsCatalogEntity[] {
  return [...sources].sort((left, right) => {
    const participantDelta =
      studyParticipantSortValue(right) - studyParticipantSortValue(left);
    if (participantDelta !== 0) {
      return participantDelta;
    }

    const yearDelta = studyYearSortValue(right) - studyYearSortValue(left);
    if (yearDelta !== 0) {
      return yearDelta;
    }

    const includedStudyDelta =
      studyIncludedStudySortValue(right) - studyIncludedStudySortValue(left);
    if (includedStudyDelta !== 0) {
      return includedStudyDelta;
    }

    const rankDelta = studyDisplayRank(left) - studyDisplayRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function studyParticipantSortValue(entity: HealthCommonsCatalogEntity): number {
  return entity.researchEvidence?.participantCount ?? -1;
}

function studyYearSortValue(entity: HealthCommonsCatalogEntity): number {
  return entity.source?.year ?? -1;
}

function studyIncludedStudySortValue(entity: HealthCommonsCatalogEntity): number {
  return entity.researchEvidence?.includedStudyCount ?? -1;
}

function studyDisplayRank(entity: HealthCommonsCatalogEntity): number {
  const bucket = readPassthroughString(entity, "evidenceBucket")?.toLowerCase() ?? "";
  const priority = readPassthroughString(entity, "murphV1Priority")?.toLowerCase() ?? "";

  if (bucket.includes("evidence backbone")) {
    return 0;
  }

  if (priority === "high") {
    return 1;
  }

  if (bucket.includes("long-term finnish cohort")) {
    return 2;
  }

  if (bucket.includes("acute") || bucket.includes("mechanistic")) {
    return 3;
  }

  if (bucket.includes("intervention") || bucket.includes("reality")) {
    return 4;
  }

  if (priority === "medium") {
    return 5;
  }

  return 6;
}

function isDisplaySource(entity: HealthCommonsCatalogEntity): boolean {
  return entity.source?.kind !== undefined && entity.source.kind !== "other";
}

function isCountedResearchSource(entity: HealthCommonsCatalogEntity): boolean {
  return entity.source?.kind === "journal_article" || entity.source?.kind === "review";
}

function researchEvidenceToStudyType(
  evidence: HealthCommonsResearchEvidence | undefined,
  source: HealthCommonsSource | undefined,
): HealthCommonsWebExperimentResearchStudyType {
  switch (evidence?.designKind) {
    case "randomized_controlled_trial":
      return "RCT";
    case "single_person_report":
      return "N1";
    case "controlled_trial":
    case "crossover_trial":
    case "single_arm_trial":
    case "pilot_intervention":
      return "INT";
    case "prospective_cohort":
    case "retrospective_registry":
    case "cross_sectional":
    case "case_control":
      return "OBS";
    case "acute_mechanistic":
      return "MECH";
    case "meta_analysis":
      return "MA";
    case "systematic_review":
    case "narrative_review":
      return "REV";
    case "guideline":
    case "expert_protocol":
      return "GUIDE";
    case "bibliography":
    case "other":
      return "SRC";
    case undefined:
      break;
  }

  return sourceKindToStudyType(source);
}

function sourceKindToStudyType(
  source: HealthCommonsSource | undefined,
): HealthCommonsWebExperimentResearchStudyType {
  if (!source) {
    return "SRC";
  }

  if (source.kind === "guideline" || source.kind === "external_protocol") {
    return "GUIDE";
  }

  if (source.kind === "review") {
    const title = source.title?.toLowerCase() ?? "";
    return title.includes("meta-analysis") || title.includes("meta analysis") ? "MA" : "REV";
  }

  if (source.kind === "journal_article") {
    const studyText = [source.title, source.journal]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();

    if (
      studyText.includes("randomized") ||
      studyText.includes("randomised") ||
      studyText.includes("controlled trial")
    ) {
      return "RCT";
    }

    if (
      studyText.includes("cohort") ||
      studyText.includes("association") ||
      studyText.includes("observational")
    ) {
      return "OBS";
    }
  }

  return "SRC";
}

function formatSourceSurfaceLabel(
  entity: HealthCommonsCatalogEntity,
  source: HealthCommonsSource | undefined,
): string {
  if (!source) {
    return formatCategory(entity.entityType);
  }

  if (source.kind !== "web_page") {
    return formatCategory(source.kind);
  }

  const categories = new Set((entity.categories ?? []).map((category) => category.toLowerCase()));
  const url = source.url?.toLowerCase() ?? "";

  if (
    categories.has("x-post") ||
    url.includes("://x.com/") ||
    url.includes("://twitter.com/")
  ) {
    return "X Post";
  }

  if (
    categories.has("linkedin") ||
    url.includes("://www.linkedin.com/") ||
    url.includes("://linkedin.com/")
  ) {
    return "LinkedIn Post";
  }

  if (categories.has("substack") || url.includes(".substack.com/")) {
    return "Substack Post";
  }

  if (categories.has("blueprint") || url.includes("://blueprint.bryanjohnson.com/")) {
    return "Blueprint Page";
  }

  return "Web Page";
}

function toResearchStats({
  countedResearchSources,
  displaySources,
  evidenceAppraisals,
  protocolKey,
  routeId,
}: {
  countedResearchSources: readonly HealthCommonsCatalogEntity[];
  displaySources: readonly HealthCommonsCatalogEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocolKey: string;
  routeId: string;
}): HealthCommonsWebExperimentResearchStat[] {
  const participantCountSources = routeId === NORWEGIAN_4X4_ROUTE_ID
    ? countedResearchSources.filter((entity) =>
        !isExcludedNorwegianParticipantCountSource(entity, protocolKey, evidenceAppraisals)
      )
    : countedResearchSources;
  const mixedResearchAndProvenance =
    countedResearchSources.length > 0 && countedResearchSources.length < displaySources.length;
  const statsSources = mixedResearchAndProvenance ? countedResearchSources : displaySources;
  const reviewCount = statsSources.filter((entity) => entity.source?.kind === "review").length;
  const journalArticleCount = statsSources.filter(
    (entity) => entity.source?.kind === "journal_article",
  ).length;
  const codedParticipantCount = sumPrimaryParticipantCount(participantCountSources);
  const codedParticipantStats = codedParticipantCount > 0
    ? [{
        label: PARTICIPANT_STAT_LABEL,
        value: codedParticipantCount === 1 ? "1" : `${codedParticipantCount.toLocaleString()}+`,
      }]
    : [];
  const years = statsSources
    .map((entity) => entity.source?.year)
    .filter((year): year is number => typeof year === "number")
    .sort((left, right) => left - right);
  const researchYears =
    years.length === 0
      ? "\u2014"
      : years[0] === years[years.length - 1]
        ? `${years[0]}`
        : `${years[0]}\u2013${years[years.length - 1]}`;

  return [
    { label: "SOURCES CHECKED", value: displaySources.length },
    ...codedParticipantStats,
    { label: "REVIEW PAPERS", value: reviewCount },
    { label: "RESEARCH PAPERS", value: journalArticleCount },
    { label: "YEARS COVERED", value: researchYears },
  ];
}

function sumPrimaryParticipantCount(
  citedSources: readonly HealthCommonsCatalogEntity[],
): number {
  const countsByCohort = new Map<string, number>();

  for (const entity of citedSources) {
    const evidence = entity.researchEvidence;
    if (
      evidence?.aggregateRole !== "primary" ||
      typeof evidence.participantCount !== "number"
    ) {
      continue;
    }

    const cohortKey = evidence.cohortKey ?? entity.key;
    const existingCount = countsByCohort.get(cohortKey) ?? 0;
    countsByCohort.set(cohortKey, Math.max(existingCount, evidence.participantCount));
  }

  return [...countsByCohort.values()].reduce((sum, count) => sum + count, 0);
}

function isExcludedNorwegianParticipantCountSource(
  entity: HealthCommonsCatalogEntity,
  protocolKey: string,
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[],
): boolean {
  const evidence = entity.researchEvidence;

  if (
    evidence?.aggregateRole !== "primary" ||
    evidence.designKind !== "retrospective_registry"
  ) {
    return false;
  }

  const normalizedSourceKey = stripRevision(entity.key);
  const normalizedProtocolKey = stripRevision(protocolKey);
  return evidenceAppraisals.some((appraisal) =>
    stripRevision(appraisal.sourceKey) === normalizedSourceKey
    && stripRevision(appraisal.targetKey) === normalizedProtocolKey
    && appraisal.stance === "safety_boundary"
  );
}

function buildStudyFindingFallback(
  entity: HealthCommonsCatalogEntity,
  appraisal: HealthCommonsEvidenceAppraisal | undefined,
): {
  kind: HealthCommonsWebExperimentResearchStudy["findingKind"];
  text: string;
} | undefined {
  const headline = normalizeStudyCardText(appraisal?.headline);
  const whyItMatters = normalizeStudyCardText(readPassthroughString(entity, "whyItMatters"));
  if (whyItMatters && whyItMatters !== headline) {
    return {
      kind: "why_it_matters",
      text: whyItMatters,
    };
  }

  const protocolTakeaway = normalizeStudyCardText(readPassthroughString(entity, "protocolTakeaway"));
  if (protocolTakeaway && protocolTakeaway !== headline && protocolTakeaway !== whyItMatters) {
    return {
      kind: "protocol_takeaway",
      text: protocolTakeaway,
    };
  }

  return undefined;
}

function normalizeStudyCardText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized ? normalized : undefined;
}

function formatResearchDesignLabel(
  designKind: HealthCommonsResearchEvidence["designKind"],
): string {
  return designKind
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function uniqueEntities(entities: readonly HealthCommonsCatalogEntity[]): HealthCommonsCatalogEntity[] {
  const seen = new Set<string>();
  const result: HealthCommonsCatalogEntity[] = [];

  for (const entity of entities) {
    if (seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    result.push(entity);
  }

  return result;
}

function isPublicProtocolVariant(
  entity: HealthCommonsCatalogEntity | undefined,
): entity is HealthCommonsCatalogEntity & { entityType: "protocol_variant" } {
  return entity?.entityType === "protocol_variant"
    && entity.status !== "deprecated"
    && entity.hidden !== true;
}

function experimentResearchTabPathForRouteId(routeId: string): string {
  return `tabs/experiments/${routeId}/research.json`;
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
    if (entitiesByKey.has(stripped)) {
      keys.add(stripped);
    }
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

  for (const plan of primary.testPlans ?? []) {
    addKey(plan.primaryBiomarkerKey);
    for (const key of plan.secondaryBiomarkerKeys ?? []) {
      addKey(key);
    }
    for (const key of plan.safetyOutcomeKeys ?? []) {
      addKey(key);
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

  for (const signal of primary.expectedSignalDescriptions ?? []) {
    addKey(signal.biomarkerKey);
  }

  if (primary.entityType === "biomarker") {
    for (const candidate of primary.protocolRanking?.candidates ?? []) {
      addKey(candidate.protocolKey);
    }

    for (const entity of catalog.entities) {
      const referencesBiomarker = (entity.relations ?? []).some(
        (relation) => stripRevision(relation.target) === primary.key,
      );
      const testPlanReferencesBiomarker = (entity.testPlans ?? []).some((plan) =>
        plan.primaryBiomarkerKey === primary.key ||
        (plan.secondaryBiomarkerKeys ?? []).includes(primary.key)
      );

      if (referencesBiomarker || testPlanReferencesBiomarker) {
        addKey(entity.key);
      }
    }
  }

  for (const appraisal of catalog.evidenceAppraisals) {
    if (stripRevision(appraisal.targetKey) === primary.key) {
      addKey(appraisal.sourceKey);
    }
  }

  return keys;
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
    interpretationFrame: entity.interpretationFrame,
    lineage: options.primary ? entity.lineage : undefined,
    measurementContexts: entity.measurementContexts,
    measurementMethod: entity.measurementMethod,
    measurementPlan: entity.measurementPlan,
    media: readPassthroughUnknown(entity, "media"),
    options: entity.options,
    profileImageUrl: readPassthroughString(entity, "profileImageUrl"),
    protocol: entity.protocol,
    protocolRanking: entity.protocolRanking,
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
  };
}

function buildEntityRouteIds(
  entity: HealthCommonsCatalogEntity,
  redirects: readonly HealthCommonsRedirect[],
): string[] {
  return uniqueStrings([
    toTrailingRouteId(entity.slug),
    ...redirects.map((redirect) => toRouteIdFromKey(redirect.from)),
  ]);
}

function selectPrimaryRouteId(
  entity: HealthCommonsCatalogEntity | null,
  routeIds: readonly string[],
): string {
  if (entity?.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week") {
    return "finnish-sauna";
  }

  return routeIds[0] ?? toTrailingRouteId(entity?.slug ?? "");
}

function bundlePathForEntity(entityType: HealthCommonsEntityType, routeId: string): string {
  return `bundles/${entityType}/${routeId}.json`;
}

function isPublishedBiomarkerIndexEntity(entity: HealthCommonsCatalogEntity): boolean {
  return entity.entityType === "biomarker"
    && entity.status !== "deprecated"
    && entity.hidden !== true
    && (entity.biomarker?.explainerCards?.length ?? 0) > 0
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && (entity.protocolRanking?.candidates?.length ?? 0) > 0
    && entity.communityOutcomeSummary !== undefined
    && (entity.biomarker?.privateMetricBindings?.some((binding) =>
      binding.source === "browser_vault_metric"
      && typeof binding.domain === "string"
      && typeof binding.metric === "string"
    ) ?? false);
}

function formatProtocolCategory(entity: HealthCommonsCatalogEntity): string {
  const categories = entity.categories ?? [];

  if (categories.includes("sleep") || categories.includes("circadian")) {
    return "Sleep";
  }

  if (
    categories.includes("exercise") ||
    categories.includes("hiit") ||
    categories.includes("vo2max")
  ) {
    return "Exercise";
  }

  if (
    categories.includes("recovery") ||
    categories.includes("dry-sauna") ||
    categories.includes("passive-heat")
  ) {
    return "Recovery";
  }

  return formatCategory(categories[0] ?? entity.entityType);
}

function formatEvidenceLabel(entity: HealthCommonsCatalogEntity): string {
  const status = STATUS_LABELS[entity.status ?? ""];
  const quality = QUALITY_LABELS[entity.quality ?? ""];

  if (status && quality) {
    return `${status} / ${quality}`;
  }

  return status ?? quality ?? "Draft / Stub";
}

function qualityToEvidenceLevel(quality: string | null): number {
  return QUALITY_TO_EVIDENCE_LEVEL[quality ?? ""] ?? 2;
}

function protocolSpecDurationDays(entity: HealthCommonsCatalogEntity): number {
  const duration = entity.protocol?.durationMinutes;

  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    return Math.max(1, Math.ceil(duration / (60 * 24)));
  }

  return 14;
}

function countRouteBundleStudySources(
  bundle: HealthCommonsWebRouteBundle,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): number {
  return Object.keys(bundle.sourceSnippets).filter((sourceKey) => {
    const source = entitiesByKey.get(sourceKey);
    return source?.source?.kind === "journal_article" || source?.source?.kind === "review";
  }).length;
}

function resolveProtocolPageImage(entity: HealthCommonsCatalogEntity): string | null {
  const media = readPassthroughUnknown(entity, "media");
  if (!Array.isArray(media)) {
    return null;
  }

  const image = media.find((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      record["kind"] === "photo" ||
      record["kind"] === "image" ||
      (typeof record["mediaType"] === "string" && record["mediaType"].startsWith("image/"))
    ) && typeof record["relativePath"] === "string" && record["relativePath"].length > 0;
  }) as Record<string, unknown> | undefined;

  const relativePath = image?.["relativePath"];
  if (typeof relativePath !== "string") {
    return null;
  }

  return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
}

function formatCategory(value: string): string {
  return value
    .split(/[._/-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function summarizeBody(body: string): string {
  const normalized = body
    .split("\n")
    .map((line) => line.replace(/^#+\s+/u, "").trim())
    .filter(Boolean)
    .join(" ");

  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
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

const QUALITY_TO_EVIDENCE_LEVEL: Record<string, number> = {
  stub: 1,
  usable: 3,
  reviewed: 4,
  excellent: 5,
};

const STATUS_LABELS: Record<string, string> = {
  community: "Community",
  deprecated: "Deprecated",
  draft: "Draft",
  "field-testing": "Field testing",
  reviewed: "Reviewed",
};

const QUALITY_LABELS: Record<string, string> = {
  excellent: "Excellent",
  reviewed: "Reviewed",
  stub: "Stub",
  usable: "Usable",
};
