import {
  ASSESSMENT_SOURCES as CONTRACT_ASSESSMENT_SOURCES,
  CONTRACT_SCHEMA_VERSION,
  type AssessmentResponseRecord as ContractAssessmentResponseRecord,
  type AssessmentSource,
} from "@murphai/contracts";

import type { RawArtifact } from "../raw.ts";
import { VAULT_LAYOUT } from "../constants.ts";
import type { UnknownRecord } from "../types.ts";
import type { ProfileSnapshotProfile, ProfileSnapshotSource } from "../profile/types.ts";

export const ASSESSMENT_RESPONSE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.assessmentResponse;
export const ASSESSMENT_LEDGER_DIRECTORY = VAULT_LAYOUT.assessmentLedgerDirectory;
export const ASSESSMENT_SOURCES = CONTRACT_ASSESSMENT_SOURCES;

export type { AssessmentSource };

export type AssessmentResponseRecord = ContractAssessmentResponseRecord;

export interface ImportAssessmentResponseInput {
  vaultRoot: string;
  sourcePath: string;
  assessmentType?: string;
  title?: string;
  recordedAt?: string | number | Date;
  importedAt?: string | number | Date;
  source?: AssessmentSource;
  questionnaireSlug?: string;
  relatedIds?: string[];
}

export interface ImportAssessmentResponseResult {
  assessment: AssessmentResponseRecord;
  raw: RawArtifact;
  ledgerPath: string;
  auditPath: string;
  manifestPath: string;
}

export interface AssessmentProposalSource {
  assessmentId?: string;
  assessmentPointer?: string;
  importedFrom?: string;
  sourcePath?: string;
}

export interface ProfileSnapshotProposal {
  source: ProfileSnapshotSource;
  sourceAssessmentIds?: string[];
  sourceEventIds?: string[];
  profile: ProfileSnapshotProfile;
}

export interface GoalProposal {
  source: AssessmentProposalSource;
  title: string;
  status?: string;
  horizon?: string;
  priority?: string;
  note?: string;
  tags: string[];
  raw: UnknownRecord;
}

export interface ConditionProposal {
  source: AssessmentProposalSource;
  name: string;
  status?: string;
  onsetAt?: string;
  note?: string;
  raw: UnknownRecord;
}

export interface AllergyProposal {
  source: AssessmentProposalSource;
  substance: string;
  reaction?: string;
  severity?: string;
  note?: string;
  raw: UnknownRecord;
}

export interface ProtocolProposal {
  source: AssessmentProposalSource;
  name: string;
  kind?: string;
  status?: string;
  dose?: string;
  schedule?: string;
  note?: string;
  raw: UnknownRecord;
}

export interface HistoryEventProposal {
  source: AssessmentProposalSource;
  kind: string;
  title: string;
  occurredAt?: string;
  note?: string;
  raw: UnknownRecord;
}

export interface FamilyMemberProposal {
  source: AssessmentProposalSource;
  name: string;
  relationship?: string;
  note?: string;
  raw: UnknownRecord;
}

export interface GeneticVariantProposal {
  source: AssessmentProposalSource;
  gene?: string;
  variant: string;
  significance?: string;
  zygosity?: string;
  raw: UnknownRecord;
}

export interface AssessmentResponseProposal {
  assessmentId?: string;
  sourcePath?: string;
  auditPath?: string;
  profileSnapshots: ProfileSnapshotProposal[];
  goals: GoalProposal[];
  conditions: ConditionProposal[];
  allergies: AllergyProposal[];
  protocols: ProtocolProposal[];
  historyEvents: HistoryEventProposal[];
  familyMembers: FamilyMemberProposal[];
  geneticVariants: GeneticVariantProposal[];
}
