import { emitAuditRecord } from "../audit.js";
import { VaultError } from "../errors.js";
import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { writeVaultTextFile } from "../fs.js";
import { generateRecordId } from "../ids.js";

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
  findRecordByIdOrSlug,
  listSection,
  loadMarkdownRegistry,
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
  selectRecordByIdOrSlug,
  stripUndefined,
  normalizeId,
  normalizeSlug,
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
  return loadMarkdownRegistry(
    vaultRoot,
    ALLERGIES_DIRECTORY,
    parseAllergyRecord,
    (left, right) => left.title.localeCompare(right.title) || left.allergyId.localeCompare(right.allergyId),
  );
}

export async function upsertAllergy(input: UpsertAllergyInput): Promise<UpsertAllergyResult> {
  const normalizedAllergyId = normalizeId(input.allergyId, "allergyId", "alg");
  const existingRecords = await loadAllergies(input.vaultRoot);
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = selectRecordByIdOrSlug(
    existingRecords,
    normalizedAllergyId,
    requestedSlug,
    (record) => record.allergyId,
    "Allergy",
    "VAULT_ALLERGY_CONFLICT",
  );
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  const slug = existingRecord?.slug ?? requestedSlug ?? normalizeSlug(undefined, "slug", title);
  const allergyId = existingRecord?.allergyId ?? normalizedAllergyId ?? generateRecordId("alg");
  const record = stripUndefined({
    schemaVersion: ALLERGY_SCHEMA_VERSION,
    docType: ALLERGY_DOC_TYPE,
    allergyId,
    slug: existingRecord?.slug ?? slug,
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
    relativePath: existingRecord?.relativePath ?? `${ALLERGIES_DIRECTORY}/${slug}.md`,
  }) as AllergyRecord;
  const markdown = stringifyFrontmatterDocument({
    attributes: buildAttributes(record),
    body: buildBody(record),
  });

  await writeVaultTextFile(input.vaultRoot, record.relativePath, markdown);
  const audit = await emitAuditRecord({
    vaultRoot: input.vaultRoot,
    action: "allergy_upsert",
    commandName: "core.upsertAllergy",
    summary: `Upserted allergy ${record.allergyId}.`,
    targetIds: [record.allergyId],
    changes: [
      {
        path: record.relativePath,
        op: existingRecord ? "update" : "create",
      },
    ],
  });

  return {
    created: !existingRecord,
    auditPath: audit.relativePath,
    record: {
      ...record,
      markdown,
    },
  };
}

export async function listAllergies(vaultRoot: string): Promise<AllergyRecord[]> {
  return loadAllergies(vaultRoot);
}

export async function readAllergy({ vaultRoot, allergyId, slug }: ReadAllergyInput): Promise<AllergyRecord> {
  const normalizedAllergyId = normalizeId(allergyId, "allergyId", "alg");
  const normalizedSlug = normalizeSelectorSlug(slug);
  const records = await loadAllergies(vaultRoot);
  const match = findRecordByIdOrSlug(records, normalizedAllergyId, normalizedSlug, (record) => record.allergyId);

  if (!match) {
    throw new VaultError("VAULT_ALLERGY_MISSING", "Allergy was not found.");
  }

  return match;
}
