import type { FamilyMemberFrontmatter } from "@murphai/contracts";

import type { StoredMarkdownRegistryEntity } from "../bank/types.ts";

export type FamilyMemberLinkType = "related_variant";

export interface FamilyMemberLink {
  type: FamilyMemberLinkType;
  targetId: string;
}

export interface FamilyMemberEntity extends FamilyMemberFrontmatter {
  links: FamilyMemberLink[];
}

export type FamilyMemberStoredDocument = StoredMarkdownRegistryEntity<FamilyMemberEntity>;

export interface UpsertFamilyMemberInput {
  vaultRoot: string;
  familyMemberId?: string;
  slug?: string;
  title?: string;
  relationship?: string;
  conditions?: string[];
  deceased?: boolean;
  note?: string;
  relatedVariantIds?: string[];
  links?: FamilyMemberLink[];
}

export interface UpsertFamilyMemberResult {
  created: boolean;
  auditPath: string;
  record: FamilyMemberStoredDocument;
}

export interface ReadFamilyMemberInput {
  vaultRoot: string;
  familyMemberId?: string;
  slug?: string;
}
