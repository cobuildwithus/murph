import {
  contractIdMaxLength,
  FAMILY_MEMBER_LIMITS,
  ID_PREFIXES,
} from "@healthybob/contracts";

import { stringifyFrontmatterDocument } from "../frontmatter.js";
import { generateRecordId } from "../ids.js";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  selectExistingRegistryRecord,
  upsertMarkdownRegistryDocument,
} from "../registry/markdown.js";

import {
  bulletList,
  maybeSection,
  normalizeId,
  normalizeSlug,
  normalizeStringList,
  optionalBoolean,
  optionalString,
  requireString,
} from "../history/shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  FamilyMemberRecord,
  ReadFamilyMemberInput,
  UpsertFamilyMemberInput,
  UpsertFamilyMemberResult,
} from "./types.js";
import { FAMILY_MEMBER_DOC_TYPE, FAMILY_MEMBER_SCHEMA_VERSION } from "./types.js";

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
    conditions: normalizeStringList(
      attributes.conditions,
      "conditions",
      "condition",
      24,
      FAMILY_CONDITION_MAX_LENGTH,
    ),
    deceased: optionalBoolean(attributes.deceased, "deceased"),
    note: optionalString(attributes.note, "note", FAMILY_NOTE_MAX_LENGTH),
    relatedVariantIds: normalizeStringList(
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

async function loadFamilyRecords(vaultRoot: string): Promise<FamilyMemberRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: FAMILY_DIRECTORY,
    recordFromParts,
    isExpectedRecord: (record) =>
      record.docType === FAMILY_MEMBER_DOC_TYPE && record.schemaVersion === FAMILY_MEMBER_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_FAMILY_MEMBER",
    invalidMessage: "Family registry document has an unexpected shape.",
  });

  records.sort(
    (left, right) => left.title.localeCompare(right.title) || left.familyMemberId.localeCompare(right.familyMemberId),
  );
  return records;
}

function selectExistingRecord(
  records: FamilyMemberRecord[],
  familyMemberId: string | undefined,
  slug: string | undefined,
): FamilyMemberRecord | null {
  return selectExistingRegistryRecord({
    records,
    recordId: familyMemberId,
    slug,
    getRecordId: (record) => record.familyMemberId,
    conflictCode: "VAULT_FAMILY_MEMBER_CONFLICT",
    conflictMessage: "familyMemberId and slug resolve to different family members.",
  });
}

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
  const existingRecords = await loadFamilyRecords(input.vaultRoot);
  const selectorSlug =
    (input.slug ? normalizeSlug(input.slug, "slug") : undefined) ??
    (input.title ?? input.name ? normalizeSlug(undefined, "slug", input.title ?? input.name) : undefined);
  const existingRecord = selectExistingRecord(existingRecords, normalizedFamilyMemberId, selectorSlug);
  const title = requireString(input.title ?? input.name ?? existingRecord?.title, "title", FAMILY_TITLE_MAX_LENGTH);
  const relationship = requireString(
    input.relationship ?? input.relation ?? existingRecord?.relationship,
    "relationship",
    FAMILY_RELATIONSHIP_MAX_LENGTH,
  );
  const slug = existingRecord?.slug ?? selectorSlug ?? normalizeSlug(undefined, "slug", title);
  const familyMemberId = existingRecord?.familyMemberId ?? normalizedFamilyMemberId ?? generateRecordId("fam");
  const relativePath = existingRecord?.relativePath ?? `${FAMILY_DIRECTORY}/${slug}.md`;
  const conditions =
    input.conditions === undefined
      ? existingRecord?.conditions
      : normalizeStringList(input.conditions, "conditions", "condition", 24, FAMILY_CONDITION_MAX_LENGTH);
  const note =
    input.note === undefined && input.summary === undefined
      ? existingRecord?.note
      : optionalString(input.note ?? input.summary, "note", FAMILY_NOTE_MAX_LENGTH);
  const relatedVariantIds =
    input.relatedVariantIds === undefined
      ? existingRecord?.relatedVariantIds
      : normalizeStringList(
          input.relatedVariantIds,
          "relatedVariantIds",
          "variantId",
          24,
          FAMILY_VARIANT_ID_MAX_LENGTH,
        );
  const created = !existingRecord;
  const attributes = buildAttributes({
    familyMemberId,
    slug: existingRecord?.slug ?? slug,
    title,
    relationship,
    conditions,
    deceased:
      input.deceased === undefined ? existingRecord?.deceased : optionalBoolean(input.deceased, "deceased"),
    note,
    relatedVariantIds,
  });
  const markdown = stringifyFrontmatterDocument({
    attributes,
    body: buildBody({
      title,
      relationship,
      conditions,
      note,
      relatedVariantIds,
    }),
  });
  const auditPath = await upsertMarkdownRegistryDocument({
    vaultRoot: input.vaultRoot,
    operationType: "family_upsert",
    summary: `Upsert family member ${familyMemberId}`,
    relativePath,
    markdown,
    created,
    audit: {
      action: "family_upsert",
      commandName: "core.upsertFamilyMember",
      summary: `${created ? "Created" : "Updated"} family member registry record.`,
      targetIds: [familyMemberId],
    },
  });

  return {
    created,
    auditPath,
    record: recordFromParts(attributes, relativePath, markdown),
  };
}

export async function listFamilyMembers(vaultRoot: string): Promise<FamilyMemberRecord[]> {
  return loadFamilyRecords(vaultRoot);
}

export async function readFamilyMember({
  vaultRoot,
  memberId,
  slug,
}: ReadFamilyMemberInput): Promise<FamilyMemberRecord> {
  const normalizedFamilyMemberId = normalizeId(memberId, "memberId", "fam");
  const normalizedSlug = slug ? normalizeSlug(slug, "slug") : undefined;
  const records = await loadFamilyRecords(vaultRoot);
  return readRegistryRecord({
    records,
    recordId: normalizedFamilyMemberId,
    slug: normalizedSlug,
    getRecordId: (record) => record.familyMemberId,
    readMissingCode: "VAULT_FAMILY_MEMBER_MISSING",
    readMissingMessage: "Family member was not found.",
  });
}
