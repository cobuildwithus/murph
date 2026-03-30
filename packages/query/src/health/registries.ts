import {
  requireBankEntityRegistryDefinition,
  type BankEntityKind,
  type BankEntityRegistryProjectionHelpers,
  type BankEntitySortBehavior,
} from "@murph/contracts";
import {
  applyLimit,
  compareNullableStrings,
  firstBoolean,
  firstNumber,
  firstObject,
  firstString,
  firstStringArray,
  matchesLookup,
  matchesStatus,
  matchesText,
  pathSlug,
} from "./shared.ts";
import {
  projectRegistryEntity,
  type CanonicalEntity,
  type CanonicalEntityFamily,
} from "../canonical-entities.ts";
import {
  readMarkdownDocument,
  walkRelativeFiles,
} from "./loaders.ts";

import type {
  FrontmatterObject,
  MarkdownDocumentRecord,
} from "./shared.ts";

export interface RegistryDocumentEnvelope {
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

export interface RegistryQueryEntity {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
}

export interface RegistryStoredDocument<
  TEntity extends RegistryQueryEntity = RegistryQueryEntity,
> {
  entity: TEntity;
  document: RegistryDocumentEnvelope;
}

export type RegistryMarkdownRecord = RegistryStoredDocument<RegistryQueryEntity>;

export interface RegistryListOptions {
  status?: string | string[];
  text?: string;
  limit?: number;
}

type ProjectedRegistryFamily = BankEntityKind;

interface RegistryDefinition<TEntity extends RegistryQueryEntity> {
  directory: string;
  idKeys: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  compare?: (left: TEntity, right: TEntity) => number;
  transform(
    base: RegistryQueryEntity,
    attributes: FrontmatterObject,
    relativePath: string,
  ): TEntity;
}

const registryProjectionHelpers: BankEntityRegistryProjectionHelpers = {
  firstBoolean,
  firstNumber,
  firstObject,
  firstString,
  firstStringArray,
};

export function buildPriorityTitleComparator<
  TEntity extends RegistryQueryEntity & { priority: number | null },
>(
  left: TEntity,
  right: TEntity,
): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return compareNullableStrings(left.title, right.title);
}

export function readPriority(
  attributes: FrontmatterObject,
  keys: readonly string[],
): number | null {
  return firstNumber(attributes, keys);
}

function compareRegistryRecords<TEntity extends RegistryQueryEntity>(
  sortBehavior: BankEntitySortBehavior | undefined,
): ((left: TEntity, right: TEntity) => number) | undefined {
  if (sortBehavior === "priority-title") {
    return buildPriorityTitleComparator as (left: TEntity, right: TEntity) => number;
  }

  if (sortBehavior === "title") {
    return (left: TEntity, right: TEntity) =>
      compareNullableStrings(left.title, right.title);
  }

  if (sortBehavior === "gene-title") {
    return (left: TEntity, right: TEntity) =>
      compareNullableStrings(
        (left as TEntity & { gene?: string | null }).gene ?? null,
        (right as TEntity & { gene?: string | null }).gene ?? null,
      ) || compareNullableStrings(left.title, right.title);
  }

  return undefined;
}

function createBankEntityRegistryDefinition<TEntity extends RegistryQueryEntity>(
  kind: BankEntityKind,
): RegistryDefinition<TEntity> {
  const definition = requireBankEntityRegistryDefinition(kind);
  const { registry } = definition;

  return {
    directory: registry.directory,
    idKeys: registry.idKeys,
    titleKeys: registry.titleKeys,
    statusKeys: registry.statusKeys,
    compare: compareRegistryRecords(registry.sortBehavior),
    transform(base, attributes, relativePath) {
      return {
        ...base,
        ...(registry.transform?.({
          attributes,
          helpers: registryProjectionHelpers,
          relativePath,
        }) ?? {}),
      } as TEntity;
    },
  };
}

function transformRegistryEntity<TEntity extends RegistryQueryEntity>(
  base: RegistryQueryEntity,
  attributes: FrontmatterObject,
  relativePath: string,
  definition: RegistryDefinition<TEntity>,
): TEntity {
  return definition.transform(base, attributes, relativePath);
}

export function toRegistryRecord<TEntity extends RegistryQueryEntity>(
  document: MarkdownDocumentRecord,
  definition: RegistryDefinition<TEntity>,
): RegistryStoredDocument<TEntity> | null {
  const slug = firstString(document.attributes, ["slug"]) ?? pathSlug(document.relativePath);
  const id = firstString(document.attributes, definition.idKeys);
  if (!id) {
    return null;
  }

  const entity = transformRegistryEntity(
    {
      id,
      slug,
      title: firstString(document.attributes, definition.titleKeys),
      status: firstString(document.attributes, definition.statusKeys),
    },
    document.attributes,
    document.relativePath,
    definition,
  );

  return {
    entity,
    document: {
      relativePath: document.relativePath,
      markdown: document.markdown,
      body: document.body,
      attributes: document.attributes,
    },
  };
}

export function sortRegistryRecords<TEntity extends RegistryQueryEntity>(
  records: RegistryStoredDocument<TEntity>[],
  definition: RegistryDefinition<TEntity>,
): RegistryStoredDocument<TEntity>[] {
  const compare =
    definition.compare ??
    ((left: TEntity, right: TEntity) =>
      compareNullableStrings(left.title, right.title));

  return records.sort((left, right) => compare(left.entity, right.entity));
}

function matchesRegistryOptions<TEntity extends RegistryQueryEntity>(
  record: RegistryStoredDocument<TEntity>,
  options: RegistryListOptions,
): boolean {
  return (
    matchesStatus(record.entity.status, options.status) &&
    matchesText(
      [
        record.entity.id,
        record.entity.slug,
        record.entity.title,
        record.document.body,
        record.document.attributes,
      ],
      options.text,
    )
  );
}

async function findRegistryRecord<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  predicate: (record: RegistryStoredDocument<TEntity>) => boolean,
): Promise<RegistryStoredDocument<TEntity> | null> {
  const records = await loadRegistry(vaultRoot, definition);
  return records.find(predicate) ?? null;
}

async function loadRegistry<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
): Promise<RegistryStoredDocument<TEntity>[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, definition.directory, ".md");
  const records: RegistryStoredDocument<TEntity>[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = toRegistryRecord(document, definition);
    if (record) {
      records.push(record);
    }
  }

  return sortRegistryRecords(records, definition);
}

export async function listRegistryRecords<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  options: RegistryListOptions = {},
): Promise<RegistryStoredDocument<TEntity>[]> {
  const records = await loadRegistry(vaultRoot, definition);
  const filtered = records.filter((record) => matchesRegistryOptions(record, options));

  return applyLimit(filtered, options.limit);
}

export async function readRegistryRecord<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  recordId: string,
): Promise<RegistryStoredDocument<TEntity> | null> {
  return findRegistryRecord(vaultRoot, definition, (record) => record.entity.id === recordId);
}

export async function showRegistryRecord<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  lookup: string,
): Promise<RegistryStoredDocument<TEntity> | null> {
  return findRegistryRecord(
    vaultRoot,
    definition,
    (record) =>
      matchesLookup(
        lookup,
        record.entity.id,
        record.entity.slug,
        record.entity.title,
      ),
  );
}

export function createRegistryQueries<TEntity extends RegistryQueryEntity>(
  definition: RegistryDefinition<TEntity>,
): {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<RegistryStoredDocument<TEntity>[]>;
  read(vaultRoot: string, recordId: string): Promise<RegistryStoredDocument<TEntity> | null>;
  show(vaultRoot: string, lookup: string): Promise<RegistryStoredDocument<TEntity> | null>;
} {
  return {
    list(vaultRoot, options = {}) {
      return listRegistryRecords(vaultRoot, definition, options);
    },
    read(vaultRoot, recordId) {
      return readRegistryRecord(vaultRoot, definition, recordId);
    },
    show(vaultRoot, lookup) {
      return showRegistryRecord(vaultRoot, definition, lookup);
    },
  };
}

export async function listProjectedRegistryRecords<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => RegistryStoredDocument<TEntity> | null,
  options: RegistryListOptions = {},
): Promise<RegistryStoredDocument<TEntity>[]> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );
  const filtered = records.filter((record) => matchesRegistryOptions(record, options));

  return applyLimit(filtered, options.limit);
}

export async function readProjectedRegistryRecord<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => RegistryStoredDocument<TEntity> | null,
  recordId: string,
): Promise<RegistryStoredDocument<TEntity> | null> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );
  return records.find((record) => record.entity.id === recordId) ?? null;
}

export async function showProjectedRegistryRecord<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => RegistryStoredDocument<TEntity> | null,
  lookup: string,
): Promise<RegistryStoredDocument<TEntity> | null> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );

  return (
    records.find((record) =>
      matchesLookup(
        lookup,
        record.entity.id,
        record.entity.slug,
        record.entity.title,
      ),
    ) ?? null
  );
}

export function createProjectedRegistryQueries<TEntity extends RegistryQueryEntity>(
  definition: RegistryDefinition<TEntity>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => RegistryStoredDocument<TEntity> | null,
): {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<RegistryStoredDocument<TEntity>[]>;
  read(vaultRoot: string, recordId: string): Promise<RegistryStoredDocument<TEntity> | null>;
  show(vaultRoot: string, lookup: string): Promise<RegistryStoredDocument<TEntity> | null>;
} {
  return {
    list(vaultRoot, options = {}) {
      return listProjectedRegistryRecords(vaultRoot, definition, family, mapEntity, options);
    },
    read(vaultRoot, recordId) {
      return readProjectedRegistryRecord(vaultRoot, definition, family, mapEntity, recordId);
    },
    show(vaultRoot, lookup) {
      return showProjectedRegistryRecord(vaultRoot, definition, family, mapEntity, lookup);
    },
  };
}

export interface GoalQueryEntity extends RegistryQueryEntity {
  horizon: string | null;
  priority: number | null;
  windowStartAt: string | null;
  windowTargetAt: string | null;
  parentGoalId: string | null;
  relatedGoalIds: string[];
  relatedExperimentIds: string[];
  domains: string[];
}

export type GoalQueryRecord = RegistryStoredDocument<GoalQueryEntity>;

export const goalRegistryDefinition: RegistryDefinition<GoalQueryEntity> =
  createBankEntityRegistryDefinition("goal");

export interface ConditionQueryEntity extends RegistryQueryEntity {
  clinicalStatus: string | null;
  verificationStatus: string | null;
  assertedOn: string | null;
  resolvedOn: string | null;
  severity: string | null;
  bodySites: string[];
  relatedGoalIds: string[];
  relatedProtocolIds: string[];
  note: string | null;
}

export type ConditionQueryRecord = RegistryStoredDocument<ConditionQueryEntity>;

export const conditionRegistryDefinition: RegistryDefinition<ConditionQueryEntity> =
  createBankEntityRegistryDefinition("condition");

export interface AllergyQueryEntity extends RegistryQueryEntity {
  substance: string | null;
  criticality: string | null;
  reaction: string | null;
  recordedOn: string | null;
  relatedConditionIds: string[];
  note: string | null;
}

export type AllergyQueryRecord = RegistryStoredDocument<AllergyQueryEntity>;

export const allergyRegistryDefinition: RegistryDefinition<AllergyQueryEntity> =
  createBankEntityRegistryDefinition("allergy");

export interface SupplementIngredientQueryRecord {
  compound: string;
  label: string | null;
  amount: number | null;
  unit: string | null;
  active: boolean;
  note: string | null;
}

export interface ProtocolQueryEntity extends RegistryQueryEntity {
  kind: string | null;
  startedOn: string | null;
  stoppedOn: string | null;
  substance: string | null;
  dose: number | null;
  unit: string | null;
  schedule: string | null;
  brand: string | null;
  manufacturer: string | null;
  servingSize: string | null;
  ingredients: SupplementIngredientQueryRecord[];
  relatedGoalIds: string[];
  relatedConditionIds: string[];
  group: string | null;
}

export type ProtocolQueryRecord = RegistryStoredDocument<ProtocolQueryEntity>;

export const protocolRegistryDefinition: RegistryDefinition<ProtocolQueryEntity> =
  createBankEntityRegistryDefinition("protocol");

export interface FamilyQueryEntity extends RegistryQueryEntity {
  relationship: string | null;
  deceased: boolean | null;
  conditions: string[];
  relatedVariantIds: string[];
  note: string | null;
}

export type FamilyQueryRecord = RegistryStoredDocument<FamilyQueryEntity>;

export const familyRegistryDefinition: RegistryDefinition<FamilyQueryEntity> =
  createBankEntityRegistryDefinition("family");

export interface GeneticsQueryEntity extends RegistryQueryEntity {
  gene: string | null;
  zygosity: string | null;
  significance: string | null;
  inheritance: string | null;
  sourceFamilyMemberIds: string[];
  note: string | null;
}

export type GeneticsQueryRecord = RegistryStoredDocument<GeneticsQueryEntity>;

export const geneticsRegistryDefinition: RegistryDefinition<GeneticsQueryEntity> =
  createBankEntityRegistryDefinition("genetics");

export interface FoodAutoLogDailyQueryRule {
  time: string;
}

export interface FoodQueryEntity extends RegistryQueryEntity {
  summary: string | null;
  kind: string | null;
  brand: string | null;
  vendor: string | null;
  location: string | null;
  serving: string | null;
  aliases: string[];
  ingredients: string[];
  tags: string[];
  note: string | null;
  attachedProtocolIds: string[];
  autoLogDaily: FoodAutoLogDailyQueryRule | null;
}

export type FoodQueryRecord = RegistryStoredDocument<FoodQueryEntity>;

export const foodRegistryDefinition: RegistryDefinition<FoodQueryEntity> =
  createBankEntityRegistryDefinition("food");

export interface RecipeQueryEntity extends RegistryQueryEntity {
  summary: string | null;
  cuisine: string | null;
  dishType: string | null;
  source: string | null;
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  tags: string[];
  ingredients: string[];
  steps: string[];
  relatedGoalIds: string[];
  relatedConditionIds: string[];
}

export type RecipeQueryRecord = RegistryStoredDocument<RecipeQueryEntity>;

export const recipeRegistryDefinition: RegistryDefinition<RecipeQueryEntity> =
  createBankEntityRegistryDefinition("recipe");

export interface ProviderQueryEntity extends RegistryQueryEntity {
  specialty: string | null;
  organization: string | null;
  location: string | null;
  website: string | null;
  phone: string | null;
  note: string | null;
  aliases: string[];
}

export type ProviderQueryRecord = RegistryStoredDocument<ProviderQueryEntity>;

export const providerRegistryDefinition: RegistryDefinition<ProviderQueryEntity> =
  createBankEntityRegistryDefinition("provider");

export interface WorkoutFormatQueryEntity extends RegistryQueryEntity {
  summary: string | null;
  activityType: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  strengthExercises: Record<string, unknown>[];
  tags: string[];
  note: string | null;
  templateText: string | null;
}

export type WorkoutFormatQueryRecord =
  RegistryStoredDocument<WorkoutFormatQueryEntity>;

export const workoutFormatRegistryDefinition: RegistryDefinition<WorkoutFormatQueryEntity> =
  createBankEntityRegistryDefinition("workout_format");

export {
  type RegistryDefinition,
};

async function loadProjectedRegistryRecords<TEntity extends RegistryQueryEntity>(
  vaultRoot: string,
  definition: RegistryDefinition<TEntity>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => RegistryStoredDocument<TEntity> | null,
): Promise<RegistryStoredDocument<TEntity>[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, definition.directory, ".md");
  const records: RegistryStoredDocument<TEntity>[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = toRegistryRecord(document, definition);
    if (!record) {
      continue;
    }

    const projected = mapEntity(projectRegistryEntity(family, record));
    if (projected) {
      records.push({
        entity: projected.entity,
        document: record.document,
      });
    }
  }

  return sortRegistryRecords(records, definition);
}

function registryRecordBaseFromEntity(
  entity: CanonicalEntity,
  family: CanonicalEntity["family"],
): RegistryMarkdownRecord | null {
  if (entity.family !== family) {
    return null;
  }

  const attributes = entity.attributes as FrontmatterObject;

  return {
    entity: {
      id: entity.entityId,
      slug: firstString(attributes, ["slug"]) ?? pathSlug(entity.path),
      title: entity.title,
      status: entity.status,
    },
    document: {
      relativePath: entity.path,
      markdown: entity.body ?? "",
      body: entity.body ?? "",
      attributes,
    },
  };
}

function projectRegistryRecordFromEntity<TEntity extends RegistryQueryEntity>(
  entity: CanonicalEntity,
  family: ProjectedRegistryFamily,
  definition: RegistryDefinition<TEntity>,
): RegistryStoredDocument<TEntity> | null {
  const base = registryRecordBaseFromEntity(entity, family);
  if (!base) {
    return null;
  }

  return {
    entity: transformRegistryEntity(
      base.entity,
      base.document.attributes,
      base.document.relativePath,
      definition,
    ),
    document: base.document,
  };
}

export function goalRecordFromEntity(entity: CanonicalEntity): GoalQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "goal", goalRegistryDefinition);
}

export function conditionRecordFromEntity(
  entity: CanonicalEntity,
): ConditionQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "condition", conditionRegistryDefinition);
}

export function allergyRecordFromEntity(entity: CanonicalEntity): AllergyQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "allergy", allergyRegistryDefinition);
}

export function protocolRecordFromEntity(entity: CanonicalEntity): ProtocolQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "protocol", protocolRegistryDefinition);
}

export function familyRecordFromEntity(entity: CanonicalEntity): FamilyQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "family", familyRegistryDefinition);
}

export function geneticsRecordFromEntity(
  entity: CanonicalEntity,
): GeneticsQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "genetics", geneticsRegistryDefinition);
}

export function foodRecordFromEntity(entity: CanonicalEntity): FoodQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "food", foodRegistryDefinition);
}

export function recipeRecordFromEntity(entity: CanonicalEntity): RecipeQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "recipe", recipeRegistryDefinition);
}

export function providerRecordFromEntity(
  entity: CanonicalEntity,
): ProviderQueryRecord | null {
  return projectRegistryRecordFromEntity(entity, "provider", providerRegistryDefinition);
}

export function workoutFormatRecordFromEntity(
  entity: CanonicalEntity,
): WorkoutFormatQueryRecord | null {
  return projectRegistryRecordFromEntity(
    entity,
    "workout_format",
    workoutFormatRegistryDefinition,
  );
}
