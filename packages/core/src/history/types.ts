import {
  ADVERSE_EFFECT_SEVERITIES as CONTRACT_ADVERSE_EFFECT_SEVERITIES,
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_SPECIMEN_TYPES,
  EVENT_SOURCES,
  HEALTH_HISTORY_EVENT_KINDS,
  TEST_RESULT_STATUSES as CONTRACT_TEST_RESULT_STATUSES,
} from "@murphai/contracts";

import type {
  BloodTestResultRecord,
  EncounterEventRecord,
  ProcedureEventRecord,
  TestEventRecord,
  AdverseEffectEventRecord,
  ExposureEventRecord,
  EventSource,
  EventRecord,
  HealthHistoryEventKind,
} from "@murphai/contracts";
import type { DateInput } from "../types.ts";

export type {
  BloodTestReferenceRange,
  BloodTestResultRecord,
} from "@murphai/contracts";

export const HEALTH_HISTORY_KINDS = HEALTH_HISTORY_EVENT_KINDS;

export const HEALTH_HISTORY_SOURCES = EVENT_SOURCES;

export const HISTORY_EVENT_ORDER = ["asc", "desc"] as const;
export const PROCEDURE_STATUSES = ["planned", "completed", "cancelled"] as const;
export const TEST_STATUSES = CONTRACT_TEST_RESULT_STATUSES;
export const ADVERSE_EFFECT_SEVERITIES = CONTRACT_ADVERSE_EFFECT_SEVERITIES;

export type HistoryEventKind = HealthHistoryEventKind;
export type HistoryEventSource = EventSource;
export type HistoryEventOrder = (typeof HISTORY_EVENT_ORDER)[number];
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];
export type TestResultStatus = (typeof TEST_STATUSES)[number];
export type AdverseEffectSeverity = (typeof ADVERSE_EFFECT_SEVERITIES)[number];
export type BloodTestCategory = typeof BLOOD_TEST_CATEGORY;
export type BloodTestFastingStatus = (typeof BLOOD_TEST_FASTING_STATUSES)[number];
export type BloodTestSpecimenType = (typeof BLOOD_TEST_SPECIMEN_TYPES)[number];

export type EncounterHistoryEventRecord = EncounterEventRecord;
export type ProcedureHistoryEventRecord = ProcedureEventRecord;
export type TestHistoryEventRecord = TestEventRecord;
export type AdverseEffectHistoryEventRecord = AdverseEffectEventRecord;
export type ExposureHistoryEventRecord = ExposureEventRecord;

export type BloodTestHistoryEventRecord = TestHistoryEventRecord & {
  testCategory: BloodTestCategory;
  results: BloodTestResultRecord[];
};
export type HistoryEventRecord = Extract<EventRecord, { kind: HistoryEventKind }>;

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
  links?: EventRecord["links"];
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
