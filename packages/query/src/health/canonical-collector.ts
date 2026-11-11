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

interface RegistryCollectorConfig {
  family: RegistryFamily;
  directory: string;
  toRecord: (document: MarkdownDocumentRecord) => RegistryMarkdownRecord | null;
}

type RegistryDocumentRead = MarkdownDocumentRecord | MarkdownDocumentOutcome;

type AsyncRegistryDocumentReader = (
  vaultRoot: string,
  relativePath: string,
  options?: { signal?: AbortSignal },
) => Promise<RegistryDocumentRead>;

const REGISTRY_COLLECTORS = [
  createRegistryCollectorConfig(
    "goal",
    goalRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, goalRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "condition",
    conditionRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, conditionRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "allergy",
    allergyRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, allergyRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "regimen",
    regimenRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, regimenRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "family",
    familyRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, familyRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "genetics",
    geneticsRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, geneticsRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "food",
    foodRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, foodRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "habitat",
    habitatRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, habitatRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "recipe",
    recipeRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, recipeRegistryDefinition),
  ),
  createRegistryCollectorConfig(
    "provider",
    providerRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, providerRegistryDefinition),
  ),
  createRegistryCollectorConfig(
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
  family: RegistryFamily,
  directory: string,
  toRecord: (document: MarkdownDocumentRecord) => RegistryMarkdownRecord | null,
): RegistryCollectorConfig {
  return {
    family,
    directory,
    toRecord,
  };
}

export async function collectCanonicalEntities(
  vaultRoot: string,
  options: { mode: "strict" | "tolerant"; signal?: AbortSignal },
): Promise<EntityCollection> {
  const { mode, signal } = options;
  signal?.throwIfAborted();
  const assessmentArgs = [
    vaultRoot,
    VAULT_LAYOUT.assessmentLedgerDirectory,
    projectAssessmentEntity,
    { signal },
  ] as const;
  let { entities, failures }: EntityCollection = mode === "strict"
    ? { entities: await readJsonlEntitiesStrict(...assessmentArgs), failures: [] }
    : await readJsonlEntitiesTolerant(...assessmentArgs);
  signal?.throwIfAborted();
  const readDocument = mode === "strict" ? readMarkdownDocument : readMarkdownDocumentOutcome;

  for (const collector of REGISTRY_COLLECTORS) {
    signal?.throwIfAborted();
    const result = await readRegistryEntitiesAsync(
      vaultRoot,
      collector,
      readDocument,
      signal,
    );
    entities = entities.concat(result.entities);
    failures = failures.concat(result.failures);
  }
  signal?.throwIfAborted();

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
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
