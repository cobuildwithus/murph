import {
  contractIdMaxLength,
  GENETIC_VARIANT_LIMITS,
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
  optionalEnum,
  optionalString,
  requireString,
} from "../history/shared.js";

import type { FrontmatterObject } from "../types.js";
import type {
  GeneticVariantRecord,
  ReadGeneticVariantInput,
  UpsertGeneticVariantInput,
  UpsertGeneticVariantResult,
} from "./types.js";
import {
  GENETIC_VARIANT_DOC_TYPE,
  GENETIC_VARIANT_SCHEMA_VERSION,
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "./types.js";

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
    sourceFamilyMemberIds: normalizeStringList(
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

async function loadGeneticVariants(vaultRoot: string): Promise<GeneticVariantRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: GENETICS_DIRECTORY,
    recordFromParts,
    isExpectedRecord: (record) =>
      record.docType === GENETIC_VARIANT_DOC_TYPE && record.schemaVersion === GENETIC_VARIANT_SCHEMA_VERSION,
    invalidCode: "VAULT_INVALID_GENETIC_VARIANT",
    invalidMessage: "Genetics registry document has an unexpected shape.",
  });

  records.sort(
    (left, right) => left.gene.localeCompare(right.gene) || left.title.localeCompare(right.title) || left.variantId.localeCompare(right.variantId),
  );
  return records;
}

function selectExistingRecord(
  records: GeneticVariantRecord[],
  variantId: string | undefined,
  slug: string | undefined,
): GeneticVariantRecord | null {
  return selectExistingRegistryRecord({
    records,
    recordId: variantId,
    slug,
    getRecordId: (record) => record.variantId,
    conflictCode: "VAULT_GENETIC_VARIANT_CONFLICT",
    conflictMessage: "variantId and slug resolve to different variants.",
  });
}

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
  const existingRecords = await loadGeneticVariants(input.vaultRoot);
  const selectorSlug =
    (input.slug ? normalizeSlug(input.slug, "slug") : undefined) ??
    (input.gene && (input.title ?? input.label)
      ? normalizeSlug(undefined, "slug", `${input.gene}-${input.title ?? input.label}`)
      : undefined);
  const existingRecord = selectExistingRecord(existingRecords, normalizedVariantId, selectorSlug);
  const title = requireString(input.title ?? input.label ?? existingRecord?.title, "title", GENETIC_TITLE_MAX_LENGTH);
  const gene = requireString(input.gene ?? existingRecord?.gene, "gene", GENETIC_GENE_MAX_LENGTH);
  const slug = existingRecord?.slug ?? selectorSlug ?? normalizeSlug(undefined, "slug", `${gene}-${title}`);
  const variantId = existingRecord?.variantId ?? normalizedVariantId ?? generateRecordId("var");
  const relativePath = existingRecord?.relativePath ?? `${GENETICS_DIRECTORY}/${slug}.md`;
  const sourceIdsInput = input.sourceFamilyMemberIds ?? input.familyMemberIds;
  const sourceFamilyMemberIds =
    sourceIdsInput === undefined
      ? existingRecord?.sourceFamilyMemberIds
      : normalizeStringList(
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
  const created = !existingRecord;
  const attributes = buildAttributes({
    variantId,
    slug: existingRecord?.slug ?? slug,
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
  });
  const markdown = stringifyFrontmatterDocument({
    attributes,
    body: buildBody({
      gene,
      title,
      sourceFamilyMemberIds,
      note,
    }),
  });
  const auditPath = await upsertMarkdownRegistryDocument({
    vaultRoot: input.vaultRoot,
    operationType: "genetics_upsert",
    summary: `Upsert genetic variant ${variantId}`,
    relativePath,
    markdown,
    created,
    audit: {
      action: "genetics_upsert",
      commandName: "core.upsertGeneticVariant",
      summary: `${created ? "Created" : "Updated"} genetic variant registry record.`,
      targetIds: [variantId],
    },
  });

  return {
    created,
    auditPath,
    record: recordFromParts(attributes, relativePath, markdown),
  };
}

export async function listGeneticVariants(vaultRoot: string): Promise<GeneticVariantRecord[]> {
  return loadGeneticVariants(vaultRoot);
}

export async function readGeneticVariant({
  vaultRoot,
  variantId,
  slug,
}: ReadGeneticVariantInput): Promise<GeneticVariantRecord> {
  const normalizedVariantId = normalizeId(variantId, "variantId", "var");
  const normalizedSlug = slug ? normalizeSlug(slug, "slug") : undefined;
  const records = await loadGeneticVariants(vaultRoot);
  return readRegistryRecord({
    records,
    recordId: normalizedVariantId,
    slug: normalizedSlug,
    getRecordId: (record) => record.variantId,
    readMissingCode: "VAULT_GENETIC_VARIANT_MISSING",
    readMissingMessage: "Genetic variant was not found.",
  });
}
