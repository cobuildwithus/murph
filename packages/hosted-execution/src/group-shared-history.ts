import {
  isHostedVaultShareRecentDateProjectionKind,
  type HostedVaultShareProjectionScope,
} from "./vault-share.ts";

// A complete civil date (all its sources/workouts) is the smallest page. This
// keeps history reads below the existing model-result budget without changing
// the stored snapshot, copying history into the room, or inventing a cursor.
export const HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES = 256 * 1024;
export const HOSTED_GROUP_SHARED_READ_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export interface HostedGroupSharedReadOptions {
  /** Current room membership id, not a private member/workspace id. */
  participantId?: string;
  history?: { fromDate: string; throughDate: string };
}

export interface HostedGroupSharedDateCoverage {
  requestedFromDate: string;
  requestedThroughDate: string;
  returnedFromDate: string;
  returnedThroughDate: string;
  /** Dates actually observed, not proof of complete provider coverage. */
  availableDates: string[];
  nextFromDate?: string;
}

export function parseHostedGroupSharedReadOptions(
  value: HostedGroupSharedReadOptions & { freshness?: unknown },
  scopes: readonly HostedVaultShareProjectionScope[],
): HostedGroupSharedReadOptions {
  const result: HostedGroupSharedReadOptions = {};
  if (value.participantId !== undefined) {
    if (!isParticipantId(value.participantId)) {
      throw new TypeError("Shared read participantId is invalid.");
    }
    result.participantId = value.participantId;
  }
  if (value.history === undefined) {
    return result;
  }
  const history = value.history;
  if (!history || typeof history !== "object" || Array.isArray(history)
    || Object.keys(history).some((key) => key !== "fromDate" && key !== "throughDate")
    || !isDate(history.fromDate) || !isDate(history.throughDate)
    || history.fromDate > history.throughDate
    || Date.parse(history.throughDate) - Date.parse(history.fromDate) > 89 * 86_400_000
    || !result.participantId || value.freshness !== undefined
    || scopes.length !== 1
    || !isHostedVaultShareRecentDateProjectionKind(scopes[0]!.projectionKind)) {
    throw new TypeError("History reads require one health scope, one participant, at most 90 civil dates, and no freshness request.");
  }
  result.history = { fromDate: history.fromDate, throughDate: history.throughDate };
  return result;
}

/** Call only AFTER grant validation, decryption and the member-local retention clip. */
export function pageHostedGroupSharedHistory<T extends { occurredAt: string }>(
  records: readonly T[],
  history: NonNullable<HostedGroupSharedReadOptions["history"]>,
): { records: T[]; dateCoverage: HostedGroupSharedDateCoverage } {
  const byDate = new Map<string, T[]>();
  for (const record of records) {
    const date = record.occurredAt.slice(0, 10);
    if (date < history.fromDate || date > history.throughDate) continue;
    const day = byDate.get(date) ?? [];
    day.push(record);
    byDate.set(date, day);
  }
  const selected: T[] = [];
  const availableDates: string[] = [];
  let bytes = 2; // Array delimiters. Each additional date needs one separator.
  let nextFromDate: string | undefined;
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!;
    const dayBytes = new TextEncoder().encode(JSON.stringify(day)).byteLength;
    if (dayBytes > HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES) {
      throw new TypeError("One complete shared date exceeds the history page budget.");
    }
    const appendedBytes = dayBytes - 2 + (selected.length ? 1 : 0);
    if (bytes + appendedBytes > HOSTED_GROUP_SHARED_HISTORY_PAGE_MAX_BYTES) {
      nextFromDate = date;
      break;
    }
    bytes += appendedBytes;
    selected.push(...day);
    availableDates.push(date);
  }
  return {
    records: selected,
    dateCoverage: {
      requestedFromDate: history.fromDate,
      requestedThroughDate: history.throughDate,
      returnedFromDate: history.fromDate,
      returnedThroughDate: nextFromDate
        ? new Date(Date.parse(nextFromDate) - 86_400_000).toISOString().slice(0, 10)
        : history.throughDate,
      availableDates,
      ...(nextFromDate ? { nextFromDate } : {}),
    },
  };
}

export function parseHostedGroupSharedDateCoverage(value: unknown): HostedGroupSharedDateCoverage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Shared date coverage is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = ["requestedFromDate", "requestedThroughDate", "returnedFromDate", "returnedThroughDate", "availableDates", "nextFromDate"];
  if (Object.keys(record).some((key) => !keys.includes(key))
    || !isDate(record.requestedFromDate) || !isDate(record.requestedThroughDate)
    || !isDate(record.returnedFromDate) || !isDate(record.returnedThroughDate)
    || !Array.isArray(record.availableDates)
    || record.availableDates.length > 90
    || !record.availableDates.every(isDate)
    || (record.nextFromDate !== undefined && !isDate(record.nextFromDate))) {
    throw new TypeError("Shared date coverage is invalid.");
  }
  const coverage: HostedGroupSharedDateCoverage = {
    requestedFromDate: record.requestedFromDate,
    requestedThroughDate: record.requestedThroughDate,
    returnedFromDate: record.returnedFromDate,
    returnedThroughDate: record.returnedThroughDate,
    availableDates: record.availableDates,
    ...(record.nextFromDate === undefined ? {} : { nextFromDate: record.nextFromDate }),
  };
  assertConsistentDateCoverage(coverage);
  return { ...coverage, availableDates: [...coverage.availableDates] };
}

function assertConsistentDateCoverage(coverage: HostedGroupSharedDateCoverage): void {
  if (coverage.requestedFromDate !== coverage.returnedFromDate
    || coverage.returnedFromDate > coverage.returnedThroughDate
    || coverage.returnedThroughDate > coverage.requestedThroughDate
    || Date.parse(coverage.requestedThroughDate) - Date.parse(coverage.requestedFromDate) > 89 * 86_400_000
    || coverage.availableDates.some((date, index) => date < coverage.returnedFromDate
      || date > coverage.returnedThroughDate
      || (index > 0 && date <= coverage.availableDates[index - 1]!))
    || (coverage.nextFromDate === undefined
      ? coverage.returnedThroughDate !== coverage.requestedThroughDate
      : Date.parse(coverage.nextFromDate) - Date.parse(coverage.returnedThroughDate) !== 86_400_000
        || coverage.nextFromDate > coverage.requestedThroughDate)) {
    throw new TypeError("Shared date coverage bounds are inconsistent.");
  }
}

function isParticipantId(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && [...value].length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
