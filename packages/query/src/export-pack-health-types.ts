import type { FrontmatterObject } from "./health/shared.ts";

export interface ExportPackFilters {
  from: string | null;
  to: string | null;
  experimentSlug: string | null;
}

export interface ExportPackAssessmentRecord {
  id: string;
  title: string | null;
  assessmentType: string | null;
  recordedAt: string | null;
  importedAt: string | null;
  source: string | null;
  sourcePath: string | null;
  questionnaireSlug: string | null;
  relatedIds: string[];
  responses: Record<string, unknown>;
  relativePath: string;
}

export interface ExportPackProfileSnapshotRecord {
  id: string;
  recordedAt: string | null;
  source: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface ExportPackHistoryRecord {
  id: string;
  kind: string;
  occurredAt: string;
  recordedAt: string | null;
  source: string | null;
  title: string;
  status: string | null;
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface ExportPackBankPage {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

export interface ExportPackCurrentProfile {
  snapshotId: string | null;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  relativePath: string;
  markdown: string | null;
  body: string | null;
}

export interface ExportPackHealthContext {
  assessments: ExportPackAssessmentRecord[];
  profileSnapshots: ExportPackProfileSnapshotRecord[];
  historyEvents: ExportPackHistoryRecord[];
  currentProfile: ExportPackCurrentProfile | null;
  goals: ExportPackBankPage[];
  conditions: ExportPackBankPage[];
  allergies: ExportPackBankPage[];
  protocols: ExportPackBankPage[];
  familyMembers: ExportPackBankPage[];
  geneticVariants: ExportPackBankPage[];
}
