import { readFileSync } from "node:fs";

import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsEntityType,
  type HealthCommonsProtocolSpec,
  type HealthCommonsRelation,
  type HealthCommonsRelationType,
} from "@murphai/contracts";

export type HealthCommonsEntity = HealthCommonsCatalogEntity;

export type HealthCommonsSearchMatchedField =
  | "aliases"
  | "body"
  | "categories"
  | "claims"
  | "key"
  | "protocol"
  | "slug"
  | "source"
  | "summary"
  | "title";

export interface LoadGeneratedHealthCommonsCatalogOptions {
  catalogPath?: string | URL;
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

export interface HealthCommonsCompactEntity {
  aliases: readonly string[];
  categories: readonly string[];
  entityType: HealthCommonsEntityType;
  evidence: HealthCommonsCompactResearchEvidence | null;
  key: string;
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

export interface HealthCommonsCatalogSearchInput {
  categories?: readonly string[];
  entityTypes?: readonly HealthCommonsEntityType[];
  includeBody?: boolean;
  limit?: number;
  query?: string;
}

export interface HealthCommonsEntityListOptions {
  categories?: readonly string[];
  limit?: number;
  query?: string;
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
  | "relation"
  | "research_landscape"
  | "self";

export interface HealthCommonsSourceReference {
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
  search(input?: HealthCommonsCatalogSearchInput): HealthCommonsCatalogSearchResult[];
}

const DEFAULT_GENERATED_CATALOG_URL = new URL("../generated/catalog.json", import.meta.url);
const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_RELATION_LIMIT = 12;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_SOURCE_LIMIT = 8;
const MAX_LIMIT = 500;

let cachedGeneratedCatalogReader: HealthCommonsCatalogReader | null = null;

export function loadGeneratedHealthCommonsCatalog(
  options: LoadGeneratedHealthCommonsCatalogOptions = {},
): HealthCommonsCatalog {
  const raw = readFileSync(options.catalogPath ?? DEFAULT_GENERATED_CATALOG_URL, "utf8");
  return healthCommonsCatalogSchema.parse(JSON.parse(raw));
}

export function getGeneratedHealthCommonsCatalogReader(): HealthCommonsCatalogReader {
  cachedGeneratedCatalogReader ??= createHealthCommonsCatalogReader(
    loadGeneratedHealthCommonsCatalog(),
  );
  return cachedGeneratedCatalogReader;
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

  const filterAndCompactList = (
    entityType: HealthCommonsEntityType,
    options: HealthCommonsEntityListOptions = {},
  ): HealthCommonsCompactEntity[] => {
    const input: HealthCommonsCatalogSearchInput = {
      entityTypes: [entityType],
      limit: options.limit ?? DEFAULT_LIST_LIMIT,
      ...(options.categories ? { categories: options.categories } : {}),
      ...(options.query ? { query: options.query } : {}),
    };

    if (input.query || input.categories) {
      return search(input).map((result) => result.entity);
    }

    return (entitiesByType.get(entityType) ?? [])
      .slice(0, normalizeLimit(input.limit, DEFAULT_LIST_LIMIT))
      .map(compactEntity);
  };

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
    return collectSourceReferences(entity, findByKey)
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
      includeSelf: input.includeSelf === true,
    }).map(({ source }) => source.key);
  };

  const search = (input: HealthCommonsCatalogSearchInput = {}): HealthCommonsCatalogSearchResult[] => {
    const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_LIMIT);
    const entityTypeSet = input.entityTypes ? new Set(input.entityTypes) : null;
    const categories = (input.categories ?? []).map(normalizeCategory).filter(Boolean);
    const normalizedQuery = normalizeSearchText(input.query ?? "");
    const tokens = tokenizeSearchQuery(normalizedQuery);

    const results = catalog.entities.flatMap((entity): HealthCommonsCatalogSearchResult[] => {
      if (entityTypeSet && !entityTypeSet.has(entity.entityType)) {
        return [];
      }

      if (!matchesCategories(entity, categories)) {
        return [];
      }

      const searchScore = scoreEntitySearch(entity, normalizedQuery, tokens, input.includeBody === true);
      if (normalizedQuery && searchScore.score <= 0) {
        return [];
      }

      return [
        {
          entity: compactEntity(entity),
          matchedFields: searchScore.matchedFields,
          score: searchScore.score,
        },
      ];
    });

    results.sort(compareSearchResults);
    return results.slice(0, limit);
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
        return byKey;
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
    search,
  };
}

function collectSourceReferences(
  entity: HealthCommonsEntity,
  findByKey: (key: string) => HealthCommonsEntity | null,
  options: { includeSelf?: boolean } = {},
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
    claimId?: string;
    groupId?: string;
    relationType?: string;
  } = {},
): HealthCommonsSourceReference {
  return {
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
  return uniqueStrings([
    toTrailingSlug(entity.slug),
    entity.slug,
    stripEntityTypePrefix(entity.key),
    ...redirectSources.map(stripEntityTypePrefix),
  ]);
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

function normalizeLimit(value: number | undefined, defaultValue: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.max(0, Math.min(Math.trunc(value), MAX_LIMIT));
}

function normalizeRouteId(value: string): string {
  return safeDecodeURIComponent(value).trim().replace(/^\/+|\/+$/gu, "");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeKeyInput(value: string): string {
  return value.trim();
}

function stripRevision(key: string): string {
  return key.split("@")[0] ?? key;
}

function stripEntityTypePrefix(key: string): string {
  return stripRevision(key).replace(/^[a-z_]+:/u, "");
}

function toTrailingSlug(slug: string): string {
  return slug.split("/").at(-1) ?? slug;
}

function normalizeCategory(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
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

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
