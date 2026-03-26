import {
  compareCanonicalEntities,
  fallbackCurrentProfileEntity,
  projectAssessmentEntity,
  projectCurrentProfileEntity,
  projectHistoryEntity,
  projectProfileSnapshotEntity,
  projectRegistryEntity,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "../canonical-entities.js";
import {
  readJsonlRecordOutcomes,
  readJsonlRecordOutcomesSync,
  readJsonlRecords,
  readMarkdownDocument,
  readMarkdownDocumentOutcome,
  readMarkdownDocumentOutcomeSync,
  readOptionalMarkdownDocument,
  readOptionalMarkdownDocumentOutcome,
  readOptionalMarkdownDocumentOutcomeSync,
  walkRelativeFiles,
  walkRelativeFilesSync,
  type JsonlRecordOutcome,
  type MarkdownDocumentOutcome,
  type ParseFailure,
} from "./loaders.js";
import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  familyRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  protocolRegistryDefinition,
  toRegistryRecord,
  type RegistryDefinition,
  type RegistryMarkdownRecord,
} from "./registries.js";
import {
  resolveCurrentProfileDocument,
  resolveCurrentProfileSnapshot,
  type CurrentProfileDocumentOutcome,
  type CurrentProfileSnapshotSortFields,
} from "./current-profile-resolution.js";
import { firstString } from "./shared.js";
import type { MarkdownDocumentRecord } from "./shared.js";

type RegistryFamily = Extract<
  CanonicalEntityFamily,
  "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
>;

type RegistryCollectionKey =
  | "goals"
  | "conditions"
  | "allergies"
  | "protocols"
  | "familyMembers"
  | "geneticVariants";

interface RegistryCollectorConfig<TRecord extends RegistryMarkdownRecord> {
  key: RegistryCollectionKey;
  family: RegistryFamily;
  definition: RegistryDefinition<TRecord>;
}

interface EntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

interface RegistryCollections {
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  protocols: CanonicalEntity[];
  familyMembers: CanonicalEntity[];
  geneticVariants: CanonicalEntity[];
}

interface CurrentProfileCollection {
  entity: CanonicalEntity | null;
  failures: ParseFailure[];
}

interface CurrentProfileDocumentResolutionInput {
  documentOutcome: CurrentProfileDocumentOutcome<CanonicalEntity, ParseFailure>;
  markdown: string | null;
}

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
  {
    key: "goals",
    family: "goal",
    definition:
      goalRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
  {
    key: "conditions",
    family: "condition",
    definition:
      conditionRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
  {
    key: "allergies",
    family: "allergy",
    definition:
      allergyRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
  {
    key: "protocols",
    family: "protocol",
    definition:
      protocolRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
  {
    key: "familyMembers",
    family: "family",
    definition:
      familyRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
  {
    key: "geneticVariants",
    family: "genetics",
    definition:
      geneticsRegistryDefinition as unknown as RegistryDefinition<RegistryMarkdownRecord>,
  },
] as const;

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
  const markdownByPath = new Map<string, string>();
  const assessments = await readJsonlEntitiesStrict(
    vaultRoot,
    "ledger/assessments",
    projectAssessmentEntity,
  );
  const profileSnapshots = await readJsonlEntitiesStrict(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
  const history = await readJsonlEntitiesStrict(
    vaultRoot,
    "ledger/events",
    projectHistoryEntity,
  );
  const registryCollections = await readRegistryCollectionsStrict(vaultRoot, markdownByPath);
  const currentProfile = await readCurrentProfileStrict(
    vaultRoot,
    profileSnapshots,
    markdownByPath,
  );

  return buildCanonicalHealthCollection({
    assessments,
    profileSnapshots,
    currentProfile,
    history,
    ...registryCollections,
    failures: [],
    markdownByPath,
  });
}

async function collectCanonicalEntitiesTolerantAsync(
  vaultRoot: string,
): Promise<CanonicalHealthEntityCollection> {
  const markdownByPath = new Map<string, string>();
  const assessments = await readJsonlEntitiesTolerant(
    vaultRoot,
    "ledger/assessments",
    projectAssessmentEntity,
  );
  const profileSnapshots = await readJsonlEntitiesTolerant(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
  const history = await readJsonlEntitiesTolerant(
    vaultRoot,
    "ledger/events",
    projectHistoryEntity,
  );
  const registryCollections = await readRegistryCollectionsTolerant(
    vaultRoot,
    markdownByPath,
  );
  const currentProfile = await readCurrentProfileTolerant(
    vaultRoot,
    profileSnapshots.entities,
    markdownByPath,
  );

  return buildCanonicalHealthCollection({
    assessments: assessments.entities,
    profileSnapshots: profileSnapshots.entities,
    currentProfile: currentProfile.entity,
    history: history.entities,
    ...registryCollections.collections,
    failures: [
      ...assessments.failures,
      ...profileSnapshots.failures,
      ...history.failures,
      ...currentProfile.failures,
      ...registryCollections.failures,
    ],
    markdownByPath,
  });
}

function collectCanonicalEntitiesTolerantSync(
  vaultRoot: string,
): CanonicalHealthEntityCollection {
  const markdownByPath = new Map<string, string>();
  const failures: ParseFailure[] = [];
  const assessments = readJsonlEntitiesTolerantSync(
    vaultRoot,
    "ledger/assessments",
    projectAssessmentEntity,
  );
  const profileSnapshots = readJsonlEntitiesTolerantSync(
    vaultRoot,
    "ledger/profile-snapshots",
    projectProfileSnapshotEntity,
  );
  const history = readJsonlEntitiesTolerantSync(
    vaultRoot,
    "ledger/events",
    projectHistoryEntity,
  );
  const registryCollections = readRegistryCollectionsTolerantSync(vaultRoot, markdownByPath);

  failures.push(
    ...assessments.failures,
    ...profileSnapshots.failures,
    ...history.failures,
  );

  const currentProfile = readCurrentProfileTolerantSync(
    vaultRoot,
    profileSnapshots.entities,
    markdownByPath,
  );

  failures.push(
    ...currentProfile.failures,
    ...registryCollections.failures,
  );

  return buildCanonicalHealthCollection({
    assessments: assessments.entities,
    profileSnapshots: profileSnapshots.entities,
    currentProfile: currentProfile.entity,
    history: history.entities,
    ...registryCollections.collections,
    failures,
    markdownByPath,
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
    ].sort(compareCanonicalEntities),
  };
}

async function readJsonlEntitiesStrict(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<CanonicalEntity[]> {
  return (await readJsonlRecords(vaultRoot, relativeRoot))
    .map((entry) => project(entry.value, entry.relativePath))
    .filter((entity): entity is CanonicalEntity => entity !== null)
    .sort(compareCanonicalEntities);
}

async function readJsonlEntitiesTolerant(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): Promise<EntityCollection> {
  return projectJsonlOutcomes(
    await readJsonlRecordOutcomes(vaultRoot, relativeRoot),
    project,
  );
}

function readJsonlEntitiesTolerantSync(
  vaultRoot: string,
  relativeRoot: string,
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  return projectJsonlOutcomes(readJsonlRecordOutcomesSync(vaultRoot, relativeRoot), project);
}

function projectJsonlOutcomes(
  outcomes: JsonlRecordOutcome[],
  project: (value: unknown, relativePath: string) => CanonicalEntity | null,
): EntityCollection {
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome);
      continue;
    }

    const entity = project(outcome.value, outcome.relativePath);
    if (entity) {
      entities.push(entity);
    }
  }

  return {
    entities: entities.sort(compareCanonicalEntities),
    failures,
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
  };
}

async function readRegistryCollectionsStrict(
  vaultRoot: string,
  markdownByPath: Map<string, string>,
): Promise<RegistryCollections> {
  const collections = createEmptyRegistryCollections();

  for (const collector of REGISTRY_COLLECTORS) {
    collections[collector.key] = await readRegistryEntitiesStrict(
      vaultRoot,
      collector,
      markdownByPath,
    );
  }

  return collections;
}

async function readRegistryCollectionsTolerant(
  vaultRoot: string,
  markdownByPath: Map<string, string>,
): Promise<{ collections: RegistryCollections; failures: ParseFailure[] }> {
  const collections = createEmptyRegistryCollections();
  const failures: ParseFailure[] = [];

  for (const collector of REGISTRY_COLLECTORS) {
    const result = await readRegistryEntitiesTolerant(vaultRoot, collector, markdownByPath);
    collections[collector.key] = result.entities;
    failures.push(...result.failures);
  }

  return { collections, failures };
}

function readRegistryCollectionsTolerantSync(
  vaultRoot: string,
  markdownByPath: Map<string, string>,
): { collections: RegistryCollections; failures: ParseFailure[] } {
  const collections = createEmptyRegistryCollections();
  const failures: ParseFailure[] = [];

  for (const collector of REGISTRY_COLLECTORS) {
    const result = readRegistryEntitiesTolerantSync(vaultRoot, collector, markdownByPath);
    collections[collector.key] = result.entities;
    failures.push(...result.failures);
  }

  return { collections, failures };
}

function projectRegistryDocumentEntity<TRecord extends RegistryMarkdownRecord>(
  config: RegistryCollectorConfig<TRecord>,
  document: MarkdownDocumentRecord,
  markdownByPath: Map<string, string>,
): CanonicalEntity | null {
  const record = toRegistryRecord(document, config.definition);
  if (!record) {
    return null;
  }

  const entity = projectRegistryEntity(config.family, record);
  markdownByPath.set(entity.path, record.markdown);
  return entity;
}

async function readRegistryEntitiesStrict<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  config: RegistryCollectorConfig<TRecord>,
  markdownByPath: Map<string, string>,
): Promise<CanonicalEntity[]> {
  const relativePaths = await walkRelativeFiles(
    vaultRoot,
    config.definition.directory,
    ".md",
  );
  const entities: CanonicalEntity[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const entity = projectRegistryDocumentEntity(config, document, markdownByPath);
    if (entity) {
      entities.push(entity);
    }
  }

  return entities.sort(compareCanonicalEntities);
}

async function readRegistryEntitiesTolerant<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  config: RegistryCollectorConfig<TRecord>,
  markdownByPath: Map<string, string>,
): Promise<EntityCollection> {
  const relativePaths = await walkRelativeFiles(
    vaultRoot,
    config.definition.directory,
    ".md",
  );
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const relativePath of relativePaths) {
    const outcome = await readMarkdownDocumentOutcome(vaultRoot, relativePath);
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

function readRegistryEntitiesTolerantSync<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  config: RegistryCollectorConfig<TRecord>,
  markdownByPath: Map<string, string>,
): EntityCollection {
  const relativePaths = walkRelativeFilesSync(
    vaultRoot,
    config.definition.directory,
    ".md",
  );
  const entities: CanonicalEntity[] = [];
  const failures: ParseFailure[] = [];

  for (const relativePath of relativePaths) {
    const outcome = readMarkdownDocumentOutcomeSync(vaultRoot, relativePath);
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

async function readCurrentProfileStrict(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
): Promise<CanonicalEntity | null> {
  const resolution = resolveCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
    fallbackCurrentProfileEntity,
  );
  const currentProfileDocument = buildCurrentProfileDocumentResolutionInput(
    await readOptionalMarkdownDocument(vaultRoot, "bank/profile/current.md"),
  );

  const resolvedCurrentProfile = resolveCurrentProfileDocument(
    resolution,
    currentProfileDocument.documentOutcome,
    currentProfileSnapshotId,
    buildCurrentProfileRetainOptions(markdownByPath, currentProfileDocument.markdown),
  );

  return resolvedCurrentProfile.currentProfile;
}

async function readCurrentProfileTolerant(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
): Promise<{ entity: CanonicalEntity | null; failures: ParseFailure[] }> {
  const resolution = resolveCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
    fallbackCurrentProfileEntity,
  );
  const currentProfileDocument = buildCurrentProfileDocumentResolutionInput(
    await readOptionalMarkdownDocumentOutcome(
      vaultRoot,
      "bank/profile/current.md",
    ),
  );
  const resolvedCurrentProfile = resolveCurrentProfileDocument(
    resolution,
    currentProfileDocument.documentOutcome,
    currentProfileSnapshotId,
    buildCurrentProfileRetainOptions(markdownByPath, currentProfileDocument.markdown),
  );

  return {
    entity: resolvedCurrentProfile.currentProfile,
    failures: resolvedCurrentProfile.failures,
  };
}

function readCurrentProfileTolerantSync(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
): CurrentProfileCollection {
  const resolution = resolveCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
    fallbackCurrentProfileEntity,
  );
  const currentProfileDocument = buildCurrentProfileDocumentResolutionInput(
    readOptionalMarkdownDocumentOutcomeSync(
      vaultRoot,
      "bank/profile/current.md",
    ),
  );
  const resolvedCurrentProfile = resolveCurrentProfileDocument(
    resolution,
    currentProfileDocument.documentOutcome,
    currentProfileSnapshotId,
    buildCurrentProfileRetainOptions(markdownByPath, currentProfileDocument.markdown),
  );

  return {
    entity: resolvedCurrentProfile.currentProfile,
    failures: resolvedCurrentProfile.failures,
  };
}

function buildCurrentProfileDocumentResolutionInput(
  input: MarkdownDocumentRecord | MarkdownDocumentOutcome | null,
): CurrentProfileDocumentResolutionInput {
  if (!input) {
    return {
      documentOutcome: { status: "missing" },
      markdown: null,
    };
  }

  if ("ok" in input) {
    if (!input.ok) {
      return {
        documentOutcome: {
          status: "parse-failed",
          failure: input,
        },
        markdown: null,
      };
    }

    return buildCurrentProfileDocumentResolutionInput(input.document);
  }

  return {
    documentOutcome: {
      status: "ok",
      currentProfile: projectCurrentProfileEntity(input),
    },
    markdown: input.markdown,
  };
}

function buildCurrentProfileRetainOptions(
  markdownByPath: Map<string, string>,
  markdown: string | null,
):
  | {
      retainDocumentCurrentProfile: (currentProfile: CanonicalEntity) => void;
    }
  | undefined {
  if (!markdown) {
    return undefined;
  }

  return {
    retainDocumentCurrentProfile: (currentProfile) => {
      markdownByPath.set(currentProfile.path, markdown);
    },
  };
}

function canonicalProfileSnapshotSortFields(
  snapshot: CanonicalEntity,
): CurrentProfileSnapshotSortFields {
  return {
    snapshotId: snapshot.entityId,
    snapshotTimestamp: snapshot.occurredAt ?? snapshot.date,
  };
}

function currentProfileSnapshotId(
  entity: CanonicalEntity,
): string | null {
  return firstString(entity.attributes, ["snapshotId"]);
}
