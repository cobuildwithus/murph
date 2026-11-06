import { VAULT_LAYOUT } from "./constants.ts";
import { createJsonlShardStorage } from "./jsonl-shard-storage.ts";

export const eventLedgerStorage = createJsonlShardStorage(VAULT_LAYOUT.eventLedgerDirectory, "EVENT_LEDGER");
export const auditStorage = createJsonlShardStorage(VAULT_LAYOUT.auditDirectory, "AUDIT");

export function canonicalJsonlStorageForPath(relativePath: string) {
  return [eventLedgerStorage, auditStorage].find((storage) => storage.isJsonlLogicalPath(relativePath)) ?? null;
}
