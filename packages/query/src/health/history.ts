import { HEALTH_HISTORY_EVENT_KINDS } from "@murphai/contracts";
import { listEntities, readVault, type VaultReadModel } from "../model.ts";
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

const HISTORY_EVENT_KIND_SET = new Set<string>(HEALTH_HISTORY_EVENT_KINDS);

export interface HistoryEventQueryRecord {
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

export interface HistoryEventListOptions {
  status?: string | string[];
  kind?: string;
  from?: string;
  to?: string;
  text?: string;
  limit?: number;
}

function historyEventRecordFromEntity(
  entity: Parameters<typeof listEntities>[0]["entities"][number],
): HistoryEventQueryRecord | null {
  if (entity.family !== "event" || !entity.occurredAt || !HISTORY_EVENT_KIND_SET.has(entity.kind)) {
    return null;
  }

  const data = asObject(entity.attributes);
  if (!data) {
    return null;
  }

  return {
    id: entity.entityId,
    kind: entity.kind,
    occurredAt: entity.occurredAt,
    recordedAt: firstString(data, ["recordedAt"]),
    source: firstString(data, ["source"]),
    title: entity.title ?? entity.entityId,
    status: entity.status,
    tags: entity.tags,
    relatedIds: entity.relatedIds,
    relativePath: entity.path,
    data,
  };
}

function matchesHistoryOptions(
  record: HistoryEventQueryRecord,
  options: HistoryEventListOptions,
): boolean {
  if (options.kind && record.kind !== options.kind) {
    return false;
  }

  return (
    matchesStatus(record.status, options.status) &&
    matchesText(
      [
        record.id,
        record.kind,
        record.title,
        record.tags,
        record.relatedIds,
        record.data,
      ],
      options.text,
    )
  );
}

function selectProjectedHistoryEvents(
  vault: VaultReadModel,
  options: HistoryEventListOptions = {},
): HistoryEventQueryRecord[] {
  const records = listEntities(vault, {
    families: ["event"],
    kinds: options.kind ? [options.kind] : [...HEALTH_HISTORY_EVENT_KINDS],
    from: options.from,
    to: options.to,
  })
    .map(historyEventRecordFromEntity)
    .filter((record): record is HistoryEventQueryRecord => record !== null)
    .filter((record) => matchesDateRange(record.occurredAt, options.from, options.to))
    .filter((record) => matchesHistoryOptions(record, options))
    .sort(compareByOccurredAtDescThenId);

  return applyLimit(records, options.limit);
}

export async function listHistoryEvents(
  vaultRoot: string,
  options: HistoryEventListOptions = {},
): Promise<HistoryEventQueryRecord[]> {
  return selectProjectedHistoryEvents(await readVault(vaultRoot), options);
}

export async function showHistoryEvent(
  vaultRoot: string,
  lookup: string,
): Promise<HistoryEventQueryRecord | null> {
  const records = await listHistoryEvents(vaultRoot);
  return (
    records.find((record) =>
      matchesLookup(lookup, record.id, record.title, record.kind),
    ) ?? null
  );
}
