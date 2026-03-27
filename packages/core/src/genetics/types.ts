import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  VARIANT_SIGNIFICANCES as CONTRACT_VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES as CONTRACT_VARIANT_ZYGOSITIES,
} from "@murph/contracts";

export const GENETIC_VARIANT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter;
export const GENETIC_VARIANT_DOC_TYPE = FRONTMATTER_DOC_TYPES.geneticVariant;
export const VARIANT_ZYGOSITIES = CONTRACT_VARIANT_ZYGOSITIES;
export const VARIANT_SIGNIFICANCES = CONTRACT_VARIANT_SIGNIFICANCES;

export type VariantZygosity = (typeof VARIANT_ZYGOSITIES)[number];
export type VariantSignificance = (typeof VARIANT_SIGNIFICANCES)[number];
export type VariantInheritance = string;

export interface GeneticVariantRecord {
  schemaVersion: typeof GENETIC_VARIANT_SCHEMA_VERSION;
  docType: typeof GENETIC_VARIANT_DOC_TYPE;
  variantId: string;
  slug: string;
  gene: string;
  title: string;
  zygosity?: VariantZygosity;
  significance?: VariantSignificance;
  inheritance?: VariantInheritance;
  sourceFamilyMemberIds?: string[];
  note?: string;
  relativePath: string;
  markdown: string;
}

export interface UpsertGeneticVariantInput {
  vaultRoot: string;
  variantId?: string;
  slug?: string;
  gene: string;
  title?: string;
  label?: string;
  zygosity?: VariantZygosity;
  significance?: VariantSignificance;
  inheritance?: VariantInheritance;
  sourceFamilyMemberIds?: string[];
  familyMemberIds?: string[];
  note?: string;
  summary?: string;
}

export interface UpsertGeneticVariantResult {
  created: boolean;
  auditPath: string;
  record: GeneticVariantRecord;
}

export interface ReadGeneticVariantInput {
  vaultRoot: string;
  variantId?: string;
  slug?: string;
}
