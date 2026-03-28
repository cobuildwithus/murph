import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_SPECIMEN_TYPES,
} from "@murph/contracts";
import {
  applyLimit,
  asObject,
  firstString,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./shared.ts";
import { compareByOccurredAtDescThenId } from "./comparators.ts";
import { listHistoryEvents, toHistoryRecord, type HistoryQueryRecord } from "./history.ts";

const BLOOD_TEST_SPECIMEN_TYPE_SET = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES);

export interface BloodTestQueryRecord {
  id: string;
  kind: "blood_test";
  occurredAt: string;
  recordedAt: string | null;
  collectedAt: string | null;
  reportedAt: string | null;
  source: string | null;
  title: string;
  testName: string | null;
  status: string | null;
  labName: string | null;
  labPanelId: string | null;
  specimenType: string | null;
  fastingStatus: string | null;
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface BloodTestListOptions {
  status?: string | string[];
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function isBloodTestData(data: Record<string, unknown>): boolean {
  const testCategory = firstString(data, ["testCategory"]);
  const specimenType = firstString(data, ["specimenType"]);

  return (
    testCategory === BLOOD_TEST_CATEGORY ||
    (specimenType !== null && BLOOD_TEST_SPECIMEN_TYPE_SET.has(specimenType))
  );
}

function bloodTestRecordFromHistory(
  record: HistoryQueryRecord,
): BloodTestQueryRecord | null {
  if (record.kind !== "test") {
    return null;
  }

  const data = asObject(record.data);
  if (!data || !isBloodTestData(data)) {
    return null;
  }

  return {
    id: record.id,
    kind: "blood_test",
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    collectedAt: firstString(data, ["collectedAt"]),
    reportedAt: firstString(data, ["reportedAt"]),
    source: record.source,
    title: record.title,
    testName: firstString(data, ["testName"]),
    status: firstString(data, ["resultStatus", "status"]),
    labName: firstString(data, ["labName"]),
    labPanelId: firstString(data, ["labPanelId"]),
    specimenType: firstString(data, ["specimenType"]),
    fastingStatus: firstString(data, ["fastingStatus"]),
    tags: record.tags,
    relatedIds: record.relatedIds,
    relativePath: record.relativePath,
    data,
  };
}

export function toBloodTestRecord(
  value: unknown,
  relativePath: string,
): BloodTestQueryRecord | null {
  const historyRecord = toHistoryRecord(value, relativePath);
  return historyRecord ? bloodTestRecordFromHistory(historyRecord) : null;
}

export function compareBloodTests(
  left: BloodTestQueryRecord,
  right: BloodTestQueryRecord,
): number {
  return compareByOccurredAtDescThenId(left, right);
}

function isBloodTestRecord(
  record: BloodTestQueryRecord | null,
): record is BloodTestQueryRecord {
  return record !== null;
}

function matchesBloodTestOptions(
  record: BloodTestQueryRecord,
  options: BloodTestListOptions,
): boolean {
  return (
    matchesStatus(record.status, options.status) &&
    matchesText(
      [
        record.id,
        record.title,
        record.testName,
        record.labName,
        record.labPanelId,
        record.specimenType,
        record.fastingStatus,
        record.tags,
        record.relatedIds,
        record.data,
      ],
      options.text,
    )
  );
}

export async function listBloodTests(
  vaultRoot: string,
  options: BloodTestListOptions = {},
): Promise<BloodTestQueryRecord[]> {
  const historyRecords = await listHistoryEvents(vaultRoot, {
    from: options.from,
    kind: "test",
    limit: undefined,
    status: undefined,
    text: undefined,
    to: options.to,
  });
  const records = historyRecords
    .map(bloodTestRecordFromHistory)
    .filter(isBloodTestRecord)
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .filter((record) => matchesBloodTestOptions(record, options))
    .sort(compareBloodTests);

  return applyLimit(records, options.limit);
}

export async function readBloodTest(
  vaultRoot: string,
  eventId: string,
): Promise<BloodTestQueryRecord | null> {
  const records = await listBloodTests(vaultRoot);
  return records.find((record) => record.id === eventId) ?? null;
}

export async function showBloodTest(
  vaultRoot: string,
  lookup: string,
): Promise<BloodTestQueryRecord | null> {
  const records = await listBloodTests(vaultRoot);
  return (
    records.find((record) =>
      matchesLookup(lookup, record.id, record.title, record.testName, record.labPanelId),
    ) ?? null
  );
}
