import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_SPECIMEN_TYPES,
} from "@healthybob/contracts";

import type {
  BloodTestReferenceRange,
  BloodTestResultRecord,
} from "@healthybob/contracts";
import type { DateInput } from "../types.ts";

export type {
  BloodTestReferenceRange,
  BloodTestResultRecord,
} from "@healthybob/contracts";

export const HEALTH_HISTORY_KINDS = [
  "encounter",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
] as const;

export const HEALTH_HISTORY_SOURCES = [
  "manual",
  "import",
  "device",
  "derived",
] as const;

export const HISTORY_EVENT_ORDER = ["asc", "desc"] as const;
export const PROCEDURE_STATUSES = ["planned", "completed", "cancelled"] as const;
export const TEST_STATUSES = ["pending", "normal", "abnormal", "mixed", "unknown"] as const;
export const ADVERSE_EFFECT_SEVERITIES = ["mild", "moderate", "severe"] as const;

export type HistoryEventKind = (typeof HEALTH_HISTORY_KINDS)[number];
export type HistoryEventSource = (typeof HEALTH_HISTORY_SOURCES)[number];
export type HistoryEventOrder = (typeof HISTORY_EVENT_ORDER)[number];
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];
export type TestResultStatus = (typeof TEST_STATUSES)[number];
export type AdverseEffectSeverity = (typeof ADVERSE_EFFECT_SEVERITIES)[number];
export type BloodTestCategory = typeof BLOOD_TEST_CATEGORY;
export type BloodTestFastingStatus = (typeof BLOOD_TEST_FASTING_STATUSES)[number];
export type BloodTestSpecimenType = (typeof BLOOD_TEST_SPECIMEN_TYPES)[number];

export interface HistoryEventBase {
  schemaVersion: "hb.event.v1";
  id: string;
  kind: HistoryEventKind;
  occurredAt: string;
  recordedAt: string;
  dayKey: string;
  timeZone?: string;
  source: HistoryEventSource;
  title: string;
  note?: string;
  tags?: string[];
  relatedIds?: string[];
  rawRefs?: string[];
}

export interface EncounterHistoryEventRecord extends HistoryEventBase {
  kind: "encounter";
  encounterType: string;
  location?: string;
  providerId?: string;
}

export interface ProcedureHistoryEventRecord extends HistoryEventBase {
  kind: "procedure";
  procedure: string;
  status: ProcedureStatus;
}

export interface TestHistoryEventRecord extends HistoryEventBase {
  kind: "test";
  testName: string;
  resultStatus: TestResultStatus;
  summary?: string;
  testCategory?: string;
  specimenType?: string;
  labName?: string;
  labPanelId?: string;
  collectedAt?: string;
  reportedAt?: string;
  fastingStatus?: BloodTestFastingStatus;
  results?: BloodTestResultRecord[];
}

export type BloodTestHistoryEventRecord = TestHistoryEventRecord & {
  testCategory: BloodTestCategory;
  results: BloodTestResultRecord[];
};

export interface AdverseEffectHistoryEventRecord extends HistoryEventBase {
  kind: "adverse_effect";
  substance: string;
  effect: string;
  severity: AdverseEffectSeverity;
}

export interface ExposureHistoryEventRecord extends HistoryEventBase {
  kind: "exposure";
  exposureType: string;
  substance: string;
  duration?: string;
}

export type HistoryEventRecord =
  | EncounterHistoryEventRecord
  | ProcedureHistoryEventRecord
  | TestHistoryEventRecord
  | AdverseEffectHistoryEventRecord
  | ExposureHistoryEventRecord;

interface HistoryEventDraftBase {
  vaultRoot: string;
  eventId?: string;
  occurredAt: DateInput;
  recordedAt?: DateInput;
  timeZone?: string;
  source?: HistoryEventSource;
  title: string;
  note?: string;
  tags?: string[];
  relatedIds?: string[];
  rawRefs?: string[];
}

export interface AppendEncounterHistoryEventInput extends HistoryEventDraftBase {
  kind: "encounter";
  encounterType: string;
  location?: string;
  providerId?: string;
  clinician?: string;
  facility?: string;
}

export interface AppendProcedureHistoryEventInput extends HistoryEventDraftBase {
  kind: "procedure";
  procedure: string;
  status?: ProcedureStatus;
  procedureName?: string;
}

export interface AppendTestHistoryEventInput extends HistoryEventDraftBase {
  kind: "test";
  testName: string;
  resultStatus?: TestResultStatus;
  summary?: string;
  resultSummary?: string;
  testCategory?: string;
  specimenType?: string;
  labName?: string;
  labPanelId?: string;
  collectedAt?: DateInput;
  reportedAt?: DateInput;
  fastingStatus?: BloodTestFastingStatus;
  results?: BloodTestResultRecord[];
}

export interface AppendBloodTestInput extends HistoryEventDraftBase {
  testName: string;
  resultStatus?: TestResultStatus;
  summary?: string;
  resultSummary?: string;
  specimenType?: BloodTestSpecimenType | string;
  labName?: string;
  labPanelId?: string;
  collectedAt?: DateInput;
  reportedAt?: DateInput;
  fastingStatus?: BloodTestFastingStatus;
  results: BloodTestResultRecord[];
}

export interface AppendAdverseEffectHistoryEventInput extends HistoryEventDraftBase {
  kind: "adverse_effect";
  substance: string;
  effect: string;
  severity?: AdverseEffectSeverity;
}

export interface AppendExposureHistoryEventInput extends HistoryEventDraftBase {
  kind: "exposure";
  exposureType?: string;
  substance?: string;
  duration?: string;
  agent?: string;
  route?: string;
  durationText?: string;
}

export type AppendHistoryEventInput =
  | AppendEncounterHistoryEventInput
  | AppendProcedureHistoryEventInput
  | AppendTestHistoryEventInput
  | AppendAdverseEffectHistoryEventInput
  | AppendExposureHistoryEventInput;

export interface AppendHistoryEventResult {
  auditPath: string;
  relativePath: string;
  record: HistoryEventRecord;
}

export interface AppendBloodTestResult extends AppendHistoryEventResult {
  record: BloodTestHistoryEventRecord;
}

export interface ListHistoryEventsInput {
  vaultRoot: string;
  kinds?: HistoryEventKind[];
  source?: HistoryEventSource;
  from?: DateInput;
  to?: DateInput;
  order?: HistoryEventOrder;
  limit?: number;
}

export interface ReadHistoryEventInput {
  vaultRoot: string;
  eventId: string;
}

export interface ReadHistoryEventResult {
  relativePath: string;
  record: HistoryEventRecord;
}
