import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES } from "@murph/contracts";

export const FAMILY_MEMBER_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.familyMemberFrontmatter;
export const FAMILY_MEMBER_DOC_TYPE = FRONTMATTER_DOC_TYPES.familyMember;

export interface FamilyMemberRecord {
  schemaVersion: typeof FAMILY_MEMBER_SCHEMA_VERSION;
  docType: typeof FAMILY_MEMBER_DOC_TYPE;
  familyMemberId: string;
  slug: string;
  title: string;
  relationship: string;
  conditions?: string[];
  deceased?: boolean;
  note?: string;
  relatedVariantIds?: string[];
  relativePath: string;
  markdown: string;
}

export interface UpsertFamilyMemberInput {
  vaultRoot: string;
  familyMemberId?: string;
  slug?: string;
  title?: string;
  name?: string;
  relationship?: string;
  relation?: string;
  conditions?: string[];
  deceased?: boolean;
  note?: string;
  summary?: string;
  relatedVariantIds?: string[];
}

export interface UpsertFamilyMemberResult {
  created: boolean;
  auditPath: string;
  record: FamilyMemberRecord;
}

export interface ReadFamilyMemberInput {
  vaultRoot: string;
  memberId?: string;
  slug?: string;
}
