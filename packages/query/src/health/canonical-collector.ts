import type { BankEntityKind } from "@murphai/contracts";

import {
  compareCanonicalEntities,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "../canonical-entities.ts";
import { projectAssessmentEntity } from "./projectors/assessment.ts";
import {
  collapseEventLedgerEntities,
  projectHistoryEntity,
} from "./projectors/history.ts";
import { projectProfileSnapshotEntity } from "./projectors/profile.ts";
import { projectRegistryEntity } from "./projectors/registry.ts";
import {
  readCurrentProfileCollectionAsync,
  readCurrentProfileCollectionSync,
  readJsonlEntitiesStrict,
  readJsonlEntitiesTolerant,
  readJsonlEntitiesTolerantSync,
  type CurrentProfileCollection,
  type EntityCollection,
} from "./entity-slices.ts";
import {
  readMarkdownDocument,
  readMarkdownDocumentOutcome,
  readMarkdownDocumentOutcomeSync,
  readOptionalMarkdownDocument,
  readOptionalMarkdownDocumentOutcome,
  readOptionalMarkdownDocumentOutcomeSync,
  walkRelativeFiles,
  walkRelativeFilesSync,
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
  protocolRegistryDefinition,
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
  | "protocols"
  | "familyMembers"
  | "geneticVariants"
  | "foods"
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
  protocols: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
  foods: CanonicalEntity[];
  recipes: CanonicalEntity[];
  providers: CanonicalEntity[];
  workoutFormats: CanonicalEntity[];
}

interface RegistryCollectionResult {
  collections: RegistryCollections;
  failures: ParseFailure[];
}

type RegistryDocumentRead = MarkdownDocumentRecord | MarkdownDocumentOutcome;

type AsyncEntityReader = (
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
) => Promise<EntityCollection>;

type SyncEntityReader = (
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
) => EntityCollection;

type AsyncRegistryDocumentReader = (
  vaultRoot: string,
  relativePath: string,
) => Promise<RegistryDocumentRead>;

type AsyncCurrentProfileDocumentReader = (
  vaultRoot: string,
  relativePath: string,
) => Promise<MarkdownDocumentRecord | MarkdownDocumentOutcome | null>;

type SyncCurrentProfileDocumentReader = (
  vaultRoot: string,
  relativePath: string,
) => MarkdownDocumentRecord | MarkdownDocumentOutcome | null;

export interface CanonicalHealthEntityCollection {
  assessments: CanonicalEntity[];
  profileSnapshots: CanonicalEntity[];
  currentProfile: CanonicalEntity | null;
  history: CanonicalEntity[];
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  protocols: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
  foods: CanonicalEntity[];
  recipes: CanonicalEntity[];
  providers: CanonicalEntity[];
  workoutFormats: CanonicalEntity[];
  entities: CanonicalEntity[];
  failures: ParseFailure[];
  markdownByPath: ReadonlyMap<string, string>;
}

export interface StrictAsyncCanonicalEntityCollectorOptions {
  mode: "strict-async";
}

export interface TolerantSyncCanonicalEntityCollectorOptions {
  mode: "tolerant-sync";
}

export interface TolerantAsyncCanonicalEntityCollectorOptions {
  mode: "tolerant-async";
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
    "protocols",
    "protocol",
    protocolRegistryDefinition.registry.directory,
    (document) => toRegistryRecord(document, protocolRegistryDefinition),
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

export function collectCanonicalEntities(
  vaultRoot: string,
  options: TolerantSyncCanonicalEntityCollectorOptions,
): CanonicalHealthEntityCollection;
export function collectCanonicalEntities(
  vaultRoot: string,
  options: StrictAsyncCanonicalEntityCollectorOptions,
): Promise<CanonicalHealthEntityCollection>;
export function collectCanonicalEntities(
  vaultRoot: string,
  options: TolerantAsyncCanonicalEntityCollectorOptions,
): Promise<CanonicalHealthEntityCollection>;
export function collectCanonicalEntities(
  vaultRoot: string,
  options:
    | StrictAsyncCanonicalEntityCollectorOptions
    | TolerantSyncCanonicalEntityCollectorOptions
    | TolerantAsyncCanonicalEntityCollectorOptions,
): CanonicalHealthEntityCollection | Promise<CanonicalHealthEntityCollection> {
  if (options.mode === "strict-async") {
    return collectCanonicalEntitiesStrict(vaultRoot);
  }

  if (options.mode === "tolerant-async") {
    return collectCanonicalEntitiesTolerantAsync(vaultRoot);
  }

  return collectCanonicalEntitiesTolerantSync(vaultRoot);
}

async function collectCanonicalEntitiesStrict(
  vaultRoot: string,
): Promise<CanonicalHealthEntityCollection> {
  return collectCanonicalEntitiesAsync(
    vaultRoot,
    async (strictVaultRoot, relativeRoot, project) => ({
      entities: await readJsonlEntitiesStrict(strictVaultRoot, relativeRoot, project),
      failures: [],
    }),
    readMarkdownDocument,
    readOptionalMarkdownDocument,
  );
}

async function collectCanonicalEntitiesTolerantAsync(
  vaultRoot: string,
): Promise<CanonicalHealthEntityCollection> {
  return collectCanonicalEntitiesAsync(
    vaultRoot,
    readJsonlEntitiesTolerant,
    readMarkdownDocumentOutcome,
    readOptionalMarkdownDocumentOutcome,
  );
}

function collectCanonicalEntitiesTolerantSync(
  vaultRoot: string,
): CanonicalHealthEntityCollection {
  return collectCanonicalEntitiesSync(
    vaultRoot,
    readJsonlEntitiesTolerantSync,
    readMarkdownDocumentOutcomeSync,
    readOptionalMarkdownDocumentOutcomeSync,
  );
}

async function collectCanonicalEntitiesAsync(
  vaultRoot: string,
  readJsonlEntities: AsyncEntityReader,
  readRegistryDocument: AsyncRegistryDocumentReader,
  readCurrentProfileDocument: AsyncCurrentProfileDocumentReader,
): Promise<CanonicalHealthEntityCollection> {
  const markdownByPath = new Map<string, string>();
  const assessments = await readJsonlEntities(
    vaultRoot,
    "ledger/assessments",
    projectAssessmentEntity,
  );
  const profileSnapshots = await readJsonlEntities(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
  const history = await readJsonlEntities(
    vaultRoot,
    "ledger/events",
    projectHistoryEntity,
  );
  const registryCollections = await readRegistryCollectionsAsync(
    vaultRoot,
    markdownByPath,
    readRegistryDocument,
  );
  const currentProfile = await readCurrentProfileCollectionAsync(
    vaultRoot,
    profileSnapshots.entities,
    markdownByPath,
    readCurrentProfileDocument,
  );

  return buildCanonicalHealthCollectionFromCollections({
    assessments,
    profileSnapshots,
    currentProfile,
    history,
    registryCollections,
    markdownByPath,
  });
}

function collectCanonicalEntitiesSync(
  vaultRoot: string,
  readJsonlEntities: SyncEntityReader,
  readRegistryDocument: typeof readMarkdownDocumentOutcomeSync,
  readCurrentProfileDocument: SyncCurrentProfileDocumentReader,
): CanonicalHealthEntityCollection {
  const markdownByPath = new Map<string, string>();
  const assessments = readJsonlEntities(
    vaultRoot,
    "ledger/assessments",
    projectAssessmentEntity,
  );
  const profileSnapshots = readJsonlEntities(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
  const history = readJsonlEntities(
    vaultRoot,
    "ledger/events",
    projectHistoryEntity,
  );
  const registryCollections = readRegistryCollectionsSync(
    vaultRoot,
    markdownByPath,
    readRegistryDocument,
  );
  const currentProfile = readCurrentProfileCollectionSync(
    vaultRoot,
    profileSnapshots.entities,
    markdownByPath,
    readCurrentProfileDocument,
  );

  return buildCanonicalHealthCollectionFromCollections({
    assessments,
    profileSnapshots,
    currentProfile,
    history,
    registryCollections,
    markdownByPath,
  });
}

function buildCanonicalHealthCollectionFromCollections(input: {
  assessments: EntityCollection;
  profileSnapshots: EntityCollection;
  currentProfile: CurrentProfileCollection;
  history: EntityCollection;
  registryCollections: RegistryCollectionResult;
  markdownByPath: ReadonlyMap<string, string>;
}): CanonicalHealthEntityCollection {
  return buildCanonicalHealthCollection({
    assessments: input.assessments.entities,
    profileSnapshots: input.profileSnapshots.entities,
    currentProfile: input.currentProfile.entity,
    history: collapseEventLedgerEntities(input.history.entities),
    ...input.registryCollections.collections,
    failures: [
      ...input.assessments.failures,
      ...input.profileSnapshots.failures,
      ...input.history.failures,
      ...input.currentProfile.failures,
      ...input.registryCollections.failures,
    ],
    markdownByPath: input.markdownByPath,
  });
}

function buildCanonicalHealthCollection(input: {
  assessments: CanonicalEntity[];
  profileSnapshots: CanonicalEntity[];
  currentProfile: CanonicalEntity | null;
  history: CanonicalEntity[];
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  protocols: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
  foods: CanonicalEntity[];
  recipes: CanonicalEntity[];
  providers: CanonicalEntity[];
  workoutFormats: CanonicalEntity[];
  failures: ParseFailure[];
  markdownByPath: ReadonlyMap<string, string>;
}): CanonicalHealthEntityCollection {
  return {
    ...input,
    entities: [
      ...input.assessments,
      ...input.profileSnapshots,
      ...(input.currentProfile ? [input.currentProfile] : []),
      ...input.history,
      ...input.goals,
      ...input.conditions,
      ...input.allergies,
      ...input.protocols,
      ...input.familyMembers,
      ...input.geneticVariants,
      ...input.foods,
      ...input.recipes,
      ...input.providers,
      ...input.workoutFormats,
    ].sort(compareCanonicalEntities),
  };
}

function createEmptyRegistryCollections(): RegistryCollections {
  return {
    goals: [],
    conditions: [],
    allergies: [],
    protocols: [],
    familyMembers: [],
    geneticVariants: [],
    foods: [],
    recipes: [],
    providers: [],
    workoutFormats: [],
  };
}

async function readRegistryCollectionsAsync(
  vaultRoot: string,
  markdownByPath: Map<string, string>,
  readDocument: AsyncRegistryDocumentReader,
): Promise<RegistryCollectionResult> {
  const collections = createEmptyRegistryCollections();
  const failures: ParseFailure[] = [];

  for (const collector of REGISTRY_COLLECTORS) {
    const result = await readRegistryEntitiesAsync(
      vaultRoot,
      collector,
      markdownByPath,
      readDocument,
    );
    collections[collector.key] = result.entities;
    failures.push(...result.failures);
  }

  return { collections, failures };
}

function readRegistryCollectionsSync(
  vaultRoot: string,
  markdownByPath: Map<string, string>,
  readDocument: typeof readMarkdownDocumentOutcomeSync,
): RegistryCollectionResult {
  const collections = createEmptyRegistryCollections();
  const failures: ParseFailure[] = [];

  for (const collector of REGISTRY_COLLECTORS) {
    const result = readRegistryEntitiesSync(
      vaultRoot,
      collector,
      markdownByPath,
      readDocument,
    );
    collections[collector.key] = result.entities;
    failures.push(...result.failures);
  }

  return { collections, failures };
}

function projectRegistryDocumentEntity(
  config: RegistryCollectorConfig,
  document: MarkdownDocumentRecord,
  markdownByPath: Map<string, string>,
): CanonicalEntity | null {
  const record = config.toRecord(document);
  if (!record) {
    return null;
  }

  const entity = projectRegistryEntity(config.family, record);
  markdownByPath.set(entity.path, record.document.markdown);
  return entity;
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
  markdownByPath: Map<string, string>,
  readDocument: AsyncRegistryDocumentReader,
): Promise<EntityCollection> {
  const relativePaths = await walkRelativeFiles(vaultRoot, config.directory, ".md");
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const relativePath of relativePaths) {
    const outcome = normalizeRegistryDocumentRead(
      await readDocument(vaultRoot, relativePath),
    );
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = projectRegistryDocumentEntity(config, outcome.document, markdownByPath);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
}

function readRegistryEntitiesSync(
  vaultRoot: string,
  config: RegistryCollectorConfig,
  markdownByPath: Map<string, string>,
  readDocument: typeof readMarkdownDocumentOutcomeSync,
): EntityCollection {
  const relativePaths = walkRelativeFilesSync(vaultRoot, config.directory, ".md");
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const relativePath of relativePaths) {
    const outcome = normalizeRegistryDocumentRead(
      readDocument(vaultRoot, relativePath),
    );
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = projectRegistryDocumentEntity(config, outcome.document, markdownByPath);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
  };
}
