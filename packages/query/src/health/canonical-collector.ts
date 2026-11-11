import { VAULT_LAYOUT, type BankEntityKind } from "@murphai/contracts";

import {
  compareCanonicalEntities,
  type CanonicalEntityFamily,
  type CanonicalEntity,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import { projectRegistryEntity } from "./projectors/registry.ts";
import {
  readJsonlEntitiesStrict,
  readJsonlEntitiesTolerant,
  type EntityCollection,
} from "./entity-slices.ts";
import {
  readMarkdownDocument,
  readMarkdownDocumentOutcome,
  walkRelativeFiles,
  type MarkdownDocumentOutcome,
  type ParseFailure,
} from "./loaders.ts";
import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  familyRegistryDefinition,
  foodRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  habitatRegistryDefinition,
  regimenRegistryDefinition,
  providerRegistryDefinition,
  recipeRegistryDefinition,
  toRegistryRecord,
  workoutFormatRegistryDefinition,
  type RegistryMarkdownRecord,
} from "./registries.ts";
import type { MarkdownDocumentRecord } from "./shared.ts";

type RegistryFamily = BankEntityKind;

type RegistryCollectionKey =
  | "goals"
  | "conditions"
  | "allergies"
  | "regimens"
  | "familyMembers"
  | "geneticVariants"
  | "foods"
  | "habitatAspects"
  | "recipes"
  | "providers"
  | "workoutFormats";

interface RegistryCollectorConfig {
  key: RegistryCollectionKey;
  family: RegistryFamily;
  directory: string;
  toRecord: (document: MarkdownDocumentRecord) => RegistryMarkdownRecord | null;
}

interface RegistryCollections {
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  regimens: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
  foods: CanonicalEntity[];
  habitatAspects: CanonicalEntity[];
  recipes: CanonicalEntity[];
  providers: CanonicalEntity[];
  workoutFormats: CanonicalEntity[];
}

interface RegistryCollectionResult {
  collections: RegistryCollections;
  failures: ParseFailure[];
}

type RegistryDocumentRead = MarkdownDocumentRecord | MarkdownDocumentOutcome;

type AsyncRegistryDocumentReader = (
  vaultRoot: string,
  relativePath: string,
  options?: { signal?: AbortSignal },
) => Promise<RegistryDocumentRead>;

export interface CanonicalHealthEntityCollection {
  assessments: CanonicalEntity[];
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  regimens: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
  foods: CanonicalEntity[];
  habitatAspects: CanonicalEntity[];
  recipes: CanonicalEntity[];
  providers: CanonicalEntity[];
  workoutFormats: CanonicalEntity[];
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

const REGISTRY_COLLECTORS = [
  createRegistryCollectorConfig(
    "goals",
    "goal",
    goalRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, goalRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "conditions",
    "condition",
    conditionRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, conditionRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "allergies",
    "allergy",
    allergyRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, allergyRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "regimens",
    "regimen",
    regimenRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, regimenRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "familyMembers",
    "family",
    familyRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, familyRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "geneticVariants",
    "genetics",
    geneticsRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, geneticsRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "foods",
    "food",
    foodRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, foodRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "habitatAspects",
    "habitat",
    habitatRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, habitatRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "recipes",
    "recipe",
    recipeRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, recipeRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "providers",
    "provider",
    providerRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, providerRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "workoutFormats",
    "workout_format",
    workoutFormatRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, workoutFormatRegistryDefinition),
  ),
] as const satisfies readonly RegistryCollectorConfig[];

/**
 * Read one health-owned canonical family without traversing every registry.
 *
 * This is the source-backed counterpart to filtered projection reads. It is
 * intended for exact and family-local resolution paths where rebuilding the
 * shared query projection would be disproportionate to the requested read.
 */
export async function readCanonicalHealthFamilyEntities(
  vaultRoot: string,
  family: CanonicalEntityFamily,
): Promise<CanonicalEntity[]> {
  if (family === "assessment") {
    return readJsonlEntitiesStrict(
      vaultRoot,
      VAULT_LAYOUT.assessmentLedgerDirectory,
      projectAssessmentEntity,
    );
  }

  const collector = REGISTRY_COLLECTORS.find((candidate) => candidate.family === family);
  if (!collector) {
    return [];
  }

  const result = await readRegistryEntitiesAsync(
    vaultRoot,
    collector,
    readMarkdownDocument,
  );
  return result.entities;
}

function createRegistryCollectorConfig(
  key: RegistryCollectionKey,
  family: RegistryFamily,
  directory: string,
  toRecord: (document: MarkdownDocumentRecord) => RegistryMarkdownRecord | null,
): RegistryCollectorConfig {
  return {
    key,
    family,
    directory,
    toRecord,
  };
}

export async function collectCanonicalEntities(
  vaultRoot: string,
  options: { mode: "strict" | "tolerant"; signal?: AbortSignal },
): Promise<CanonicalHealthEntityCollection> {
  const { mode, signal } = options;
  signal?.throwIfAborted();
  const assessmentArgs = [
    vaultRoot,
    VAULT_LAYOUT.assessmentLedgerDirectory,
    projectAssessmentEntity,
    { signal },
  ] as const;
  const assessments = mode === "strict"
    ? { entities: await readJsonlEntitiesStrict(...assessmentArgs), failures: [] }
    : await readJsonlEntitiesTolerant(...assessmentArgs);
  signal?.throwIfAborted();
  const registryCollections = await readRegistryCollectionsAsync(
    vaultRoot,
    mode === "strict" ? readMarkdownDocument : readMarkdownDocumentOutcome,
    signal,
  );
  signal?.throwIfAborted();
  const families = { assessments: assessments.entities, ...registryCollections.collections };

  return {
    ...families,
    entities: Object.values(families).flat().sort(compareCanonicalEntities),
    failures: [...assessments.failures, ...registryCollections.failures],
  };
}

async function readRegistryCollectionsAsync(
  vaultRoot: string,
  readDocument: AsyncRegistryDocumentReader,
  signal?: AbortSignal,
): Promise<RegistryCollectionResult> {
  const collections: RegistryCollections = {
    goals: [],
    conditions: [],
    allergies: [],
    regimens: [],
    familyMembers: [],
    geneticVariants: [],
    foods: [],
    habitatAspects: [],
    recipes: [],
    providers: [],
    workoutFormats: [],
  };
  const failures: ParseFailure[] = [];

  for (const collector of REGISTRY_COLLECTORS) {
    signal?.throwIfAborted();
    const result = await readRegistryEntitiesAsync(
      vaultRoot,
      collector,
      readDocument,
      signal,
    );
    collections[collector.key] = result.entities;
    failures.push(...result.failures);
  }

  return { collections, failures };
}

function projectRegistryDocumentEntity(
  config: RegistryCollectorConfig,
  document: MarkdownDocumentRecord,
): CanonicalEntity | null {
  const record = config.toRecord(document);
  if (!record) {
    return null;
  }

  return projectRegistryEntity(config.family, record);
}

function normalizeRegistryDocumentRead(
  input: RegistryDocumentRead,
): MarkdownDocumentOutcome {
  if ("ok" in input) {
    return input;
  }

  return {
    ok: true,
    relativePath: input.relativePath,
    document: input,
  };
}

async function readRegistryEntitiesAsync(
  vaultRoot: string,
  config: RegistryCollectorConfig,
  readDocument: AsyncRegistryDocumentReader,
  signal?: AbortSignal,
): Promise<EntityCollection> {
  const relativePaths = await walkRelativeFiles(
    vaultRoot,
    config.directory,
    ".md",
    { signal },
  );
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const relativePath of relativePaths) {
    signal?.throwIfAborted();
    const outcome = normalizeRegistryDocumentRead(
      await readDocument(vaultRoot, relativePath, { signal }),
    );
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = projectRegistryDocumentEntity(config, outcome.document);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
}
