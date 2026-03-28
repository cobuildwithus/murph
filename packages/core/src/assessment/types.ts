import type { RawArtifact } from "../raw.ts";
import type { UnknownRecord } from "../types.ts";
import type { ProfileSnapshotSource } from "../profile/types.ts";

export const ASSESSMENT_RESPONSE_SCHEMA_VERSION = "murph.assessment-response.v1";
export const ASSESSMENT_LEDGER_DIRECTORY = "ledger/assessments";
export const ASSESSMENT_SOURCES = ["import", "manual", "derived"] as const;

export type AssessmentSource = (typeof ASSESSMENT_SOURCES)[number];

export interface AssessmentResponseRecord {
  schemaVersion: typeof ASSESSMENT_RESPONSE_SCHEMA_VERSION;
  id: string;
  assessmentType: string;
  recordedAt: string;
  source: AssessmentSource;
  rawPath: string;
  title?: string;
  questionnaireSlug?: string;
  responses: UnknownRecord;
  relatedIds?: string[];
}

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
  profile: UnknownRecord;
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
