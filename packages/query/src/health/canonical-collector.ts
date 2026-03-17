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
  type ParseFailure,
} from "./loaders.js";
import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  familyRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  regimenRegistryDefinition,
  toRegistryRecord,
  type RegistryDefinition,
  type RegistryMarkdownRecord,
} from "./registries.js";
import {
  fallbackFromLatestCurrentProfileSnapshot,
  isCurrentProfileStale,
  selectLatestCurrentProfileSnapshot,
  type CurrentProfileSnapshotSortFields,
} from "./current-profile-resolution.js";
import { firstString } from "./shared.js";

type RegistryFamily = Extract<
  CanonicalEntityFamily,
  "allergy" | "condition" | "family" | "genetics" | "goal" | "regimen"
>;

interface RegistryCollectorConfig<TRecord extends RegistryMarkdownRecord> {
  family: RegistryFamily;
  definition: RegistryDefinition<TRecord>;
}

interface EntityCollection {
  entities: CanonicalEntity[];
  failures: ParseFailure[];
}

export interface CanonicalHealthEntityCollection {
  assessments: CanonicalEntity[];
  profileSnapshots: CanonicalEntity[];
  currentProfile: CanonicalEntity | null;
  history: CanonicalEntity[];
  goals: CanonicalEntity[];
  conditions: CanonicalEntity[];
  allergies: CanonicalEntity[];
  regimens: CanonicalEntity[];
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
  createRegistryCollectorConfig("goal", goalRegistryDefinition),
  createRegistryCollectorConfig("condition", conditionRegistryDefinition),
  createRegistryCollectorConfig("allergy", allergyRegistryDefinition),
  createRegistryCollectorConfig("regimen", regimenRegistryDefinition),
  createRegistryCollectorConfig("family", familyRegistryDefinition),
  createRegistryCollectorConfig("genetics", geneticsRegistryDefinition),
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

function createRegistryCollectorConfig<TRecord extends RegistryMarkdownRecord>(
  family: RegistryFamily,
  definition: RegistryDefinition<TRecord>,
): RegistryCollectorConfig<TRecord> {
  return { family, definition };
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
  const goals = await readRegistryEntitiesStrict(vaultRoot, REGISTRY_COLLECTORS[0], markdownByPath);
  const conditions = await readRegistryEntitiesStrict(
    vaultRoot,
    REGISTRY_COLLECTORS[1],
    markdownByPath,
  );
  const allergies = await readRegistryEntitiesStrict(
    vaultRoot,
    REGISTRY_COLLECTORS[2],
    markdownByPath,
  );
  const regimens = await readRegistryEntitiesStrict(
    vaultRoot,
    REGISTRY_COLLECTORS[3],
    markdownByPath,
  );
  const familyMembers = await readRegistryEntitiesStrict(
    vaultRoot,
    REGISTRY_COLLECTORS[4],
    markdownByPath,
  );
  const geneticVariants = await readRegistryEntitiesStrict(
    vaultRoot,
    REGISTRY_COLLECTORS[5],
    markdownByPath,
  );
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
    goals,
    conditions,
    allergies,
    regimens,
    familyMembers,
    geneticVariants,
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
  const goals = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[0],
    markdownByPath,
  );
  const conditions = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[1],
    markdownByPath,
  );
  const allergies = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[2],
    markdownByPath,
  );
  const regimens = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[3],
    markdownByPath,
  );
  const familyMembers = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[4],
    markdownByPath,
  );
  const geneticVariants = await readRegistryEntitiesTolerant(
    vaultRoot,
    REGISTRY_COLLECTORS[5],
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
    goals: goals.entities,
    conditions: conditions.entities,
    allergies: allergies.entities,
    regimens: regimens.entities,
    familyMembers: familyMembers.entities,
    geneticVariants: geneticVariants.entities,
    failures: [
      ...assessments.failures,
      ...profileSnapshots.failures,
      ...history.failures,
      ...currentProfile.failures,
      ...goals.failures,
      ...conditions.failures,
      ...allergies.failures,
      ...regimens.failures,
      ...familyMembers.failures,
      ...geneticVariants.failures,
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
  const goals = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[0],
    markdownByPath,
  );
  const conditions = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[1],
    markdownByPath,
  );
  const allergies = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[2],
    markdownByPath,
  );
  const regimens = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[3],
    markdownByPath,
  );
  const familyMembers = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[4],
    markdownByPath,
  );
  const geneticVariants = readRegistryEntitiesTolerantSync(
    vaultRoot,
    REGISTRY_COLLECTORS[5],
    markdownByPath,
  );

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
    ...goals.failures,
    ...conditions.failures,
    ...allergies.failures,
    ...regimens.failures,
    ...familyMembers.failures,
    ...geneticVariants.failures,
  );

  return buildCanonicalHealthCollection({
    assessments: assessments.entities,
    profileSnapshots: profileSnapshots.entities,
    currentProfile: currentProfile.entity,
    history: history.entities,
    goals: goals.entities,
    conditions: conditions.entities,
    allergies: allergies.entities,
    regimens: regimens.entities,
    familyMembers: familyMembers.entities,
    geneticVariants: geneticVariants.entities,
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
  regimens: CanonicalEntity[];
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
      ...input.regimens,
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
    const record = toRegistryRecord(document, config.definition);
    if (!record) {
      continue;
    }

    const entity = projectRegistryEntity(config.family, record);
    markdownByPath.set(entity.path, record.markdown);
    entities.push(entity);
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

    const record = toRegistryRecord(outcome.document, config.definition);
    if (!record) {
      continue;
    }

    const entity = projectRegistryEntity(config.family, record);
    markdownByPath.set(entity.path, record.markdown);
    entities.push(entity);
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

    const record = toRegistryRecord(outcome.document, config.definition);
    if (!record) {
      continue;
    }

    const entity = projectRegistryEntity(config.family, record);
    markdownByPath.set(entity.path, record.markdown);
    entities.push(entity);
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
  const latestSnapshot = selectLatestCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
  );
  const fallbackCurrentProfile = () =>
    fallbackFromLatestCurrentProfileSnapshot(
      latestSnapshot,
      fallbackCurrentProfileEntity,
    );
  const document = await readOptionalMarkdownDocument(vaultRoot, "bank/profile/current.md");

  if (!document) {
    return fallbackCurrentProfile();
  }

  const currentProfile = projectCurrentProfileEntity(document);
  if (
    isCurrentProfileStale(
      firstString(currentProfile.attributes, ["snapshotId"]),
      latestSnapshot?.entityId ?? null,
    )
  ) {
    return fallbackCurrentProfile();
  }

  markdownByPath.set(currentProfile.path, document.markdown);
  return currentProfile;
}

async function readCurrentProfileTolerant(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
): Promise<{ entity: CanonicalEntity | null; failures: ParseFailure[] }> {
  const latestSnapshot = selectLatestCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
  );
  const fallbackCurrentProfile = () =>
    fallbackFromLatestCurrentProfileSnapshot(
      latestSnapshot,
      fallbackCurrentProfileEntity,
    );
  const outcome = await readOptionalMarkdownDocumentOutcome(
    vaultRoot,
    "bank/profile/current.md",
  );

  if (!outcome) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [],
    };
  }

  if (!outcome.ok) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [outcome],
    };
  }

  const currentProfile = projectCurrentProfileEntity(outcome.document);
  if (
    isCurrentProfileStale(
      firstString(currentProfile.attributes, ["snapshotId"]),
      latestSnapshot?.entityId ?? null,
    )
  ) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [],
    };
  }

  markdownByPath.set(currentProfile.path, outcome.document.markdown);
  return {
    entity: currentProfile,
    failures: [],
  };
}

function readCurrentProfileTolerantSync(
  vaultRoot: string,
  profileSnapshots: CanonicalEntity[],
  markdownByPath: Map<string, string>,
): { entity: CanonicalEntity | null; failures: ParseFailure[] } {
  const latestSnapshot = selectLatestCurrentProfileSnapshot(
    profileSnapshots,
    canonicalProfileSnapshotSortFields,
  );
  const fallbackCurrentProfile = () =>
    fallbackFromLatestCurrentProfileSnapshot(
      latestSnapshot,
      fallbackCurrentProfileEntity,
    );
  const outcome = readOptionalMarkdownDocumentOutcomeSync(
    vaultRoot,
    "bank/profile/current.md",
  );

  if (!outcome) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [],
    };
  }

  if (!outcome.ok) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [outcome],
    };
  }

  const currentProfile = projectCurrentProfileEntity(outcome.document);
  if (
    isCurrentProfileStale(
      firstString(currentProfile.attributes, ["snapshotId"]),
      latestSnapshot?.entityId ?? null,
    )
  ) {
    return {
      entity: fallbackCurrentProfile(),
      failures: [],
    };
  }

  markdownByPath.set(currentProfile.path, outcome.document.markdown);
  return {
    entity: currentProfile,
    failures: [],
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
