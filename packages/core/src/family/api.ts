import {
  contractIdMaxLength,
  FAMILY_MEMBER_LIMITS,
  ID_PREFIXES,
} from "@murph/contracts";

import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  bulletList,
  maybeSection,
  normalizeId,
  normalizeSlug,
  optionalBoolean,
  optionalString,
  requireString,
  validateSortedStringList,
} from "../history/shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  FamilyMemberRecord,
  ReadFamilyMemberInput,
  UpsertFamilyMemberInput,
  UpsertFamilyMemberResult,
} from "./types.ts";
import { FAMILY_MEMBER_DOC_TYPE, FAMILY_MEMBER_SCHEMA_VERSION } from "./types.ts";

const FAMILY_DIRECTORY = "bank/family";
const FAMILY_TITLE_MAX_LENGTH = FAMILY_MEMBER_LIMITS.title;
const FAMILY_RELATIONSHIP_MAX_LENGTH = FAMILY_MEMBER_LIMITS.relationship;
const FAMILY_NOTE_MAX_LENGTH = FAMILY_MEMBER_LIMITS.note;
const FAMILY_CONDITION_MAX_LENGTH = FAMILY_MEMBER_LIMITS.condition;
const FAMILY_VARIANT_ID_MAX_LENGTH = contractIdMaxLength(ID_PREFIXES.variant);

function buildBody(record: {
  title: string;
  relationship: string;
  conditions?: string[];
  note?: string;
  relatedVariantIds?: string[];
}): string {
  return [
    `# ${record.title}`,
    "",
    `Relationship: ${record.relationship}`,
    "",
    "## Conditions",
    "",
    bulletList(record.conditions),
    "",
    "## Related Variants",
    "",
    bulletList(record.relatedVariantIds),
    "",
    maybeSection("Notes", record.note),
    "",
  ].join("\n");
}

function recordFromParts(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): FamilyMemberRecord {
  return {
    schemaVersion: requireString(attributes.schemaVersion, "schemaVersion", 40) as typeof FAMILY_MEMBER_SCHEMA_VERSION,
    docType: requireString(attributes.docType, "docType", 40) as typeof FAMILY_MEMBER_DOC_TYPE,
    familyMemberId: requireString(attributes.familyMemberId, "familyMemberId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", FAMILY_TITLE_MAX_LENGTH),
    relationship: requireString(attributes.relationship, "relationship", FAMILY_RELATIONSHIP_MAX_LENGTH),
    conditions: validateSortedStringList(
      attributes.conditions,
      "conditions",
      "condition",
      24,
      FAMILY_CONDITION_MAX_LENGTH,
    ),
    deceased: optionalBoolean(attributes.deceased, "deceased"),
    note: optionalString(attributes.note, "note", FAMILY_NOTE_MAX_LENGTH),
    relatedVariantIds: validateSortedStringList(
      attributes.relatedVariantIds,
      "relatedVariantIds",
      "variantId",
      24,
      FAMILY_VARIANT_ID_MAX_LENGTH,
    ),
    relativePath,
    markdown,
  };
}

const familyRegistryApi = createMarkdownRegistryApi<FamilyMemberRecord>({
  directory: FAMILY_DIRECTORY,
  recordFromParts,
  isExpectedRecord: (record) =>
    record.docType === FAMILY_MEMBER_DOC_TYPE && record.schemaVersion === FAMILY_MEMBER_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_FAMILY_MEMBER",
  invalidMessage: "Family registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) => left.title.localeCompare(right.title) || left.familyMemberId.localeCompare(right.familyMemberId),
    ),
  getRecordId: (record) => record.familyMemberId,
  conflictCode: "VAULT_FAMILY_MEMBER_CONFLICT",
  conflictMessage: "familyMemberId and slug resolve to different family members.",
  readMissingCode: "VAULT_FAMILY_MEMBER_MISSING",
  readMissingMessage: "Family member was not found.",
  createRecordId: () => generateRecordId("fam"),
  operationType: "family_upsert",
  summary: (recordId) => `Upsert family member ${recordId}`,
  audit: {
    action: "family_upsert",
    commandName: "core.upsertFamilyMember",
    summary: (created) => `${created ? "Created" : "Updated"} family member registry record.`,
  },
});

function buildAttributes(input: {
  familyMemberId: string;
  slug: string;
  title: string;
  relationship: string;
  conditions?: string[];
  deceased?: boolean;
  note?: string;
  relatedVariantIds?: string[];
}): FrontmatterObject {
  return Object.fromEntries(
    Object.entries({
      schemaVersion: FAMILY_MEMBER_SCHEMA_VERSION,
      docType: FAMILY_MEMBER_DOC_TYPE,
      familyMemberId: input.familyMemberId,
      slug: input.slug,
      title: input.title,
      relationship: input.relationship,
      conditions: input.conditions,
      deceased: input.deceased,
      note: input.note,
      relatedVariantIds: input.relatedVariantIds,
    }).filter(([, value]) => value !== undefined),
  ) as FrontmatterObject;
}

export async function upsertFamilyMember(
  input: UpsertFamilyMemberInput,
): Promise<UpsertFamilyMemberResult> {
  const normalizedFamilyMemberId = normalizeId(input.familyMemberId, "familyMemberId", "fam");
  const selectorSlug =
    (input.slug ? normalizeSlug(input.slug, "slug") : undefined) ??
    (input.title ? normalizeSlug(undefined, "slug", input.title) : undefined);
  const existingRecord = await familyRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedFamilyMemberId,
    slug: selectorSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", FAMILY_TITLE_MAX_LENGTH);
  const relationship = requireString(
    input.relationship ?? existingRecord?.relationship,
    "relationship",
    FAMILY_RELATIONSHIP_MAX_LENGTH,
  );
  const conditions =
    input.conditions === undefined
      ? existingRecord?.conditions
      : validateSortedStringList(
          input.conditions,
          "conditions",
          "condition",
          24,
          FAMILY_CONDITION_MAX_LENGTH,
        );
  const note =
    input.note === undefined
      ? existingRecord?.note
      : optionalString(input.note, "note", FAMILY_NOTE_MAX_LENGTH);
  const relatedVariantIds =
    input.relatedVariantIds === undefined
      ? existingRecord?.relatedVariantIds
      : validateSortedStringList(
          input.relatedVariantIds,
          "relatedVariantIds",
          "variantId",
          24,
          FAMILY_VARIANT_ID_MAX_LENGTH,
        );
  return familyRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedFamilyMemberId,
    requestedSlug: selectorSlug,
    defaultSlug: normalizeSlug(undefined, "slug", title),
    buildDocument: (target) => ({
      attributes: buildAttributes({
        familyMemberId: target.recordId,
        slug: target.slug,
        title,
        relationship,
        conditions,
        deceased:
          input.deceased === undefined ? existingRecord?.deceased : optionalBoolean(input.deceased, "deceased"),
        note,
        relatedVariantIds,
      }),
      body: buildBody({
        title,
        relationship,
        conditions,
        note,
        relatedVariantIds,
      }),
    }),
  });
}

export async function listFamilyMembers(vaultRoot: string): Promise<FamilyMemberRecord[]> {
  return familyRegistryApi.listRecords(vaultRoot);
}

export async function readFamilyMember({
  vaultRoot,
  familyMemberId,
  slug,
}: ReadFamilyMemberInput): Promise<FamilyMemberRecord> {
  const normalizedFamilyMemberId = normalizeId(familyMemberId, "familyMemberId", "fam");
  const normalizedSlug = slug ? normalizeSlug(slug, "slug") : undefined;
  return familyRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedFamilyMemberId,
    slug: normalizedSlug,
  });
}
