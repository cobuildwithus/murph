import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS,
  type HealthCommonsBiomarkerDesiredDirection,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsEntityType,
  type HealthCommonsEvidenceAppraisal,
  type HealthCommonsMeasurementMethod,
  type HealthCommonsMeasurementPlan,
  type HealthCommonsProtocolSpec,
  type HealthCommonsRelation,
  type HealthCommonsRelationType,
} from "@murphai/contracts";
import {
  resolveMetricDefinition,
  resolveMetricDefinitionForBiomarker,
} from "@murphai/health-metrics";
import { resolveHealthCommonsBiomarkerEntityKey } from "./biomarker-entity-mappings.ts";
import {
  HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION,
  type HealthCommonsBiomarkerDesiredDirectionsArtifact,
} from "./biomarker-runtime-artifacts.ts";
import {
  HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT,
  HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE,
  HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
  searchHealthCommonsKnowledgeIndex,
  type HealthCommonsKnowledgeSearchResult,
} from "./knowledge-index.ts";
export type {
  HealthCommonsKnowledgeSearchItem,
  HealthCommonsKnowledgeSearchResult,
  HealthCommonsKnowledgeSourceReference,
} from "./knowledge-index.ts";
export {
  HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT,
  HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
};
import {
  HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION,
  HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION,
  type HealthCommonsProtocolEntitySummary,
  type HealthCommonsProtocolEntityType,
  type HealthCommonsProtocolFamilySummary,
  type HealthCommonsProtocolFamilyGraphArtifact,
  type HealthCommonsProtocolFamilyGraphEdge,
  type HealthCommonsProtocolIndexArtifact,
  type HealthCommonsProtocolIndexEntry,
  type HealthCommonsProtocolRunSpec,
  type HealthCommonsProtocolRunSpecsArtifact,
} from "./protocol-artifacts.ts";
export type {
  HealthCommonsBiomarkerDesiredDirectionEntry,
  HealthCommonsBiomarkerDesiredDirectionsArtifact,
} from "./biomarker-runtime-artifacts.ts";
export type {
  HealthCommonsProtocolEntitySummary,
  HealthCommonsProtocolFamilySummary,
  HealthCommonsProtocolIndexEntry,
  HealthCommonsProtocolRunSpec,
} from "./protocol-artifacts.ts";
import {
  HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebBiomarkerIndex,
  type HealthCommonsWebExperimentIndex,
  type HealthCommonsWebExperimentProtocolTab,
  type HealthCommonsWebExperimentResearchTab,
  type HealthCommonsWebExperimentResultsPublic,
  type HealthCommonsWebExperimentShell,
  type HealthCommonsWebProjectionKey,
  type HealthCommonsWebRouteBundle,
  type HealthCommonsWebRouteIndex,
} from "./web-artifacts.ts";

export type {
  HealthCommonsWebBiomarkerOverview,
  HealthCommonsWebBiomarkerFallbackRange,
  HealthCommonsWebBiomarkerResearch,
  HealthCommonsWebBiomarkerShell,
  HealthCommonsWebExperimentProtocolTab,
  HealthCommonsWebExperimentResearchTab,
  HealthCommonsWebExperimentResultsPublic,
  HealthCommonsWebExperimentShell,
  HealthCommonsWebProjectionKey,
} from "./web-artifacts.ts";
export { isRunnableProtocolStatus } from "./protocol-publishing.ts";

export type HealthCommonsEntity = HealthCommonsCatalogEntity;

export const MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV =
  "MURPH_HEALTH_COMMONS_PACKAGE_ROOT";

export const HEALTH_COMMONS_PAGE_STATUSES = [
  "draft",
  "field-testing",
  "reviewed",
  "deprecated",
  "community",
] as const;

export const HEALTH_COMMONS_SOURCE_KINDS = [
  "journal_article",
  "review",
  "guideline",
  "book",
  "podcast",
  "external_protocol",
  "web_page",
  "other",
] as const;

export type HealthCommonsPageStatus = (typeof HEALTH_COMMONS_PAGE_STATUSES)[number];
export type HealthCommonsSourceKind = (typeof HEALTH_COMMONS_SOURCE_KINDS)[number];

export type HealthCommonsSearchMatchedField =
  | "aliases"
  | "body"
  | "categories"
  | "claims"
  | "key"
  | "measurement_method"
  | "measurement_plan"
  | "protocol"
  | "slug"
  | "source"
  | "summary"
  | "title";

export interface LoadGeneratedHealthCommonsProtocolIndexOptions {
  protocolIndexPath?: string | URL;
}

export interface LoadGeneratedHealthCommonsProtocolRunSpecsOptions {
  protocolRunSpecsPath?: string | URL;
}

export interface LoadGeneratedHealthCommonsProtocolFamilyGraphOptions {
  protocolFamilyGraphPath?: string | URL;
}

export interface LoadGeneratedHealthCommonsBiomarkerDesiredDirectionsOptions {
  biomarkerDesiredDirectionsPath?: string | URL;
}

export interface LoadGeneratedHealthCommonsWebArtifactOptions {
  generatedWebRoot?: string | URL;
}

export interface SearchGeneratedHealthCommonsKnowledgeOptions {
  focus?: string;
  knowledgeIndexPath?: string | URL;
  limit?: number;
  query: string;
}

export interface HealthCommonsCompactProtocol {
  cautionLevel: string | null;
  doseSignature: string;
  durationMinutes: HealthCommonsProtocolSpec["durationMinutes"] | null;
  frequency: HealthCommonsProtocolSpec["frequency"] | null;
  recipeHash: string | null;
  runSpecRevisionId: string | null;
  target: string | null;
}

export interface HealthCommonsCompactSource {
  authors: string | null;
  citation: string | null;
  doi: string | null;
  journal: string | null;
  kind: string;
  pmid: string | null;
  title: string | null;
  url: string | null;
  year: number | null;
}

export interface HealthCommonsCompactResearchEvidence {
  aggregateRole: string | null;
  designKind: string;
  designLabel: string | null;
  durationLabel: string | null;
  participantCount: number | null;
  populationLabel: string | null;
}

export type HealthCommonsCompactMeasurementMethod = HealthCommonsMeasurementMethod;

export type HealthCommonsCompactMeasurementPlan = HealthCommonsMeasurementPlan;

export interface HealthCommonsCompactEntity {
  aliases: readonly string[];
  categories: readonly string[];
  entityType: HealthCommonsEntityType;
  evidence: HealthCommonsCompactResearchEvidence | null;
  key: string;
  measurementMethod: HealthCommonsCompactMeasurementMethod | null;
  measurementPlan: HealthCommonsCompactMeasurementPlan | null;
  protocol: HealthCommonsCompactProtocol | null;
  quality: string | null;
  revision: HealthCommonsEntity["revision"];
  routeId: string;
  routeIds: readonly string[];
  slug: string;
  source: HealthCommonsCompactSource | null;
  status: string | null;
  summary: string | null;
  title: string;
}

export interface HealthCommonsCatalogSearchInput extends HealthCommonsEntityListOptions {
  entityTypes?: readonly HealthCommonsEntityType[];
}

export interface HealthCommonsEntityListOptions {
  categories?: readonly string[];
  candidateKeys?: readonly string[];
  includeBody?: boolean;
  limit?: number;
  query?: string;
  sourceKinds?: readonly string[];
  statuses?: readonly string[];
}

export interface HealthCommonsIgnoredWildcardFilters {
  categories: readonly string[];
  sourceKinds: readonly string[];
  statuses: readonly string[];
}

export interface HealthCommonsNormalizedEntityListOptions {
  categories: readonly string[];
  ignoredWildcards: HealthCommonsIgnoredWildcardFilters;
  limit: number;
  query: string | null;
  sourceKinds: readonly HealthCommonsSourceKind[];
  statuses: readonly HealthCommonsPageStatus[];
}

export interface HealthCommonsCatalogSearchResult {
  entity: HealthCommonsCompactEntity;
  matchedFields: readonly HealthCommonsSearchMatchedField[];
  score: number;
}

export interface HealthCommonsResolvedRelation {
  entity: HealthCommonsCompactEntity;
  relation: HealthCommonsRelation;
}

export type HealthCommonsSourceReferenceKind =
  | "claim"
  | "evidence_appraisal"
  | "relation"
  | "research_landscape"
  | "self";

export interface HealthCommonsSourceReference {
  appraisalKey: string | null;
  claimId: string | null;
  groupId: string | null;
  kind: HealthCommonsSourceReferenceKind;
  relationType: string | null;
}

export interface HealthCommonsResolvedSource {
  reasons: readonly HealthCommonsSourceReference[];
  source: HealthCommonsCompactEntity;
}

export interface HealthCommonsRelationInput {
  entity: HealthCommonsEntity;
  entityTypes?: readonly HealthCommonsEntityType[];
  limit?: number;
  relationTypes?: readonly HealthCommonsRelationType[];
}

export interface HealthCommonsSourceInput {
  entity: HealthCommonsEntity | string;
  limit?: number;
}

export interface HealthCommonsSourceKeyInput {
  entity: HealthCommonsEntity | string | null;
  includeSelf?: boolean;
}

export interface HealthCommonsEntityContextInput {
  entity: HealthCommonsEntity | string;
  relationLimit?: number;
  relationTypes?: readonly HealthCommonsRelationType[];
  sourceLimit?: number;
}

export interface HealthCommonsResolvedEntityContext {
  entity: HealthCommonsCompactEntity;
  relations: readonly HealthCommonsResolvedRelation[];
  sources: readonly HealthCommonsResolvedSource[];
}

export interface HealthCommonsCatalogReader {
  catalogHash: string;
  collectSourceKeys(input: HealthCommonsSourceKeyInput): string[];
  compactEntity(entity: HealthCommonsEntity): HealthCommonsCompactEntity;
  findByKey(key: string): HealthCommonsEntity | null;
  findByRouteId(input: {
    entityType: HealthCommonsEntityType;
    routeId: string;
  }): HealthCommonsEntity | null;
  findBySlug(slug: string): HealthCommonsEntity | null;
  listByEntityType(entityType: HealthCommonsEntityType): HealthCommonsEntity[];
  listEvidenceAppraisals(input?: {
    groupId?: string;
    sourceKey?: string;
    targetKey?: string;
  }): HealthCommonsEvidenceAppraisal[];
  listMeasurementMethods(options?: HealthCommonsEntityListOptions): HealthCommonsCompactEntity[];
  listProtocolVariants(options?: HealthCommonsEntityListOptions): HealthCommonsCompactEntity[];
  listRelated(input: {
    entity: HealthCommonsEntity;
    entityTypes?: readonly HealthCommonsEntityType[];
    relationTypes?: readonly HealthCommonsRelationType[];
  }): HealthCommonsEntity[];
  listSourceArtifacts(options?: HealthCommonsEntityListOptions): HealthCommonsCompactEntity[];
  resolveEntityContext(input: HealthCommonsEntityContextInput): HealthCommonsResolvedEntityContext | null;
  resolveRelations(input: HealthCommonsRelationInput): HealthCommonsResolvedRelation[];
  resolveSources(input: HealthCommonsSourceInput): HealthCommonsResolvedSource[];
  normalizeListOptions(options?: HealthCommonsEntityListOptions): HealthCommonsNormalizedEntityListOptions;
  search(input?: HealthCommonsCatalogSearchInput): HealthCommonsCatalogSearchResult[];
}

export interface HealthCommonsProtocolIndexReader {
  artifact: HealthCommonsProtocolIndexArtifact;
  catalogHash: string;
  findByLookup(lookup: string): HealthCommonsProtocolIndexEntry | null;
  listProtocols(options?: HealthCommonsEntityListOptions): HealthCommonsProtocolIndexEntry[];
  normalizeListOptions(options?: HealthCommonsEntityListOptions): HealthCommonsNormalizedEntityListOptions;
}

export interface HealthCommonsProtocolRunSpecReader {
  artifact: HealthCommonsProtocolRunSpecsArtifact;
  catalogHash: string;
  findByLookup(lookup: string): HealthCommonsProtocolRunSpec | null;
}

export type HealthCommonsProtocolFamilyGraphEntity =
  | HealthCommonsProtocolFamilySummary
  | HealthCommonsProtocolIndexEntry;

export interface HealthCommonsProtocolExploreMatch {
  matchReason: "direct_family" | "direct_protocol" | "query_match";
  protocol: HealthCommonsProtocolIndexEntry;
}

export interface HealthCommonsProtocolFamilyGraphReader {
  artifact: HealthCommonsProtocolFamilyGraphArtifact;
  catalogHash: string;
  childFamilies(family: HealthCommonsProtocolFamilySummary): HealthCommonsProtocolFamilySummary[];
  findEntity(input: {
    entityTypes: readonly HealthCommonsProtocolEntityType[];
    lookup: string;
  }): HealthCommonsProtocolFamilyGraphEntity | null;
  listProtocolMatches(input: {
    limit: number;
    lookup: string;
  }): HealthCommonsProtocolExploreMatch[];
  parentFamilies(protocol: HealthCommonsProtocolIndexEntry): HealthCommonsProtocolFamilySummary[];
  protocolVariantsForFamily(
    family: HealthCommonsProtocolFamilySummary,
    seenFamilyKeys?: Set<string>,
  ): HealthCommonsProtocolIndexEntry[];
  relatedProtocolVariants(entity: HealthCommonsProtocolFamilyGraphEntity): HealthCommonsProtocolIndexEntry[];
}

export interface HealthCommonsRouteBundleReader extends HealthCommonsCatalogReader {
  bundle: HealthCommonsWebRouteBundle;
  getSourceSnippet(sourceKey: string): HealthCommonsWebRouteBundle["sourceSnippets"][string] | null;
  listReverseEdges(input?: {
    relationTypes?: readonly HealthCommonsRelationType[];
    targetKey?: string;
  }): HealthCommonsWebRouteBundle["reverseEdges"];
  revisionManifest: HealthCommonsWebRouteBundle["revisionManifest"];
  route: HealthCommonsWebRouteBundle["route"];
}

const DEFAULT_GENERATED_PROTOCOL_INDEX_PATH = "generated/protocol-index.json";
const DEFAULT_GENERATED_PROTOCOL_RUN_SPECS_PATH = "generated/protocol-run-specs.json";
const DEFAULT_GENERATED_PROTOCOL_FAMILY_GRAPH_PATH = "generated/protocol-family-graph.json";
const DEFAULT_GENERATED_BIOMARKER_DESIRED_DIRECTIONS_PATH =
  "generated/biomarker-desired-directions.json";
const DEFAULT_GENERATED_KNOWLEDGE_INDEX_PATH =
  `generated/${HEALTH_COMMONS_KNOWLEDGE_INDEX_FILE}`;

export function searchGeneratedHealthCommonsKnowledge(
  options: SearchGeneratedHealthCommonsKnowledgeOptions,
): HealthCommonsKnowledgeSearchResult {
  const indexLocation = options.knowledgeIndexPath ?? defaultGeneratedKnowledgeIndexUrl();
  const databasePath = indexLocation instanceof URL
    ? fileURLToPath(indexLocation)
    : indexLocation;
  return searchHealthCommonsKnowledgeIndex({
    databasePath,
    focus: options.focus,
    limit: Math.min(
      options.limit ?? HEALTH_COMMONS_KNOWLEDGE_DEFAULT_LIMIT,
      HEALTH_COMMONS_KNOWLEDGE_MAX_LIMIT,
    ),
    query: options.query,
  });
}
const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_RELATION_LIMIT = 12;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_SOURCE_LIMIT = 8;
const MAX_LIMIT = 500;
type HealthCommonsWebExperimentProjectionKey = Extract<
  HealthCommonsWebProjectionKey,
  | "experiment.protocol"
  | "experiment.research"
  | "experiment.results-public"
  | "experiment.shell"
>;
const HEALTH_COMMONS_WEB_PROJECTION_KEYS: readonly HealthCommonsWebProjectionKey[] = [
  "biomarker.overview",
  "biomarker.research",
  "biomarker.shell",
  "experiment.protocol",
  "experiment.research",
  "experiment.results-public",
  "experiment.shell",
];

let cachedGeneratedProtocolIndexReader: HealthCommonsProtocolIndexReader | null = null;
let cachedGeneratedProtocolRunSpecReader: HealthCommonsProtocolRunSpecReader | null = null;
let cachedGeneratedProtocolFamilyGraphReader: HealthCommonsProtocolFamilyGraphReader | null = null;
let cachedGeneratedBiomarkerDesiredDirections:
  HealthCommonsBiomarkerDesiredDirectionsArtifact | null = null;
let cachedGeneratedWebBiomarkerIndex: HealthCommonsWebBiomarkerIndex | null = null;
let cachedGeneratedWebExperimentIndex: HealthCommonsWebExperimentIndex | null = null;
let cachedGeneratedWebRouteIndex: HealthCommonsWebRouteIndex | null = null;
const cachedGeneratedWebRouteBundles = new Map<string, HealthCommonsWebRouteBundle>();
const cachedGeneratedWebExperimentResearchTabs = new Map<
  string,
  HealthCommonsWebExperimentResearchTab | null
>();
const cachedGeneratedWebExperimentShells = new Map<
  string,
  HealthCommonsWebExperimentShell | null
>();
const cachedGeneratedWebExperimentProtocolTabs = new Map<
  string,
  HealthCommonsWebExperimentProtocolTab | null
>();
const cachedGeneratedWebExperimentResultsPublic = new Map<
  string,
  HealthCommonsWebExperimentResultsPublic | null
>();

export function loadGeneratedHealthCommonsProtocolIndex(
  options: LoadGeneratedHealthCommonsProtocolIndexOptions = {},
): HealthCommonsProtocolIndexArtifact {
  const raw = readFileSync(
    options.protocolIndexPath ?? defaultGeneratedProtocolIndexUrl(),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedHealthCommonsProtocolIndex(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsProtocolIndexReader(
  options: LoadGeneratedHealthCommonsProtocolIndexOptions = {},
): HealthCommonsProtocolIndexReader {
  if (options.protocolIndexPath) {
    return createHealthCommonsProtocolIndexReader(
      loadGeneratedHealthCommonsProtocolIndex(options),
    );
  }

  cachedGeneratedProtocolIndexReader ??= createHealthCommonsProtocolIndexReader(
    loadGeneratedHealthCommonsProtocolIndex(),
  );
  return cachedGeneratedProtocolIndexReader;
}

export function loadGeneratedHealthCommonsProtocolRunSpecs(
  options: LoadGeneratedHealthCommonsProtocolRunSpecsOptions = {},
): HealthCommonsProtocolRunSpecsArtifact {
  const raw = readFileSync(
    options.protocolRunSpecsPath ?? defaultGeneratedProtocolRunSpecsUrl(),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedHealthCommonsProtocolRunSpecs(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsProtocolRunSpecReader(
  options: LoadGeneratedHealthCommonsProtocolRunSpecsOptions = {},
): HealthCommonsProtocolRunSpecReader {
  if (options.protocolRunSpecsPath) {
    return createHealthCommonsProtocolRunSpecReader(
      loadGeneratedHealthCommonsProtocolRunSpecs(options),
    );
  }

  cachedGeneratedProtocolRunSpecReader ??= createHealthCommonsProtocolRunSpecReader(
    loadGeneratedHealthCommonsProtocolRunSpecs(),
  );
  return cachedGeneratedProtocolRunSpecReader;
}

export function loadGeneratedHealthCommonsProtocolFamilyGraph(
  options: LoadGeneratedHealthCommonsProtocolFamilyGraphOptions = {},
): HealthCommonsProtocolFamilyGraphArtifact {
  const raw = readFileSync(
    options.protocolFamilyGraphPath ?? defaultGeneratedProtocolFamilyGraphUrl(),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedHealthCommonsProtocolFamilyGraph(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsProtocolFamilyGraphReader(
  options: LoadGeneratedHealthCommonsProtocolFamilyGraphOptions = {},
): HealthCommonsProtocolFamilyGraphReader {
  if (options.protocolFamilyGraphPath) {
    return createHealthCommonsProtocolFamilyGraphReader(
      loadGeneratedHealthCommonsProtocolFamilyGraph(options),
    );
  }

  cachedGeneratedProtocolFamilyGraphReader ??= createHealthCommonsProtocolFamilyGraphReader(
    loadGeneratedHealthCommonsProtocolFamilyGraph(),
    {
      protocolSearchEntries: getGeneratedHealthCommonsProtocolIndexReader().artifact.protocols,
    },
  );
  return cachedGeneratedProtocolFamilyGraphReader;
}

export function loadGeneratedHealthCommonsBiomarkerDesiredDirections(
  options: LoadGeneratedHealthCommonsBiomarkerDesiredDirectionsOptions = {},
): HealthCommonsBiomarkerDesiredDirectionsArtifact {
  const raw = readFileSync(
    options.biomarkerDesiredDirectionsPath ??
      defaultGeneratedBiomarkerDesiredDirectionsUrl(),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedHealthCommonsBiomarkerDesiredDirections(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsBiomarkerDesiredDirections(
  options: LoadGeneratedHealthCommonsBiomarkerDesiredDirectionsOptions = {},
): HealthCommonsBiomarkerDesiredDirectionsArtifact {
  if (options.biomarkerDesiredDirectionsPath) {
    return loadGeneratedHealthCommonsBiomarkerDesiredDirections(options);
  }

  cachedGeneratedBiomarkerDesiredDirections ??=
    loadGeneratedHealthCommonsBiomarkerDesiredDirections();
  return cachedGeneratedBiomarkerDesiredDirections;
}

export function loadGeneratedHealthCommonsWebRouteIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebRouteIndex {
  const raw = readFileSync(
    new URL("routes/index.json", normalizeGeneratedWebRoot(options.generatedWebRoot)),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedWebRouteIndex(parsed);
  return parsed;
}

export function loadGeneratedHealthCommonsWebExperimentIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebExperimentIndex {
  const raw = readFileSync(
    new URL("browse/experiments.json", normalizeGeneratedWebRoot(options.generatedWebRoot)),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedWebExperimentIndex(parsed);
  return parsed;
}

export function loadGeneratedHealthCommonsWebBiomarkerIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebBiomarkerIndex {
  const raw = readFileSync(
    new URL("browse/biomarkers.json", normalizeGeneratedWebRoot(options.generatedWebRoot)),
    "utf8",
  );
  const parsed = parseJsonObject(raw);
  assertGeneratedWebBiomarkerIndex(parsed);
  return parsed;
}

export function getGeneratedHealthCommonsWebRouteIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebRouteIndex {
  if (options.generatedWebRoot) {
    return loadGeneratedHealthCommonsWebRouteIndex(options);
  }

  cachedGeneratedWebRouteIndex ??= loadGeneratedHealthCommonsWebRouteIndex();
  return cachedGeneratedWebRouteIndex;
}

export function getGeneratedHealthCommonsWebExperimentIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebExperimentIndex {
  if (options.generatedWebRoot) {
    return loadGeneratedHealthCommonsWebExperimentIndex(options);
  }

  cachedGeneratedWebExperimentIndex ??= loadGeneratedHealthCommonsWebExperimentIndex();
  return cachedGeneratedWebExperimentIndex;
}

export function getGeneratedHealthCommonsWebBiomarkerIndex(
  options: LoadGeneratedHealthCommonsWebArtifactOptions = {},
): HealthCommonsWebBiomarkerIndex {
  if (options.generatedWebRoot) {
    return loadGeneratedHealthCommonsWebBiomarkerIndex(options);
  }

  cachedGeneratedWebBiomarkerIndex ??= loadGeneratedHealthCommonsWebBiomarkerIndex();
  return cachedGeneratedWebBiomarkerIndex;
}

export function resolveGeneratedHealthCommonsBiomarkerDesiredDirection(
  biomarkerKey: string,
  options: LoadGeneratedHealthCommonsBiomarkerDesiredDirectionsOptions = {},
): HealthCommonsBiomarkerDesiredDirection | null {
  const canonicalBiomarkerKey = resolveCanonicalBiomarkerKey(biomarkerKey);
  const entry = getGeneratedHealthCommonsBiomarkerDesiredDirections(options).biomarkers.find(
    (biomarker) => biomarker.key === canonicalBiomarkerKey,
  );
  return entry?.desiredDirection ?? null;
}

function resolveCanonicalBiomarkerKey(biomarkerKey: string): string {
  const normalized = biomarkerKey.trim().toLowerCase();
  const slug = normalized.split(":").at(-1) ?? normalized;
  const normalizedBiomarkerKey = normalized.startsWith("biomarker:")
    ? normalized
    : `biomarker:${slug}`;
  const metricBiomarkerKey =
    resolveMetricDefinitionForBiomarker(normalizedBiomarkerKey)?.biomarkerKey ??
    resolveMetricDefinition(slug)?.biomarkerKey ??
    normalizedBiomarkerKey;
  return resolveHealthCommonsBiomarkerEntityKey(metricBiomarkerKey);
}

export function loadGeneratedHealthCommonsWebRouteBundle(input: {
  entityType: HealthCommonsEntityType;
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebRouteBundle | null {
  const routeIndex = getGeneratedHealthCommonsWebRouteIndex({
    generatedWebRoot: input.generatedWebRoot,
  });
  const normalizedRouteId = normalizeRouteId(input.routeId);
  const route = routeIndex.routes.find((entry) =>
    entry.entityType === input.entityType && entry.routeId === normalizedRouteId
  );

  if (!route) {
    return null;
  }

  const cacheKey = `${routeIndex.catalogHash}:${route.bundlePath}`;
  if (!input.generatedWebRoot && cachedGeneratedWebRouteBundles.has(cacheKey)) {
    return cachedGeneratedWebRouteBundles.get(cacheKey) ?? null;
  }

  const raw = readFileSync(generatedWebArtifactUrl(route.bundlePath, input.generatedWebRoot), "utf8");
  const bundle = parseJsonObject(raw);
  assertGeneratedWebRouteBundle(bundle, route.bundlePath);

  if (!input.generatedWebRoot) {
    cachedGeneratedWebRouteBundles.set(cacheKey, bundle);
  }

  return bundle;
}

export function loadGeneratedHealthCommonsWebExperimentResearchTab(input: {
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebExperimentResearchTab | null {
  return loadGeneratedHealthCommonsWebExperimentArtifact({
    assertArtifact: assertGeneratedWebExperimentResearchTab,
    cache: cachedGeneratedWebExperimentResearchTabs,
    generatedWebRoot: input.generatedWebRoot,
    projectionKey: "experiment.research",
    routeId: input.routeId,
  });
}

export function loadGeneratedHealthCommonsWebExperimentShell(input: {
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebExperimentShell | null {
  return loadGeneratedHealthCommonsWebExperimentArtifact({
    assertArtifact: assertGeneratedWebExperimentShell,
    cache: cachedGeneratedWebExperimentShells,
    generatedWebRoot: input.generatedWebRoot,
    projectionKey: "experiment.shell",
    routeId: input.routeId,
  });
}

export function loadGeneratedHealthCommonsWebExperimentProtocolTab(input: {
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebExperimentProtocolTab | null {
  return loadGeneratedHealthCommonsWebExperimentArtifact({
    assertArtifact: assertGeneratedWebExperimentProtocolTab,
    cache: cachedGeneratedWebExperimentProtocolTabs,
    generatedWebRoot: input.generatedWebRoot,
    projectionKey: "experiment.protocol",
    routeId: input.routeId,
  });
}

export function loadGeneratedHealthCommonsWebExperimentResultsPublic(input: {
  generatedWebRoot?: string | URL;
  routeId: string;
}): HealthCommonsWebExperimentResultsPublic | null {
  return loadGeneratedHealthCommonsWebExperimentArtifact({
    assertArtifact: assertGeneratedWebExperimentResultsPublic,
    cache: cachedGeneratedWebExperimentResultsPublic,
    generatedWebRoot: input.generatedWebRoot,
    projectionKey: "experiment.results-public",
    routeId: input.routeId,
  });
}

function loadGeneratedHealthCommonsWebExperimentArtifact<T>(input: {
  assertArtifact: (value: unknown, artifactPath: string) => asserts value is T;
  cache: Map<string, T | null>;
  generatedWebRoot?: string | URL;
  projectionKey: HealthCommonsWebExperimentProjectionKey;
  routeId: string;
}): T | null {
  const routeIndex = getGeneratedHealthCommonsWebRouteIndex({
    generatedWebRoot: input.generatedWebRoot,
  });
  const normalizedRouteId = normalizeRouteId(input.routeId);
  const route = routeIndex.routes.find((entry) =>
    entry.entityType === "protocol_variant" && entry.routeId === normalizedRouteId
  );

  if (!route) {
    return null;
  }

  const artifactPath = route.projections?.[input.projectionKey];
  if (!artifactPath) {
    return null;
  }
  const artifactRouteId = routeIdFromGeneratedWebBundlePath(route.bundlePath);
  assertProjectionPathMatchesRoute(input.projectionKey, artifactPath, artifactRouteId);

  const cacheKey = `${routeIndex.catalogHash}:${artifactPath}`;
  if (!input.generatedWebRoot && input.cache.has(cacheKey)) {
    return input.cache.get(cacheKey) ?? null;
  }

  const artifactUrl = generatedWebArtifactUrl(artifactPath, input.generatedWebRoot);
  if (artifactUrl.protocol === "file:" && !existsSync(artifactUrl)) {
    if (!input.generatedWebRoot) {
      input.cache.set(cacheKey, null);
    }
    return null;
  }

  const raw = readFileSync(artifactUrl, "utf8");
  const artifact = parseJsonObject(raw);
  input.assertArtifact(artifact, artifactPath);
  assertGeneratedWebExperimentArtifactMatchesRoute(artifact, {
    artifactPath,
    routeId: artifactRouteId,
    routeKey: route.key,
  });

  if (!input.generatedWebRoot) {
    input.cache.set(cacheKey, artifact);
  }

  return artifact;
}

export function createHealthCommonsProtocolIndexReader(
  artifact: HealthCommonsProtocolIndexArtifact,
): HealthCommonsProtocolIndexReader {
  const lookup = createProtocolLookup(artifact.protocols, "protocol_variant");

  const normalizeListOptions = (
    options: HealthCommonsEntityListOptions = {},
  ): HealthCommonsNormalizedEntityListOptions => {
    const normalized = normalizeEntitySelectionInput(options, DEFAULT_LIST_LIMIT);
    return {
      categories: normalized.categories,
      ignoredWildcards: normalized.ignoredWildcards,
      limit: normalized.limit,
      query: normalized.query,
      sourceKinds: normalized.sourceKinds,
      statuses: normalized.statuses,
    };
  };

  return {
    artifact,
    catalogHash: artifact.catalogHash,
    findByLookup(lookupValue) {
      return lookup.find(lookupValue) as HealthCommonsProtocolIndexEntry | null;
    },
    listProtocols(options = {}) {
      return listCompactProtocols(artifact.protocols, options);
    },
    normalizeListOptions,
  };
}

export function createHealthCommonsProtocolRunSpecReader(
  artifact: HealthCommonsProtocolRunSpecsArtifact,
): HealthCommonsProtocolRunSpecReader {
  const lookup = createProtocolLookup(artifact.protocols, "protocol_variant");

  return {
    artifact,
    catalogHash: artifact.catalogHash,
    findByLookup(lookupValue) {
      return lookup.find(lookupValue) as HealthCommonsProtocolRunSpec | null;
    },
  };
}

export function createHealthCommonsProtocolFamilyGraphReader(
  artifact: HealthCommonsProtocolFamilyGraphArtifact,
  options: {
    protocolSearchEntries?: readonly HealthCommonsProtocolIndexEntry[];
  } = {},
): HealthCommonsProtocolFamilyGraphReader {
  const protocolsByKey = new Map(artifact.protocols.map((protocol) => [protocol.key, protocol]));
  const familiesByKey = new Map(artifact.families.map((family) => [family.key, family]));
  const protocolLookup = createProtocolLookup(artifact.protocols, "protocol_variant");
  const familyLookup = createProtocolLookup(artifact.families, "experiment_family");
  const protocolSearchEntries = options.protocolSearchEntries ?? artifact.protocols;

  const graphTargets = <T extends HealthCommonsProtocolFamilyGraphEntity>(
    input: {
      entity: HealthCommonsProtocolFamilyGraphEntity;
      relationType: HealthCommonsProtocolFamilyGraphEdge["type"];
      targetByKey: ReadonlyMap<string, T>;
    },
  ): T[] =>
    uniqueProtocolGraphEntities(
      artifact.edges
        .filter((edge) =>
          edge.sourceKey === input.entity.key &&
          edge.type === input.relationType
        )
        .map((edge) => input.targetByKey.get(edge.targetKey))
        .filter((entity): entity is T => entity !== undefined),
    );

  const protocolVariantsForFamily = (
    family: HealthCommonsProtocolFamilySummary,
    seenFamilyKeys = new Set<string>(),
  ): HealthCommonsProtocolIndexEntry[] => {
    if (seenFamilyKeys.has(family.key)) {
      return [];
    }

    seenFamilyKeys.add(family.key);
    const directRelated = graphTargets({
      entity: family,
      relationType: "related_protocol",
      targetByKey: protocolsByKey,
    });
    const byParentFamily = artifact.protocols.filter((protocol) =>
      artifact.edges.some((edge) =>
        edge.sourceKey === protocol.key &&
        edge.targetKey === family.key &&
        edge.type === "parent_family"
      )
    );
    const fromChildFamilies = graphTargets({
      entity: family,
      relationType: "child_family",
      targetByKey: familiesByKey,
    }).flatMap((childFamily) => protocolVariantsForFamily(childFamily, seenFamilyKeys));

    return uniqueProtocolGraphEntities([
      ...directRelated,
      ...byParentFamily,
      ...fromChildFamilies,
    ]);
  };
  const findGraphEntity = (input: {
    entityTypes: readonly HealthCommonsProtocolEntityType[];
    lookup: string;
  }): HealthCommonsProtocolFamilyGraphEntity | null => {
    for (const entityType of input.entityTypes) {
      const found = entityType === "protocol_variant"
        ? protocolLookup.find(input.lookup)
        : familyLookup.find(input.lookup);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return {
    artifact,
    catalogHash: artifact.catalogHash,
    childFamilies(family) {
      return graphTargets({
        entity: family,
        relationType: "child_family",
        targetByKey: familiesByKey,
      });
    },
    findEntity(input) {
      return findGraphEntity(input);
    },
    listProtocolMatches(input) {
      const matchedEntity = findGraphEntity({
        entityTypes: ["experiment_family", "protocol_variant"],
        lookup: input.lookup,
      });

      if (matchedEntity?.entityType === "protocol_variant") {
        return [{
          matchReason: "direct_protocol",
          protocol: matchedEntity as HealthCommonsProtocolIndexEntry,
        }];
      }

      if (matchedEntity?.entityType === "experiment_family") {
        return protocolVariantsForFamily(matchedEntity)
          .slice(0, normalizeLimit(input.limit, 5))
          .map((protocol) => ({
            matchReason: "direct_family",
            protocol,
          }));
      }

      return searchCompactProtocols(protocolSearchEntries, {
        limit: normalizeLimit(input.limit, 5),
        query: input.lookup,
      }).map((protocol) => ({
        matchReason: "query_match",
        protocol,
      }));
    },
    parentFamilies(protocol) {
      return graphTargets({
        entity: protocol,
        relationType: "parent_family",
        targetByKey: familiesByKey,
      });
    },
    protocolVariantsForFamily,
    relatedProtocolVariants(entity) {
      return graphTargets({
        entity,
        relationType: "related_protocol",
        targetByKey: protocolsByKey,
      });
    },
  };
}

export function createHealthCommonsRouteBundleReader(
  bundle: HealthCommonsWebRouteBundle,
): HealthCommonsRouteBundleReader {
  const reader = createHealthCommonsCatalogReader({
    artifactManifests: [],
    catalogHash: bundle.catalogHash,
    changes: [],
    entities: Object.values(bundle.entitiesByKey),
    evidenceAppraisals: bundle.evidenceAppraisals,
    redirects: bundle.redirects,
    schemaVersion: "murph.commons.catalog.v1",
  });

  return {
    ...reader,
    bundle,
    getSourceSnippet(sourceKey) {
      return bundle.sourceSnippets[stripRevision(sourceKey)] ?? null;
    },
    listReverseEdges(input = {}) {
      const relationTypes: ReadonlySet<string> | null = input.relationTypes
        ? new Set(input.relationTypes)
        : null;
      const targetKey = input.targetKey ? stripRevision(input.targetKey) : null;
      return bundle.reverseEdges.filter((edge) => {
        if (relationTypes && !relationTypes.has(edge.relation.type)) {
          return false;
        }
        if (targetKey && stripRevision(edge.relation.target) !== targetKey) {
          return false;
        }
        return true;
      });
    },
    revisionManifest: bundle.revisionManifest,
    route: bundle.route,
  };
}

export function createHealthCommonsCatalogReader(
  catalog: HealthCommonsCatalog,
): HealthCommonsCatalogReader {
  const entitiesByKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const entitiesBySlug = new Map(catalog.entities.map((entity) => [entity.slug, entity]));
  const entitiesByType = new Map<HealthCommonsEntityType, HealthCommonsEntity[]>();
  const entitiesByTrailingSlug = new Map<string, HealthCommonsEntity[]>();
  const redirectsBySource = new Map(catalog.redirects.map((redirect) => [redirect.from, redirect.to]));
  const redirectSourcesByTarget = new Map<string, string[]>();
  const evidenceAppraisalsByTarget = new Map<string, HealthCommonsEvidenceAppraisal[]>();
  const evidenceAppraisals = catalog.evidenceAppraisals;

  for (const appraisal of catalog.evidenceAppraisals) {
    const targetKey = stripRevision(appraisal.targetKey);
    const existing = evidenceAppraisalsByTarget.get(targetKey) ?? [];
    existing.push(appraisal);
    evidenceAppraisalsByTarget.set(targetKey, existing);
  }

  for (const entity of catalog.entities) {
    const existingByType = entitiesByType.get(entity.entityType) ?? [];
    existingByType.push(entity);
    entitiesByType.set(entity.entityType, existingByType);

    const trailingSlug = toTrailingSlug(entity.slug);
    const existingByTrailingSlug = entitiesByTrailingSlug.get(trailingSlug) ?? [];
    existingByTrailingSlug.push(entity);
    entitiesByTrailingSlug.set(trailingSlug, existingByTrailingSlug);
  }

  for (const redirect of catalog.redirects) {
    const existing = redirectSourcesByTarget.get(redirect.to) ?? [];
    existing.push(redirect.from);
    redirectSourcesByTarget.set(redirect.to, existing);
  }

  const resolveKey = (key: string): string => {
    let current = normalizeKeyInput(key);
    const seen = new Set<string>();

    while (redirectsBySource.has(current) && !seen.has(current)) {
      seen.add(current);
      current = redirectsBySource.get(current) ?? current;
    }

    return current;
  };

  const findByKey = (key: string): HealthCommonsEntity | null => {
    const resolvedKey = resolveKey(key);
    const exact = entitiesByKey.get(resolvedKey);
    if (exact) {
      return exact;
    }

    const baseKey = stripRevision(resolvedKey);
    if (baseKey === resolvedKey) {
      return null;
    }

    return entitiesByKey.get(resolveKey(baseKey)) ?? null;
  };

  const findBySlug = (slug: string): HealthCommonsEntity | null => {
    const normalizedSlug = normalizeRouteId(slug);
    return entitiesBySlug.get(normalizedSlug) ?? null;
  };

  const compactEntity = (entity: HealthCommonsEntity): HealthCommonsCompactEntity =>
    toCompactEntity(entity, redirectSourcesByTarget.get(entity.key) ?? []);

  const normalizeListOptions = (
    options: HealthCommonsEntityListOptions = {},
  ): HealthCommonsNormalizedEntityListOptions => {
    const normalized = normalizeEntitySelectionInput(options, DEFAULT_LIST_LIMIT);
    return {
      categories: normalized.categories,
      ignoredWildcards: normalized.ignoredWildcards,
      limit: normalized.limit,
      query: normalized.query,
      sourceKinds: normalized.sourceKinds,
      statuses: normalized.statuses,
    };
  };

  const selectCatalogEntities = (
    input: HealthCommonsCatalogSearchInput & { defaultLimit: number },
  ): HealthCommonsCatalogSearchResult[] => {
    const normalized = normalizeEntitySelectionInput(input, input.defaultLimit);
    const entityTypeSet = input.entityTypes ? new Set(input.entityTypes) : null;
    const statusSet = new Set<string>(normalized.statuses);
    const sourceKindSet = new Set<string>(normalized.sourceKinds);
    const tokens = tokenizeSearchQuery(normalized.query ?? "");
    const rawCandidates = normalized.candidateKeys === null
      ? catalog.entities
      : normalized.candidateKeys
          .map((key) => findByKey(key))
          .filter((entity): entity is HealthCommonsEntity => entity !== null);
    const seenCandidateKeys = new Set<string>();
    const results: HealthCommonsCatalogSearchResult[] = [];

    for (const entity of rawCandidates) {
      if (seenCandidateKeys.has(entity.key)) {
        continue;
      }
      seenCandidateKeys.add(entity.key);

      if (entityTypeSet && !entityTypeSet.has(entity.entityType)) {
        continue;
      }

      if (statusSet.size > 0 && (!entity.status || !statusSet.has(entity.status))) {
        continue;
      }

      if (sourceKindSet.size > 0 && (!entity.source || !sourceKindSet.has(entity.source.kind))) {
        continue;
      }

      if (!matchesCategories(entity, normalized.categories)) {
        continue;
      }

      const searchScore = scoreEntitySearch(
        entity,
        normalized.query ?? "",
        tokens,
        input.includeBody === true,
      );
      if (normalized.query && searchScore.score <= 0) {
        continue;
      }

      results.push({
        entity: compactEntity(entity),
        matchedFields: searchScore.matchedFields,
        score: searchScore.score,
      });
    }

    if (normalized.query) {
      results.sort(compareSearchResults);
    }

    return results.slice(0, normalized.limit);
  };

  const filterAndCompactList = (
    entityType: HealthCommonsEntityType,
    options: HealthCommonsEntityListOptions = {},
  ): HealthCommonsCompactEntity[] =>
    selectCatalogEntities({
      ...options,
      defaultLimit: DEFAULT_LIST_LIMIT,
      entityTypes: [entityType],
      includeBody: options.includeBody ?? true,
    }).map((result) => result.entity);

  const listRelated = (input: {
    entity: HealthCommonsEntity;
    entityTypes?: readonly HealthCommonsEntityType[];
    relationTypes?: readonly HealthCommonsRelationType[];
  }): HealthCommonsEntity[] =>
    resolveRelationEntities({
      entity: input.entity,
      entityTypes: input.entityTypes,
      relationTypes: input.relationTypes,
    }).map((entry) => entry.entity);

  const resolveRelations = (input: HealthCommonsRelationInput): HealthCommonsResolvedRelation[] => {
    const limit = normalizeLimit(input.limit, DEFAULT_RELATION_LIMIT);
    return resolveRelationEntities(input)
      .slice(0, limit)
      .map(({ entity, relation }) => ({
        entity: compactEntity(entity),
        relation,
      }));
  };

  const resolveSources = (input: HealthCommonsSourceInput): HealthCommonsResolvedSource[] => {
    const entity = typeof input.entity === "string" ? findByKey(input.entity) : input.entity;
    if (!entity) {
      return [];
    }

    const limit = normalizeLimit(input.limit, DEFAULT_SOURCE_LIMIT);
    return collectSourceReferences(entity, findByKey, {
      evidenceAppraisals: evidenceAppraisalsByTarget.get(entity.key) ?? [],
    })
      .slice(0, limit)
      .map(({ reasons, source }) => ({
        reasons,
        source: compactEntity(source),
      }));
  };

  const collectSourceKeys = (input: HealthCommonsSourceKeyInput): string[] => {
    const entity = typeof input.entity === "string" ? findByKey(input.entity) : input.entity;
    if (!entity) {
      return [];
    }

    return collectSourceReferences(entity, findByKey, {
      evidenceAppraisals: evidenceAppraisalsByTarget.get(entity.key) ?? [],
      includeSelf: input.includeSelf === true,
    }).map(({ source }) => source.key);
  };

  const search = (input: HealthCommonsCatalogSearchInput = {}): HealthCommonsCatalogSearchResult[] => {
    return selectCatalogEntities({
      ...input,
      defaultLimit: DEFAULT_SEARCH_LIMIT,
    });
  };

  function resolveRelationEntities(input: {
    entity: HealthCommonsEntity;
    entityTypes?: readonly HealthCommonsEntityType[];
    relationTypes?: readonly HealthCommonsRelationType[];
  }): { entity: HealthCommonsEntity; relation: HealthCommonsRelation }[] {
    const relationTypeSet: ReadonlySet<string> | null = input.relationTypes
      ? new Set(input.relationTypes)
      : null;
    const entityTypeSet = input.entityTypes ? new Set(input.entityTypes) : null;

    return (input.entity.relations ?? []).flatMap((relation) => {
      if (relationTypeSet && !relationTypeSet.has(relation.type)) {
        return [];
      }

      const target = findByKey(relation.target);
      if (!target) {
        return [];
      }

      if (entityTypeSet && !entityTypeSet.has(target.entityType)) {
        return [];
      }

      return [{ entity: target, relation }];
    });
  }

  return {
    catalogHash: catalog.catalogHash,
    collectSourceKeys,
    compactEntity,
    findByKey,
    findByRouteId({ entityType, routeId }) {
      const normalizedRouteId = normalizeRouteId(routeId);
      const keyCandidate = `${entityType}:${normalizedRouteId}`;
      const byKey = findByKey(keyCandidate);
      if (byKey) {
        return byKey.entityType === entityType ? byKey : null;
      }

      const bySlug = findBySlug(normalizedRouteId);
      if (bySlug) {
        return bySlug.entityType === entityType ? bySlug : null;
      }

      const byTrailingSlug = (entitiesByTrailingSlug.get(normalizedRouteId) ?? []).filter(
        (entity) => entity.entityType === entityType,
      );

      return byTrailingSlug.length === 1 ? byTrailingSlug[0] : null;
    },
    findBySlug,
    listByEntityType(entityType: HealthCommonsEntityType) {
      return entitiesByType.get(entityType)?.slice() ?? [];
    },
    listEvidenceAppraisals(input = {}) {
      const sourceKey = input.sourceKey ? stripRevision(resolveKey(input.sourceKey)) : null;
      const targetKey = input.targetKey ? stripRevision(resolveKey(input.targetKey)) : null;
      return evidenceAppraisals.filter((appraisal) => {
        if (sourceKey && stripRevision(resolveKey(appraisal.sourceKey)) !== sourceKey) {
          return false;
        }
        if (targetKey && stripRevision(resolveKey(appraisal.targetKey)) !== targetKey) {
          return false;
        }
        if (input.groupId && appraisal.groupId !== input.groupId) {
          return false;
        }
        return true;
      });
    },
    listMeasurementMethods(options) {
      return filterAndCompactList("measurement_method", options);
    },
    listProtocolVariants(options) {
      return filterAndCompactList("protocol_variant", options);
    },
    listRelated,
    listSourceArtifacts(options) {
      return filterAndCompactList("source_artifact", options);
    },
    resolveEntityContext(input) {
      const entity = typeof input.entity === "string" ? findByKey(input.entity) : input.entity;
      if (!entity) {
        return null;
      }

      return {
        entity: compactEntity(entity),
        relations: resolveRelations({
          entity,
          limit: input.relationLimit,
          relationTypes: input.relationTypes,
        }),
        sources: resolveSources({
          entity,
          limit: input.sourceLimit,
        }),
      };
    },
    resolveRelations,
    resolveSources,
    normalizeListOptions,
    search,
  };
}

function collectSourceReferences(
  entity: HealthCommonsEntity,
  findByKey: (key: string) => HealthCommonsEntity | null,
  options: {
    evidenceAppraisals?: readonly HealthCommonsEvidenceAppraisal[];
    includeSelf?: boolean;
  } = {},
): { reasons: readonly HealthCommonsSourceReference[]; source: HealthCommonsEntity }[] {
  const references = new Map<string, { reasons: HealthCommonsSourceReference[]; source: HealthCommonsEntity }>();

  const append = (key: string, reason: HealthCommonsSourceReference) => {
    const source = findByKey(key);
    if (!source || source.entityType !== "source_artifact") {
      return;
    }

    const existing = references.get(source.key);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }

    references.set(source.key, { reasons: [reason], source });
  };

  if (options.includeSelf !== false && entity.entityType === "source_artifact") {
    append(entity.key, sourceReference("self"));
  }

  for (const claim of entity.claims ?? []) {
    for (const sourceKey of claim.sourceKeys ?? []) {
      append(sourceKey, sourceReference("claim", { claimId: claim.claimId }));
    }
  }

  for (const group of entity.researchLandscape?.groups ?? []) {
    for (const sourceKey of group.sourceKeys) {
      append(sourceKey, sourceReference("research_landscape", { groupId: group.id }));
    }
  }

  for (const appraisal of options.evidenceAppraisals ?? []) {
    append(appraisal.sourceKey, sourceReference("evidence_appraisal", {
      appraisalKey: appraisal.key,
      groupId: appraisal.groupId,
    }));
  }

  for (const relation of entity.relations ?? []) {
    if (relation.type === "cites") {
      append(relation.target, sourceReference("relation", { relationType: relation.type }));
    }
  }

  return [...references.values()];
}

function sourceReference(
  kind: HealthCommonsSourceReferenceKind,
  options: {
    appraisalKey?: string;
    claimId?: string;
    groupId?: string;
    relationType?: string;
  } = {},
): HealthCommonsSourceReference {
  return {
    appraisalKey: options.appraisalKey ?? null,
    claimId: options.claimId ?? null,
    groupId: options.groupId ?? null,
    kind,
    relationType: options.relationType ?? null,
  };
}

function toCompactEntity(
  entity: HealthCommonsEntity,
  redirectSources: readonly string[],
): HealthCommonsCompactEntity {
  return {
    aliases: [...(entity.aliases ?? [])],
    categories: [...(entity.categories ?? [])],
    entityType: entity.entityType,
    evidence: entity.researchEvidence
      ? {
          aggregateRole: entity.researchEvidence.aggregateRole ?? null,
          designKind: entity.researchEvidence.designKind,
          designLabel: entity.researchEvidence.designLabel ?? null,
          durationLabel: entity.researchEvidence.durationLabel ?? null,
          participantCount: entity.researchEvidence.participantCount ?? null,
          populationLabel: entity.researchEvidence.populationLabel ?? null,
        }
      : null,
    key: entity.key,
    measurementMethod: toCompactMeasurementMethod(entity),
    measurementPlan: toCompactMeasurementPlan(entity),
    protocol: entity.protocol
      ? {
          cautionLevel: entity.safety?.cautionLevel ?? null,
          doseSignature: entity.protocol.doseSignature,
          durationMinutes: entity.protocol.durationMinutes ?? null,
          frequency: entity.protocol.frequency ?? null,
          recipeHash: entity.revision.recipeHash ?? null,
          runSpecRevisionId: entity.revision.runSpecRevisionId ?? null,
          target: entity.protocol.target ?? null,
        }
      : null,
    quality: entity.quality ?? null,
    revision: entity.revision,
    routeId: toTrailingSlug(entity.slug),
    routeIds: toRouteIds(entity, redirectSources),
    slug: entity.slug,
    source: entity.source
      ? {
          authors: entity.source.authors ?? null,
          citation: entity.source.citation ?? null,
          doi: entity.source.doi ?? null,
          journal: entity.source.journal ?? null,
          kind: entity.source.kind,
          pmid: entity.source.pmid ?? null,
          title: entity.source.title ?? null,
          url: entity.source.url ?? null,
          year: entity.source.year ?? null,
        }
      : null,
    status: entity.status ?? null,
    summary: entity.summary ?? null,
    title: entity.title,
  };
}

function toRouteIds(entity: HealthCommonsEntity, redirectSources: readonly string[]): string[] {
  const sameTypeRedirectSources = redirectSources.filter(
    (redirectSource) => entityTypePrefix(redirectSource) === entity.entityType,
  );
  return uniqueStrings([
    toTrailingSlug(entity.slug),
    entity.slug,
    stripEntityTypePrefix(entity.key),
    ...sameTypeRedirectSources.map(stripEntityTypePrefix),
  ]);
}

function toCompactMeasurementMethod(
  entity: HealthCommonsEntity,
): HealthCommonsCompactMeasurementMethod | null {
  const measurementMethod = entity.measurementMethod;
  if (!measurementMethod) {
    return null;
  }

  return {
    ...measurementMethod,
    burden: measurementMethod.burden ? { ...measurementMethod.burden } : undefined,
    confounders: measurementMethod.confounders ? [...measurementMethod.confounders] : undefined,
    fidelity: measurementMethod.fidelity
      ? {
          ...measurementMethod.fidelity,
          calibration: measurementMethod.fidelity.calibration
            ? [...measurementMethod.fidelity.calibration]
            : undefined,
          minimumRequirements: measurementMethod.fidelity.minimumRequirements
            ? [...measurementMethod.fidelity.minimumRequirements]
            : undefined,
          repeatabilityRisks: measurementMethod.fidelity.repeatabilityRisks
            ? [...measurementMethod.fidelity.repeatabilityRisks]
            : undefined,
        }
      : undefined,
    interpretation: measurementMethod.interpretation
      ? { ...measurementMethod.interpretation }
      : undefined,
    measuredBiomarkerKeys: measurementMethod.measuredBiomarkerKeys
      ? [...measurementMethod.measuredBiomarkerKeys]
      : undefined,
    modalities: [...measurementMethod.modalities],
    outputs: measurementMethod.outputs.map((output) => ({
      ...output,
      notes: output.notes ? [...output.notes] : undefined,
    })),
    privacy: measurementMethod.privacy
      ? {
          ...measurementMethod.privacy,
          notes: measurementMethod.privacy.notes ? [...measurementMethod.privacy.notes] : undefined,
        }
      : undefined,
    procedure: {
      ...measurementMethod.procedure,
      materials: measurementMethod.procedure.materials
        ? [...measurementMethod.procedure.materials]
        : undefined,
      schedule: measurementMethod.procedure.schedule
        ? [...measurementMethod.procedure.schedule]
        : undefined,
      steps: [...measurementMethod.procedure.steps],
    },
  };
}

function toCompactMeasurementPlan(
  entity: HealthCommonsEntity,
): HealthCommonsCompactMeasurementPlan | null {
  if (!entity.measurementPlan) {
    return null;
  }

  return {
    ...entity.measurementPlan,
    paths: entity.measurementPlan.paths.map((path) => ({
      ...path,
      methodKeys: [...path.methodKeys],
      notes: path.notes ? [...path.notes] : undefined,
      outcomeKeys: path.outcomeKeys ? [...path.outcomeKeys] : undefined,
      safetyOutcomeKeys: path.safetyOutcomeKeys ? [...path.safetyOutcomeKeys] : undefined,
    })),
  };
}

function createProtocolLookup<T extends HealthCommonsProtocolFamilyGraphEntity>(
  entities: readonly T[],
  lookupEntityType: HealthCommonsProtocolEntityType,
): { find(lookup: string): T | null } {
  const byKey = new Map<string, T>();
  const byRouteId = new Map<string, T>();
  const byAlias = new Map<string, T>();

  const setFirst = (map: Map<string, T>, key: string, entity: T) => {
    if (!key || map.has(key)) {
      return;
    }
    map.set(key, entity);
  };

  for (const entity of entities) {
    setFirst(byKey, normalizeLookupKey(entity.key), entity);
    setFirst(byRouteId, normalizeRouteId(entity.slug), entity);
    setFirst(byRouteId, normalizeRouteId(stripEntityTypePrefix(entity.key)), entity);
    for (const routeId of entity.routeIds) {
      setFirst(byRouteId, normalizeRouteId(routeId), entity);
    }
    for (const alias of entity.aliases) {
      setFirst(byAlias, normalizeSearchText(alias), entity);
    }
  }

  return {
    find(lookup) {
      const trimmed = lookup.trim();
      if (!trimmed) {
        return null;
      }

      const exact = byKey.get(normalizeLookupKey(trimmed));
      if (exact) {
        return exact;
      }

      const lookupType = protocolEntityTypePrefix(trimmed);
      if (lookupType && lookupType !== lookupEntityType) {
        return null;
      }

      const routeLookup = lookupType === lookupEntityType
        ? stripEntityTypePrefix(trimmed)
        : trimmed;

      return byRouteId.get(normalizeRouteId(routeLookup)) ??
        byAlias.get(normalizeSearchText(trimmed)) ??
        null;
    },
  };
}

function listCompactProtocols(
  protocols: readonly HealthCommonsProtocolIndexEntry[],
  options: HealthCommonsEntityListOptions,
): HealthCommonsProtocolIndexEntry[] {
  const normalized = normalizeEntitySelectionInput(options, DEFAULT_LIST_LIMIT);
  const statusSet = new Set<string>(normalized.statuses);
  const candidateKeys = normalized.candidateKeys === null
    ? null
    : new Set(normalized.candidateKeys.map(stripRevision));
  const filtered = protocols.filter((protocol) => {
    if (candidateKeys && !candidateKeys.has(protocol.key)) {
      return false;
    }
    if (statusSet.size > 0 && (!protocol.status || !statusSet.has(protocol.status))) {
      return false;
    }
    if (!matchesProtocolCategories(protocol, normalized.categories)) {
      return false;
    }
    return true;
  });

  if (!normalized.query) {
    return filtered.slice(0, normalized.limit);
  }

  return scoreCompactProtocols(filtered, normalized.query)
    .slice(0, normalized.limit)
    .map((result) => result.protocol);
}

function searchCompactProtocols(
  protocols: readonly HealthCommonsProtocolIndexEntry[],
  input: {
    limit: number;
    query: string;
  },
): HealthCommonsProtocolIndexEntry[] {
  const query = normalizeNullableSearchQuery(input.query);
  const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  if (!query) {
    return protocols.slice(0, limit);
  }

  return scoreCompactProtocols(protocols, query)
    .slice(0, limit)
    .map((result) => result.protocol);
}

function scoreCompactProtocols(
  protocols: readonly HealthCommonsProtocolIndexEntry[],
  normalizedQuery: string,
): { protocol: HealthCommonsProtocolIndexEntry; score: number }[] {
  const tokens = tokenizeSearchQuery(normalizedQuery);

  return protocols
    .map((protocol) => ({
      protocol,
      score: scoreCompactProtocolSearch(protocol, normalizedQuery, tokens),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const titleComparison = left.protocol.title.localeCompare(right.protocol.title);
      if (titleComparison !== 0) {
        return titleComparison;
      }

      return left.protocol.key.localeCompare(right.protocol.key);
    });
}

function scoreCompactProtocolSearch(
  protocol: HealthCommonsProtocolIndexEntry,
  normalizedQuery: string,
  tokens: readonly string[],
): number {
  let score = 0;

  for (const field of buildCompactProtocolSearchFields(protocol)) {
    const normalizedValue = normalizeSearchText(field.value);
    if (!normalizedValue) {
      continue;
    }

    if (normalizedValue === normalizedQuery) {
      score += field.weight * 12;
    } else if (normalizedValue.startsWith(normalizedQuery)) {
      score += field.weight * 8;
    } else if (normalizedValue.includes(normalizedQuery)) {
      score += field.weight * 5;
    }

    for (const token of tokens) {
      if (normalizedValue.includes(token)) {
        score += field.weight;
      }
    }
  }

  return score;
}

function buildCompactProtocolSearchFields(
  protocol: HealthCommonsProtocolIndexEntry,
): { value: string; weight: number }[] {
  return [
    { value: protocol.title, weight: 12 },
    { value: protocol.aliases.join(" "), weight: 10 },
    {
      value: [
        protocol.key,
        protocol.slug,
        protocol.routeId,
        ...protocol.routeIds,
      ].join(" "),
      weight: 9,
    },
    { value: protocol.categories.join(" "), weight: 8 },
    { value: protocol.summary ?? "", weight: 5 },
    { value: protocol.searchText ?? "", weight: 3 },
    {
      value: [
        protocol.status,
        protocol.traits.cautionLevel,
        protocol.traits.externalProtocol ? "external protocol" : "",
        protocol.traits.highCaution ? "high caution" : "",
        protocol.traits.murphCanonical ? "murph canonical" : "",
        protocol.traits.sourceAttributed ? "source attributed" : "",
      ].filter(isNonEmptyString).join(" "),
      weight: 4,
    },
  ];
}

function matchesProtocolCategories(
  protocol: HealthCommonsProtocolEntitySummary,
  normalizedCategories: readonly string[],
): boolean {
  if (normalizedCategories.length === 0) {
    return true;
  }

  const protocolCategories = new Set(protocol.categories.map(normalizeCategory));
  return normalizedCategories.every((category) => protocolCategories.has(category));
}

function uniqueProtocolGraphEntities<T extends HealthCommonsProtocolFamilyGraphEntity>(
  entities: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const entity of entities) {
    if (seen.has(entity.key)) {
      continue;
    }

    seen.add(entity.key);
    result.push(entity);
  }

  return result;
}

function matchesCategories(
  entity: HealthCommonsEntity,
  normalizedCategories: readonly string[],
): boolean {
  if (normalizedCategories.length === 0) {
    return true;
  }

  const entityCategories = new Set((entity.categories ?? []).map(normalizeCategory));
  return normalizedCategories.every((category) => entityCategories.has(category));
}

function scoreEntitySearch(
  entity: HealthCommonsEntity,
  normalizedQuery: string,
  tokens: readonly string[],
  includeBody: boolean,
): { matchedFields: readonly HealthCommonsSearchMatchedField[]; score: number } {
  if (!normalizedQuery) {
    return { matchedFields: [], score: 0 };
  }

  const matchedFields: HealthCommonsSearchMatchedField[] = [];
  let score = 0;

  for (const field of buildSearchFields(entity, includeBody)) {
    const normalizedValue = normalizeSearchText(field.value);
    if (!normalizedValue) {
      continue;
    }

    const fieldScore = scoreSearchField(field.field, normalizedValue, normalizedQuery, tokens);
    if (fieldScore <= 0) {
      continue;
    }

    score += fieldScore;
    if (!matchedFields.includes(field.field)) {
      matchedFields.push(field.field);
    }
  }

  return { matchedFields, score };
}

function buildSearchFields(
  entity: HealthCommonsEntity,
  includeBody: boolean,
): { field: HealthCommonsSearchMatchedField; value: string }[] {
  const fields: { field: HealthCommonsSearchMatchedField; value: string }[] = [
    { field: "key", value: entity.key },
    { field: "slug", value: entity.slug },
    { field: "title", value: entity.title },
    { field: "summary", value: entity.summary ?? "" },
    { field: "aliases", value: (entity.aliases ?? []).join(" ") },
    { field: "categories", value: (entity.categories ?? []).join(" ") },
  ];

  if (entity.protocol) {
    fields.push({
      field: "protocol",
      value: [
        entity.protocol.doseSignature,
        entity.protocol.target,
        ...(entity.protocol.steps ?? []),
        ...(entity.protocol.tips ?? []),
        ...(entity.protocol.keepInMind ?? []),
      ].filter(isNonEmptyString).join(" "),
    });
  }

  const measurementMethod = toCompactMeasurementMethod(entity);
  if (measurementMethod) {
    fields.push({
      field: "measurement_method",
      value: collectSearchableUnknownValues(measurementMethod).join(" "),
    });
  }

  const measurementPlan = toCompactMeasurementPlan(entity);
  if (measurementPlan) {
    fields.push({
      field: "measurement_plan",
      value: collectSearchableUnknownValues(measurementPlan).join(" "),
    });
  }

  if (entity.source) {
    fields.push({
      field: "source",
      value: [
        entity.source.title,
        entity.source.authors,
        entity.source.journal,
        entity.source.pmid,
        entity.source.doi,
        entity.source.citation,
        entity.source.url,
      ].filter(isNonEmptyString).join(" "),
    });
  }

  fields.push({
    field: "claims",
    value: (entity.claims ?? []).flatMap((claim) => [
      claim.claimId,
      claim.text,
      ...(claim.caveats ?? []),
    ]).join(" "),
  });

  if (includeBody) {
    fields.push({ field: "body", value: entity.body });
  }

  return fields;
}

function scoreSearchField(
  field: HealthCommonsSearchMatchedField,
  normalizedValue: string,
  normalizedQuery: string,
  tokens: readonly string[],
): number {
  const weight = searchFieldWeight(field);
  let score = 0;

  if (normalizedValue === normalizedQuery) {
    score += weight * 12;
  } else if (normalizedValue.startsWith(normalizedQuery)) {
    score += weight * 8;
  } else if (normalizedValue.includes(normalizedQuery)) {
    score += weight * 5;
  }

  for (const token of tokens) {
    if (normalizedValue.includes(token)) {
      score += weight;
    }
  }

  return score;
}

function searchFieldWeight(field: HealthCommonsSearchMatchedField): number {
  switch (field) {
    case "title":
      return 12;
    case "aliases":
      return 10;
    case "key":
    case "slug":
      return 9;
    case "categories":
      return 8;
    case "summary":
    case "protocol":
    case "measurement_method":
    case "measurement_plan":
    case "source":
      return 5;
    case "claims":
      return 3;
    case "body":
      return 1;
  }
}

function compareSearchResults(
  left: HealthCommonsCatalogSearchResult,
  right: HealthCommonsCatalogSearchResult,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  const titleComparison = left.entity.title.localeCompare(right.entity.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.entity.key.localeCompare(right.entity.key);
}

interface HealthCommonsNormalizedEntitySelectionInput extends HealthCommonsNormalizedEntityListOptions {
  candidateKeys: readonly string[] | null;
}

const FILTER_WILDCARDS = new Set(["*", "all", "any"]);

function normalizeEntitySelectionInput(
  input: HealthCommonsEntityListOptions,
  defaultLimit: number,
): HealthCommonsNormalizedEntitySelectionInput {
  const categories = normalizeRepeatableFilter(input.categories, {
    normalize: normalizeCategory,
  });
  const statuses = normalizeClosedRepeatableFilter(input.statuses, {
    allowedValues: HEALTH_COMMONS_PAGE_STATUSES,
    fieldLabel: "status",
    isAllowedValue: isHealthCommonsPageStatus,
    normalize: normalizeStatusFilterValue,
  });
  const sourceKinds = normalizeClosedRepeatableFilter(input.sourceKinds, {
    allowedValues: HEALTH_COMMONS_SOURCE_KINDS,
    fieldLabel: "source kind",
    isAllowedValue: isHealthCommonsSourceKind,
    normalize: normalizeSourceKindFilterValue,
  });

  return {
    candidateKeys: normalizeCandidateKeys(input.candidateKeys),
    categories: categories.values,
    ignoredWildcards: {
      categories: categories.ignoredWildcards,
      sourceKinds: sourceKinds.ignoredWildcards,
      statuses: statuses.ignoredWildcards,
    },
    limit: normalizeLimit(input.limit, defaultLimit),
    query: normalizeNullableSearchQuery(input.query),
    sourceKinds: sourceKinds.values,
    statuses: statuses.values,
  };
}

function normalizeRepeatableFilter(
  input: readonly string[] | undefined,
  options: {
    normalize(value: string): string;
  },
): { ignoredWildcards: string[]; values: string[] } {
  const ignoredWildcards: string[] = [];
  const values: string[] = [];

  for (const rawValue of input ?? []) {
    for (const part of rawValue.split(",")) {
      const normalized = normalizeFilterPart(part, {
        ignoredWildcards,
        normalize: options.normalize,
      });
      if (normalized && !values.includes(normalized)) {
        values.push(normalized);
      }
    }
  }

  return {
    ignoredWildcards,
    values,
  };
}

function normalizeClosedRepeatableFilter<TValue extends string>(
  input: readonly string[] | undefined,
  options: {
    allowedValues: readonly TValue[];
    fieldLabel: string;
    isAllowedValue(value: string): value is TValue;
    normalize(value: string): string;
  },
): { ignoredWildcards: string[]; values: TValue[] } {
  const ignoredWildcards: string[] = [];
  const values: TValue[] = [];

  for (const rawValue of input ?? []) {
    for (const part of rawValue.split(",")) {
      const normalized = normalizeFilterPart(part, {
        ignoredWildcards,
        normalize: options.normalize,
      });
      if (!normalized) {
        continue;
      }

      if (options.isAllowedValue(normalized)) {
        if (!values.includes(normalized)) {
          values.push(normalized);
        }
        continue;
      }

      throw new Error(
        `Unknown Health Commons ${options.fieldLabel} filter. Expected one of: ${options.allowedValues.join(", ")}, or * for all.`,
      );
    }
  }

  return {
    ignoredWildcards,
    values,
  };
}

function normalizeFilterPart(
  rawValue: string,
  options: {
    ignoredWildcards: string[];
    normalize(value: string): string;
  },
): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  if (FILTER_WILDCARDS.has(normalizeSearchText(trimmed))) {
    options.ignoredWildcards.push(trimmed);
    return null;
  }

  const normalized = options.normalize(trimmed);
  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeCandidateKeys(input: readonly string[] | undefined): string[] | null {
  if (input === undefined) {
    return null;
  }

  const keys = (input ?? []).flatMap((rawValue) =>
    rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return uniqueStrings(keys);
}

function normalizeLimit(value: number | undefined, defaultValue: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.max(0, Math.min(Math.trunc(value), MAX_LIMIT));
}

function normalizeRouteId(value: string): string {
  return safeDecodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "").toLowerCase();
}

function normalizeLookupKey(value: string): string {
  return safeDecodeURIComponent(stripRevision(value)).trim().toLowerCase();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeGeneratedWebRoot(value: string | URL | undefined): URL {
  if (!value) {
    return ensureTrailingSlashUrl(defaultGeneratedWebRootUrl());
  }

  const url = typeof value === "string"
    ? stringToGeneratedWebRootUrl(value)
    : value;
  return ensureTrailingSlashUrl(url);
}

function generatedWebArtifactUrl(artifactPath: string, generatedWebRoot: string | URL | undefined): URL {
  if (!isSafeGeneratedWebArtifactPath(artifactPath)) {
    throw new Error(`Unsafe Health Commons generated web artifact path: ${artifactPath}`);
  }

  return new URL(artifactPath, normalizeGeneratedWebRoot(generatedWebRoot));
}

function routeIdFromGeneratedWebBundlePath(bundlePath: string): string {
  const parts = bundlePath.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== "bundles" ||
    !parts[2]?.endsWith(".json")
  ) {
    throw new Error(`Unexpected Health Commons generated web bundle path: ${bundlePath}`);
  }

  return parts[2].slice(0, -".json".length);
}

function assertProjectionPathMatchesRoute(
  projectionKey: HealthCommonsWebExperimentProjectionKey,
  artifactPath: string,
  routeId: string,
): void {
  const expectedPath = experimentProjectionPathForRouteId(projectionKey, routeId);
  if (artifactPath !== expectedPath) {
    throw new Error(
      `Health Commons generated web projection path does not match route bundle id: ${artifactPath}.`,
    );
  }
}

function experimentProjectionPathForRouteId(
  projectionKey: HealthCommonsWebExperimentProjectionKey,
  routeId: string,
): string {
  switch (projectionKey) {
    case "experiment.protocol":
      return `tabs/experiments/${routeId}/protocol.json`;
    case "experiment.research":
      return `tabs/experiments/${routeId}/research.json`;
    case "experiment.results-public":
      return `tabs/experiments/${routeId}/results-public.json`;
    case "experiment.shell":
      return `shell/experiments/${routeId}.json`;
  }
}

function assertGeneratedWebExperimentArtifactMatchesRoute(
  artifact: unknown,
  input: {
    artifactPath: string;
    routeId: string;
    routeKey: string;
  },
): void {
  if (!isRecord(artifact) || artifact["key"] !== input.routeKey) {
    throw new Error(`Health Commons generated web projection key does not match route index: ${input.artifactPath}.`);
  }

  if ("id" in artifact && artifact["id"] !== input.routeId) {
    throw new Error(`Health Commons generated web projection id does not match route index: ${input.artifactPath}.`);
  }

  const route = artifact["route"];
  if (!isRecord(route) || route["routeId"] !== input.routeId) {
    throw new Error(`Health Commons generated web projection route does not match route index: ${input.artifactPath}.`);
  }
}

function isSafeGeneratedWebArtifactPath(value: string): boolean {
  if (/^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith("/") || value.includes("\\")) {
    return false;
  }

  const parts = value.split("/");
  return parts.length > 0 && parts.every((part) =>
    part.length > 0 && part !== "." && part !== ".."
  );
}

function ensureTrailingSlashUrl(value: URL): URL {
  return value.href.endsWith("/") ? value : new URL(`${value.href}/`);
}

function defaultGeneratedProtocolIndexUrl(): URL {
  return new URL(
    DEFAULT_GENERATED_PROTOCOL_INDEX_PATH,
    defaultHealthCommonsPackageRootUrl(),
  );
}

function defaultGeneratedProtocolRunSpecsUrl(): URL {
  return new URL(
    DEFAULT_GENERATED_PROTOCOL_RUN_SPECS_PATH,
    defaultHealthCommonsPackageRootUrl(),
  );
}

function defaultGeneratedProtocolFamilyGraphUrl(): URL {
  return new URL(
    DEFAULT_GENERATED_PROTOCOL_FAMILY_GRAPH_PATH,
    defaultHealthCommonsPackageRootUrl(),
  );
}

function defaultGeneratedBiomarkerDesiredDirectionsUrl(): URL {
  return new URL(
    DEFAULT_GENERATED_BIOMARKER_DESIRED_DIRECTIONS_PATH,
    defaultHealthCommonsPackageRootUrl(),
  );
}

function defaultGeneratedKnowledgeIndexUrl(): URL {
  return new URL(
    DEFAULT_GENERATED_KNOWLEDGE_INDEX_PATH,
    defaultHealthCommonsPackageRootUrl(),
  );
}

function defaultHealthCommonsPackageRootUrl(): URL {
  const envValue = process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]?.trim();
  if (envValue) {
    return ensureTrailingSlashUrl(stringToFileOrUrl(envValue));
  }

  return ensureTrailingSlashUrl(new URL("..", import.meta.url));
}

function defaultGeneratedWebRootUrl(): URL {
  const envPackageRoot = process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]?.trim();
  if (envPackageRoot) {
    return ensureTrailingSlashUrl(
      new URL("generated/web", defaultHealthCommonsPackageRootUrl()),
    );
  }

  const runtimeSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fallbackGeneratedWebRootUrl = pathToFileURL(resolve(
    process.cwd(),
    "packages/health-commons/generated/web",
  ));
  const candidateRootUrls = [
    fallbackGeneratedWebRootUrl,
    pathToFileURL(resolve(process.cwd(), "../packages/health-commons/generated/web")),
    pathToFileURL(resolve(process.cwd(), "../../packages/health-commons/generated/web")),
    pathToFileURL(resolve(runtimeSourceRoot, "generated/web")),
  ];

  for (const candidateRootUrl of candidateRootUrls) {
    const candidateRoot = candidateRootUrl.protocol === "file:"
      ? fileURLToPath(candidateRootUrl)
      : null;
    if (candidateRoot && existsSync(resolve(candidateRoot, "routes/index.json"))) {
      return ensureTrailingSlashUrl(candidateRootUrl);
    }
  }

  return ensureTrailingSlashUrl(fallbackGeneratedWebRootUrl);
}

function stringToGeneratedWebRootUrl(value: string): URL {
  return stringToFileOrUrl(value);
}

function stringToFileOrUrl(value: string): URL {
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    return new URL(value);
  }

  return pathToFileURL(resolve(value));
}

function parseJsonObject(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Health Commons generated artifact must be a JSON object.");
  }

  return parsed;
}

function assertGeneratedHealthCommonsProtocolIndex(
  value: unknown,
): asserts value is HealthCommonsProtocolIndexArtifact {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated protocol index is invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["protocols"]) ||
    !value["protocols"].every(isGeneratedProtocolIndexEntry) ||
    !value["protocols"].every(hasGeneratedProtocolSearchText)
  ) {
    throw new Error("Health Commons generated protocol index is invalid.");
  }
}

function assertGeneratedHealthCommonsProtocolRunSpecs(
  value: unknown,
): asserts value is HealthCommonsProtocolRunSpecsArtifact {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated protocol run specs are invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["protocols"]) ||
    !value["protocols"].every(isGeneratedProtocolRunSpec)
  ) {
    throw new Error("Health Commons generated protocol run specs are invalid.");
  }
}

function assertGeneratedHealthCommonsProtocolFamilyGraph(
  value: unknown,
): asserts value is HealthCommonsProtocolFamilyGraphArtifact {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated protocol family graph is invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["protocols"]) ||
    !value["protocols"].every(isGeneratedProtocolIndexEntry) ||
    !Array.isArray(value["families"]) ||
    !value["families"].every(isGeneratedProtocolFamilySummary) ||
    !Array.isArray(value["edges"]) ||
    !value["edges"].every(isGeneratedProtocolFamilyGraphEdge)
  ) {
    throw new Error("Health Commons generated protocol family graph is invalid.");
  }
}

function isGeneratedProtocolRunSpec(value: unknown): boolean {
  if (!isGeneratedProtocolIndexEntry(value) || !isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["expectedSignalDescriptions"]) &&
    Array.isArray(value["testPlans"]) &&
    Array.isArray(value["whyItWorks"]) &&
    value["whyItWorks"].every(isString) &&
    isNullableRecord(value["experimentOnboarding"]) &&
    isNullableRecord(value["protocol"]) &&
    isNullableRecord(value["safety"])
  );
}

function isGeneratedProtocolIndexEntry(value: unknown): boolean {
  return isGeneratedProtocolEntitySummary(value, "protocol_variant") &&
    isRecord(value) &&
    (value["searchText"] === undefined || typeof value["searchText"] === "string") &&
    isGeneratedProtocolTraits(value["traits"]);
}

function hasGeneratedProtocolSearchText(value: unknown): boolean {
  return isRecord(value) && typeof value["searchText"] === "string";
}

function isGeneratedProtocolFamilySummary(value: unknown): boolean {
  return isGeneratedProtocolEntitySummary(value, "experiment_family");
}

function isGeneratedProtocolEntitySummary(
  value: unknown,
  entityType: HealthCommonsProtocolEntityType,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    Array.isArray(value["categories"]) &&
    value["categories"].every(isString) &&
    value["entityType"] === entityType &&
    typeof value["key"] === "string" &&
    typeof value["relativePath"] === "string" &&
    isGeneratedProtocolRevision(value["revision"]) &&
    typeof value["routeId"] === "string" &&
    Array.isArray(value["routeIds"]) &&
    value["routeIds"].every(isString) &&
    typeof value["slug"] === "string" &&
    isNullableString(value["status"]) &&
    isNullableString(value["summary"]) &&
    typeof value["title"] === "string"
  );
}

function isGeneratedProtocolRevision(value: unknown): boolean {
  return isRecord(value) &&
    typeof value["pageRevisionId"] === "string" &&
    isNullableString(value["recipeHash"]) &&
    isNullableString(value["runSpecRevisionId"]);
}

function isGeneratedProtocolTraits(value: unknown): boolean {
  return isRecord(value) &&
    isNullableString(value["cautionLevel"]) &&
    typeof value["externalProtocol"] === "boolean" &&
    typeof value["highCaution"] === "boolean" &&
    typeof value["murphCanonical"] === "boolean" &&
    typeof value["sourceAttributed"] === "boolean";
}

function isGeneratedProtocolFamilyGraphEdge(value: unknown): boolean {
  return isRecord(value) &&
    typeof value["sourceKey"] === "string" &&
    typeof value["targetKey"] === "string" &&
    (
      value["type"] === "child_family" ||
      value["type"] === "parent_family" ||
      value["type"] === "related_protocol"
    );
}

function assertGeneratedHealthCommonsBiomarkerDesiredDirections(
  value: unknown,
): asserts value is HealthCommonsBiomarkerDesiredDirectionsArtifact {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !==
      HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["biomarkers"]) ||
    !value["biomarkers"].every(isGeneratedBiomarkerDesiredDirectionEntry)
  ) {
    throw new Error(
      "Health Commons generated biomarker desired directions are invalid.",
    );
  }
}

function assertGeneratedWebRouteIndex(
  value: unknown,
): asserts value is HealthCommonsWebRouteIndex {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated web route index is invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["routes"]) ||
    !value["routes"].every(isGeneratedWebRouteIndexEntry)
  ) {
    throw new Error("Health Commons generated web route index is invalid.");
  }
}

function assertGeneratedWebExperimentIndex(
  value: unknown,
): asserts value is HealthCommonsWebExperimentIndex {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated web experiment index is invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_EXPERIMENT_INDEX_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["experiments"]) ||
    !value["experiments"].every(isGeneratedWebExperimentIndexEntry)
  ) {
    throw new Error("Health Commons generated web experiment index is invalid.");
  }
}

function assertGeneratedWebBiomarkerIndex(
  value: unknown,
): asserts value is HealthCommonsWebBiomarkerIndex {
  if (!isRecord(value)) {
    throw new Error("Health Commons generated web biomarker index is invalid.");
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_BIOMARKER_INDEX_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    !Array.isArray(value["biomarkers"]) ||
    !value["biomarkers"].every(isGeneratedWebBiomarkerIndexEntry)
  ) {
    throw new Error("Health Commons generated web biomarker index is invalid.");
  }
}

function assertGeneratedWebExperimentResearchTab(
  value: unknown,
  tabPath: string,
): asserts value is HealthCommonsWebExperimentResearchTab {
  if (!isRecord(value)) {
    throw new Error(`Health Commons generated experiment research tab is invalid: ${tabPath}.`);
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_EXPERIMENT_RESEARCH_TAB_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    typeof value["key"] !== "string" ||
    typeof value["title"] !== "string" ||
    typeof value["description"] !== "string" ||
    !Array.isArray(value["protocolKeepInMind"]) ||
    !value["protocolKeepInMind"].every(isString) ||
    !Array.isArray(value["researchStats"]) ||
    !value["researchStats"].every(isGeneratedWebResearchStat) ||
    !isRecord(value["revision"]) ||
    !isRecord(value["route"]) ||
    !isGeneratedWebRoute(value["route"]) ||
    value["route"]["entityType"] !== "protocol_variant" ||
    !Array.isArray(value["studies"]) ||
    !value["studies"].every(isGeneratedWebResearchStudy)
  ) {
    throw new Error(`Health Commons generated experiment research tab is invalid: ${tabPath}.`);
  }

  if (
    value["researchGroups"] !== undefined &&
    (
      !Array.isArray(value["researchGroups"]) ||
      !value["researchGroups"].every(isGeneratedWebResearchGroup)
    )
  ) {
    throw new Error(`Health Commons generated experiment research groups are invalid: ${tabPath}.`);
  }

  if (
    value["researchLandscape"] !== undefined &&
    !isGeneratedWebResearchLandscape(value["researchLandscape"])
  ) {
    throw new Error(`Health Commons generated experiment research landscape is invalid: ${tabPath}.`);
  }
}

function assertGeneratedWebExperimentShell(
  value: unknown,
  artifactPath: string,
): asserts value is HealthCommonsWebExperimentShell {
  if (!isRecord(value)) {
    throw new Error(`Health Commons generated experiment shell is invalid: ${artifactPath}.`);
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_EXPERIMENT_SHELL_SCHEMA_VERSION ||
    typeof value["baselineDays"] !== "number" ||
    typeof value["catalogHash"] !== "string" ||
    typeof value["category"] !== "string" ||
    typeof value["description"] !== "string" ||
    typeof value["durationDays"] !== "number" ||
    typeof value["evidenceLabel"] !== "string" ||
    typeof value["evidenceLevel"] !== "number" ||
    typeof value["id"] !== "string" ||
    (typeof value["image"] !== "string" && value["image"] !== null) ||
    typeof value["key"] !== "string" ||
    !isRecord(value["revision"]) ||
    !isRecord(value["route"]) ||
    !isGeneratedWebRoute(value["route"]) ||
    value["route"]["entityType"] !== "protocol_variant" ||
    typeof value["title"] !== "string"
  ) {
    throw new Error(`Health Commons generated experiment shell is invalid: ${artifactPath}.`);
  }
}

function assertGeneratedWebExperimentProtocolTab(
  value: unknown,
  artifactPath: string,
): asserts value is HealthCommonsWebExperimentProtocolTab {
  if (!isRecord(value)) {
    throw new Error(`Health Commons generated experiment protocol tab is invalid: ${artifactPath}.`);
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_EXPERIMENT_PROTOCOL_TAB_SCHEMA_VERSION ||
    typeof value["baselineDays"] !== "number" ||
    typeof value["catalogHash"] !== "string" ||
    typeof value["durationDays"] !== "number" ||
    !Array.isArray(value["expectedSignals"]) ||
    !value["expectedSignals"].every(isGeneratedWebExperimentSignal) ||
    !Array.isArray(value["experts"]) ||
    !value["experts"].every(isGeneratedWebExperimentExpert) ||
    typeof value["id"] !== "string" ||
    typeof value["key"] !== "string" ||
    !Array.isArray(value["measurementPaths"]) ||
    !value["measurementPaths"].every(isGeneratedWebMeasurementPath) ||
    !Array.isArray(value["mechanismChain"]) ||
    !value["mechanismChain"].every(isGeneratedWebMechanismChainStep) ||
    !Array.isArray(value["protocol"]) ||
    !value["protocol"].every(isGeneratedWebProtocolStep) ||
    !Array.isArray(value["protocolFacts"]) ||
    !value["protocolFacts"].every(isGeneratedWebProtocolFact) ||
    !Array.isArray(value["protocolTips"]) ||
    !value["protocolTips"].every(isString) ||
    !isRecord(value["revision"]) ||
    !isRecord(value["route"]) ||
    !isGeneratedWebRoute(value["route"]) ||
    value["route"]["entityType"] !== "protocol_variant" ||
    !isGeneratedWebSafety(value["safety"]) ||
    typeof value["title"] !== "string" ||
    (
      value["sessionShape"] !== undefined &&
      !isGeneratedWebSessionShape(value["sessionShape"])
    ) ||
    typeof value["whyItWorks"] !== "string"
  ) {
    throw new Error(`Health Commons generated experiment protocol tab is invalid: ${artifactPath}.`);
  }
}

function isGeneratedWebMechanismChainStep(value: unknown): boolean {
  return isRecord(value) &&
    typeof value["content"] === "string" &&
    typeof value["label"] === "string";
}

function assertGeneratedWebExperimentResultsPublic(
  value: unknown,
  artifactPath: string,
): asserts value is HealthCommonsWebExperimentResultsPublic {
  if (!isRecord(value)) {
    throw new Error(`Health Commons generated experiment results public is invalid: ${artifactPath}.`);
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_EXPERIMENT_RESULTS_PUBLIC_SCHEMA_VERSION ||
    typeof value["baselineDays"] !== "number" ||
    typeof value["catalogHash"] !== "string" ||
    !isGeneratedWebExperimentCommons(value["commons"]) ||
    typeof value["durationDays"] !== "number" ||
    typeof value["id"] !== "string" ||
    typeof value["key"] !== "string" ||
    !Array.isArray(value["protocol"]) ||
    !value["protocol"].every(isGeneratedWebProtocolStep) ||
    !isRecord(value["revision"]) ||
    !isRecord(value["route"]) ||
    !isGeneratedWebRoute(value["route"]) ||
    value["route"]["entityType"] !== "protocol_variant" ||
    typeof value["title"] !== "string"
  ) {
    throw new Error(`Health Commons generated experiment results public is invalid: ${artifactPath}.`);
  }
}

function assertGeneratedWebRouteBundle(
  value: unknown,
  bundlePath: string,
): asserts value is HealthCommonsWebRouteBundle {
  if (!isRecord(value)) {
    throw new Error(`Health Commons generated web route bundle is invalid: ${bundlePath}.`);
  }

  if (
    value["schemaVersion"] !== HEALTH_COMMONS_WEB_ROUTE_BUNDLE_SCHEMA_VERSION ||
    typeof value["catalogHash"] !== "string" ||
    typeof value["primaryKey"] !== "string" ||
    !isRecord(value["route"]) ||
    !isGeneratedWebRoute(value["route"]) ||
    !isRecord(value["entitiesByKey"]) ||
    !Array.isArray(value["evidenceAppraisals"]) ||
    !Array.isArray(value["redirects"]) ||
    !Array.isArray(value["reverseEdges"]) ||
    !isRecord(value["revisionManifest"]) ||
    !isRecord(value["sourceSnippets"])
  ) {
    throw new Error(`Health Commons generated web route bundle is invalid: ${bundlePath}.`);
  }

  const entities = Object.values(value["entitiesByKey"]);
  if (!entities.every(isRecord) || !entities.every(isGeneratedWebBundleEntity)) {
    throw new Error(`Health Commons generated web route bundle has unsafe entities: ${bundlePath}.`);
  }
}

function isGeneratedWebRouteIndexEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const projections = value["projections"];
  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    typeof value["bundlePath"] === "string" &&
    isSafeGeneratedWebArtifactPath(value["bundlePath"]) &&
    typeof value["entityType"] === "string" &&
    typeof value["key"] === "string" &&
    typeof value["routeId"] === "string" &&
    typeof value["slug"] === "string" &&
    (
      projections === undefined ||
      (
        isRecord(projections) &&
        Object.entries(projections).every(([projectionKey, artifactPath]) =>
          isGeneratedWebProjectionKey(projectionKey) &&
          typeof artifactPath === "string" &&
          isSafeGeneratedWebArtifactPath(artifactPath)
        )
      )
    )
  );
}

function isGeneratedWebProjectionKey(value: string): value is HealthCommonsWebProjectionKey {
  return HEALTH_COMMONS_WEB_PROJECTION_KEYS.some((projectionKey) => projectionKey === value);
}

function isGeneratedWebExperimentIndexEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    typeof value["baselineDays"] === "number" &&
    Array.isArray(value["categories"]) &&
    value["categories"].every(isString) &&
    typeof value["bundlePath"] === "string" &&
    typeof value["category"] === "string" &&
    typeof value["description"] === "string" &&
    typeof value["durationDays"] === "number" &&
    typeof value["evidenceLabel"] === "string" &&
    typeof value["evidenceLevel"] === "number" &&
    typeof value["hidden"] === "boolean" &&
    (typeof value["image"] === "string" || value["image"] === null) &&
    typeof value["key"] === "string" &&
    (typeof value["quality"] === "string" || value["quality"] === null) &&
    isRecord(value["revision"]) &&
    typeof value["routeId"] === "string" &&
    typeof value["slug"] === "string" &&
    (
      value["sortRank"] === undefined ||
      typeof value["sortRank"] === "number" ||
      value["sortRank"] === null
    ) &&
    (typeof value["status"] === "string" || value["status"] === null) &&
    typeof value["studyCount"] === "number" &&
    (typeof value["summary"] === "string" || value["summary"] === null) &&
    typeof value["title"] === "string"
  );
}

function isGeneratedWebBiomarkerIndexEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    typeof value["bundlePath"] === "string" &&
    Array.isArray(value["categories"]) &&
    value["categories"].every(isString) &&
    isHealthCommonsBiomarkerDesiredDirection(value["desiredDirection"]) &&
    Array.isArray(value["fallbackRanges"]) &&
    value["fallbackRanges"].every(isGeneratedWebBiomarkerFallbackRange) &&
    typeof value["hidden"] === "boolean" &&
    typeof value["key"] === "string" &&
    typeof value["published"] === "boolean" &&
    (typeof value["quality"] === "string" || value["quality"] === null) &&
    isRecord(value["revision"]) &&
    typeof value["routeId"] === "string" &&
    typeof value["slug"] === "string" &&
    (typeof value["status"] === "string" || value["status"] === null) &&
    (typeof value["summary"] === "string" || value["summary"] === null) &&
    typeof value["title"] === "string" &&
    (typeof value["unit"] === "string" || value["unit"] === null)
  );
}

function isGeneratedWebBiomarkerFallbackRange(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const lowerBound = value["lowerBound"];
  const upperBound = value["upperBound"];
  return typeof value["applicability"] === "string"
    && Array.isArray(value["eligibleSpecimenKinds"])
    && value["eligibleSpecimenKinds"].length > 0
    && value["eligibleSpecimenKinds"].every((kind) => kind === "serum" || kind === "plasma")
    && typeof value["label"] === "string"
    && typeof value["unit"] === "string"
    && (lowerBound === undefined || isGeneratedWebBiomarkerFallbackBound(lowerBound))
    && (upperBound === undefined || isGeneratedWebBiomarkerFallbackBound(upperBound))
    && (lowerBound !== undefined || upperBound !== undefined)
    && !(
      isGeneratedWebBiomarkerFallbackBound(lowerBound)
      && isGeneratedWebBiomarkerFallbackBound(upperBound)
      && lowerBound["value"] >= upperBound["value"]
    );
}

function isGeneratedWebBiomarkerFallbackBound(value: unknown): value is {
  inclusive: boolean;
  value: number;
} {
  return isRecord(value)
    && typeof value["inclusive"] === "boolean"
    && typeof value["value"] === "number"
    && Number.isFinite(value["value"]);
}

function isGeneratedWebRoute(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    typeof value["entityType"] === "string" &&
    typeof value["routeId"] === "string" &&
    typeof value["slug"] === "string"
  );
}

function isGeneratedWebResearchStat(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["label"] === "string" &&
    (typeof value["value"] === "string" || typeof value["value"] === "number")
  );
}

function isGeneratedWebResearchLandscape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["bottomLine"] === "string" &&
    isGeneratedWebResearchConfidenceLabel(value["confidenceLabel"]) &&
    typeof value["mainCaveat"] === "string" &&
    typeof value["primaryClaim"] === "string"
  );
}

function isGeneratedWebResearchGroup(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["defaultOpen"] === undefined || typeof value["defaultOpen"] === "boolean") &&
    typeof value["id"] === "string" &&
    typeof value["label"] === "string" &&
    isGeneratedWebResearchStance(value["stance"]) &&
    Array.isArray(value["studies"]) &&
    value["studies"].every(isGeneratedWebResearchStudy) &&
    typeof value["summary"] === "string"
  );
}

function isGeneratedWebResearchStudy(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Object.keys(value).every((key) => GENERATED_WEB_RESEARCH_STUDY_KEYS.has(key)) &&
    typeof value["authors"] === "string" &&
    (value["caveat"] === undefined || typeof value["caveat"] === "string") &&
    (value["designLabel"] === undefined || typeof value["designLabel"] === "string") &&
    (value["displayPriority"] === undefined || typeof value["displayPriority"] === "number") &&
    (value["duration"] === undefined || typeof value["duration"] === "string") &&
    (value["finding"] === undefined || typeof value["finding"] === "string") &&
    (
      value["findingKind"] === undefined ||
      isGeneratedWebResearchFindingKind(value["findingKind"])
    ) &&
    (value["groupId"] === undefined || typeof value["groupId"] === "string") &&
    (value["headline"] === undefined || typeof value["headline"] === "string") &&
    (value["implication"] === undefined || typeof value["implication"] === "string") &&
    typeof value["journal"] === "string" &&
    (
      value["participantCountKind"] === undefined ||
      isGeneratedWebResearchParticipantCountKind(value["participantCountKind"])
    ) &&
    (value["population"] === undefined || typeof value["population"] === "string") &&
    (
      value["result"] === undefined ||
      isGeneratedWebResearchResult(value["result"])
    ) &&
    (
      value["scope"] === undefined ||
      isGeneratedWebResearchScope(value["scope"])
    ) &&
    (
      value["stance"] === undefined ||
      isGeneratedWebResearchStance(value["stance"])
    ) &&
    typeof value["title"] === "string" &&
    isGeneratedWebResearchStudyType(value["type"]) &&
    (value["year"] === undefined || typeof value["year"] === "number") &&
    (value["participants"] === undefined || typeof value["participants"] === "number") &&
    (value["includedStudyCount"] === undefined || typeof value["includedStudyCount"] === "number") &&
    (
      value["url"] === undefined ||
      (typeof value["url"] === "string" && isSafeGeneratedWebHttpUrl(value["url"]))
    )
  );
}

function isSafeGeneratedWebHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isGeneratedWebExperimentSignal(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["baseline"] === undefined || typeof value["baseline"] === "string") &&
    typeof value["delta"] === "string" &&
    (value["description"] === undefined || typeof value["description"] === "string") &&
    isGeneratedWebSignalDirection(value["direction"]) &&
    (value["displayValue"] === undefined || typeof value["displayValue"] === "string") &&
    (
      value["estimatedChange"] === undefined ||
      isGeneratedWebExperimentSignalEstimate(value["estimatedChange"])
    ) &&
    (
      value["biomarkerRouteId"] === undefined ||
      typeof value["biomarkerRouteId"] === "string"
    ) &&
    typeof value["expected"] === "string" &&
    typeof value["label"] === "string" &&
    (
      value["protocolProminence"] === undefined ||
      value["protocolProminence"] === "focus" ||
      value["protocolProminence"] === "context"
    ) &&
    (value["unit"] === undefined || typeof value["unit"] === "string") &&
    typeof value["value"] === "string"
  );
}

function isGeneratedWebExperimentSignalEstimate(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value["kind"] === "mixed_or_contextual") {
    return (
      (value["basis"] === undefined || typeof value["basis"] === "string") &&
      isGeneratedWebExperimentSignalEstimateConfidence(value["confidence"]) &&
      (value["window"] === undefined || typeof value["window"] === "string")
    );
  }

  return (
    (value["kind"] === "absolute" || value["kind"] === "relative_percent") &&
    (value["basis"] === undefined || typeof value["basis"] === "string") &&
    isGeneratedWebExperimentSignalEstimateConfidence(value["confidence"]) &&
    typeof value["high"] === "number" &&
    typeof value["low"] === "number" &&
    typeof value["unit"] === "string" &&
    (value["window"] === undefined || typeof value["window"] === "string")
  );
}

function isGeneratedWebExperimentSignalEstimateConfidence(value: unknown): boolean {
  return (
    value === undefined ||
    value === "low" ||
    value === "moderate" ||
    value === "high" ||
    value === "mixed"
  );
}

function isGeneratedWebMeasurementPath(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["isDefault"] === "boolean" &&
    typeof value["label"] === "string" &&
    Array.isArray(value["methodKeys"]) &&
    value["methodKeys"].every(isString) &&
    Array.isArray(value["methods"]) &&
    value["methods"].every(isGeneratedWebMeasurementMethodReference) &&
    Array.isArray(value["notes"]) &&
    value["notes"].every(isString) &&
    Array.isArray(value["outcomeLabels"]) &&
    value["outcomeLabels"].every(isString) &&
    typeof value["pathId"] === "string" &&
    typeof value["required"] === "boolean" &&
    Array.isArray(value["safetyOutcomeLabels"]) &&
    value["safetyOutcomeLabels"].every(isString) &&
    typeof value["tier"] === "string"
  );
}

function isGeneratedWebMeasurementMethodReference(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["href"] === undefined || typeof value["href"] === "string") &&
    typeof value["key"] === "string" &&
    Array.isArray(value["modalities"]) &&
    value["modalities"].every(isString) &&
    (value["privacy"] === undefined || isGeneratedWebMeasurementMethodPrivacy(value["privacy"])) &&
    (value["routeId"] === undefined || typeof value["routeId"] === "string") &&
    typeof value["shortName"] === "string" &&
    (value["summary"] === undefined || typeof value["summary"] === "string") &&
    typeof value["tier"] === "string" &&
    typeof value["title"] === "string"
  );
}

function isGeneratedWebMeasurementMethodPrivacy(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["containsIdentifiableImages"] === undefined ||
      typeof value["containsIdentifiableImages"] === "boolean") &&
    (value["localOnlyRecommended"] === undefined ||
      typeof value["localOnlyRecommended"] === "boolean") &&
    Array.isArray(value["notes"]) &&
    value["notes"].every(isString)
  );
}

function isGeneratedWebProtocolStep(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["detail"] === "string" &&
    typeof value["number"] === "number" &&
    typeof value["title"] === "string"
  );
}

function isGeneratedWebSessionShape(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["label"] === undefined || typeof value["label"] === "string") &&
    Array.isArray(value["segments"]) &&
    value["segments"].every(isGeneratedWebSessionShapeSegment) &&
    (
      value["summarySegments"] === undefined ||
      (
        Array.isArray(value["summarySegments"]) &&
        value["summarySegments"].every(isGeneratedWebSessionShapeSegment)
      )
    ) &&
    (
      value["ticks"] === undefined ||
      (Array.isArray(value["ticks"]) && value["ticks"].every(isGeneratedWebSessionShapeTick))
    )
  );
}

function isGeneratedWebSessionShapeTick(value: unknown): boolean {
  if (typeof value === "string") {
    return true;
  }
  if (!isRecord(value) || typeof value["label"] !== "string") {
    return false;
  }

  const hasOffset = typeof value["offsetMinutes"] === "number" &&
    Number.isFinite(value["offsetMinutes"]) &&
    value["offsetMinutes"] >= 0;
  const hasPosition = typeof value["positionPercent"] === "number" &&
    Number.isFinite(value["positionPercent"]) &&
    value["positionPercent"] >= 0 &&
    value["positionPercent"] <= 100;

  return hasOffset !== hasPosition;
}

function isGeneratedWebSessionShapeSegment(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["durationMinutes"] === "number" &&
    value["durationMinutes"] > 0 &&
    isGeneratedWebSessionShapeSegmentKind(value["kind"]) &&
    typeof value["label"] === "string"
  );
}

function isGeneratedWebSessionShapeSegmentKind(value: unknown): boolean {
  return (
    value === "preparation" ||
    value === "stimulus" ||
    value === "recovery" ||
    value === "cooldown" ||
    value === "transition" ||
    value === "context"
  );
}

function isGeneratedWebProtocolFact(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["detail"] === undefined || typeof value["detail"] === "string") &&
    typeof value["label"] === "string" &&
    typeof value["value"] === "string"
  );
}

function isGeneratedWebExperimentExpert(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["field"] === "string" &&
    typeof value["initials"] === "string" &&
    typeof value["name"] === "string" &&
    (value["profileImageUrl"] === undefined || typeof value["profileImageUrl"] === "string") &&
    typeof value["quote"] === "string"
  );
}

function isGeneratedWebSafety(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["cautionLevel"] === "number" &&
    Array.isArray(value["precautions"]) &&
    value["precautions"].every(isString) &&
    Array.isArray(value["whoShouldAvoid"]) &&
    value["whoShouldAvoid"].every(isString)
  );
}

function isGeneratedWebExperimentCommons(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value["aliases"]) &&
    value["aliases"].every(isString) &&
    typeof value["catalogHash"] === "string" &&
    typeof value["key"] === "string" &&
    typeof value["pageRevisionId"] === "string" &&
    (typeof value["recipeHash"] === "string" || value["recipeHash"] === null) &&
    typeof value["routeId"] === "string" &&
    (typeof value["runSpecRevisionId"] === "string" || value["runSpecRevisionId"] === null) &&
    typeof value["slug"] === "string"
  );
}

function isGeneratedWebResearchConfidenceLabel(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_CONFIDENCE_LABELS.has(value);
}

function isGeneratedBiomarkerDesiredDirectionEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    value["desiredDirection"] !== null &&
    isHealthCommonsBiomarkerDesiredDirection(value["desiredDirection"])
  );
}

function isHealthCommonsBiomarkerDesiredDirection(value: unknown): boolean {
  return value === null
    || (typeof value === "string"
      && (HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS as readonly string[]).includes(value));
}

function isGeneratedWebSignalDirection(value: unknown): boolean {
  return value === "up" || value === "down" || value === "neutral";
}

function isGeneratedWebResearchFindingKind(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_FINDING_KINDS.has(value);
}

function isGeneratedWebResearchParticipantCountKind(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_PARTICIPANT_COUNT_KINDS.has(value);
}

function isGeneratedWebResearchResult(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_RESULTS.has(value);
}

function isGeneratedWebResearchScope(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_SCOPES.has(value);
}

function isGeneratedWebResearchStance(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_STANCES.has(value);
}

function isGeneratedWebResearchStudyType(value: unknown): boolean {
  return typeof value === "string" && GENERATED_WEB_RESEARCH_STUDY_TYPES.has(value);
}

const GENERATED_WEB_RESEARCH_STUDY_KEYS = new Set<string>([
  "authors",
  "caveat",
  "designLabel",
  "displayPriority",
  "duration",
  "finding",
  "findingKind",
  "groupId",
  "headline",
  "implication",
  "includedStudyCount",
  "journal",
  "participantCountKind",
  "participants",
  "population",
  "result",
  "scope",
  "stance",
  "title",
  "type",
  "url",
  "year",
]);

const GENERATED_WEB_RESEARCH_CONFIDENCE_LABELS = new Set<string>([
  "early",
  "limited",
  "mixed",
  "moderate",
  "strong",
]);
const GENERATED_WEB_RESEARCH_FINDING_KINDS = new Set<string>([
  "finding",
  "protocol_takeaway",
  "why_it_matters",
]);
const GENERATED_WEB_RESEARCH_PARTICIPANT_COUNT_KINDS = new Set<string>([
  "approximate",
  "range",
  "reported",
]);
const GENERATED_WEB_RESEARCH_RESULTS = new Set<string>([
  "mixed",
  "negative",
  "no_clear_advantage",
  "not_efficacy_evidence",
  "positive",
]);
const GENERATED_WEB_RESEARCH_SCOPES = new Set<string>([
  "adjacent_variant",
  "clinical_supervised",
  "direct_protocol",
  "general_guideline",
  "measurement_context",
  "same_mechanism",
]);
const GENERATED_WEB_RESEARCH_STANCES = new Set<string>([
  "context_only",
  "contradicts",
  "does_not_confirm",
  "mixed",
  "safety_boundary",
  "supports",
]);
const GENERATED_WEB_RESEARCH_STUDY_TYPES = new Set<string>([
  "GUIDE",
  "INT",
  "MA",
  "MECH",
  "N1",
  "OBS",
  "RCT",
  "REV",
  "SRC",
]);

function isGeneratedWebBundleEntity(value: Record<string, unknown>): boolean {
  if (
    typeof value["entityType"] !== "string" ||
    typeof value["body"] !== "string" ||
    typeof value["key"] !== "string"
  ) {
    return false;
  }

  if (value["entityType"] !== "source_artifact") {
    return true;
  }

  const body = value["body"];
  const relations = value["relations"];
  return (
    (body === "" || body.startsWith("**Findings:** ")) &&
    Array.isArray(relations) &&
    relations.length === 0
  );
}

function normalizeKeyInput(value: string): string {
  return value.trim();
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function stripEntityTypePrefix(key: string): string {
  return stripRevision(safeDecodeURIComponent(key)).replace(/^[a-z_]+:/iu, "");
}

function entityTypePrefix(key: string): string | null {
  const baseKey = stripRevision(safeDecodeURIComponent(key));
  const separatorIndex = baseKey.indexOf(":");
  return separatorIndex > 0 ? baseKey.slice(0, separatorIndex).toLowerCase() : null;
}

function protocolEntityTypePrefix(key: string): HealthCommonsProtocolEntityType | null {
  const prefix = entityTypePrefix(key);
  return prefix === "experiment_family" || prefix === "protocol_variant"
    ? prefix
    : null;
}

function toTrailingSlug(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function normalizeCategory(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function normalizeNullableSearchQuery(value: string | undefined): string | null {
  const normalized = normalizeSearchText(value ?? "");
  return normalized || null;
}

function normalizeStatusFilterValue(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function normalizeSourceKindFilterValue(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
}

function isHealthCommonsPageStatus(value: string): value is HealthCommonsPageStatus {
  return HEALTH_COMMONS_PAGE_STATUSES.some((status) => status === value);
}

function isHealthCommonsSourceKind(value: string): value is HealthCommonsSourceKind {
  return HEALTH_COMMONS_SOURCE_KINDS.some((kind) => kind === value);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim();
}

function tokenizeSearchQuery(normalizedQuery: string): string[] {
  return uniqueStrings(normalizedQuery.split(/[^a-z0-9]+/u).filter(Boolean));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function collectSearchableUnknownValues(value: unknown): string[] {
  const values: string[] = [];
  appendSearchableUnknownValues(value, values, 0);
  return values;
}

function appendSearchableUnknownValues(value: unknown, values: string[], depth: number): void {
  if (depth > 4) {
    return;
  }

  if (typeof value === "string") {
    values.push(value);
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    values.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendSearchableUnknownValues(item, values, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    values.push(key);
    appendSearchableUnknownValues(nestedValue, values, depth + 1);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableRecord(value: unknown): value is Record<string, unknown> | null {
  return value === null || isRecord(value);
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
