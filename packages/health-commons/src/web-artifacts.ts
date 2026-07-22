import type {
  HealthCommonsCatalog,
  HealthCommonsBiomarkerFallbackRange,
  HealthCommonsBiomarkerDesiredDirection,
  HealthCommonsBiomarkerProtocolExpectedDirection,
  HealthCommonsCatalogEntity,
  HealthCommonsClaim,
  HealthCommonsEntityType,
  HealthCommonsEvidenceAppraisal,
  HealthCommonsMeasurementMethod,
  HealthCommonsMeasurementPlanPath,
  HealthCommonsMechanismChainStep,
  HealthCommonsRedirect,
  HealthCommonsRelation,
  HealthCommonsProtocolSpec,
  HealthCommonsProtocolSessionShape,
  HealthCommonsResearchEvidence,
  HealthCommonsResearchLandscapeGroup,
  HealthCommonsSafety,
  HealthCommonsSource,
  HealthCommonsTestPlan,
} from "@murphai/contracts";

import {
  buildHealthCommonsWebBiomarkerOverview,
  buildHealthCommonsWebBiomarkerResearch,
  buildHealthCommonsWebBiomarkerShell,
  resolveHealthCommonsWebBiomarkerShortName,
  type HealthCommonsWebBiomarkerProjectionArtifact,
  type HealthCommonsWebBiomarkerProjectionKey,
} from "./biomarker-web-artifacts.ts";
import { isRunnableProtocolStatus } from "./protocol-publishing.ts";

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
export const HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION =
  "murph.commons.web.experiment-index.v1" as const;
export const HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION =
  "murph.commons.web.biomarker-index.v2" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION =
  "murph.commons.web.experiment-research-tab.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION =
  "murph.commons.web.experiment-shell.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION =
  "murph.commons.web.experiment-protocol-tab.v1" as const;
export const HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION =
  "murph.commons.web.experiment-results-public.v1" as const;

export type HealthCommonsWebProjectionKey =
  | "experiment.shell"
  | "experiment.protocol"
  | "experiment.research"
  | "experiment.results-public"
  | HealthCommonsWebBiomarkerProjectionKey;

const SOURCE_SNIPPET_FINDING_MAX_LENGTH = 1_000;
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
  sortRank?: number | null;
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
  desiredDirection: HealthCommonsBiomarkerDesiredDirection | null;
  fallbackRanges: HealthCommonsWebBiomarkerFallbackRange[];
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
  "applicability" | "label" | "lowerBound" | "unit" | "upperBound"
>;

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

export interface HealthCommonsWebExperimentCommonsReference {
  aliases: string[];
  catalogHash: string;
  key: string;
  pageRevisionId: string;
  recipeHash: string | null;
  routeId: string;
  runSpecRevisionId: string | null;
  slug: string;
}

export interface HealthCommonsWebExperimentShell {
  baselineDays: number;
  catalogHash: string;
  category: string;
  description: string;
  durationDays: number;
  evidenceLabel: string;
  evidenceLevel: number;
  id: string;
  image: string | null;
  key: string;
  revision: HealthCommonsWebRevisionRef;
  route: {
    aliases: string[];
    entityType: "protocol_variant";
    routeId: string;
    slug: string;
  };
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION;
  title: string;
}

export interface HealthCommonsWebExperimentSignal {
  baseline?: string;
  biomarkerRouteId?: string;
  delta: string;
  description?: string;
  direction: "up" | "down" | "neutral";
  displayValue?: string;
  estimatedChange?: HealthCommonsWebExperimentSignalEstimatedChange;
  expected: string;
  label: string;
  protocolProminence?: "focus" | "context";
  unit?: string;
  value: string;
}

export type HealthCommonsWebExperimentSignalEstimatedChange =
  | {
      basis?: string;
      confidence?: "low" | "moderate" | "high" | "mixed";
      high: number;
      kind: "absolute" | "relative_percent";
      low: number;
      unit: string;
      window?: string;
    }
  | {
      basis?: string;
      confidence?: "low" | "moderate" | "high" | "mixed";
      kind: "mixed_or_contextual";
      window?: string;
    };

export interface HealthCommonsWebExperimentMeasurementMethodReference {
  href?: string;
  key: string;
  modalities: string[];
  privacy?: {
    containsIdentifiableImages?: boolean;
    localOnlyRecommended?: boolean;
    notes: string[];
  };
  routeId?: string;
  shortName: string;
  summary?: string;
  tier: HealthCommonsMeasurementMethod["tier"];
  title: string;
}

export interface HealthCommonsWebExperimentMeasurementPath {
  isDefault: boolean;
  label: string;
  methodKeys: string[];
  methods: HealthCommonsWebExperimentMeasurementMethodReference[];
  notes: string[];
  outcomeLabels: string[];
  pathId: string;
  required: boolean;
  safetyOutcomeLabels: string[];
  tier: HealthCommonsMeasurementMethod["tier"];
}

export interface HealthCommonsWebExperimentProtocolFact {
  detail?: string;
  label: string;
  value: string;
}

export interface HealthCommonsWebExperimentProtocolStep {
  detail: string;
  number: number;
  title: string;
}

export interface HealthCommonsWebExperimentMechanismChainStep {
  content: string;
  label: string;
}

export interface HealthCommonsWebExperimentExpert {
  field: string;
  initials: string;
  name: string;
  profileImageUrl?: string;
  quote: string;
}

export interface HealthCommonsWebExperimentSafety {
  cautionLevel: number;
  precautions: string[];
  whoShouldAvoid: string[];
}

export type HealthCommonsWebExperimentSessionShape = HealthCommonsProtocolSessionShape;

export interface HealthCommonsWebExperimentProtocolTab {
  baselineDays: number;
  catalogHash: string;
  durationDays: number;
  expectedSignals: HealthCommonsWebExperimentSignal[];
  experts: HealthCommonsWebExperimentExpert[];
  id: string;
  key: string;
  measurementPaths: HealthCommonsWebExperimentMeasurementPath[];
  mechanismChain: HealthCommonsWebExperimentMechanismChainStep[];
  protocol: HealthCommonsWebExperimentProtocolStep[];
  protocolFacts: HealthCommonsWebExperimentProtocolFact[];
  protocolTips: string[];
  revision: HealthCommonsWebRevisionRef;
  route: {
    aliases: string[];
    entityType: "protocol_variant";
    routeId: string;
    slug: string;
  };
  safety: HealthCommonsWebExperimentSafety;
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION;
  sessionShape?: HealthCommonsWebExperimentSessionShape;
  title: string;
  whyItWorks: string;
}

export interface HealthCommonsWebExperimentResultsPublic {
  baselineDays: number;
  catalogHash: string;
  commons: HealthCommonsWebExperimentCommonsReference;
  durationDays: number;
  id: string;
  key: string;
  protocol: HealthCommonsWebExperimentProtocolStep[];
  revision: HealthCommonsWebRevisionRef;
  route: {
    aliases: string[];
    entityType: "protocol_variant";
    routeId: string;
    slug: string;
  };
  schemaVersion: typeof HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION;
  title: string;
}

export type HealthCommonsWebExperimentProjectionArtifact =
  | HealthCommonsWebExperimentProtocolTab
  | HealthCommonsWebExperimentResearchTab
  | HealthCommonsWebExperimentResultsPublic
  | HealthCommonsWebExperimentShell;

export type HealthCommonsWebProjectionArtifact =
  | HealthCommonsWebBiomarkerProjectionArtifact
  | HealthCommonsWebExperimentProjectionArtifact;

export interface HealthCommonsWebGeneratedArtifacts {
  biomarkerIndex: HealthCommonsWebBiomarkerIndex;
  experimentIndex: HealthCommonsWebExperimentIndex;
  projectionArtifacts: Map<string, HealthCommonsWebProjectionArtifact>;
  routeBundles: Map<string, HealthCommonsWebRouteBundle>;
  routeIndex: HealthCommonsWebRouteIndex;
}

const WEB_BUNDLE_ENTITY_TYPES = new Set<HealthCommonsEntityType>([
  "biomarker",
  "measurement_method",
  "protocol_variant",
]);
type HealthCommonsWebExperimentProjectionSpec = {
  buildArtifact: (input: {
    bundle: HealthCommonsWebRouteBundle;
    entitiesByKey: Map<string, HealthCommonsCatalogEntity>;
    protocol: HealthCommonsCatalogEntity & { entityType: "protocol_variant" };
  }) => HealthCommonsWebExperimentProjectionArtifact;
  key: HealthCommonsWebProjectionKey;
  pathForRouteId: (routeId: string) => string;
};

const EXPERIMENT_PROJECTION_SPECS: readonly HealthCommonsWebExperimentProjectionSpec[] = [
  {
    buildArtifact: ({ bundle, protocol }) => buildExperimentShell({ bundle, protocol }),
    key: "experiment.shell",
    pathForRouteId: (routeId) => `shell/experiments/${routeId}.json`,
  },
  {
    buildArtifact: ({ bundle, entitiesByKey, protocol }) =>
      buildExperimentProtocolTab({ bundle, entitiesByKey, protocol }),
    key: "experiment.protocol",
    pathForRouteId: (routeId) => `tabs/experiments/${routeId}/protocol.json`,
  },
  {
    buildArtifact: ({ bundle, entitiesByKey, protocol }) =>
      buildExperimentResearchTab({ bundle, entitiesByKey, protocol }),
    key: "experiment.research",
    pathForRouteId: (routeId) => `tabs/experiments/${routeId}/research.json`,
  },
  {
    buildArtifact: ({ bundle, protocol }) => buildExperimentResultsPublic({ bundle, protocol }),
    key: "experiment.results-public",
    pathForRouteId: (routeId) => `tabs/experiments/${routeId}/results-public.json`,
  },
];

function projectionPathsForPublishedBiomarkerRoute(
  entity: HealthCommonsCatalogEntity,
  routeId: string,
  allEntities: Iterable<HealthCommonsCatalogEntity>,
): Partial<Record<HealthCommonsWebProjectionKey, string>> | undefined {
  if (
    entity.entityType !== "biomarker"
    || !isPublishedBiomarkerIndexEntity(entity, allEntities)
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
  const routeIdByEntityKey = new Map<string, string>();

  for (const entity of catalog.entities) {
    if (!WEB_BUNDLE_ENTITY_TYPES.has(entity.entityType)) {
      continue;
    }
    if (entity.entityType === "protocol_variant" && !isPublicProtocolVariant(entity)) {
      continue;
    }

    const routeIds = buildEntityRouteIds(entity, redirectsByTarget.get(entity.key) ?? []);
    const routeId = selectPrimaryRouteId(entity, routeIds);
    routeIdByEntityKey.set(entity.key, routeId);
    const bundlePath = bundlePathForEntity(entity.entityType, routeId);
    const aliases = routeIds.filter((candidate) => candidate !== routeId);
    const projections = projectionPathsForRoute(entity, routeId)
      ?? projectionPathsForPublishedBiomarkerRoute(entity, routeId, entitiesByKey.values());
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

  for (const bundle of routeBundles.values()) {
    if (bundle.route.entityType !== "protocol_variant") {
      continue;
    }
    const protocol = entitiesByKey.get(bundle.primaryKey);
    if (!isPublicProtocolVariant(protocol)) {
      continue;
    }

    for (const spec of EXPERIMENT_PROJECTION_SPECS) {
      projectionArtifacts.set(
        spec.pathForRouteId(bundle.route.routeId),
        spec.buildArtifact({
          bundle,
          entitiesByKey,
          protocol,
        }),
      );
    }
  }

  for (const bundle of routeBundles.values()) {
    if (bundle.route.entityType !== "biomarker") {
      continue;
    }
    const biomarker = entitiesByKey.get(bundle.primaryKey);
    if (
      biomarker?.entityType !== "biomarker"
      || !isPublishedBiomarkerIndexEntity(biomarker, entitiesByKey.values())
    ) {
      continue;
    }

    const buildInput = {
      biomarker,
      catalogHash: catalog.catalogHash,
      entitiesByKey,
      routeAliases: bundle.route.aliases,
      routeId: bundle.route.routeId,
      routeIdByEntityKey,
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
            fallbackRanges: entity.referenceGuidance?.fallbackRanges?.map((range) => ({
              applicability: range.applicability,
              label: range.label,
              ...(range.lowerBound ? { lowerBound: range.lowerBound } : {}),
              unit: range.unit,
              ...(range.upperBound ? { upperBound: range.upperBound } : {}),
            })) ?? [],
            hidden: entity.hidden === true,
            key: entity.key,
            published: isPublishedBiomarkerIndexEntity(entity, entitiesByKey.values()),
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
    experimentIndex: {
      catalogHash: catalog.catalogHash,
      experiments: [...routeBundles.values()]
        .filter((bundle) => bundle.route.entityType === "protocol_variant")
        .flatMap((bundle) => {
          const entity = entitiesByKey.get(bundle.primaryKey);
          if (!isPublicProtocolVariant(entity)) {
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
            sortRank: entity.sortRank ?? null,
            status: entity.status ?? null,
            studyCount: countRouteBundleStudySources(bundle, entitiesByKey),
            summary: entity.summary ?? null,
            title: entity.title,
          }];
        })
        .sort((left, right) => left.title.localeCompare(right.title)),
      schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION,
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

function buildRouteBundle(input: {
  catalog: HealthCommonsCatalog;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  primary: HealthCommonsCatalogEntity;
  redirects: readonly HealthCommonsRedirect[];
  routeAliases: readonly string[];
  routeId: string;
}): HealthCommonsWebRouteBundle {
  const closureKeys = collectRouteClosureKeys(input.primary, input.catalog, input.entitiesByKey);
  const reverseEdges = collectRouteReverseEdges(input.catalog, new Set([input.primary.key]))
    .filter((edge) => shouldIncludeReverseEdgeSource(edge, input.entitiesByKey));
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

function buildExperimentShell(input: {
  bundle: HealthCommonsWebRouteBundle;
  protocol: HealthCommonsCatalogEntity;
}): HealthCommonsWebExperimentShell {
  const testPlan = input.protocol.testPlans?.[0] ?? null;

  return {
    baselineDays: testPlan?.baselineDays ?? 0,
    catalogHash: input.bundle.catalogHash,
    category: formatProtocolCategory(input.protocol),
    description: input.protocol.summary ?? summarizeBody(input.protocol.body),
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(input.protocol),
    evidenceLabel: formatDetailEvidenceLabel(input.protocol),
    evidenceLevel: qualityToEvidenceLevel(input.protocol.quality ?? null),
    id: input.bundle.route.routeId,
    image: resolveProtocolPageImage(input.protocol),
    key: input.protocol.key,
    revision: revisionRefForEntity(input.protocol),
    route: {
      aliases: input.bundle.route.aliases,
      entityType: "protocol_variant",
      routeId: input.bundle.route.routeId,
      slug: input.protocol.slug,
    },
    schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION,
    title: input.protocol.title,
  };
}

function buildExperimentProtocolTab(input: {
  bundle: HealthCommonsWebRouteBundle;
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  protocol: HealthCommonsCatalogEntity;
}): HealthCommonsWebExperimentProtocolTab {
  const testPlan = input.protocol.testPlans?.[0] ?? null;
  const biomarkerEntities = listProtocolBiomarkers(input.protocol, input.entitiesByKey);
  const sourcePeople = listRelatedEntities({
    entitiesByKey: input.entitiesByKey,
    entity: input.protocol,
    entityTypes: ["source_person"],
    relationTypes: ["source_person"],
  });

  return {
    baselineDays: testPlan?.baselineDays ?? 0,
    catalogHash: input.bundle.catalogHash,
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(input.protocol),
    expectedSignals: biomarkerEntities.map((biomarker) =>
      toExpectedSignal(input.protocol, biomarker)
    ),
    experts: sourcePeople.map(toExpert),
    id: input.bundle.route.routeId,
    key: input.protocol.key,
    measurementPaths: toMeasurementPaths(input.protocol, input.entitiesByKey),
    mechanismChain: toMechanismChain(input.protocol.mechanismChain),
    protocol: toProtocolSteps(input.protocol.protocol),
    protocolFacts: toProtocolFacts(input.protocol.protocol, testPlan),
    protocolTips: input.protocol.protocol?.tips ?? [],
    revision: revisionRefForEntity(input.protocol),
    route: {
      aliases: input.bundle.route.aliases,
      entityType: "protocol_variant",
      routeId: input.bundle.route.routeId,
      slug: input.protocol.slug,
    },
    safety: toSafety(input.protocol.safety),
    schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION,
    ...(input.protocol.protocol?.sessionShape
      ? { sessionShape: toSessionShape(input.protocol.protocol.sessionShape) }
      : {}),
    title: input.protocol.title,
    whyItWorks: toWhyItWorks(input.protocol, input.protocol.claims ?? []),
  };
}

function buildExperimentResultsPublic(input: {
  bundle: HealthCommonsWebRouteBundle;
  protocol: HealthCommonsCatalogEntity;
}): HealthCommonsWebExperimentResultsPublic {
  const testPlan = input.protocol.testPlans?.[0] ?? null;
  const revision = revisionRefForEntity(input.protocol);

  return {
    baselineDays: testPlan?.baselineDays ?? 0,
    catalogHash: input.bundle.catalogHash,
    commons: buildExperimentCommonsReference({
      bundle: input.bundle,
      protocol: input.protocol,
      revision,
    }),
    durationDays: testPlan?.durationDays ?? protocolSpecDurationDays(input.protocol),
    id: input.bundle.route.routeId,
    key: input.protocol.key,
    protocol: toProtocolSteps(input.protocol.protocol),
    revision,
    route: {
      aliases: input.bundle.route.aliases,
      entityType: "protocol_variant",
      routeId: input.bundle.route.routeId,
      slug: input.protocol.slug,
    },
    schemaVersion: HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION,
    title: input.protocol.title,
  };
}

function buildExperimentCommonsReference(input: {
  bundle: HealthCommonsWebRouteBundle;
  protocol: HealthCommonsCatalogEntity;
  revision: HealthCommonsWebRevisionRef;
}): HealthCommonsWebExperimentCommonsReference {
  return {
    aliases: uniqueStrings([
      input.bundle.route.routeId,
      input.protocol.key,
      input.protocol.key.replace(/^protocol_variant:/u, ""),
      input.protocol.slug,
      input.protocol.slug.split("/").at(-1) ?? null,
      ...input.bundle.route.aliases,
    ]),
    catalogHash: input.bundle.catalogHash,
    key: input.protocol.key,
    pageRevisionId: input.revision.pageRevisionId,
    recipeHash: input.revision.recipeHash ?? null,
    routeId: input.bundle.route.routeId,
    runSpecRevisionId: input.revision.runSpecRevisionId ?? null,
    slug: input.protocol.slug,
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

type ExperimentSignalDirection = HealthCommonsWebExperimentSignal["direction"];
type ExperimentSignalProminence = NonNullable<
  HealthCommonsWebExperimentSignal["protocolProminence"]
>;

interface BiomarkerDisplayHint {
  description?: string;
  direction: ExperimentSignalDirection;
  expected: string;
  protocolProminence?: ExperimentSignalProminence;
}

const DEFAULT_BIOMARKER_DISPLAY_HINTS: Record<string, BiomarkerDisplayHint> = {
  "biomarker:deep-sleep-minutes": {
    direction: "neutral",
    expected: "Worth watching",
  },
  "biomarker:estimated-vo2max": {
    direction: "up",
    expected: "Could improve",
  },
  "biomarker:hrv-rmssd": {
    direction: "neutral",
    expected: "Worth watching",
  },
  "biomarker:morning-blood-pressure": {
    direction: "down",
    expected: "Could trend lower",
  },
  "biomarker:resting-heart-rate": {
    direction: "down",
    expected: "Could trend lower",
  },
  "biomarker:sleep-efficiency": {
    direction: "up",
    expected: "Could improve",
  },
  "biomarker:sleep-onset-latency": {
    direction: "down",
    expected: "May fall asleep sooner",
  },
};

function listProtocolBiomarkers(
  protocol: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsCatalogEntity[] {
  const protocolKeys = listProtocolBiomarkerKeys(protocol);
  const fromAuthoredSignals = protocolKeys.flatMap((key) => {
    const entity = entitiesByKey.get(stripRevision(key));
    return entity?.entityType === "biomarker" ? [entity] : [];
  });

  if (fromAuthoredSignals.length > 0) {
    return fromAuthoredSignals;
  }

  return listRelatedEntities({
    entitiesByKey,
    entity: protocol,
    entityTypes: ["biomarker"],
    relationTypes: ["primary_biomarker", "secondary_biomarker"],
  });
}

function listProtocolBiomarkerKeys(protocol: HealthCommonsCatalogEntity): string[] {
  const testPlan = protocol.testPlans?.[0];

  return uniqueStrings([
    ...(protocol.expectedSignalDescriptions ?? []).map((signal) => signal.biomarkerKey),
    testPlan?.primaryBiomarkerKey,
    ...(testPlan?.secondaryBiomarkerKeys ?? []),
    ...(testPlan?.safetyOutcomeKeys ?? []),
  ]);
}

function listRelatedEntities(input: {
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  entity: HealthCommonsCatalogEntity;
  entityTypes?: readonly HealthCommonsEntityType[];
  relationTypes?: readonly string[];
}): HealthCommonsCatalogEntity[] {
  const entityTypes = input.entityTypes ? new Set(input.entityTypes) : null;
  const relationTypes = input.relationTypes ? new Set(input.relationTypes) : null;

  return (input.entity.relations ?? []).flatMap((relation) => {
    if (relationTypes && !relationTypes.has(relation.type)) {
      return [];
    }
    const target = input.entitiesByKey.get(stripRevision(relation.target));
    if (!target) {
      return [];
    }
    if (entityTypes && !entityTypes.has(target.entityType)) {
      return [];
    }
    return [target];
  });
}

function toExpectedSignal(
  protocol: HealthCommonsCatalogEntity,
  biomarker: HealthCommonsCatalogEntity,
): HealthCommonsWebExperimentSignal {
  const hint = resolveBiomarkerDisplayHint(biomarker);
  const protocolSignal = protocol.expectedSignalDescriptions?.find(
    (signal) => stripRevision(signal.biomarkerKey) === stripRevision(biomarker.key),
  );
  const protocolProminence =
    protocolSignal?.protocolProminence ?? hint.protocolProminence;
  const direction =
    directionForExpectedSignal(protocolSignal?.expectedDirection)
    ?? directionForExpectedSignal(protocolSignal?.expected)
    ?? hint.direction;
  const expected = normalizeExpectedSignalLabel(
    protocolSignal?.expected
    ?? expectedLabelForExpectedSignal(protocolSignal?.expectedDirection)
    ?? hint.expected,
  );

  return omitUndefined({
    label: biomarker.title,
    value: "",
    delta: "",
    direction,
    biomarkerRouteId: biomarker.key.replace(/^biomarker:/u, ""),
    displayValue: protocolSignal?.displayValue,
    estimatedChange: protocolSignal?.estimatedChange,
    expected,
    description:
      protocolSignal?.description
      ?? hint.description
      ?? biomarker.summary
      ?? summarizeBody(biomarker.body),
    protocolProminence,
  });
}

function normalizeExpectedSignalLabel(expected: string): string {
  switch (expected) {
    case "down":
    case "down_or_stable":
      return "Could trend lower";
    case "up":
    case "up_or_stable":
      return "Could improve";
    case "mixed_or_contextual":
      return "Possible change";
    case "stable":
      return "Should stay stable";
    default:
      return expected;
  }
}

function resolveBiomarkerDisplayHint(
  biomarker: HealthCommonsCatalogEntity,
): BiomarkerDisplayHint {
  const biomarkerKey = biomarker.key;
  const baseHint = DEFAULT_BIOMARKER_DISPLAY_HINTS[biomarkerKey] ?? {
    direction: "neutral" as const,
    expected: "Worth watching",
  };
  const direction = directionForBiomarkerDesiredDirection(
    biomarker.biomarker?.direction?.desired,
  );

  return direction
    ? {
        ...baseHint,
        direction,
        expected: expectedLabelForBiomarkerDirection(direction),
      }
    : baseHint;
}

function directionForExpectedSignal(
  expected: HealthCommonsBiomarkerProtocolExpectedDirection | string | undefined,
): ExperimentSignalDirection | null {
  switch (expected) {
    case "down":
    case "down_or_stable":
      return "down";
    case "up":
    case "up_or_stable":
      return "up";
    case "mixed_or_contextual":
    case "stable":
      return "neutral";
    default:
      return null;
  }
}

function expectedLabelForExpectedSignal(
  expected: HealthCommonsBiomarkerProtocolExpectedDirection | undefined,
): string | null {
  return expected ? normalizeExpectedSignalLabel(expected) : null;
}

function directionForBiomarkerDesiredDirection(
  desired: HealthCommonsBiomarkerDesiredDirection | undefined,
): ExperimentSignalDirection | null {
  switch (desired) {
    case "higher":
    case "higher_or_stable":
      return "up";
    case "lower":
    case "lower_or_stable":
      return "down";
    case "mixed_or_contextual":
    case "stable":
      return "neutral";
    default:
      return null;
  }
}

function expectedLabelForBiomarkerDirection(direction: ExperimentSignalDirection): string {
  switch (direction) {
    case "down":
      return "Could trend lower";
    case "up":
      return "Could improve";
    case "neutral":
      return "Worth watching";
  }
}

function toMeasurementPaths(
  protocol: HealthCommonsCatalogEntity,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): HealthCommonsWebExperimentMeasurementPath[] {
  const plan = protocol.measurementPlan;

  if (!plan) {
    return [];
  }

  return plan.paths
    .map((path, index) => ({
      index,
      path,
    }))
    .sort((left, right) => {
      if (left.path.pathId === plan.defaultPathId) {
        return -1;
      }

      if (right.path.pathId === plan.defaultPathId) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ path }) => toMeasurementPath({
      entitiesByKey,
      isDefault: path.pathId === plan.defaultPathId,
      path,
    }));
}

function toMeasurementPath(input: {
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  isDefault: boolean;
  path: HealthCommonsMeasurementPlanPath;
}): HealthCommonsWebExperimentMeasurementPath {
  return {
    isDefault: input.isDefault,
    label: input.path.label,
    methodKeys: input.path.methodKeys,
    methods: input.path.methodKeys.map((methodKey) =>
      toMeasurementMethodReference({
        entitiesByKey: input.entitiesByKey,
        methodKey,
      })
    ),
    notes: input.path.notes ?? [],
    outcomeLabels: toMeasurementOutcomeLabels(input.entitiesByKey, input.path.outcomeKeys ?? []),
    pathId: input.path.pathId,
    required: input.path.required,
    safetyOutcomeLabels: toMeasurementOutcomeLabels(
      input.entitiesByKey,
      input.path.safetyOutcomeKeys ?? [],
    ),
    tier: input.path.tier,
  };
}

function toMeasurementMethodReference(input: {
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>;
  methodKey: string;
}): HealthCommonsWebExperimentMeasurementMethodReference {
  const entity = input.entitiesByKey.get(stripRevision(input.methodKey));

  if (!isMeasurementMethodEntity(entity)) {
    throw new Error(
      `Measurement plan method key ${input.methodKey} did not resolve to a measurement_method.`,
    );
  }

  const method = entity.measurementMethod;
  const routeId = toTrailingRouteId(entity.slug);

  return omitUndefined({
    href: `/measurement-methods/${routeId}`,
    key: entity.key,
    modalities: method.modalities.map(formatCategory),
    privacy: method.privacy
      ? omitUndefined({
          containsIdentifiableImages: method.privacy.containsIdentifiableImages,
          localOnlyRecommended: method.privacy.localOnlyRecommended,
          notes: method.privacy.notes ?? [],
        })
      : undefined,
    routeId,
    shortName: method.shortName ?? method.displayName ?? entity.title,
    summary: entity.summary ?? summarizeBody(entity.body),
    tier: method.tier,
    title: method.displayName ?? entity.title,
  });
}

function toMeasurementOutcomeLabels(
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
  keys: readonly string[],
): string[] {
  return keys.map((key) => {
    const entity = entitiesByKey.get(stripRevision(key));

    if (entity?.entityType !== "biomarker") {
      throw new Error(
        `Measurement plan outcome key ${key} did not resolve to a biomarker.`,
      );
    }

    return entity.title;
  });
}

function isMeasurementMethodEntity(
  entity: HealthCommonsCatalogEntity | undefined,
): entity is HealthCommonsCatalogEntity & {
  entityType: "measurement_method";
  measurementMethod: HealthCommonsMeasurementMethod;
} {
  return entity?.entityType === "measurement_method" && entity.measurementMethod !== undefined;
}

function toProtocolFacts(
  protocol: HealthCommonsProtocolSpec | undefined,
  testPlan: HealthCommonsTestPlan | null,
): HealthCommonsWebExperimentProtocolFact[] {
  if (!protocol) {
    return [];
  }

  return [
    testPlan
      ? {
          label: "Baseline",
          value: formatDays(testPlan.baselineDays),
          detail: "Keep the usual routine stable before the change.",
        }
      : null,
    testPlan
      ? {
          label: "Intervention",
          value: formatDays(testPlan.interventionDays),
          detail: formatAdherenceTarget(testPlan, protocol),
        }
      : null,
    formatProtocolFrequencyFact(protocol),
    formatProtocolDurationFact(protocol),
    formatProtocolTargetFact(protocol),
  ].filter((fact): fact is HealthCommonsWebExperimentProtocolFact => fact !== null);
}

function toProtocolSteps(
  protocol: HealthCommonsProtocolSpec | undefined,
): HealthCommonsWebExperimentProtocolStep[] {
  const steps = protocol?.steps ?? [];

  return steps.map((step, index) => ({
    detail: step,
    number: index + 1,
    title: `Step ${index + 1}`,
  }));
}

function toMechanismChain(
  mechanismChain: readonly HealthCommonsMechanismChainStep[] | undefined,
): HealthCommonsWebExperimentMechanismChainStep[] {
  return (mechanismChain ?? []).map((step) => ({
    content: step.content,
    label: step.label,
  }));
}

function toSessionShape(
  shape: HealthCommonsProtocolSessionShape,
): HealthCommonsWebExperimentSessionShape {
  return {
    ...(shape.label ? { label: shape.label } : {}),
    segments: shape.segments.map(toSessionShapeSegment),
    ...(shape.summarySegments
      ? { summarySegments: shape.summarySegments.map(toSessionShapeSegment) }
      : {}),
    ...(shape.ticks ? { ticks: shape.ticks.map(toSessionShapeTick) } : {}),
  };
}

function toSessionShapeSegment(
  segment: HealthCommonsProtocolSessionShape["segments"][number],
): HealthCommonsProtocolSessionShape["segments"][number] {
  return {
    durationMinutes: segment.durationMinutes,
    kind: segment.kind,
    label: segment.label,
  };
}

function toSessionShapeTick(
  tick: NonNullable<HealthCommonsProtocolSessionShape["ticks"]>[number],
): NonNullable<HealthCommonsProtocolSessionShape["ticks"]>[number] {
  if (typeof tick === "string") {
    return tick;
  }
  if ("offsetMinutes" in tick) {
    return {
      label: tick.label,
      offsetMinutes: tick.offsetMinutes,
    };
  }
  return {
    label: tick.label,
    positionPercent: tick.positionPercent,
  };
}

function toWhyItWorks(
  protocol: HealthCommonsCatalogEntity,
  claims: readonly HealthCommonsClaim[],
): string {
  if (protocol.whyItWorks && protocol.whyItWorks.length > 0) {
    return protocol.whyItWorks.join("\n\n");
  }

  const selectedClaims = claims
    .filter((claim) => claim.type !== "safety")
    .map((claim, index) => ({ claim, index }))
    .sort((left, right) => {
      const rankDelta = claimWhyItWorksRank(left.claim) - claimWhyItWorksRank(right.claim);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .slice(0, 4)
    .map(({ claim }) => claim.text);

  if (selectedClaims.length > 0) {
    return selectedClaims.join("\n\n");
  }

  return summarizeBody(protocol.body);
}

function claimWhyItWorksRank(claim: HealthCommonsClaim): number {
  switch (claim.type) {
    case "mechanistic":
      return 0;
    case "intervention_result":
      return 1;
    case "mixed_evidence":
      return 2;
    case "design_guardrail":
      return 3;
    case "evidence_scope":
      return 4;
    case "association_not_causation":
      return 5;
    case "community_outcome":
      return 6;
    case "safety":
      return 7;
  }
}

function formatProtocolFrequencyFact(
  protocol: HealthCommonsProtocolSpec,
): HealthCommonsWebExperimentProtocolFact | null {
  const value = formatFrequency(protocol);

  return value
    ? {
        label: "Frequency",
        value: stripTrailingPeriod(value),
      }
    : null;
}

function formatProtocolDurationFact(
  protocol: HealthCommonsProtocolSpec,
): HealthCommonsWebExperimentProtocolFact | null {
  const value = formatDuration(protocol);

  return value
    ? {
        label: "Session",
        value: stripTrailingPeriod(value),
      }
    : null;
}

function formatProtocolTargetFact(
  protocol: HealthCommonsProtocolSpec,
): HealthCommonsWebExperimentProtocolFact {
  const target = protocol.target ?? formatTemperature(protocol);

  return target
    ? {
        label: protocol.temperatureC ? "Target" : "Dose",
        value: stripTrailingPeriod(target),
      }
    : {
        label: "Dose",
        value: protocol.doseSignature,
      };
}

function formatAdherenceTarget(
  testPlan: HealthCommonsTestPlan,
  protocol: HealthCommonsProtocolSpec,
): string | undefined {
  const target = testPlan.targetAdherenceSessions ?? protocol.interventionSessionsTarget;
  const minimum = testPlan.minimumAdherenceSessions ?? protocol.interventionSessionsMinimum;

  if (typeof target === "number" && typeof minimum === "number" && target !== minimum) {
    return `${minimum} session minimum; ${target} session target.`;
  }

  if (typeof target === "number") {
    return `${target} session target.`;
  }

  if (typeof minimum === "number") {
    return `${minimum} session minimum.`;
  }

  return undefined;
}

function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.$/u, "");
}

function toSafety(safety: HealthCommonsSafety | undefined): HealthCommonsWebExperimentSafety {
  if (!safety) {
    return {
      cautionLevel: 3,
      precautions: ["Stop if symptoms feel concerning."],
      whoShouldAvoid: ["Use appropriate clinician guidance for heat exposure risks."],
    };
  }

  return {
    cautionLevel: safetyCautionLevel(safety.cautionLevel),
    precautions: [
      ...(safety.notes ?? []),
      ...(safety.stopIf && safety.stopIf.length > 0
        ? [`Stop if: ${safety.stopIf.map(humanizeToken).join(", ")}.`]
        : []),
    ],
    whoShouldAvoid: (safety.avoidOrGetClinicianGuidance ?? []).map(humanizeToken),
  };
}

function safetyCautionLevel(cautionLevel: HealthCommonsSafety["cautionLevel"]): number {
  switch (cautionLevel) {
    case "low":
      return 2;
    case "moderate":
      return 3;
    case "high":
      return 4;
    case "unknown":
      return 3;
  }
}

function formatFrequency(protocol: HealthCommonsProtocolSpec): string | null {
  if (protocol.frequency?.sessionsPerWeek) {
    return `${protocol.frequency.sessionsPerWeek} sessions per week.`;
  }

  if (protocol.frequency?.sessionsPerDay) {
    return `${protocol.frequency.sessionsPerDay} sessions per day.`;
  }

  return null;
}

function formatDuration(protocol: HealthCommonsProtocolSpec): string | null {
  const min = protocol.durationMinutes?.min;
  const max = protocol.durationMinutes?.max;

  if (typeof min === "number" && typeof max === "number") {
    return min === max ? `${min} minutes per session.` : `${min}\u2013${max} minutes per session.`;
  }

  if (typeof min === "number") {
    return `At least ${min} minutes per session.`;
  }

  if (typeof max === "number") {
    return `Up to ${max} minutes per session.`;
  }

  return null;
}

function formatTemperature(protocol: HealthCommonsProtocolSpec): string | null {
  const min = protocol.temperatureC?.min;
  const max = protocol.temperatureC?.max;

  if (typeof min === "number" && typeof max === "number") {
    return min === max
      ? `${min} \u00b0C target temperature.`
      : `${min}\u2013${max} \u00b0C target temperature.`;
  }

  return null;
}

function toExpert(entity: HealthCommonsCatalogEntity): HealthCommonsWebExperimentExpert {
  const initials = entity.title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "HC";

  return omitUndefined({
    field: entity.entityType === "source_person"
      ? ""
      : formatCategory(entity.categories?.[0] ?? "source"),
    initials,
    name: entity.title,
    profileImageUrl: readOptionalProfileImageUrl(entity),
    quote: entity.summary ?? summarizeBody(entity.body),
  });
}

function readOptionalProfileImageUrl(
  entity: HealthCommonsCatalogEntity,
): string | undefined {
  const rawValue = readPassthroughString(entity, "profileImageUrl");
  const normalized = rawValue?.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    (normalized.startsWith("/") && !normalized.startsWith("//"))
    || /^https?:\/\//u.test(normalized)
  ) {
    return normalized;
  }

  return undefined;
}

function formatDetailEvidenceLabel(entity: HealthCommonsCatalogEntity): string {
  const status = STATUS_LABELS[entity.status ?? ""] ?? (entity.status ? humanizeToken(entity.status) : "Draft");
  const quality = QUALITY_LABELS[entity.quality ?? ""] ?? (entity.quality ? humanizeToken(entity.quality) : "Unreviewed");

  return status === quality ? quality : `${status} · ${quality}`;
}

function humanizeToken(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (match) => match.toUpperCase());
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
    url: safeWebUrl(source?.url),
    year: source?.year,
  });
}

function safeWebUrl(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
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
}: {
  countedResearchSources: readonly HealthCommonsCatalogEntity[];
  displaySources: readonly HealthCommonsCatalogEntity[];
  evidenceAppraisals: readonly HealthCommonsEvidenceAppraisal[];
  protocolKey: string;
}): HealthCommonsWebExperimentResearchStat[] {
  const participantCountSources = countedResearchSources.filter((entity) =>
    !isExcludedParticipantCountSource(entity, protocolKey, evidenceAppraisals)
  );
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

function isExcludedParticipantCountSource(
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
    && isRunnableProtocolStatus(entity.status)
    && entity.hidden !== true;
}

function projectionPathsForRoute(
  entity: HealthCommonsCatalogEntity,
  routeId: string,
): Partial<Record<HealthCommonsWebProjectionKey, string>> | null {
  if (isPublicProtocolVariant(entity)) {
    const projections: Partial<Record<HealthCommonsWebProjectionKey, string>> = {};
    for (const spec of EXPERIMENT_PROJECTION_SPECS) {
      projections[spec.key] = spec.pathForRouteId(routeId);
    }
    return projections;
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

function shouldIncludeReverseEdgeSource(
  edge: HealthCommonsWebReverseRelation,
  entitiesByKey: ReadonlyMap<string, HealthCommonsCatalogEntity>,
): boolean {
  const source = entitiesByKey.get(stripRevision(edge.sourceKey));

  return source?.entityType === "protocol_variant"
    ? isPublicProtocolVariant(source)
    : true;
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
    if (entity.entityType === "protocol_variant" && !isPublicProtocolVariant(entity)) {
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
    for (const entity of catalog.entities) {
      if (!isPublicProtocolVariant(entity)) {
        continue;
      }

      const referencesBiomarker = (entity.relations ?? []).some(
        (relation) => stripRevision(relation.target) === primary.key,
      );
      const testPlanReferencesBiomarker = (entity.testPlans ?? []).some((plan) =>
        plan.primaryBiomarkerKey === primary.key ||
        (plan.secondaryBiomarkerKeys ?? []).includes(primary.key)
      );
      const expectedSignalReferencesBiomarker = (entity.expectedSignalDescriptions ?? []).some(
        (signal) => stripRevision(signal.biomarkerKey) === primary.key,
      );

      if (referencesBiomarker || testPlanReferencesBiomarker || expectedSignalReferencesBiomarker) {
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

function isPublishedBiomarkerIndexEntity(
  entity: HealthCommonsCatalogEntity | undefined,
  entities: Iterable<HealthCommonsCatalogEntity>,
): entity is HealthCommonsCatalogEntity & { entityType: "biomarker" } {
  return entity?.entityType === "biomarker"
    && entity.status !== "deprecated"
    && entity.hidden !== true
    && hasCompleteBiomarkerAbout(entity)
    && (entity.biomarker?.measurement?.howToMeasure?.length ?? 0) > 0
    && hasPublishedProtocolExpectedSignal(entity.key, entities)
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

function hasPublishedProtocolExpectedSignal(
  biomarkerKey: string,
  entities: Iterable<HealthCommonsCatalogEntity>,
): boolean {
  for (const entity of entities) {
    if (
      entity.entityType !== "protocol_variant" ||
      !isRunnableProtocolStatus(entity.status) ||
      entity.hidden === true
    ) {
      continue;
    }

    if ((entity.expectedSignalDescriptions ?? []).some((signal) =>
      stripRevision(signal.biomarkerKey) === biomarkerKey
    )) {
      return true;
    }
  }

  return false;
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
