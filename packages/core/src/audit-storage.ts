import { auditStorage } from "./canonical-jsonl-storage.ts";

export const {
  archiveClosedJsonlShards: archiveClosedAuditShards,
  listJsonlShardSources: listAuditShardSources,
  listJsonlShardPaths: listAuditShardPaths,
  readJsonlShardRows: readAuditShardRows,
} = auditStorage;
