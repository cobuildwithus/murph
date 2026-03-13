import {
  applyLimit,
  asObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./shared.js";
import { readJsonlRecords } from "./loaders.js";

export type HealthHistoryKind =
  | "encounter"
  | "procedure"
  | "test"
  | "adverse_effect"
  | "exposure";

export interface HistoryQueryRecord {
  id: string;
  kind: HealthHistoryKind;
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

export interface HistoryListOptions {
  kind?: HealthHistoryKind | HealthHistoryKind[];
  status?: string | string[];
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

const HEALTH_HISTORY_KINDS = new Set<HealthHistoryKind>([
  "encounter",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
]);

export function toHistoryRecord(
  value: unknown,
  relativePath: string,
): HistoryQueryRecord | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const id = firstString(source, ["id"]);
  const kind = firstString(source, ["kind"]);
  const occurredAt = firstString(source, ["occurredAt"]);
  const title = firstString(source, ["title"]);

  if (!id?.startsWith("evt_") || !kind || !HEALTH_HISTORY_KINDS.has(kind as HealthHistoryKind) || !occurredAt || !title) {
    return null;
  }

  return {
    id,
    kind: kind as HealthHistoryKind,
    occurredAt,
    recordedAt: firstString(source, ["recordedAt"]),
    source: firstString(source, ["source"]),
    title,
    status: firstString(source, ["status"]),
    tags: firstStringArray(source, ["tags"]),
    relatedIds: firstStringArray(source, ["relatedIds"]),
    relativePath,
    data: source,
  };
}

export function compareHistory(left: HistoryQueryRecord, right: HistoryQueryRecord): number {
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }

  return left.id.localeCompare(right.id);
}

export async function listHistoryEvents(
  vaultRoot: string,
  options: HistoryListOptions = {},
): Promise<HistoryQueryRecord[]> {
  const kindFilters = Array.isArray(options.kind)
    ? new Set(options.kind)
    : options.kind
      ? new Set([options.kind])
      : null;
  const entries = await readJsonlRecords(vaultRoot, "ledger/events");
  const records = entries
    .map((entry) => toHistoryRecord(entry.value, entry.relativePath))
    .filter((entry): entry is HistoryQueryRecord => entry !== null)
    .filter(
      (entry) =>
        (kindFilters ? kindFilters.has(entry.kind) : true) &&
        matchesDateRange(entry.occurredAt, options.from, options.to) &&
        matchesStatus(entry.status, options.status) &&
        matchesText([entry.id, entry.title, entry.kind, entry.source, entry.tags, entry.relatedIds, entry.data], options.text),
    )
    .sort(compareHistory);

  return applyLimit(records, options.limit);
}

export async function readHistoryEvent(
  vaultRoot: string,
  eventId: string,
): Promise<HistoryQueryRecord | null> {
  const records = await listHistoryEvents(vaultRoot);
  return records.find((record) => record.id === eventId) ?? null;
}

export async function showHistoryEvent(
  vaultRoot: string,
  lookup: string,
): Promise<HistoryQueryRecord | null> {
  const records = await listHistoryEvents(vaultRoot);
  return records.find((record) => matchesLookup(lookup, record.id, record.title)) ?? null;
}
