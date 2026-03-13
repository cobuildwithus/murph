import {
  applyLimit,
  asObject,
  firstString,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
} from "./shared.js";
import { readJsonlRecords } from "./loaders.js";
import {
  HEALTH_HISTORY_KINDS,
  projectHistoryEntity,
} from "../canonical-entities.js";

import type { CanonicalEntity } from "../canonical-entities.js";

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

function historyRecordFromEntity(
  entity: CanonicalEntity,
): HistoryQueryRecord | null {
  if (entity.family !== "history") {
    return null;
  }

  const data = asObject(entity.attributes);
  if (!data || !HEALTH_HISTORY_KINDS.has(entity.kind as HealthHistoryKind) || !entity.occurredAt || !entity.title) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: entity.kind as HealthHistoryKind,
    occurredAt: entity.occurredAt,
    recordedAt: firstString(data, ["recordedAt"]),
    source: firstString(data, ["source"]),
    title: entity.title,
    status: entity.status,
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data,
  };
}

export function toHistoryRecord(
  value: unknown,
  relativePath: string,
): HistoryQueryRecord | null {
  const entity = projectHistoryEntity(value, relativePath);
  return entity ? historyRecordFromEntity(entity) : null;
}

export function compareHistory(left: HistoryQueryRecord, right: HistoryQueryRecord): number {
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt.localeCompare(left.occurredAt);
  }

  return left.id.localeCompare(right.id);
}

function isHistoryRecord(record: HistoryQueryRecord | null): record is HistoryQueryRecord {
  return record !== null;
}

function matchesKindFilter(
  record: HistoryQueryRecord,
  kindFilters: ReadonlySet<HealthHistoryKind> | null,
): boolean {
  return !kindFilters || kindFilters.has(record.kind);
}

function matchesHistoryOptions(
  record: HistoryQueryRecord,
  options: HistoryListOptions,
  kindFilters: ReadonlySet<HealthHistoryKind> | null,
): boolean {
  return (
    matchesKindFilter(record, kindFilters) &&
    matchesStatus(record.status, options.status) &&
    matchesText(
      [
        record.id,
        record.title,
        record.kind,
        record.source,
        record.tags,
        record.relatedIds,
        record.data,
      ],
      options.text,
    )
  );
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
    .map((entry) => projectHistoryEntity(entry.value, entry.relativePath))
    .map((entity) => (entity ? historyRecordFromEntity(entity) : null))
    .filter(isHistoryRecord)
    .filter((entry) => matchesDateRange(entry.occurredAt, options.from, options.to))
    .filter((entry) => matchesHistoryOptions(entry, options, kindFilters))
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
