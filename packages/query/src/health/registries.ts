import {
  deriveProtocolGroupFromRelativePath,
  healthEntityDefinitionByKind,
  hasHealthEntityRegistry,
  type HealthEntityDefinitionWithRegistry,
  type HealthEntityKind,
  type HealthEntityRegistryProjectionHelpers,
  type HealthEntitySortBehavior,
} from "@healthybob/contracts";
import {
  applyLimit,
  asObject,
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
} from "./shared.js";
import {
  projectRegistryEntity,
  type CanonicalEntityFamily,
} from "../canonical-entities.js";
import {
  readMarkdownDocument,
  walkRelativeFiles,
} from "./loaders.js";

import type {
  FrontmatterObject,
  MarkdownDocumentRecord,
} from "./shared.js";
import type { CanonicalEntity } from "../canonical-entities.js";

export interface RegistryMarkdownRecord {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

export interface RegistryListOptions {
  status?: string | string[];
  text?: string;
  limit?: number;
}

type ProjectedRegistryFamily = Extract<
  CanonicalEntityFamily,
  "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
>;

interface RegistryDefinition<TRecord extends RegistryMarkdownRecord> {
  directory: string;
  idKeys: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  compare?: (left: TRecord, right: TRecord) => number;
  transform(
    base: RegistryMarkdownRecord,
    attributes: FrontmatterObject,
  ): TRecord;
}

const registryProjectionHelpers: HealthEntityRegistryProjectionHelpers = {
  firstBoolean,
  firstNumber,
  firstObject,
  firstString,
  firstStringArray,
};

export function buildPriorityTitleComparator<TRecord extends RegistryMarkdownRecord & { priority: number | null }>(
  left: TRecord,
  right: TRecord,
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

export function readRegistryStrings(
  attributes: FrontmatterObject,
  keys: readonly string[],
): string[] {
  return firstStringArray(attributes, keys);
}

function requireRegistryEntityDefinition(
  kind: HealthEntityKind,
): HealthEntityDefinitionWithRegistry {
  const definition = healthEntityDefinitionByKind.get(kind);

  if (!definition || !hasHealthEntityRegistry(definition)) {
    throw new Error(`Health entity "${kind}" does not define a registry projection.`);
  }

  return definition;
}

function compareRegistryRecords<TRecord extends RegistryMarkdownRecord>(
  sortBehavior: HealthEntitySortBehavior | undefined,
): ((left: TRecord, right: TRecord) => number) | undefined {
  if (sortBehavior === "priority-title") {
    return buildPriorityTitleComparator as (left: TRecord, right: TRecord) => number;
  }

  return undefined;
}

function createHealthEntityRegistryDefinition<TRecord extends RegistryMarkdownRecord>(
  kind: HealthEntityKind,
): RegistryDefinition<TRecord> {
  const definition = requireRegistryEntityDefinition(kind);
  const { registry } = definition;

  return {
    directory: registry.directory,
    idKeys: registry.idKeys,
    titleKeys: registry.titleKeys,
    statusKeys: registry.statusKeys,
    compare: compareRegistryRecords(registry.sortBehavior),
    transform(base, attributes) {
      return {
        ...base,
        ...(registry.transform?.({
          attributes,
          helpers: registryProjectionHelpers,
          relativePath: base.relativePath,
        }) ?? {}),
      } as TRecord;
    },
  };
}

export function toRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  document: MarkdownDocumentRecord,
  definition: RegistryDefinition<TRecord>,
): TRecord | null {
  const id = firstString(document.attributes, definition.idKeys);
  if (!id) {
    return null;
  }

  const base: RegistryMarkdownRecord = {
    id,
    slug: firstString(document.attributes, ["slug"]) ?? pathSlug(document.relativePath),
    title: firstString(document.attributes, definition.titleKeys),
    status: firstString(document.attributes, definition.statusKeys),
    relativePath: document.relativePath,
    markdown: document.markdown,
    body: document.body,
    attributes: document.attributes,
  };

  return definition.transform(base, document.attributes);
}

export function sortRegistryRecords<TRecord extends RegistryMarkdownRecord>(
  records: TRecord[],
  definition: RegistryDefinition<TRecord>,
): TRecord[] {
  const compare =
    definition.compare ??
    ((left: TRecord, right: TRecord) => compareNullableStrings(left.title, right.title));

  return records.sort(compare);
}

function matchesRegistryOptions<TRecord extends RegistryMarkdownRecord>(
  record: TRecord,
  options: RegistryListOptions,
): boolean {
  return (
    matchesStatus(record.status, options.status) &&
    matchesText(
      [record.id, record.slug, record.title, record.body, record.attributes],
      options.text,
    )
  );
}

async function findRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  predicate: (record: TRecord) => boolean,
): Promise<TRecord | null> {
  const records = await loadRegistry(vaultRoot, definition);
  return records.find(predicate) ?? null;
}

async function loadRegistry<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
): Promise<TRecord[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, definition.directory, ".md");
  const records: TRecord[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = toRegistryRecord(document, definition);
    if (record) {
      records.push(record);
    }
  }

  return sortRegistryRecords(records, definition);
}

export async function listRegistryRecords<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  options: RegistryListOptions = {},
): Promise<TRecord[]> {
  const records = await loadRegistry(vaultRoot, definition);
  const filtered = records.filter((record) => matchesRegistryOptions(record, options));

  return applyLimit(filtered, options.limit);
}

export async function readRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  recordId: string,
): Promise<TRecord | null> {
  return findRegistryRecord(vaultRoot, definition, (record) => record.id === recordId);
}

export async function showRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  lookup: string,
): Promise<TRecord | null> {
  return findRegistryRecord(
    vaultRoot,
    definition,
    (record) => matchesLookup(lookup, record.id, record.slug, record.title),
  );
}

export function createRegistryQueries<TRecord extends RegistryMarkdownRecord>(
  definition: RegistryDefinition<TRecord>,
): {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<TRecord[]>;
  read(vaultRoot: string, recordId: string): Promise<TRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<TRecord | null>;
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

export async function listProjectedRegistryRecords<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => TRecord | null,
  options: RegistryListOptions = {},
): Promise<TRecord[]> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );
  const filtered = records.filter((record) => matchesRegistryOptions(record, options));

  return applyLimit(filtered, options.limit);
}

export async function readProjectedRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => TRecord | null,
  recordId: string,
): Promise<TRecord | null> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );
  return records.find((record) => record.id === recordId) ?? null;
}

export async function showProjectedRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => TRecord | null,
  lookup: string,
): Promise<TRecord | null> {
  const records = await loadProjectedRegistryRecords(
    vaultRoot,
    definition,
    family,
    mapEntity,
  );

  return records.find((record) => matchesLookup(lookup, record.id, record.slug, record.title)) ?? null;
}

export function createProjectedRegistryQueries<TRecord extends RegistryMarkdownRecord>(
  definition: RegistryDefinition<TRecord>,
  family: ProjectedRegistryFamily,
  mapEntity: (entity: CanonicalEntity) => TRecord | null,
): {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<TRecord[]>;
  read(vaultRoot: string, recordId: string): Promise<TRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<TRecord | null>;
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

export interface GoalQueryRecord extends RegistryMarkdownRecord {
  horizon: string | null;
  priority: number | null;
  windowStartAt: string | null;
  windowTargetAt: string | null;
  parentGoalId: string | null;
  relatedGoalIds: string[];
  relatedExperimentIds: string[];
  domains: string[];
}

export const goalRegistryDefinition: RegistryDefinition<GoalQueryRecord> =
  createHealthEntityRegistryDefinition("goal");

export interface ConditionQueryRecord extends RegistryMarkdownRecord {
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

export const conditionRegistryDefinition: RegistryDefinition<ConditionQueryRecord> =
  createHealthEntityRegistryDefinition("condition");

export interface AllergyQueryRecord extends RegistryMarkdownRecord {
  substance: string | null;
  criticality: string | null;
  reaction: string | null;
  recordedOn: string | null;
  relatedConditionIds: string[];
  note: string | null;
}

export const allergyRegistryDefinition: RegistryDefinition<AllergyQueryRecord> =
  createHealthEntityRegistryDefinition("allergy");

export interface SupplementIngredientQueryRecord {
  compound: string;
  label: string | null;
  amount: number | null;
  unit: string | null;
  active: boolean;
  note: string | null;
}

export function readSupplementIngredients(
  attributes: FrontmatterObject,
  keys: readonly string[] = ["ingredients"],
): SupplementIngredientQueryRecord[] {
  for (const key of keys) {
    const value = attributes[key];

    if (!Array.isArray(value)) {
      continue;
    }

    return value.flatMap((entry) => {
      const ingredient = asObject(entry);
      if (!ingredient) {
        return [];
      }

      const compound = firstString(ingredient, ["compound"]);
      if (!compound) {
        return [];
      }

      return [{
        compound,
        label: firstString(ingredient, ["label"]),
        amount: firstNumber(ingredient, ["amount"]),
        unit: firstString(ingredient, ["unit"]),
        active: firstBoolean(ingredient, ["active"]) ?? true,
        note: firstString(ingredient, ["note"]),
      }];
    });
  }

  return [];
}

export interface ProtocolQueryRecord extends RegistryMarkdownRecord {
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

export const protocolRegistryDefinition: RegistryDefinition<ProtocolQueryRecord> =
  createHealthEntityRegistryDefinition("protocol");

export interface FamilyQueryRecord extends RegistryMarkdownRecord {
  relationship: string | null;
  deceased: boolean | null;
  conditions: string[];
  relatedVariantIds: string[];
  note: string | null;
  lineage: string | null;
  updatedAt: string | null;
}

export const familyRegistryDefinition: RegistryDefinition<FamilyQueryRecord> =
  createHealthEntityRegistryDefinition("family");

export interface GeneticsQueryRecord extends RegistryMarkdownRecord {
  gene: string | null;
  zygosity: string | null;
  significance: string | null;
  inheritance: string | null;
  sourceFamilyMemberIds: string[];
  note: string | null;
  updatedAt: string | null;
}

export const geneticsRegistryDefinition: RegistryDefinition<GeneticsQueryRecord> =
  createHealthEntityRegistryDefinition("genetics");

export {
  type RegistryDefinition,
};

async function loadProjectedRegistryRecords<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  family: Extract<
    CanonicalEntityFamily,
    "allergy" | "condition" | "family" | "genetics" | "goal" | "protocol"
  >,
  mapEntity: (entity: CanonicalEntity) => TRecord | null,
): Promise<TRecord[]> {
  const relativePaths = await walkRelativeFiles(vaultRoot, definition.directory, ".md");
  const records: TRecord[] = [];

  for (const relativePath of relativePaths) {
    const document = await readMarkdownDocument(vaultRoot, relativePath);
    const record = toRegistryRecord(document, definition);
    if (!record) {
      continue;
    }

    const projected = mapEntity(projectRegistryEntity(family, record));
    if (projected) {
      records.push(projected);
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
    id: entity.entityId,
    slug: firstString(attributes, ["slug"]) ?? pathSlug(entity.path),
    title: entity.title,
    status: entity.status,
    relativePath: entity.path,
    markdown: entity.body ?? "",
    body: entity.body ?? "",
    attributes,
  };
}

export function goalRecordFromEntity(entity: CanonicalEntity): GoalQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "goal");
  if (!base) {
    return null;
  }

  const window = base.attributes.window as FrontmatterObject | undefined;

  return {
    ...base,
    horizon: firstString(base.attributes, ["horizon"]),
    priority: readPriority(base.attributes, ["priority"]),
    windowStartAt: window ? firstString(window, ["startAt"]) : null,
    windowTargetAt: window ? firstString(window, ["targetAt"]) : null,
    parentGoalId: firstString(base.attributes, ["parentGoalId"]),
    relatedGoalIds: readRegistryStrings(base.attributes, ["relatedGoalIds"]),
    relatedExperimentIds: readRegistryStrings(base.attributes, ["relatedExperimentIds"]),
    domains: readRegistryStrings(base.attributes, ["domains"]),
  };
}

export function conditionRecordFromEntity(
  entity: CanonicalEntity,
): ConditionQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "condition");
  if (!base) {
    return null;
  }

  return {
    ...base,
    clinicalStatus: firstString(base.attributes, ["clinicalStatus"]),
    verificationStatus: firstString(base.attributes, ["verificationStatus"]),
    assertedOn: firstString(base.attributes, ["assertedOn"]),
    resolvedOn: firstString(base.attributes, ["resolvedOn"]),
    severity: firstString(base.attributes, ["severity"]),
    bodySites: readRegistryStrings(base.attributes, ["bodySites"]),
    relatedGoalIds: readRegistryStrings(base.attributes, ["relatedGoalIds"]),
    relatedProtocolIds: readRegistryStrings(base.attributes, ["relatedProtocolIds"]),
    note: firstString(base.attributes, ["note"]),
  };
}

export function allergyRecordFromEntity(entity: CanonicalEntity): AllergyQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "allergy");
  if (!base) {
    return null;
  }

  return {
    ...base,
    substance: firstString(base.attributes, ["substance"]),
    criticality: firstString(base.attributes, ["criticality"]),
    reaction: firstString(base.attributes, ["reaction"]),
    recordedOn: firstString(base.attributes, ["recordedOn", "assertedOn"]),
    relatedConditionIds: readRegistryStrings(base.attributes, ["relatedConditionIds"]),
    note: firstString(base.attributes, ["note"]),
  };
}

export function protocolRecordFromEntity(entity: CanonicalEntity): ProtocolQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "protocol");
  if (!base) {
    return null;
  }

  return {
    ...base,
    kind: firstString(base.attributes, ["kind"]),
    startedOn: firstString(base.attributes, ["startedOn"]),
    stoppedOn: firstString(base.attributes, ["stoppedOn"]),
    substance: firstString(base.attributes, ["substance"]),
    dose: firstNumber(base.attributes, ["dose"]),
    unit: firstString(base.attributes, ["unit"]),
    schedule: firstString(base.attributes, ["schedule"]),
    brand: firstString(base.attributes, ["brand"]),
    manufacturer: firstString(base.attributes, ["manufacturer"]),
    servingSize: firstString(base.attributes, ["servingSize"]),
    ingredients: readSupplementIngredients(base.attributes),
    relatedGoalIds: readRegistryStrings(base.attributes, ["relatedGoalIds"]),
    relatedConditionIds: readRegistryStrings(base.attributes, ["relatedConditionIds"]),
    group:
      firstString(base.attributes, ["group"]) ??
      deriveProtocolGroupFromRelativePath(base.relativePath),
  };
}

export function familyRecordFromEntity(entity: CanonicalEntity): FamilyQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "family");
  if (!base) {
    return null;
  }

  return {
    ...base,
    relationship: firstString(base.attributes, ["relationship", "relation"]),
    deceased: firstBoolean(base.attributes, ["deceased"]),
    conditions: readRegistryStrings(base.attributes, ["conditions"]),
    relatedVariantIds: readRegistryStrings(base.attributes, ["relatedVariantIds"]),
    note: firstString(base.attributes, ["note", "summary", "notes"]),
    lineage: firstString(base.attributes, ["lineage"]),
    updatedAt: firstString(base.attributes, ["updatedAt"]),
  };
}

export function geneticsRecordFromEntity(
  entity: CanonicalEntity,
): GeneticsQueryRecord | null {
  const base = registryRecordBaseFromEntity(entity, "genetics");
  if (!base) {
    return null;
  }

  return {
    ...base,
    gene: firstString(base.attributes, ["gene"]),
    zygosity: firstString(base.attributes, ["zygosity"]),
    significance: firstString(base.attributes, ["significance"]),
    inheritance: firstString(base.attributes, ["inheritance"]),
    sourceFamilyMemberIds: readRegistryStrings(base.attributes, ["sourceFamilyMemberIds", "familyMemberIds"]),
    note: firstString(base.attributes, ["note", "summary", "actionability", "notes"]),
    updatedAt: firstString(base.attributes, ["updatedAt"]),
  };
}
