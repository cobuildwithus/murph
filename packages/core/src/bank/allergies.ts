import {
  allergyRegistryEntityDefinition,
  extractHealthEntityRegistryLinks,
  type AllergyFrontmatter,
} from "@murph/contracts";

import { VaultError } from "../errors.ts";
import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  ALLERGIES_DIRECTORY,
  ALLERGY_CRITICALITIES,
  ALLERGY_DOC_TYPE,
  ALLERGY_SCHEMA_VERSION,
  ALLERGY_STATUSES,
} from "./types.ts";
import {
  buildDocumentFromAttributes,
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
} from "./shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  AllergyEntity,
  AllergyLink,
  AllergyLinkType,
  AllergyRecord,
  ReadAllergyInput,
  UpsertAllergyInput,
  UpsertAllergyResult,
} from "./types.ts";

function buildBody(record: AllergyRecord): string {
  const relations = canonicalizeAllergyRelations(record);

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
      listSection("Related Conditions", relations.relatedConditionIds),
      section("Note", record.note ?? "- none"),
    ],
  );
}

function parseAllergyFrontmatter(
  attributes: FrontmatterObject,
): AllergyFrontmatter {
  const schema = allergyRegistryEntityDefinition.registry.frontmatterSchema;

  if (!schema) {
    throw new Error("Allergy registry definition is missing a frontmatter schema.");
  }

  const result = schema.safeParse(attributes);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_ALLERGY", "Allergy registry document has an unexpected shape.");
  }

  return result.data as AllergyFrontmatter;
}

function normalizeAllergyLinkType(value: string): AllergyLinkType | null {
  return value === "related_condition" ? value : null;
}

function compareAllergyLinks(left: AllergyLink, right: AllergyLink): number {
  return left.targetId.localeCompare(right.targetId);
}

function buildAllergyLinksFromFields(input: {
  relatedConditionIds?: string[];
}): AllergyLink[] {
  return (input.relatedConditionIds ?? []).map((targetId) => ({
    type: "related_condition",
    targetId,
  }) satisfies AllergyLink);
}

function normalizeAllergyLinks(rawLinks: readonly AllergyLink[]): AllergyLink[] {
  const sortedLinks = [...rawLinks].sort(compareAllergyLinks);
  const links: AllergyLink[] = [];
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

function parseAllergyLinks(attributes: FrontmatterObject): AllergyLink[] {
  return normalizeAllergyLinks(
    extractHealthEntityRegistryLinks("allergy", attributes).flatMap((link) => {
      const type = normalizeAllergyLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies AllergyLink] : [];
    }),
  );
}

function allergyRelationsFromLinks(
  links: readonly AllergyLink[],
): Pick<AllergyEntity, "relatedConditionIds" | "links"> {
  const relatedConditionIds = links.map((link) => link.targetId);

  return {
    relatedConditionIds: relatedConditionIds.length > 0 ? relatedConditionIds : undefined,
    links: [...links],
  };
}

function canonicalizeAllergyRelations(input: {
  links?: readonly AllergyLink[];
  relatedConditionIds?: string[];
}): Pick<AllergyEntity, "relatedConditionIds" | "links"> {
  const links = normalizeAllergyLinks(
    (input.links?.length ?? 0) > 0
      ? [...(input.links ?? [])]
      : buildAllergyLinksFromFields({
          relatedConditionIds: input.relatedConditionIds,
        }),
  );

  return allergyRelationsFromLinks(links);
}

function parseAllergyRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): AllergyRecord {
  const parsed = parseAllergyFrontmatter(attributes);
  requireMatchingDocType(
    parsed as unknown as FrontmatterObject,
    ALLERGY_SCHEMA_VERSION,
    ALLERGY_DOC_TYPE,
    "VAULT_INVALID_ALLERGY",
    "Allergy registry document has an unexpected shape.",
  );
  const relations = canonicalizeAllergyRelations({
    links: parseAllergyLinks(attributes),
  });

  return stripUndefined({
    schemaVersion: ALLERGY_SCHEMA_VERSION,
    docType: ALLERGY_DOC_TYPE,
    allergyId: requireString(parsed.allergyId, "allergyId", 64),
    slug: requireString(parsed.slug, "slug", 160),
    title: requireString(parsed.title, "title", 160),
    substance: requireString(parsed.substance, "substance", 160),
    status: optionalEnum(parsed.status, ALLERGY_STATUSES, "status") ?? "active",
    criticality: optionalEnum(parsed.criticality, ALLERGY_CRITICALITIES, "criticality"),
    reaction: optionalString(parsed.reaction, "reaction", 160),
    recordedOn: optionalDateOnly(parsed.recordedOn, "recordedOn"),
    relatedConditionIds: relations.relatedConditionIds,
    note: optionalString(parsed.note, "note", 4000),
    links: relations.links,
    relativePath,
    markdown,
  });
}

function buildAttributes(record: AllergyEntity | AllergyRecord): FrontmatterObject {
  const relations = canonicalizeAllergyRelations(record);

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
    relatedConditionIds: relations.relatedConditionIds,
    note: record.note,
  }) as FrontmatterObject;
}

const allergyRegistryApi = createMarkdownRegistryApi<AllergyRecord>({
  directory: ALLERGIES_DIRECTORY,
  recordFromParts: parseAllergyRecord,
  isExpectedRecord: (record) =>
    record.docType === ALLERGY_DOC_TYPE && record.schemaVersion === ALLERGY_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_ALLERGY",
  invalidMessage: "Allergy registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) => left.title.localeCompare(right.title) || left.allergyId.localeCompare(right.allergyId),
    ),
  getRecordId: (record) => record.allergyId,
  conflictCode: "VAULT_ALLERGY_CONFLICT",
  conflictMessage: "Allergy id and slug resolve to different records.",
  readMissingCode: "VAULT_ALLERGY_MISSING",
  readMissingMessage: "Allergy was not found.",
  createRecordId: () => generateRecordId("alg"),
  operationType: "allergy_upsert",
  summary: (recordId) => `Upsert allergy ${recordId}`,
  audit: {
    action: "allergy_upsert",
    commandName: "core.upsertAllergy",
    summary: (_created, recordId) => `Upserted allergy ${recordId}.`,
  },
});

export async function upsertAllergy(input: UpsertAllergyInput): Promise<UpsertAllergyResult> {
  const normalizedAllergyId = normalizeId(input.allergyId, "allergyId", "alg");
  const requestedSlug = normalizeUpsertSelectorSlug(input.slug, input.title);
  const existingRecord = await allergyRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedAllergyId,
    slug: requestedSlug,
  });
  const title = requireString(input.title ?? existingRecord?.title, "title", 160);
  return allergyRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedAllergyId,
    requestedSlug,
    defaultSlug: normalizeUpsertSelectorSlug(undefined, title) ?? "",
    buildDocument: (target) => {
      const relations = canonicalizeAllergyRelations({
        relatedConditionIds: resolveOptionalUpsertValue(
          input.relatedConditionIds,
          existingRecord?.relatedConditionIds,
          (value) => normalizeRecordIdList(value, "relatedConditionIds", "cond"),
        ),
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
          relatedConditionIds: relations.relatedConditionIds,
          note: resolveOptionalUpsertValue(input.note, existingRecord?.note, (value) =>
            optionalString(value, "note", 4000),
          ),
          links: relations.links,
        }) as AllergyEntity,
      );

      return buildDocumentFromAttributes<FrontmatterObject, AllergyRecord>({
        attributes,
        relativePath: target.relativePath,
        markdown: existingRecord?.markdown,
        buildBody,
      });
    },
  });
}

export async function listAllergies(vaultRoot: string): Promise<AllergyRecord[]> {
  return allergyRegistryApi.listRecords(vaultRoot);
}

export async function readAllergy({ vaultRoot, allergyId, slug }: ReadAllergyInput): Promise<AllergyRecord> {
  const normalizedAllergyId = normalizeId(allergyId, "allergyId", "alg");
  const normalizedSlug = normalizeSelectorSlug(slug);
  return allergyRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedAllergyId,
    slug: normalizedSlug,
  });
}
