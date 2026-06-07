import { readFileSync } from "node:fs";

import {
  EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION,
  EXERCISE_CATALOG_FACETS_SCHEMA_VERSION,
  EXERCISE_CATALOG_INDEX_SCHEMA_VERSION,
  exerciseCatalogCommonnessValues,
  exerciseCatalogEnvironmentValues,
  exerciseCatalogKindValues,
  exerciseCatalogLevelValues,
  type ExerciseCatalogCommonness,
  type ExerciseCatalogDetailsArtifact,
  type ExerciseCatalogEnvironment,
  type ExerciseCatalogFacets,
  type ExerciseCatalogFacetsArtifact,
  type ExerciseCatalogIndexArtifact,
  type ExerciseCatalogItem,
  type ExerciseCatalogKind,
  type ExerciseCatalogLevel,
  type ExerciseCatalogListOptions,
  type ExerciseCatalogNormalizedListOptions,
  type ExerciseCatalogSummary,
} from "./schema.js";

export {
  exerciseCatalogCommonnessValues,
  exerciseCatalogEnvironmentValues,
  exerciseCatalogKindValues,
  exerciseCatalogLevelValues,
} from "./schema.js";

export type ExerciseCatalogLookupResult =
  | { kind: "found"; item: ExerciseCatalogItem }
  | { kind: "not_found" }
  | { kind: "ambiguous"; matches: readonly ExerciseCatalogSummary[] };

export interface ExerciseCatalogReader {
  readonly catalogHash: string;
  facets(): ExerciseCatalogFacets;
  findByLookup(lookup: string): ExerciseCatalogLookupResult;
  listExercises(options?: ExerciseCatalogListOptions): ExerciseCatalogSummary[];
  normalizeListOptions(options?: ExerciseCatalogListOptions): ExerciseCatalogNormalizedListOptions;
}

export interface LoadGeneratedExerciseCatalogOptions {
  detailsPath?: string | URL;
  facetsPath?: string | URL;
  indexPath?: string | URL;
}

const DEFAULT_INDEX_URL = new URL("../generated/exercise-index.json", import.meta.url);
const DEFAULT_DETAILS_URL = new URL("../generated/exercise-details.json", import.meta.url);
const DEFAULT_FACETS_URL = new URL("../generated/exercise-facets.json", import.meta.url);

let generatedReader: ExerciseCatalogReader | null = null;

export function getGeneratedExerciseCatalogReader(
  options: LoadGeneratedExerciseCatalogOptions = {},
): ExerciseCatalogReader {
  if (Object.keys(options).length === 0) {
    generatedReader ??= createExerciseCatalogReader(loadGeneratedExerciseCatalog(options));
    return generatedReader;
  }
  return createExerciseCatalogReader(loadGeneratedExerciseCatalog(options));
}

export function loadGeneratedExerciseCatalog(
  options: LoadGeneratedExerciseCatalogOptions = {},
): {
  details: ExerciseCatalogDetailsArtifact;
  facets: ExerciseCatalogFacetsArtifact;
  index: ExerciseCatalogIndexArtifact;
} {
  const index = readJsonArtifact<ExerciseCatalogIndexArtifact>(options.indexPath ?? DEFAULT_INDEX_URL);
  const details = readJsonArtifact<ExerciseCatalogDetailsArtifact>(options.detailsPath ?? DEFAULT_DETAILS_URL);
  const facets = readJsonArtifact<ExerciseCatalogFacetsArtifact>(options.facetsPath ?? DEFAULT_FACETS_URL);
  assertArtifactShape(index, details, facets);
  return { details, facets, index };
}

export function createExerciseCatalogReader(input: {
  details: ExerciseCatalogDetailsArtifact;
  facets: ExerciseCatalogFacetsArtifact;
  index: ExerciseCatalogIndexArtifact;
}): ExerciseCatalogReader {
  assertArtifactShape(input.index, input.details, input.facets);
  const detailsById = new Map(input.details.items.map((item) => [normalizeLookup(item.id), item]));
  const detailsBySlug = new Map(input.details.items.map((item) => [normalizeLookup(item.slug), item]));
  const detailsByName = new Map<string, ExerciseCatalogItem[]>();
  for (const item of input.details.items) {
    const key = normalizeLookup(item.name);
    detailsByName.set(key, [...(detailsByName.get(key) ?? []), item]);
  }

  return {
    catalogHash: input.index.catalogHash,
    facets() {
      return input.facets.facets;
    },
    findByLookup(lookup: string) {
      const normalizedLookup = normalizeLookup(lookup);
      const exact = detailsById.get(normalizedLookup) ?? detailsBySlug.get(normalizedLookup);
      if (exact) {
        return { kind: "found", item: exact };
      }

      const named = detailsByName.get(normalizedLookup) ?? [];
      if (named.length === 1 && named[0]) {
        return { kind: "found", item: named[0] };
      }
      if (named.length > 1) {
        return {
          kind: "ambiguous",
          matches: named.map(toSummary),
        };
      }
      return { kind: "not_found" };
    },
    listExercises(options = {}) {
      const normalized = normalizeListOptions(options);
      const scored = input.index.items
        .map((item) => ({ item, score: scoreExercise(item, normalized.query) }))
        .filter(({ item, score }) => score !== null && matchesFilters(item, normalized))
        .sort((left, right) =>
          (right.score ?? 0) - (left.score ?? 0)
          || commonnessRank(left.item.commonness) - commonnessRank(right.item.commonness)
          || levelRank(left.item.level) - levelRank(right.item.level)
          || left.item.name.localeCompare(right.item.name)
          || left.item.id.localeCompare(right.item.id),
        );

      return scored.slice(0, normalized.limit).map(({ item }) => item);
    },
    normalizeListOptions,
  };
}

function assertArtifactShape(
  index: ExerciseCatalogIndexArtifact,
  details: ExerciseCatalogDetailsArtifact,
  facets: ExerciseCatalogFacetsArtifact,
): void {
  if (index.schemaVersion !== EXERCISE_CATALOG_INDEX_SCHEMA_VERSION) {
    throw new Error("Unexpected exercise index schema version.");
  }
  if (details.schemaVersion !== EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION) {
    throw new Error("Unexpected exercise details schema version.");
  }
  if (facets.schemaVersion !== EXERCISE_CATALOG_FACETS_SCHEMA_VERSION) {
    throw new Error("Unexpected exercise facets schema version.");
  }
  if (index.catalogHash !== details.catalogHash || index.catalogHash !== facets.catalogHash) {
    throw new Error("Exercise generated artifact hashes do not match.");
  }
}

function readJsonArtifact<TValue>(pathOrUrl: string | URL): TValue {
  return JSON.parse(readFileSync(pathOrUrl, "utf8")) as TValue;
}

function normalizeListOptions(options: ExerciseCatalogListOptions = {}): ExerciseCatalogNormalizedListOptions {
  return {
    category: normalizeStringFilters(options.category),
    commonness: normalizeEnumFilters(options.commonness, exerciseCatalogCommonnessValues),
    environment: normalizeEnumFilters(options.environment, exerciseCatalogEnvironmentValues),
    equipment: normalizeStringFilters(options.equipment),
    kind: normalizeEnumFilters(options.kind, exerciseCatalogKindValues),
    level: normalizeEnumFilters(options.level, exerciseCatalogLevelValues),
    limit: normalizeLimit(options.limit),
    modality: normalizeStringFilters(options.modality),
    position: normalizeStringFilters(options.position),
    query: normalizeNullableQuery(options.query),
    target: normalizeStringFilters(options.target),
  };
}

function normalizeEnumFilters<const TValue extends string>(
  values: readonly TValue[] | undefined,
  allowed: readonly TValue[],
): TValue[] {
  if (!values || values.length === 0) {
    return [];
  }
  const allowedValues = new Set(allowed);
  return [...new Set(values.filter((value) => allowedValues.has(value)))];
}

function normalizeStringFilters(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [...new Set(values.map(normalizeFacet).filter(Boolean))];
}

function normalizeNullableQuery(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
  return normalized ? normalized : null;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined) {
    return 10;
  }
  return Math.min(Math.max(value, 1), 500);
}

function matchesFilters(
  item: ExerciseCatalogSummary,
  filters: ExerciseCatalogNormalizedListOptions,
): boolean {
  return matchesOne(item.kind, filters.kind)
    && matchesAny(item.environment, filters.environment)
    && matchesOne(item.category, filters.category)
    && matchesAnyLoose(item.targets, filters.target)
    && matchesOne(item.level, filters.level)
    && matchesAny(item.equipment, filters.equipment, item.equipment.length === 0 ? ["none"] : undefined)
    && matchesOne(item.position, filters.position)
    && matchesOne(item.modality, filters.modality)
    && matchesOne(item.commonness, filters.commonness);
}

function matchesOne(value: string | null, filters: readonly string[]): boolean {
  return filters.length === 0 || (value !== null && filters.includes(normalizeFacet(value)));
}

function matchesAny(values: readonly string[], filters: readonly string[], fallbackValues: readonly string[] = []): boolean {
  if (filters.length === 0) {
    return true;
  }
  const normalizedValues = new Set([...values, ...fallbackValues].map(normalizeFacet));
  return filters.some((filter) => normalizedValues.has(filter));
}

function matchesAnyLoose(values: readonly string[], filters: readonly string[]): boolean {
  if (filters.length === 0) {
    return true;
  }
  const normalizedValues = values.map(normalizeFacet);
  return filters.some((filter) =>
    normalizedValues.some((value) =>
      value === filter
      || value.includes(filter)
      || filter.includes(value)
      || singularizeFacet(value) === singularizeFacet(filter),
    ),
  );
}

function singularizeFacet(value: string): string {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

function scoreExercise(item: ExerciseCatalogSummary, query: string | null): number | null {
  if (!query) {
    return 0;
  }
  const normalizedQuery = normalizeLookup(query);
  if (normalizeLookup(item.id) === normalizedQuery) return 1000;
  if (normalizeLookup(item.slug) === normalizedQuery) return 950;
  if (normalizeLookup(item.name) === normalizedQuery) return 900;

  const queryTokens = tokenize(normalizedQuery);
  const nameTokens = tokenize(item.name);
  const targetTokens = tokenize(item.targets.join(" "));
  const metadataTokens = tokenize([item.category, item.modality, item.description].join(" "));
  let score = 0;
  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += 80;
    if (targetTokens.has(token)) score += 35;
    if (metadataTokens.has(token)) score += 15;
  }
  if (score > 0) {
    return score;
  }
  return normalizeLookup(item.description).includes(normalizedQuery) ? 5 : null;
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeLookup(value).split(/[^a-z0-9]+/u).filter(Boolean));
}

function commonnessRank(value: ExerciseCatalogCommonness): number {
  return exerciseCatalogCommonnessValues.indexOf(value);
}

function levelRank(value: ExerciseCatalogLevel): number {
  return exerciseCatalogLevelValues.indexOf(value);
}

function toSummary(item: ExerciseCatalogItem): ExerciseCatalogSummary {
  const { image: _image, steps: _steps, tips: _tips, ...summary } = item;
  return summary;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeFacet(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/gu, "-");
}
