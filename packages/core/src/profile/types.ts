import type { ProfileSnapshotProfile as ContractProfileSnapshotProfile } from "@murph/contracts";

export const PROFILE_SNAPSHOT_SCHEMA_VERSION = "murph.profile-snapshot.v1";
export const PROFILE_SNAPSHOT_LEDGER_DIRECTORY = "ledger/profile-snapshots";
export const PROFILE_CURRENT_DOCUMENT_PATH = "bank/profile/current.md";
export const PROFILE_CURRENT_SCHEMA_VERSION = "murph.frontmatter.profile-current.v1";
export const PROFILE_CURRENT_DOC_TYPE = "profile_current";

export const PROFILE_SNAPSHOT_SOURCES = ["assessment_projection", "manual", "derived"] as const;
export type ProfileSnapshotSource = (typeof PROFILE_SNAPSHOT_SOURCES)[number];
export type ProfileSnapshotProfile = ContractProfileSnapshotProfile;

export interface ProfileSnapshotRecord {
  schemaVersion: typeof PROFILE_SNAPSHOT_SCHEMA_VERSION;
  id: string;
  recordedAt: string;
  source: ProfileSnapshotSource;
  sourceAssessmentIds?: string[];
  sourceEventIds?: string[];
  profile: ProfileSnapshotProfile;
}

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
