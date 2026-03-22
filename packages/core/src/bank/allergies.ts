import { generateRecordId } from "../ids.js";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  selectExistingRegistryRecord,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.js";

import {
  ALLERGIES_DIRECTORY,
  ALLERGY_CRITICALITIES,
  ALLERGY_DOC_TYPE,
  ALLERGY_SCHEMA_VERSION,
  ALLERGY_STATUSES,
} from "./types.js";
import {
  buildMarkdownBody,
  detailList,
  listSection,
  normalizeRecordIdList,
  normalizeSelectorSlug,
  normalizeUpsertSelectorSlug,
  optionalDateOnly,
  optionalEnum,
  optionalString,
  resolveOptionalUpsertValue,
  resolveRequiredUpsertValue,
  requireMatchingDocType,
  requireString,
  section,
  stripUndefined,
  normalizeId,
} from "./shared.js";

import type { FrontmatterObject } from "../types.js";
import type { AllergyRecord, ReadAllergyInput, UpsertAllergyInput, UpsertAllergyResult } from "./types.js";

function buildBody(record: AllergyRecord): string {
  return buildMarkdownBody(
    record.title,
    detailList([
      ["Substance", record.substance],
      ["Status", record.status],
      ["Criticality", record.criticality],
      ["Reaction", record.reaction],
      ["Recorded on", record.recordedOn],
    ]),
    [
      listSection("Related Conditions", record.relatedConditionIds),
      section("Note", record.note ?? "- none"),
    ],
  );
}

function parseAllergyRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): AllergyRecord {
  requireMatchingDocType(
    attributes,
    ALLERGY_SCHEMA_VERSION,
    ALLERGY_DOC_TYPE,
    "VAULT_INVALID_ALLERGY",
    "Allergy registry document has an unexpected shape.",
  );

  return stripUndefined({
    schemaVersion: ALLERGY_SCHEMA_VERSION,
    docType: ALLERGY_DOC_TYPE,
    allergyId: requireString(attributes.allergyId, "allergyId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", 160),
    substance: requireString(attributes.substance, "substance", 160),
    status: optionalEnum(attributes.status, ALLERGY_STATUSES, "status") ?? "active",
    criticality: optionalEnum(attributes.criticality, ALLERGY_CRITICALITIES, "criticality"),
    reaction: optionalString(attributes.reaction, "reaction", 160),
    recordedOn: optionalDateOnly(attributes.recordedOn as string | undefined, "recordedOn"),
    relatedConditionIds: normalizeRecordIdList(attributes.relatedConditionIds, "relatedConditionIds", "cond"),
    note: optionalString(attributes.note, "note", 4000),
    relativePath,
    markdown,
  });
}

function buildAttributes(record: AllergyRecord): FrontmatterObject {
  return stripUndefined({
    schemaVersion: ALLERGY_SCHEMA_VERSION,
    docType: ALLERGY_DOC_TYPE,
    allergyId: record.allergyId,
    slug: record.slug,
    title: record.title,
    substance: record.substance,
    status: record.status,
    criticality: record.criticality,
    reaction: record.reaction,
    recordedOn: record.recordedOn,
    relatedConditionIds: record.relatedConditionIds,
    note: record.note,
  }) as FrontmatterObject;
}

async function loadAllergies(vaultRoot: string): Promise<AllergyRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: ALLERGIES_DIRECTORY,
    recordFromParts: parseAllergyRecord,
    isExpectedRecord: (record) =>
      record.docType === ALLERGY_DOC_TYPE && record.schemaVersion === ALLERGY_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_ALLERGY",
    invalidMessage: "Allergy registry document has an unexpected shape.",
  });

  records.sort((left, right) => left.title.localeCompare(right.title) || left.allergyId.localeCompare(right.allergyId));
  return records;
}

export async function upsertAllergy(input: UpsertAllergyInput): Promise<UpsertAllergyResult> {
  const normalizedAllergyId = normalizeId(input.allergyId, "allergyId", "alg");
  const existingRecords = await loadAllergies(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = selectExistingRegistryRecord({
    records: existingRecords,
    recordId: normalizedAllergyId,
    slug: requestedSlug,
    getRecordId: (record) => record.allergyId,
    conflictCode: "VAULT_ALLERGY_CONFLICT",
    conflictMessage: "Allergy id and slug resolve to different records.",
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: normalizedAllergyId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    directory: ALLERGIES_DIRECTORY,
    getRecordId: (record) => record.allergyId,
    createRecordId: () => generateRecordId("alg"),
  });
  const attributes = buildAttributes(
    stripUndefined({
      schemaVersion: ALLERGY_SCHEMA_VERSION,
      docType: ALLERGY_DOC_TYPE,
      allergyId: target.recordId,
      slug: target.slug,
      title,
      substance: requireString(input.substance ?? existingRecord?.substance, "substance", 160),
      status: resolveRequiredUpsertValue(input.status, existingRecord?.status, "active", (value) =>
        optionalEnum(value, ALLERGY_STATUSES, "status") ?? "active",
      ),
      criticality: resolveOptionalUpsertValue(input.criticality, existingRecord?.criticality, (value) =>
        optionalEnum(value, ALLERGY_CRITICALITIES, "criticality"),
      ),
      reaction: resolveOptionalUpsertValue(input.reaction, existingRecord?.reaction, (value) =>
        optionalString(value, "reaction", 160),
      ),
      recordedOn: resolveOptionalUpsertValue(input.recordedOn, existingRecord?.recordedOn, (value) =>
        optionalDateOnly(value, "recordedOn"),
      ),
      relatedConditionIds: resolveOptionalUpsertValue(
        input.relatedConditionIds,
        existingRecord?.relatedConditionIds,
        (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
      ),
      note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
        optionalString(value, "note", 4000),
      ),
    }) as AllergyRecord,
  );
  const { auditPath, record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes,
    body: buildBody({
      ...attributes,
      relativePath: target.relativePath,
      markdown: existingRecord?.markdown ?? "",
    } as AllergyRecord),
    recordFromParts: parseAllergyRecord,
    operationType: "allergy_upsert",
    summary: `Upsert allergy ${target.recordId}`,
    audit: {
      action: "allergy_upsert",
      commandName: "core.upsertAllergy",
      summary: `Upserted allergy ${target.recordId}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    created: target.created,
    auditPath,
    record,
  };
}

export async function listAllergies(vaultRoot: string): Promise<AllergyRecord[]> {
  return loadAllergies(vaultRoot);
}

export async function readAllergy({ vaultRoot, allergyId, slug }: ReadAllergyInput): Promise<AllergyRecord> {
  const normalizedAllergyId = normalizeId(allergyId, "allergyId", "alg");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const records = await loadAllergies(vaultRoot);
  return readRegistryRecord({
    records,
    recordId: normalizedAllergyId,
    slug: normalizedSlug,
    getRecordId: (record) => record.allergyId,
    readMissingCode: "VAULT_ALLERGY_MISSING",
    readMissingMessage: "Allergy was not found.",
  });
}
