import {
  applyLimit,
  compareNullableStrings,
  firstNumber,
  firstString,
  firstStringArray,
  matchesLookup,
  matchesStatus,
  matchesText,
  pathSlug,
} from "./shared.js";
import {
  readMarkdownDocument,
  walkRelativeFiles,
} from "./loaders.js";

import type {
  FrontmatterObject,
  MarkdownDocumentRecord,
} from "./shared.js";

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
  const filtered = records.filter(
    (record) =>
      matchesStatus(record.status, options.status) &&
      matchesText([record.id, record.slug, record.title, record.body, record.attributes], options.text),
  );

  return applyLimit(filtered, options.limit);
}

export async function readRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  recordId: string,
): Promise<TRecord | null> {
  const records = await loadRegistry(vaultRoot, definition);
  return records.find((record) => record.id === recordId) ?? null;
}

export async function showRegistryRecord<TRecord extends RegistryMarkdownRecord>(
  vaultRoot: string,
  definition: RegistryDefinition<TRecord>,
  lookup: string,
): Promise<TRecord | null> {
  const records = await loadRegistry(vaultRoot, definition);
  return (
    records.find((record) => matchesLookup(lookup, record.id, record.slug, record.title)) ??
    null
  );
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

export const goalRegistryDefinition: RegistryDefinition<GoalQueryRecord> = {
  directory: "bank/goals",
  idKeys: ["goalId"],
  titleKeys: ["title"],
  statusKeys: ["status"],
  compare: buildPriorityTitleComparator,
  transform(base, attributes) {
    const window = attributes.window as FrontmatterObject | undefined;

    return {
      ...base,
      horizon: firstString(attributes, ["horizon"]),
      priority: readPriority(attributes, ["priority"]),
      windowStartAt: window ? firstString(window, ["startAt"]) : null,
      windowTargetAt: window ? firstString(window, ["targetAt"]) : null,
      parentGoalId: firstString(attributes, ["parentGoalId"]),
      relatedGoalIds: readRegistryStrings(attributes, ["relatedGoalIds"]),
      relatedExperimentIds: readRegistryStrings(attributes, ["relatedExperimentIds"]),
      domains: readRegistryStrings(attributes, ["domains"]),
    };
  },
};

export interface ConditionQueryRecord extends RegistryMarkdownRecord {
  clinicalStatus: string | null;
  verificationStatus: string | null;
  assertedOn: string | null;
  resolvedOn: string | null;
  severity: string | null;
  bodySites: string[];
  relatedGoalIds: string[];
  relatedRegimenIds: string[];
  note: string | null;
}

export const conditionRegistryDefinition: RegistryDefinition<ConditionQueryRecord> = {
  directory: "bank/conditions",
  idKeys: ["conditionId"],
  titleKeys: ["title"],
  statusKeys: ["clinicalStatus"],
  transform(base, attributes) {
    return {
      ...base,
      clinicalStatus: firstString(attributes, ["clinicalStatus"]),
      verificationStatus: firstString(attributes, ["verificationStatus"]),
      assertedOn: firstString(attributes, ["assertedOn"]),
      resolvedOn: firstString(attributes, ["resolvedOn"]),
      severity: firstString(attributes, ["severity"]),
      bodySites: readRegistryStrings(attributes, ["bodySites"]),
      relatedGoalIds: readRegistryStrings(attributes, ["relatedGoalIds"]),
      relatedRegimenIds: readRegistryStrings(attributes, ["relatedRegimenIds"]),
      note: firstString(attributes, ["note"]),
    };
  },
};

export interface AllergyQueryRecord extends RegistryMarkdownRecord {
  substance: string | null;
  criticality: string | null;
  reaction: string | null;
  recordedOn: string | null;
  relatedConditionIds: string[];
  note: string | null;
}

export const allergyRegistryDefinition: RegistryDefinition<AllergyQueryRecord> = {
  directory: "bank/allergies",
  idKeys: ["allergyId"],
  titleKeys: ["title"],
  statusKeys: ["status"],
  transform(base, attributes) {
    return {
      ...base,
      substance: firstString(attributes, ["substance"]),
      criticality: firstString(attributes, ["criticality"]),
      reaction: firstString(attributes, ["reaction"]),
      recordedOn: firstString(attributes, ["recordedOn"]),
      relatedConditionIds: readRegistryStrings(attributes, ["relatedConditionIds"]),
      note: firstString(attributes, ["note"]),
    };
  },
};

export interface RegimenQueryRecord extends RegistryMarkdownRecord {
  kind: string | null;
  startedOn: string | null;
  stoppedOn: string | null;
  substance: string | null;
  dose: number | null;
  unit: string | null;
  schedule: string | null;
  relatedGoalIds: string[];
  relatedConditionIds: string[];
  group: string | null;
}

export const regimenRegistryDefinition: RegistryDefinition<RegimenQueryRecord> = {
  directory: "bank/regimens",
  idKeys: ["regimenId"],
  titleKeys: ["title"],
  statusKeys: ["status"],
  transform(base, attributes) {
    const directory = base.relativePath.split("/").slice(0, -1);
    const group = directory.length > 2 ? directory.slice(2).join("/") : null;

    return {
      ...base,
      kind: firstString(attributes, ["kind"]),
      startedOn: firstString(attributes, ["startedOn"]),
      stoppedOn: firstString(attributes, ["stoppedOn"]),
      substance: firstString(attributes, ["substance"]),
      dose: firstNumber(attributes, ["dose"]),
      unit: firstString(attributes, ["unit"]),
      schedule: firstString(attributes, ["schedule"]),
      relatedGoalIds: readRegistryStrings(attributes, ["relatedGoalIds"]),
      relatedConditionIds: readRegistryStrings(attributes, ["relatedConditionIds"]),
      group,
    };
  },
};

export interface FamilyQueryRecord extends RegistryMarkdownRecord {
  relationship: string | null;
  deceased: boolean | null;
  conditions: string[];
  relatedVariantIds: string[];
  note: string | null;
  lineage: string | null;
  updatedAt: string | null;
}

export const familyRegistryDefinition: RegistryDefinition<FamilyQueryRecord> = {
  directory: "bank/family",
  idKeys: ["familyMemberId", "memberId"],
  titleKeys: ["title", "name"],
  statusKeys: [],
  transform(base, attributes) {
    return {
      ...base,
      relationship: firstString(attributes, ["relationship", "relation"]),
      deceased: attributes.deceased === undefined ? null : Boolean(attributes.deceased),
      conditions: readRegistryStrings(attributes, ["conditions"]),
      relatedVariantIds: readRegistryStrings(attributes, ["relatedVariantIds"]),
      note: firstString(attributes, ["note", "summary", "notes"]),
      lineage: firstString(attributes, ["lineage"]),
      updatedAt: firstString(attributes, ["updatedAt"]),
    };
  },
};

export interface GeneticsQueryRecord extends RegistryMarkdownRecord {
  gene: string | null;
  zygosity: string | null;
  significance: string | null;
  inheritance: string | null;
  sourceFamilyMemberIds: string[];
  note: string | null;
  updatedAt: string | null;
}

export const geneticsRegistryDefinition: RegistryDefinition<GeneticsQueryRecord> = {
  directory: "bank/genetics",
  idKeys: ["variantId"],
  titleKeys: ["title", "label"],
  statusKeys: ["significance"],
  transform(base, attributes) {
    return {
      ...base,
      gene: firstString(attributes, ["gene"]),
      zygosity: firstString(attributes, ["zygosity"]),
      significance: firstString(attributes, ["significance"]),
      inheritance: firstString(attributes, ["inheritance"]),
      sourceFamilyMemberIds: readRegistryStrings(attributes, ["sourceFamilyMemberIds", "familyMemberIds"]),
      note: firstString(attributes, ["note", "summary", "actionability", "notes"]),
      updatedAt: firstString(attributes, ["updatedAt"]),
    };
  },
};

export {
  type RegistryDefinition,
};
