import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  extractHealthEntityRegistryLinks,
  geneticsRegistryEntityDefinition,
  type GeneticVariantFrontmatter,
  contractIdMaxLength,
  GENETIC_VARIANT_LIMITS,
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
  optionalEnum,
  optionalString,
  requireString,
  validateSortedStringList,
} from "../history/shared.ts";

import type { FrontmatterObject } from "../types.ts";
import type {
  GeneticVariantEntity,
  GeneticVariantLink,
  GeneticVariantLinkType,
  GeneticVariantStoredDocument,
  ReadGeneticVariantInput,
  UpsertGeneticVariantInput,
  UpsertGeneticVariantResult,
} from "./types.ts";
import {
  VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES,
} from "./types.ts";

const GENETICS_DIRECTORY = geneticsRegistryEntityDefinition.registry.directory;
const GENETIC_TITLE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.title;
const GENETIC_GENE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.gene;
const GENETIC_INHERITANCE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.inheritance;
const GENETIC_NOTE_MAX_LENGTH = GENETIC_VARIANT_LIMITS.note;
const GENETIC_FAMILY_ID_MAX_LENGTH = contractIdMaxLength(ID_PREFIXES.family);

function parseGeneticVariantFrontmatter(attributes: FrontmatterObject): GeneticVariantFrontmatter {
  const schema = geneticsRegistryEntityDefinition.registry.frontmatterSchema;

  if (!schema) {
    throw new Error("Genetics registry definition is missing a frontmatter schema.");
  }

  const result = schema.safeParse(attributes);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_GENETIC_VARIANT", "Genetics registry document has an unexpected shape.");
  }

  return result.data as GeneticVariantFrontmatter;
}

function sortGeneticRecords(records: GeneticVariantStoredDocument[]): void {
  if (geneticsRegistryEntityDefinition.registry.sortBehavior !== "gene-title") {
    throw new Error('Genetics registry definition must use "gene-title" sort behavior.');
  }

  records.sort(
    (left, right) =>
      left.entity.gene.localeCompare(right.entity.gene) ||
      left.entity.title.localeCompare(right.entity.title) ||
      left.entity.variantId.localeCompare(right.entity.variantId),
  );
}

function buildBody(record: {
  gene: string;
  title: string;
  links?: readonly GeneticVariantLink[];
  sourceFamilyMemberIds?: string[];
  note?: string;
}): string {
  const relations = canonicalizeGeneticRelations(record);

  return [
    `# ${record.title}`,
    "",
    `Gene: ${record.gene}`,
    "",
    "## Source Family Members",
    "",
    bulletList(relations.sourceFamilyMemberIds),
    "",
    maybeSection("Notes", record.note),
    "",
  ].join("\n");
}

function normalizeGeneticLinkType(value: string): GeneticVariantLinkType | null {
  return value === "source_family_member" ? value : null;
}

function compareGeneticLinks(left: GeneticVariantLink, right: GeneticVariantLink): number {
  return left.targetId.localeCompare(right.targetId);
}

function buildGeneticLinksFromFields(input: {
  sourceFamilyMemberIds?: string[];
}): GeneticVariantLink[] {
  return (input.sourceFamilyMemberIds ?? []).map((targetId) => ({
    type: "source_family_member",
    targetId,
  }) satisfies GeneticVariantLink);
}

function normalizeGeneticLinks(rawLinks: readonly GeneticVariantLink[]): GeneticVariantLink[] {
  const sortedLinks = [...rawLinks].sort(compareGeneticLinks);
  const links: GeneticVariantLink[] = [];
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

function parseGeneticLinks(attributes: FrontmatterObject): GeneticVariantLink[] {
  return normalizeGeneticLinks(
    extractHealthEntityRegistryLinks("genetics", attributes).flatMap((link) => {
      const type = normalizeGeneticLinkType(link.type);
      return type ? [{ type, targetId: link.targetId } satisfies GeneticVariantLink] : [];
    }),
  );
}

function geneticRelationsFromLinks(
  links: readonly GeneticVariantLink[],
): Pick<GeneticVariantEntity, "sourceFamilyMemberIds" | "links"> {
  const sourceFamilyMemberIds = links.map((link) => link.targetId);

  return {
    sourceFamilyMemberIds: sourceFamilyMemberIds.length > 0 ? sourceFamilyMemberIds : undefined,
    links: [...links],
  };
}

function canonicalizeGeneticRelations(input: {
  links?: readonly GeneticVariantLink[];
  sourceFamilyMemberIds?: string[];
}): Pick<GeneticVariantEntity, "sourceFamilyMemberIds" | "links"> {
  const links = normalizeGeneticLinks(
    (input.links?.length ?? 0) > 0
      ? [...(input.links ?? [])]
      : buildGeneticLinksFromFields({
          sourceFamilyMemberIds: input.sourceFamilyMemberIds,
        }),
  );

  return geneticRelationsFromLinks(links);
}

function recordFromParts(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): GeneticVariantStoredDocument {
  const frontmatter = parseGeneticVariantFrontmatter(attributes);
  const relations = canonicalizeGeneticRelations({
    links: parseGeneticLinks(attributes),
  });

  const entity = {
    ...frontmatter,
    zygosity: optionalEnum(frontmatter.zygosity, VARIANT_ZYGOSITIES, "zygosity"),
    significance: optionalEnum(frontmatter.significance, VARIANT_SIGNIFICANCES, "significance"),
    inheritance: optionalString(frontmatter.inheritance, "inheritance", GENETIC_INHERITANCE_MAX_LENGTH),
    sourceFamilyMemberIds: relations.sourceFamilyMemberIds,
    note: optionalString(frontmatter.note, "note", GENETIC_NOTE_MAX_LENGTH),
    links: relations.links,
  } satisfies GeneticVariantEntity;

  return {
    entity,
    document: {
      relativePath,
      markdown,
    },
  };
}

const geneticsRegistryApi = createMarkdownRegistryApi<GeneticVariantStoredDocument>({
  directory: GENETICS_DIRECTORY,
  recordFromParts,
  isExpectedRecord: () => true,
  invalidCode: "VAULT_INVALID_GENETIC_VARIANT",
  invalidMessage: "Genetics registry document has an unexpected shape.",
  sortRecords: sortGeneticRecords,
  getRecordId: (record) => record.entity.variantId,
  getRecordSlug: (record) => record.entity.slug,
  getRecordRelativePath: (record) => record.document.relativePath,
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
  links?: readonly GeneticVariantLink[];
  sourceFamilyMemberIds?: string[];
  note?: string;
}): GeneticVariantFrontmatter {
  const relations = canonicalizeGeneticRelations(input);

  return Object.fromEntries(
    Object.entries({
      schemaVersion: CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.geneticVariant,
      variantId: input.variantId,
      slug: input.slug,
      title: input.title,
      gene: input.gene,
      zygosity: input.zygosity,
      significance: input.significance,
      inheritance: input.inheritance,
      sourceFamilyMemberIds: relations.sourceFamilyMemberIds,
      note: input.note,
    }).filter(([, value]) => value !== undefined),
  ) as GeneticVariantFrontmatter;
}

export async function upsertGeneticVariant(
  input: UpsertGeneticVariantInput,
): Promise<UpsertGeneticVariantResult> {
  const normalizedVariantId = normalizeId(input.variantId, "variantId", "var");
  const selectorSlug =
    (input.slug ? normalizeSlug(input.slug, "slug") : undefined) ??
    (input.gene && input.title
      ? normalizeSlug(undefined, "slug", `${input.gene}-${input.title}`)
      : undefined);
  const existingRecord = await geneticsRegistryApi.resolveExistingRecord({
    vaultRoot: input.vaultRoot,
    recordId: normalizedVariantId,
    slug: selectorSlug,
  });
  const existingEntity = existingRecord?.entity;
  const title = requireString(input.title ?? existingEntity?.title, "title", GENETIC_TITLE_MAX_LENGTH);
  const gene = requireString(input.gene ?? existingEntity?.gene, "gene", GENETIC_GENE_MAX_LENGTH);
  const sourceFamilyMemberIds =
    input.sourceFamilyMemberIds === undefined
      ? existingEntity?.sourceFamilyMemberIds
      : validateSortedStringList(
          input.sourceFamilyMemberIds,
          "sourceFamilyMemberIds",
          "familyMemberId",
          24,
          GENETIC_FAMILY_ID_MAX_LENGTH,
        );
  const relations = canonicalizeGeneticRelations({
    sourceFamilyMemberIds,
  });
  const note =
    input.note === undefined
      ? existingEntity?.note
      : optionalString(input.note, "note", GENETIC_NOTE_MAX_LENGTH);
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
            ? existingEntity?.zygosity
            : optionalEnum(input.zygosity, VARIANT_ZYGOSITIES, "zygosity"),
        significance:
          input.significance === undefined
            ? existingEntity?.significance
            : optionalEnum(input.significance, VARIANT_SIGNIFICANCES, "significance"),
        inheritance:
          input.inheritance === undefined
            ? existingEntity?.inheritance
            : optionalString(input.inheritance, "inheritance", GENETIC_INHERITANCE_MAX_LENGTH),
        sourceFamilyMemberIds: relations.sourceFamilyMemberIds,
        links: relations.links,
        note,
      }),
      body: buildBody({
        gene,
        title,
        sourceFamilyMemberIds: relations.sourceFamilyMemberIds,
        links: relations.links,
        note,
      }),
    }),
  });
}

export async function listGeneticVariants(vaultRoot: string): Promise<GeneticVariantStoredDocument[]> {
  return geneticsRegistryApi.listRecords(vaultRoot);
}

export async function readGeneticVariant({
  vaultRoot,
  variantId,
  slug,
}: ReadGeneticVariantInput): Promise<GeneticVariantStoredDocument> {
  const normalizedVariantId = normalizeId(variantId, "variantId", "var");
  const normalizedSlug = slug ? normalizeSlug(slug, "slug") : undefined;
  return geneticsRegistryApi.readRecord({
    vaultRoot,
    recordId: normalizedVariantId,
    slug: normalizedSlug,
  });
}
