import { requireObject, requireString } from "./parsers/assertions.ts";

/** Finite fleet migration protocol; never carries live runtime authority. */
export const HOSTED_RUNTIME_MIGRATION_PATH = "/api/internal/hosted-runtime/migration";
export const LEGACY_RUNTIME_EXPORT_SCHEMA = "murph.legacy-runtime-export.v1";
export const LEGACY_RUNTIME_EXPORT_PAGE_SIZE = 50;
export type LegacyRuntimeExportCursor = { section: number; after: string };
export interface LegacyRuntimeExportPage {
  schema: typeof LEGACY_RUNTIME_EXPORT_SCHEMA;
  userId: string | null;
  generation: string;
  cursor: LegacyRuntimeExportCursor;
  next: LegacyRuntimeExportCursor | null;
  records: Array<{ kind: "media" | "resource"; key: string; value: Record<string, unknown> }>;
  hash: string;
}
export interface HostedRuntimeMigrationIdentity { namespaceId: string; workerVersion: string }
export type HostedRuntimeMigrationCommand =
  | { operation: "status" }
  | ({ operation: "begin" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "inventory"; after: string; objectIds: string[]; complete: boolean } & HostedRuntimeMigrationIdentity)
  | ({ operation: "read_object"; objectId: string } & HostedRuntimeMigrationIdentity)
  | ({ operation: "import"; objectId: string; page: LegacyRuntimeExportPage } & HostedRuntimeMigrationIdentity)
  | ({ operation: "activate"; inventoryHash: string; inventoryCount: number } & HostedRuntimeMigrationIdentity);

export function parseLegacyRuntimeExportCursor(value: unknown): LegacyRuntimeExportCursor {
  const record = requireObject(value, "Legacy export cursor");
  if (!Number.isInteger(record.section) || typeof record.section !== "number" || record.section < 0 || record.section > 3
    || typeof record.after !== "string" || record.after.length > 2048) throw new TypeError("Legacy export cursor is invalid.");
  return { section: record.section, after: record.after };
}
export function parseLegacyRuntimeExportPage(value: unknown): LegacyRuntimeExportPage {
  const record = requireObject(value, "Legacy export page");
  if (record.schema !== LEGACY_RUNTIME_EXPORT_SCHEMA || !Array.isArray(record.records)
    || record.records.length > LEGACY_RUNTIME_EXPORT_PAGE_SIZE) throw new TypeError("Legacy export page is invalid.");
  const generation = requireString(record.generation, "Legacy generation");
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(generation) || BigInt(generation) >= 9_223_372_036_854_775_807n) throw new TypeError("Legacy generation is invalid.");
  const records = record.records.map<LegacyRuntimeExportPage["records"][number]>(value => {
    const row = requireObject(value, "Legacy export record");
    if (row.kind !== "media" && row.kind !== "resource") throw new TypeError("Legacy export record kind is invalid.");
    return { kind: row.kind, key: requireString(row.key, "Legacy export key"), value: requireObject(row.value, "Legacy export value") };
  });
  return { schema: LEGACY_RUNTIME_EXPORT_SCHEMA,
    userId: record.userId === null ? null : requireString(record.userId, "Legacy member"), generation,
    cursor: parseLegacyRuntimeExportCursor(record.cursor), next: record.next === null ? null : parseLegacyRuntimeExportCursor(record.next),
    records, hash: migrationDigest(record.hash) };
}
export function parseHostedRuntimeMigrationCommand(value: unknown): HostedRuntimeMigrationCommand {
  const record = requireObject(value, "Runtime migration command");
  if (record.operation === "status") return { operation: "status" };
  const identity = { namespaceId: migrationIdentifier(record.namespaceId), workerVersion: migrationIdentifier(record.workerVersion) };
  switch (record.operation) {
    case "begin": return { operation: "begin", ...identity };
    case "inventory": {
      if (!Array.isArray(record.objectIds) || record.objectIds.length > 100 || typeof record.complete !== "boolean"
        || typeof record.after !== "string") throw new TypeError("Migration inventory page is invalid.");
      return { operation: "inventory", ...identity, after: record.after === "" ? "" : migrationDigest(record.after),
        objectIds: record.objectIds.map(migrationDigest), complete: record.complete };
    }
    case "read_object": return { operation: "read_object", ...identity, objectId: migrationDigest(record.objectId) };
    case "import": return { operation: "import", ...identity, objectId: migrationDigest(record.objectId), page: parseLegacyRuntimeExportPage(record.page) };
    case "activate": {
      if (typeof record.inventoryCount !== "number" || !Number.isSafeInteger(record.inventoryCount) || record.inventoryCount < 0) throw new TypeError("Migration inventory count is invalid.");
      return { operation: "activate", ...identity, inventoryHash: migrationDigest(record.inventoryHash), inventoryCount: record.inventoryCount };
    }
    default: throw new TypeError("Runtime migration operation is invalid.");
  }
}
function migrationIdentifier(value: unknown): string {
  const text = requireString(value, "Migration identity");
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(text)) throw new TypeError("Migration identity is invalid.");
  return text;
}
function migrationDigest(value: unknown): string {
  const text = requireString(value, "Migration digest");
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError("Migration digest is invalid.");
  return text;
}
