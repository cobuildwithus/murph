import type {
  HealthCommonsCatalog,
  HealthCommonsCatalogEntity,
  HealthCommonsExpectedSignalDescription,
  HealthCommonsExperimentOnboarding,
  HealthCommonsProtocolSpec,
  HealthCommonsRelationType,
  HealthCommonsRevision,
  HealthCommonsSafety,
  HealthCommonsTestPlan,
} from "@murphai/contracts";

import type { HealthCommonsWebRouteIndex } from "./web-artifacts.ts";

export const HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION =
  "murph.commons.protocol-index.v1" as const;
export const HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION =
  "murph.commons.protocol-run-specs.v1" as const;
export const HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION =
  "murph.commons.protocol-family-graph.v1" as const;

export type HealthCommonsProtocolEntityType =
  | "experiment_family"
  | "protocol_variant";

export interface HealthCommonsProtocolRevisionRef {
  pageRevisionId: string;
  recipeHash: string | null;
  runSpecRevisionId: string | null;
}

export interface HealthCommonsProtocolTraits {
  cautionLevel: string | null;
  externalProtocol: boolean;
  highCaution: boolean;
  murphCanonical: boolean;
  sourceAttributed: boolean;
}

export interface HealthCommonsProtocolEntitySummary {
  aliases: string[];
  categories: string[];
  entityType: HealthCommonsProtocolEntityType;
  key: string;
  relativePath: string;
  revision: HealthCommonsProtocolRevisionRef;
  routeId: string;
  routeIds: string[];
  slug: string;
  status: string | null;
  summary: string | null;
  title: string;
}

export type HealthCommonsProtocolFamilySummary = HealthCommonsProtocolEntitySummary & {
  entityType: "experiment_family";
};

export interface HealthCommonsProtocolIndexEntry
  extends HealthCommonsProtocolEntitySummary {
  entityType: "protocol_variant";
  traits: HealthCommonsProtocolTraits;
}

export interface HealthCommonsProtocolIndexArtifact {
  catalogHash: string;
  protocols: HealthCommonsProtocolIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION;
}

export interface HealthCommonsProtocolRunSpec
  extends HealthCommonsProtocolIndexEntry {
  expectedSignalDescriptions: HealthCommonsExpectedSignalDescription[];
  experimentOnboarding: HealthCommonsExperimentOnboarding | null;
  protocol: HealthCommonsProtocolSpec | null;
  safety: HealthCommonsSafety | null;
  testPlans: HealthCommonsTestPlan[];
  whyItWorks: string[];
}

export interface HealthCommonsProtocolRunSpecsArtifact {
  catalogHash: string;
  protocols: HealthCommonsProtocolRunSpec[];
  schemaVersion: typeof HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION;
}

export interface HealthCommonsProtocolFamilyGraphEdge {
  sourceKey: string;
  targetKey: string;
  type: Extract<
    HealthCommonsRelationType,
    "child_family" | "parent_family" | "related_protocol"
  >;
}

export interface HealthCommonsProtocolFamilyGraphArtifact {
  catalogHash: string;
  edges: HealthCommonsProtocolFamilyGraphEdge[];
  families: HealthCommonsProtocolFamilySummary[];
  protocols: HealthCommonsProtocolIndexEntry[];
  schemaVersion: typeof HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION;
}

export interface HealthCommonsProtocolGeneratedArtifacts {
  familyGraph: HealthCommonsProtocolFamilyGraphArtifact;
  index: HealthCommonsProtocolIndexArtifact;
  runSpecs: HealthCommonsProtocolRunSpecsArtifact;
}

export function buildHealthCommonsProtocolGeneratedArtifacts(input: {
  catalog: HealthCommonsCatalog;
  routeIndex: HealthCommonsWebRouteIndex;
}): HealthCommonsProtocolGeneratedArtifacts {
  const routeEntriesByKey = groupRouteEntriesByKey(input.routeIndex);
  const protocols = input.catalog.entities
    .filter(isProtocolVariant)
    .map((entity) => toProtocolIndexEntry(entity, routeEntriesByKey))
    .sort(compareProtocolSummaries);
  const runSpecs = input.catalog.entities
    .filter(isProtocolVariant)
    .map((entity) => toProtocolRunSpec(entity, routeEntriesByKey))
    .sort(compareProtocolSummaries);
  const families = input.catalog.entities
    .filter(isExperimentFamily)
    .map((entity) => toProtocolFamilySummary(entity, routeEntriesByKey))
    .sort(compareProtocolSummaries);

  return {
    familyGraph: {
      catalogHash: input.catalog.catalogHash,
      edges: buildProtocolFamilyGraphEdges(input.catalog),
      families,
      protocols,
      schemaVersion: HEALTH_COMMONS_PROTOCOL_FAMILY_GRAPH_SCHEMA_VERSION,
    },
    index: {
      catalogHash: input.catalog.catalogHash,
      protocols,
      schemaVersion: HEALTH_COMMONS_PROTOCOL_INDEX_SCHEMA_VERSION,
    },
    runSpecs: {
      catalogHash: input.catalog.catalogHash,
      protocols: runSpecs,
      schemaVersion: HEALTH_COMMONS_PROTOCOL_RUN_SPECS_SCHEMA_VERSION,
    },
  };
}

function groupRouteEntriesByKey(
  routeIndex: HealthCommonsWebRouteIndex,
): ReadonlyMap<string, HealthCommonsWebRouteIndex["routes"]> {
  const routeEntriesByKey = new Map<string, HealthCommonsWebRouteIndex["routes"]>();

  for (const route of routeIndex.routes) {
    const entries = routeEntriesByKey.get(route.key) ?? [];
    entries.push(route);
    routeEntriesByKey.set(route.key, entries);
  }

  return routeEntriesByKey;
}

function toProtocolFamilySummary(
  entity: HealthCommonsCatalogEntity & { entityType: "experiment_family" },
  routeEntriesByKey: ReadonlyMap<string, HealthCommonsWebRouteIndex["routes"]>,
): HealthCommonsProtocolFamilySummary {
  return {
    ...toProtocolEntitySummary(entity, routeEntriesByKey),
    entityType: "experiment_family",
  };
}

function toProtocolRunSpec(
  entity: HealthCommonsCatalogEntity & { entityType: "protocol_variant" },
  routeEntriesByKey: ReadonlyMap<string, HealthCommonsWebRouteIndex["routes"]>,
): HealthCommonsProtocolRunSpec {
  return {
    ...toProtocolIndexEntry(entity, routeEntriesByKey),
    expectedSignalDescriptions: [...(entity.expectedSignalDescriptions ?? [])],
    experimentOnboarding: entity.experimentOnboarding ?? null,
    protocol: entity.protocol ?? null,
    safety: entity.safety ?? null,
    testPlans: [...(entity.testPlans ?? [])],
    whyItWorks: [...(entity.whyItWorks ?? [])],
  };
}

function toProtocolIndexEntry(
  entity: HealthCommonsCatalogEntity & { entityType: "protocol_variant" },
  routeEntriesByKey: ReadonlyMap<string, HealthCommonsWebRouteIndex["routes"]>,
): HealthCommonsProtocolIndexEntry {
  return {
    ...toProtocolEntitySummary(entity, routeEntriesByKey),
    entityType: "protocol_variant",
    traits: toProtocolTraits(entity),
  };
}

function toProtocolEntitySummary(
  entity: HealthCommonsCatalogEntity & {
    entityType: HealthCommonsProtocolEntityType;
  },
  routeEntriesByKey: ReadonlyMap<string, HealthCommonsWebRouteIndex["routes"]>,
): HealthCommonsProtocolEntitySummary {
  const routeIds = buildProtocolRouteIds(entity, routeEntriesByKey.get(entity.key) ?? []);

  return {
    aliases: [...(entity.aliases ?? [])],
    categories: [...(entity.categories ?? [])],
    entityType: entity.entityType,
    key: entity.key,
    relativePath: entity.relativePath,
    revision: revisionRefForEntity(entity.revision),
    routeId: routeIds[0] ?? toTrailingRouteId(entity.slug),
    routeIds,
    slug: entity.slug,
    status: entity.status ?? null,
    summary: entity.summary ?? null,
    title: entity.title,
  };
}

function buildProtocolRouteIds(
  entity: HealthCommonsCatalogEntity,
  routeEntries: HealthCommonsWebRouteIndex["routes"],
): string[] {
  const primaryRoute = routeEntries.find((entry) =>
    entry.routeId === routeIdFromBundlePath(entry.bundlePath)
  );

  return uniqueStrings([
    primaryRoute?.routeId,
    ...routeEntries.map((entry) => entry.routeId),
    toTrailingRouteId(entity.slug),
    stripEntityTypePrefix(entity.key),
    entity.slug,
  ]);
}

function buildProtocolFamilyGraphEdges(
  catalog: HealthCommonsCatalog,
): HealthCommonsProtocolFamilyGraphEdge[] {
  const graphEntityKeys = new Set(
    catalog.entities
      .filter((entity) =>
        entity.entityType === "experiment_family" ||
        entity.entityType === "protocol_variant"
      )
      .map((entity) => entity.key),
  );
  const edges: HealthCommonsProtocolFamilyGraphEdge[] = [];

  for (const entity of catalog.entities) {
    if (!graphEntityKeys.has(entity.key)) {
      continue;
    }

    for (const relation of entity.relations ?? []) {
      if (!isProtocolFamilyGraphRelationType(relation.type)) {
        continue;
      }

      const targetKey = stripRevision(relation.target);
      if (!graphEntityKeys.has(targetKey)) {
        continue;
      }

      edges.push({
        sourceKey: entity.key,
        targetKey,
        type: relation.type,
      });
    }
  }

  return edges.sort((left, right) =>
    `${left.sourceKey}:${left.type}:${left.targetKey}`.localeCompare(
      `${right.sourceKey}:${right.type}:${right.targetKey}`,
    )
  );
}

function toProtocolTraits(
  entity: HealthCommonsCatalogEntity & { entityType: "protocol_variant" },
): HealthCommonsProtocolTraits {
  const categories = new Set(entity.categories ?? []);
  const cautionLevel = entity.safety?.cautionLevel ?? null;

  return {
    cautionLevel,
    externalProtocol: categories.has("external-protocol"),
    highCaution: cautionLevel === "high",
    murphCanonical: categories.has("murph-canonical"),
    sourceAttributed: categories.has("source-attributed"),
  };
}

function revisionRefForEntity(revision: HealthCommonsRevision): HealthCommonsProtocolRevisionRef {
  return {
    pageRevisionId: revision.pageRevisionId,
    recipeHash: revision.recipeHash ?? null,
    runSpecRevisionId: revision.runSpecRevisionId ?? null,
  };
}

function compareProtocolSummaries(
  left: HealthCommonsProtocolEntitySummary,
  right: HealthCommonsProtocolEntitySummary,
): number {
  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.key.localeCompare(right.key);
}

function isProtocolVariant(
  entity: HealthCommonsCatalogEntity,
): entity is HealthCommonsCatalogEntity & { entityType: "protocol_variant" } {
  return entity.entityType === "protocol_variant";
}

function isExperimentFamily(
  entity: HealthCommonsCatalogEntity,
): entity is HealthCommonsCatalogEntity & { entityType: "experiment_family" } {
  return entity.entityType === "experiment_family";
}

function isProtocolFamilyGraphRelationType(
  value: string,
): value is HealthCommonsProtocolFamilyGraphEdge["type"] {
  return value === "child_family" ||
    value === "parent_family" ||
    value === "related_protocol";
}

function routeIdFromBundlePath(bundlePath: string): string | null {
  const match = /^bundles\/[^/]+\/(.+)\.json$/u.exec(bundlePath);
  return match?.[1] ?? null;
}

function toTrailingRouteId(slug: string): string {
  return slug.replace(/^\/+/u, "").replace(/\/+$/u, "").split("/").at(-1) ?? slug;
}

function stripEntityTypePrefix(key: string): string {
  return key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
}

function stripRevision(key: string): string {
  const revisionIndex = key.indexOf("@sha256:");
  return revisionIndex >= 0 ? key.slice(0, revisionIndex) : key;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}
