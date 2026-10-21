import { eventLedgerStorage } from "./canonical-jsonl-storage.ts";

export {
  MAX_JSONL_SHARD_BYTES as MAX_EVENT_LEDGER_SHARD_BYTES,
  MAX_JSONL_ARCHIVE_BYTES as MAX_EVENT_LEDGER_ARCHIVE_BYTES,
} from "./jsonl-shard-storage.ts";
export type {
  JsonlShardSource as EventLedgerShardSource,
  JsonlShardContentReceipt as EventLedgerShardContentReceipt,
  ArchiveClosedJsonlShardsResult as ArchiveClosedEventLedgerShardsResult,
} from "./jsonl-shard-storage.ts";

export const {
  isJsonlLogicalPath: isEventLedgerLogicalPath,
  listJsonlShardSources: listEventLedgerShardSources,
  listJsonlShardPaths: listEventLedgerShardPaths,
  listJsonlShardPathsInterruptible: listEventLedgerShardPathsInterruptible,
  resolveJsonlShardSource: resolveEventLedgerShardSource,
  readJsonlShardRows: readEventLedgerShardRows,
  readJsonlShardText: readEventLedgerShardText,
  readJsonlShardRecords: readEventLedgerShardRecords,
  visitJsonlShardRecordsInterruptible: visitEventLedgerShardRecordsInterruptible,
  createArchivedJsonlShardContentReceipt: createArchivedEventLedgerShardContentReceipt,
  inspectArchivedJsonlShardAppend: inspectArchivedEventLedgerShardAppend,
  appendArchivedJsonlShard: appendArchivedEventLedgerShard,
  truncateArchivedJsonlShard: truncateArchivedEventLedgerShard,
  archiveClosedJsonlShards: archiveClosedEventLedgerShards,
} = eventLedgerStorage;
