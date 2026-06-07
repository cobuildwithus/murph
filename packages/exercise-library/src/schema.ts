export const EXERCISE_CATALOG_SCHEMA_VERSION = "murph.exercise-catalog.v1" as const;
export const EXERCISE_CATALOG_INDEX_SCHEMA_VERSION = "murph.exercise-index.v1" as const;
export const EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION = "murph.exercise-details.v1" as const;
export const EXERCISE_CATALOG_FACETS_SCHEMA_VERSION = "murph.exercise-facets.v1" as const;

export const exerciseCatalogKindValues = [
  "exercise",
  "stretch",
  "mobility",
  "breathing",
] as const;
export type ExerciseCatalogKind = (typeof exerciseCatalogKindValues)[number];

export const exerciseCatalogEnvironmentValues = ["at_home", "gym"] as const;
export type ExerciseCatalogEnvironment = (typeof exerciseCatalogEnvironmentValues)[number];

export const exerciseCatalogLevelValues = [
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type ExerciseCatalogLevel = (typeof exerciseCatalogLevelValues)[number];

export const exerciseCatalogCommonnessValues = [
  "very_common",
  "common",
  "variant",
] as const;
export type ExerciseCatalogCommonness = (typeof exerciseCatalogCommonnessValues)[number];

export interface ExerciseCatalogImage {
  alt: string;
  url: string;
}

export interface ExerciseCatalogSource {
  id: number;
  url: string;
}

export interface ExerciseCatalogSummary {
  category: string;
  commonness: ExerciseCatalogCommonness;
  description: string;
  environment: ExerciseCatalogEnvironment[];
  equipment: string[];
  id: string;
  kind: ExerciseCatalogKind;
  level: ExerciseCatalogLevel;
  modality: string;
  name: string;
  position: string | null;
  slug: string;
  targets: string[];
}

export interface ExerciseCatalogItem extends ExerciseCatalogSummary {
  image: ExerciseCatalogImage | null;
  sourceIds: number[];
  steps: string[];
  tips: string[];
}

export interface ExerciseCatalogIndexArtifact {
  catalogHash: string;
  generatedAt: string | null;
  items: ExerciseCatalogSummary[];
  schemaVersion: typeof EXERCISE_CATALOG_INDEX_SCHEMA_VERSION;
}

export interface ExerciseCatalogDetailsArtifact {
  catalogHash: string;
  generatedAt: string | null;
  items: ExerciseCatalogItem[];
  schemaVersion: typeof EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION;
  sources: ExerciseCatalogSource[];
}

export interface ExerciseCatalogFacets {
  categories: string[];
  commonness: ExerciseCatalogCommonness[];
  environments: ExerciseCatalogEnvironment[];
  equipment: string[];
  kinds: ExerciseCatalogKind[];
  levels: ExerciseCatalogLevel[];
  modalities: string[];
  positions: string[];
  targets: string[];
}

export interface ExerciseCatalogFacetsArtifact {
  catalogHash: string;
  facets: ExerciseCatalogFacets;
  generatedAt: string | null;
  schemaVersion: typeof EXERCISE_CATALOG_FACETS_SCHEMA_VERSION;
}

export interface ExerciseCatalogListOptions {
  category?: string[];
  commonness?: ExerciseCatalogCommonness[];
  environment?: ExerciseCatalogEnvironment[];
  equipment?: string[];
  kind?: ExerciseCatalogKind[];
  level?: ExerciseCatalogLevel[];
  limit?: number;
  modality?: string[];
  position?: string[];
  query?: string | null;
  target?: string[];
}

export interface ExerciseCatalogNormalizedListOptions {
  category: string[];
  commonness: ExerciseCatalogCommonness[];
  environment: ExerciseCatalogEnvironment[];
  equipment: string[];
  kind: ExerciseCatalogKind[];
  level: ExerciseCatalogLevel[];
  limit: number;
  modality: string[];
  position: string[];
  query: string | null;
  target: string[];
}

export interface ExerciseCatalogListResult {
  items: ExerciseCatalogSummary[];
  total: number;
}
