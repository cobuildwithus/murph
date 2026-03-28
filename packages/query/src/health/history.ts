import {
  matchesLookup,
} from "./shared.ts";
import { readHistoryEntitiesStrict } from "./entity-slices.ts";
import {
  compareHistory,
  selectHistoryRecords,
  toHistoryRecord,
  type HealthHistoryKind,
  type HistoryListOptions,
  type HistoryQueryRecord,
} from "./projections.ts";

export type { HealthHistoryKind, HistoryListOptions, HistoryQueryRecord } from "./projections.ts";
export { compareHistory, toHistoryRecord } from "./projections.ts";

export async function listHistoryEvents(
  vaultRoot: string,
  options: HistoryListOptions = {},
): Promise<HistoryQueryRecord[]> {
  return selectHistoryRecords(await readHistoryEntitiesStrict(vaultRoot), options);
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
