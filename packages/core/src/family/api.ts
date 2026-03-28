import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  extractHealthEntityRegistryLinks,
  familyRegistryEntityDefinition,
  type FamilyMemberFrontmatter,
  contractIdMaxLength,
  FAMILY_MEMBER_LIMITS,
  ID_PREFIXES,
} from "@murph/contracts";

import { VaultError } from "../errors.ts";
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
  FamilyMemberEntity,
  FamilyMemberLink,
  FamilyMemberLinkType,
  FamilyMemberRecord,
  ReadFamilyMemberInput,
  UpsertFamilyMemberInput,
  UpsertFamilyMemberResult,
} from "./types.ts";

const FAMILY_DIRECTORY = familyRegistryEntityDefinition.registry.directory;
const FAMILY_TITLE_MAX_LENGTH = FAMILY_MEMBER_LIMITS.title;
const FAMILY_RELATIONSHIP_MAX_LENGTH = FAMILY_MEMBER_LIMITS.relationship;
const FAMILY_NOTE_MAX_LENGTH = FAMILY_MEMBER_LIMITS.note;
const FAMILY_CONDITION_MAX_LENGTH = FAMILY_MEMBER_LIMITS.condition;
const FAMILY_VARIANT_ID_MAX_LENGTH = contractIdMaxLength(ID_PREFIXES.variant);

function parseFamilyMemberFrontmatter(attributes: FrontmatterObject): FamilyMemberFrontmatter {
  const schema = familyRegistryEntityDefinition.registry.frontmatterSchema;

  if (!schema) {
    throw new Error("Family registry definition is missing a frontmatter schema.");
  }

  const result = schema.safeParse(attributes);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_FAMILY_MEMBER", "Family registry document has an unexpected shape.");
  }

  return result.data as FamilyMemberFrontmatter;
}

function sortFamilyRecords(records: FamilyMemberRecord[]): void {
  if (familyRegistryEntityDefinition.registry.sortBehavior !== "title") {
    throw new Error('Family registry definition must use "title" sort behavior.');
  }

  records.sort(
    (left, right) => left.title.localeCompare(right.title) || left.familyMemberId.localeCompare(right.familyMemberId),
  );
}

function buildBody(record: {
  title: string;
  relationship: string;
  conditions?: string[];
  note?: string;
  links?: readonly FamilyMemberLink[];
  relatedVariantIds?: string[];
}): string {
  const relations = canonicalizeFamilyRelations(record);

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
    bulletList(relations.relatedVariantIds),
    "",
    maybeSection("Notes", record.note),
    "",
  ].join("\n");
}

function normalizeFamilyLinkType(value: string): FamilyMemberLinkType | null {
  return value === "related_variant" ? value : null;
}

function compareFamilyLinks(left: FamilyMemberLink, right: FamilyMemberLink): number {
  return left.targetId.localeCompare(right.targetId);
}

function buildFamilyLinksFromFields(input: {
  relatedVariantIds?: string[];
}): FamilyMemberLink[] {
  return (input.relatedVariantIds ?? []).map((targetId) => ({
    type: "related_variant",
    targetId,
  }) satisfies FamilyMemberLink);
}

function normalizeFamilyLinks(rawLinks: readonly FamilyMemberLink[]): FamilyMemberLink[] {
  const sortedLinks = [...rawLinks].sort(compareFamilyLinks);
  const links: FamilyMemberLink[] = [];
  const seen = new Set<string>();

  for (const link of sortedLinks) {
    const dedupeKey = `${link.type}:${link.targetId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push(link);
  }

  return links;
}

function parseFamilyLinks(attributes: FrontmatterObject): FamilyMemberLink[] {
  return normalizeFamilyLinks(
    extractHealthEntityRegistryLinks("family", attributes).flatMap((link) => {
      const type = normalizeFamilyLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies FamilyMemberLink] : [];
    }),
  );
}

function familyRelationsFromLinks(
  links: readonly FamilyMemberLink[],
): Pick<FamilyMemberEntity, "relatedVariantIds" | "links"> {
  const relatedVariantIds = links.map((link) => link.targetId);

  return {
    relatedVariantIds: relatedVariantIds.length > 0 ? relatedVariantIds : undefined,
    links: [...links],
  };
}

function canonicalizeFamilyRelations(input: {
  links?: readonly FamilyMemberLink[];
  relatedVariantIds?: string[];
}): Pick<FamilyMemberEntity, "relatedVariantIds" | "links"> {
  const links = normalizeFamilyLinks(
    (input.links?.length ?? 0) > 0
      ? [...(input.links ?? [])]
      : buildFamilyLinksFromFields({
          relatedVariantIds: input.relatedVariantIds,
        }),
  );

  return familyRelationsFromLinks(links);
}

function recordFromParts(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): FamilyMemberRecord {
  const frontmatter = parseFamilyMemberFrontmatter(attributes);
  const relations = canonicalizeFamilyRelations({
    links: parseFamilyLinks(attributes),
  });

  return {
    ...frontmatter,
    conditions: validateSortedStringList(
      frontmatter.conditions,
      "conditions",
      "condition",
      24,
      FAMILY_CONDITION_MAX_LENGTH,
    ),
    deceased: optionalBoolean(frontmatter.deceased, "deceased"),
    note: optionalString(frontmatter.note, "note", FAMILY_NOTE_MAX_LENGTH),
    relatedVariantIds: relations.relatedVariantIds,
    links: relations.links,
    relativePath,
    markdown,
  };
}

const familyRegistryApi = createMarkdownRegistryApi<FamilyMemberRecord>({
  directory: FAMILY_DIRECTORY,
  recordFromParts,
  isExpectedRecord: () => true,
  invalidCode: "VAULT_INVALID_FAMILY_MEMBER",
  invalidMessage: "Family registry document has an unexpected shape.",
  sortRecords: sortFamilyRecords,
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
  links?: readonly FamilyMemberLink[];
  relatedVariantIds?: string[];
}): FamilyMemberFrontmatter {
  const relations = canonicalizeFamilyRelations(input);

  return Object.fromEntries(
    Object.entries({
      schemaVersion: CONTRACT_SCHEMA_VERSION.familyMemberFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.familyMember,
      familyMemberId: input.familyMemberId,
      slug: input.slug,
      title: input.title,
      relationship: input.relationship,
      conditions: input.conditions,
      deceased: input.deceased,
      note: input.note,
      relatedVariantIds: relations.relatedVariantIds,
    }).filter(([, value]) => value !== undefined),
  ) as FamilyMemberFrontmatter;
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
  const relations = canonicalizeFamilyRelations({
    relatedVariantIds,
  });
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
        relatedVariantIds: relations.relatedVariantIds,
        links: relations.links,
      }),
      body: buildBody({
        title,
        relationship,
        conditions,
        note,
        relatedVariantIds: relations.relatedVariantIds,
        links: relations.links,
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
