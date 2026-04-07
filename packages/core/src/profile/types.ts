import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  PROFILE_SNAPSHOT_SOURCES as CONTRACT_PROFILE_SNAPSHOT_SOURCES,
  type ProfileSnapshotProfile,
  type ProfileSnapshotRecord as ContractProfileSnapshotRecord,
  type ProfileSnapshotSource,
} from "@murphai/contracts";

export const PROFILE_SNAPSHOT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.profileSnapshot;
export const PROFILE_SNAPSHOT_LEDGER_DIRECTORY = "ledger/profile-snapshots";
export const PROFILE_CURRENT_DOCUMENT_PATH = "bank/profile/current.md";
export const PROFILE_CURRENT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter;
export const PROFILE_CURRENT_DOC_TYPE = FRONTMATTER_DOC_TYPES.profileCurrent;

export const PROFILE_SNAPSHOT_SOURCES = CONTRACT_PROFILE_SNAPSHOT_SOURCES;
export type { ProfileSnapshotProfile, ProfileSnapshotSource };

export type ProfileSnapshotRecord = ContractProfileSnapshotRecord;

export interface AppendProfileSnapshotInput {
  vaultRoot: string;
  recordedAt?: string | number | Date;
  source?: ProfileSnapshotSource;
  sourceAssessmentIds?: string[];
  sourceEventIds?: string[];
  profile: ProfileSnapshotProfile;
}

export interface CurrentProfileState {
  relativePath: typeof PROFILE_CURRENT_DOCUMENT_PATH;
  exists: boolean;
  markdown: string | null;
  snapshot: ProfileSnapshotRecord | null;
  profile: ProfileSnapshotProfile | null;
}

export interface RebuiltCurrentProfile extends CurrentProfileState {
  auditPath: string;
  updated: boolean;
}
