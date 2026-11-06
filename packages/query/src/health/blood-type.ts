import {
  combineBloodTypeRows,
  isBloodTypeResultLabel,
  parseBloodType,
  type BloodType,
} from "@murphai/contracts";

import { listBloodTests, type BloodTestQueryRecord } from "./blood-tests.ts";

export interface CurrentBloodTypeRecord extends BloodType {
  eventId: string;
  occurredAt: string;
  dayKey: string | null;
  recordedAt: string | null;
  source: string | null;
  note: string | null;
  rawRefs: string[];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bloodTypeFromRecord(record: BloodTestQueryRecord): BloodType | null {
  const results = Array.isArray(record.data.results) ? record.data.results : [];
  const rows: Array<{ label: string; text: string }> = [];

  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const entry = result as Record<string, unknown>;
    const text = stringField(entry.textValue);
    const labels = [stringField(entry.slug), stringField(entry.analyte)].filter(Boolean);
    if (labels.some(isBloodTypeResultLabel)) {
      const parsed = parseBloodType(text);
      if (parsed) return parsed;
    }
    for (const label of labels) rows.push({ label, text });
  }

  return combineBloodTypeRows(rows);
}

function instant(value: string | null): number {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function saveTime(record: BloodTestQueryRecord): number {
  return instant(record.recordedAt ?? record.occurredAt);
}

function compareDescending(left: number, right: number): number {
  return left === right ? 0 : right > left ? 1 : -1;
}

/**
 * Orders blood-type candidates so the most recently saved one comes first: a
 * correction saved later wins even when it carries an older lab date. Legacy
 * events without a distinct save time fall back to lab date, then event id.
 */
export function compareCurrentBloodTypeCandidates(
  left: BloodTestQueryRecord,
  right: BloodTestQueryRecord,
): number {
  return (
    compareDescending(saveTime(left), saveTime(right)) ||
    compareDescending(instant(left.occurredAt), instant(right.occurredAt)) ||
    right.id.localeCompare(left.id)
  );
}

export function selectCurrentBloodType(
  records: readonly BloodTestQueryRecord[],
): CurrentBloodTypeRecord | null {
  const candidates = records
    .map((record) => ({ record, bloodType: bloodTypeFromRecord(record) }))
    .filter((entry): entry is { record: BloodTestQueryRecord; bloodType: BloodType } =>
      entry.bloodType !== null
    )
    .sort((left, right) => compareCurrentBloodTypeCandidates(left.record, right.record));
  const current = candidates[0];
  if (!current) return null;

  const { record, bloodType } = current;
  const rawRefs = Array.isArray(record.data.rawRefs)
    ? record.data.rawRefs.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...bloodType,
    eventId: record.id,
    occurredAt: record.occurredAt,
    dayKey: typeof record.data.dayKey === "string" ? record.data.dayKey : null,
    recordedAt: record.recordedAt,
    source: record.source,
    note: typeof record.data.note === "string" ? record.data.note : null,
    rawRefs,
  };
}

/**
 * Reads the member's current blood type from live blood-test history. Null
 * means no recognizable blood type is saved in blood-test history; it does not
 * prove that no retained document mentions one.
 */
export async function readCurrentBloodType(
  vaultRoot: string,
): Promise<CurrentBloodTypeRecord | null> {
  return selectCurrentBloodType(await listBloodTests(vaultRoot));
}
