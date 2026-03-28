import {
  VARIANT_SIGNIFICANCES as CONTRACT_VARIANT_SIGNIFICANCES,
  VARIANT_ZYGOSITIES as CONTRACT_VARIANT_ZYGOSITIES,
  type GeneticVariantFrontmatter,
} from "@murph/contracts";

import type { MarkdownRegistryDocumentEnvelope } from "../bank/types.ts";

export const VARIANT_ZYGOSITIES = CONTRACT_VARIANT_ZYGOSITIES;
export const VARIANT_SIGNIFICANCES = CONTRACT_VARIANT_SIGNIFICANCES;

export type VariantZygosity = (typeof VARIANT_ZYGOSITIES)[number];
export type VariantSignificance = (typeof VARIANT_SIGNIFICANCES)[number];
export type VariantInheritance = string;

export type GeneticVariantLinkType = "source_family_member";

export interface GeneticVariantLink {
  type: GeneticVariantLinkType;
  targetId: string;
}

export interface GeneticVariantEntity extends GeneticVariantFrontmatter {
  links: GeneticVariantLink[];
}

export type GeneticVariantRecord = GeneticVariantEntity & MarkdownRegistryDocumentEnvelope;

export interface UpsertGeneticVariantInput {
  vaultRoot: string;
  variantId?: string;
  slug?: string;
  gene?: string;
  title?: string;
  zygosity?: VariantZygosity;
  significance?: VariantSignificance;
  inheritance?: VariantInheritance;
  sourceFamilyMemberIds?: string[];
  note?: string;
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
