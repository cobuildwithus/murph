import type { FamilyMemberFrontmatter } from "@murph/contracts";

import type { MarkdownRegistryDocumentEnvelope } from "../bank/types.ts";

export type FamilyMemberLinkType = "related_variant";

export interface FamilyMemberLink {
  type: FamilyMemberLinkType;
  targetId: string;
}

export interface FamilyMemberEntity extends FamilyMemberFrontmatter {
  links: FamilyMemberLink[];
}

export type FamilyMemberRecord = FamilyMemberEntity & MarkdownRegistryDocumentEnvelope;

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
}

export interface UpsertFamilyMemberResult {
  created: boolean;
  auditPath: string;
  record: FamilyMemberRecord;
}

export interface ReadFamilyMemberInput {
  vaultRoot: string;
  familyMemberId?: string;
  slug?: string;
}
