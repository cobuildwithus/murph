import {
  contractIdMaxLength,
  GENETIC_VARIANT_LIMITS,
  ID_PREFIXES,
} from "@murph/contracts";

import { generateRecordId } from "../ids.ts";
import { createMarkdownRegistryApi } from "../registry/api.ts";

import {
  bulletList,
  maybeSection,
  normalizeId,
  normalizeSlug,
  optionalEnum,
  optionalString,
  requireString,
  validateSortedStringList,
} from "../history/shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  GeneticVariantRecord,
  ReadGeneticVariantInput,
  UpsertGeneticVariantInput,
  UpsertGeneticVariantResult,
} from "./types.ts";
import {
  GENETIC_VARIANT_DOC_TYPE,
  GENETIC_VARIANT_SCHEMA_VERSION,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "./types.ts";

const GENETICS_DIRECTORY = "bank/genetics";
const GENETIC_TITLE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.title;
const GENETIC_GENE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.gene;
const GENETIC_INHERITANCE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.inheritance;
const GENETIC_NOTE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.note;
const GENETIC_FAMILY_ID_MAX_LENGTH = contractIdMaxLength(ID_PREFIXES.family);

function buildBody(record: {
  gene: string;
  title: string;
  sourceFamilyMemberIds?: string[];
  note?: string;
}): string {
  return [
    `# ${record.title}`,
    "",
    `Gene: ${record.gene}`,
    "",
    "## Source Family Members",
    "",
    bulletList(record.sourceFamilyMemberIds),
    "",
    maybeSection("Notes", record.note),
    "",
  ].join("\n");
}

function recordFromParts(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): GeneticVariantRecord {
  return {
    schemaVersion: requireString(attributes.schemaVersion, "schemaVersion", 40) as typeof GENETIC_VARIANT_SCHEMA_VERSION,
    docType: requireString(attributes.docType, "docType", 40) as typeof GENETIC_VARIANT_DOC_TYPE,
    variantId: requireString(attributes.variantId, "variantId", 64),
    slug: requireString(attributes.slug, "slug", 160),
    title: requireString(attributes.title, "title", GENETIC_TITLE_MAX_LENGTH),
    gene: requireString(attributes.gene, "gene", GENETIC_GENE_MAX_LENGTH),
    zygosity: optionalEnum(attributes.zygosity, VARIANT_ZYGOSITIES, "zygosity"),
    significance: optionalEnum(attributes.significance, VARIANT_SIGNIFICANCES, "significance"),
    inheritance: optionalString(attributes.inheritance, "inheritance", GENETIC_INHERITANCE_MAX_LENGTH),
    sourceFamilyMemberIds: validateSortedStringList(
      attributes.sourceFamilyMemberIds,
      "sourceFamilyMemberIds",
      "familyMemberId",
      24,
      GENETIC_FAMILY_ID_MAX_LENGTH,
    ),
    note: optionalString(attributes.note, "note", GENETIC_NOTE_MAX_LENGTH),
    relativePath,
    markdown,
  };
}

const geneticsRegistryApi = createMarkdownRegistryApi<GeneticVariantRecord>({
  directory: GENETICS_DIRECTORY,
  recordFromParts,
  isExpectedRecord: (record) =>
    record.docType === GENETIC_VARIANT_DOC_TYPE && record.schemaVersion === GENETIC_VARIANT_SCHEMA_VERSION,
  invalidCode: "VAULT_INVALID_GENETIC_VARIANT",
  invalidMessage: "Genetics registry document has an unexpected shape.",
  sortRecords: (records) =>
    records.sort(
      (left, right) =>
        left.gene.localeCompare(right.gene) ||
        left.title.localeCompare(right.title) ||
        left.variantId.localeCompare(right.variantId),
    ),
  getRecordId: (record) => record.variantId,
  conflictCode: "VAULT_GENETIC_VARIANT_CONFLICT",
  conflictMessage: "variantId and slug resolve to different variants.",
  readMissingCode: "VAULT_GENETIC_VARIANT_MISSING",
  readMissingMessage: "Genetic variant was not found.",
  createRecordId: () => generateRecordId("var"),
  operationType: "genetics_upsert",
  summary: (recordId) => `Upsert genetic variant ${recordId}`,
  audit: {
    action: "genetics_upsert",
    commandName: "core.upsertGeneticVariant",
    summary: (created) => `${created ? "Created" : "Updated"} genetic variant registry record.`,
  },
});

function buildAttributes(input: {
  variantId: string;
  slug: string;
  title: string;
  gene: string;
  zygosity?: string;
  significance?: string;
  inheritance?: string;
  sourceFamilyMemberIds?: string[];
  note?: string;
}): FrontmatterObject {
  return Object.fromEntries(
    Object.entries({
      schemaVersion: GENETIC_VARIANT_SCHEMA_VERSION,
      docType: GENETIC_VARIANT_DOC_TYPE,
      variantId: input.variantId,
      slug: input.slug,
      title: input.title,
      gene: input.gene,
      zygosity: input.zygosity,
      significance: input.significance,
      inheritance: input.inheritance,
      sourceFamilyMemberIds: input.sourceFamilyMemberIds,
      note: input.note,
    }).filter(([, value]) => value !== undefined),
  ) as FrontmatterObject;
}

export async function upsertGeneticVariant(
  input: UpsertGeneticVariantInput,
): Promise<UpsertGeneticVariantResult> {
  const normalizedVariantId = normalizeId(input.variantId, "variantId", "var");
  const selectorSlug =
    (input.slug ? normalizeSlug(input.slug, "slug") : undefined) ??
    (input.gene && (input.title ?? input.label)
      ? normalizeSlug(undefined, "slug", `${input.gene}-${input.title ?? input.label}`)
      : undefined);
  const existingRecord = await geneticsRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedVariantId,
    slug: selectorSlug,
  });
  const title = requireString(input.title ?? input.label ?? existingRecord?.title, "title", GENETIC_TITLE_MAX_LENGTH);
  const gene = requireString(input.gene ?? existingRecord?.gene, "gene", GENETIC_GENE_MAX_LENGTH);
  const sourceIdsInput = input.sourceFamilyMemberIds ?? input.familyMemberIds;
  const sourceFamilyMemberIds =
    sourceIdsInput === undefined
      ? existingRecord?.sourceFamilyMemberIds
      : validateSortedStringList(
          sourceIdsInput,
          "sourceFamilyMemberIds",
          "familyMemberId",
          24,
          GENETIC_FAMILY_ID_MAX_LENGTH,
        );
  const note =
    input.note === undefined && input.summary === undefined
      ? existingRecord?.note
      : optionalString(input.note ?? input.summary, "note", GENETIC_NOTE_MAX_LENGTH);
  return geneticsRegistryApi.upsertRecord({
    vaultRoot: input.vaultRoot,
    existingRecord,
    recordId: normalizedVariantId,
    requestedSlug: selectorSlug,
    defaultSlug: normalizeSlug(undefined, "slug", `${gene}-${title}`),
    buildDocument: (target) => ({
      attributes: buildAttributes({
        variantId: target.recordId,
        slug: target.slug,
        title,
        gene,
        zygosity:
          input.zygosity === undefined
            ? existingRecord?.zygosity
            : optionalEnum(input.zygosity, VARIANT_ZYGOSITIES, "zygosity"),
        significance:
          input.significance === undefined
            ? existingRecord?.significance
            : optionalEnum(input.significance, VARIANT_SIGNIFICANCES, "significance"),
        inheritance:
          input.inheritance === undefined
            ? existingRecord?.inheritance
            : optionalString(input.inheritance, "inheritance", GENETIC_INHERITANCE_MAX_LENGTH),
        sourceFamilyMemberIds,
        note,
      }),
      body: buildBody({
        gene,
        title,
        sourceFamilyMemberIds,
        note,
      }),
    }),
  });
}

export async function listGeneticVariants(vaultRoot: string): Promise<GeneticVariantRecord[]> {
  return geneticsRegistryApi.listRecords(vaultRoot);
}

export async function readGeneticVariant({
  vaultRoot,
  variantId,
  slug,
}: ReadGeneticVariantInput): Promise<GeneticVariantRecord> {
  const normalizedVariantId = normalizeId(variantId, "variantId", "var");
  const normalizedSlug = slug ? normalizeSlug(slug, "slug") : undefined;
  return geneticsRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedVariantId,
    slug: normalizedSlug,
  });
}
