import { createHash } from "node:crypto";
import type { DurableObjectStateLike, DurableObjectSqlValue } from "./types.ts";
import { LEGACY_MANAGED_SNAPSHOT_PREFIX, parseLegacyManagedSnapshot } from "./legacy-managed-snapshot.ts";
import { browserVaultReplicaOrphanCandidateStoragePrefix, workspaceSnapshotOrphanCandidateStoragePrefix, workspaceSnapshotUploadSessionCurrentStorageKey } from "./workspace-snapshot-sessions.ts";

const PAGE_SIZE = 50;
const EXPORT_KV_PREFIXES = [
  workspaceSnapshotUploadSessionCurrentStorageKey(),
  workspaceSnapshotOrphanCandidateStoragePrefix(),
  browserVaultReplicaOrphanCandidateStoragePrefix(),
] as const;
const DRAIN_KEYS = ["workspace-snapshot:r2-put-drain:v1", "browser-vault-replica:active-direct-puts:v1"];
/** Pre-SQLite runner state left on long-lived objects. No current code path
 * reads it; the SQL tables are the runtime authority, so it is neither exported
 * nor treated as member identity. */
const RETIRED_KV_PREFIXES = ["runner:"] as const;

export type { LegacyRuntimeExportCursor, LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";
import type { LegacyRuntimeExportCursor, LegacyRuntimeExportPage } from "@murphai/hosted-execution/runtime-migration";

/** No active attempt, credential hash, inference envelope, or runtime authority
 * enters the export. Only resource metadata and the generation high-water do. */
export async function readLegacyRuntimeMigrationIdentity(state: DurableObjectStateLike): Promise<{ userId: string | null; generation: string }> {
  const sql = state.storage.sql;
  if (!sql) throw new Error("Legacy runtime migration requires SQLite storage.");
  const tables = new Set(sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('runner_meta', 'runner_hosted_media_asset')").toArray().map(row => row.name));
  const meta = tables.has("runner_meta") ? sql.exec<{ user_id: string; active_generation: number; active_attempt_id: string | null; active_runner_container_name: string | null }>(
    "SELECT user_id, active_generation, active_attempt_id, active_runner_container_name FROM runner_meta WHERE singleton = 1",
  ).toArray()[0] : undefined;
  const members = new Set<string>();
  if (meta) {
    if (!Number.isSafeInteger(meta.active_generation) || meta.active_generation < 0) throw new Error("Legacy runtime generation is invalid.");
    members.add(meta.user_id);
  }
  if (tables.has("runner_hosted_media_asset")) {
    for (const row of sql.exec<{ user_id: string }>("SELECT DISTINCT user_id FROM runner_hosted_media_asset LIMIT 2").toArray()) members.add(row.user_id);
  }
  if (!state.storage.list) throw new Error("Legacy runtime migration requires bounded storage listing.");
  for (const prefix of [...EXPORT_KV_PREFIXES, ...DRAIN_KEYS, LEGACY_MANAGED_SNAPSHOT_PREFIX]) {
    const records = await state.storage.list<unknown>({ prefix, limit: 1 });
    for (const value of records.values()) {
      if (!value || typeof value !== "object" || !("userId" in value) || typeof value.userId !== "string" || !value.userId) throw new Error("Legacy resource member identity is missing.");
      members.add(value.userId);
    }
  }
  if (members.size > 1) throw new Error("Legacy runtime contains conflicting member identities.");
  return { userId: members.values().next().value ?? null, generation: String(meta?.active_generation ?? 0) };
}

/** Caller holds the durable completed freeze. Keyset pages avoid loading an
 * entire media table or resource collection into a single RPC. */
export async function readLegacyRuntimeExportPage(state: DurableObjectStateLike, cursor: LegacyRuntimeExportCursor): Promise<LegacyRuntimeExportPage> {
  if (!Number.isInteger(cursor.section) || cursor.section < 0 || cursor.section > EXPORT_KV_PREFIXES.length
    || typeof cursor.after !== "string" || cursor.after.length > 2048) throw new TypeError("Legacy export cursor is invalid.");
  const identity = await readLegacyRuntimeMigrationIdentity(state);
  const active = hasTable(state, "runner_meta") ? state.storage.sql!.exec<{ active_attempt_id: string | null; active_runner_container_name: string | null }>(
    "SELECT active_attempt_id, active_runner_container_name FROM runner_meta WHERE singleton = 1",
  ).toArray()[0] : undefined;
  if (active?.active_attempt_id || active?.active_runner_container_name) throw new Error("Legacy runtime export still has an execution target.");
  const records = cursor.section === 0
    ? readMediaPage(state, cursor.after)
    : await readResourcePage(state, EXPORT_KV_PREFIXES[cursor.section - 1]!, cursor.after);
  const next = records.length === PAGE_SIZE ? { section: cursor.section, after: records.at(-1)!.key }
    : cursor.section < EXPORT_KV_PREFIXES.length ? { section: cursor.section + 1, after: "" } : null;
  const page = { schema: "murph.legacy-runtime-export.v1" as const, ...identity, cursor, next, records };
  const serialized = JSON.stringify(page);
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) throw new Error("Legacy runtime export page exceeds its bound.");
  return { ...page, hash: createHash("sha256").update(serialized).digest("hex") };
}

function readMediaPage(state: DurableObjectStateLike, after: string): LegacyRuntimeExportPage["records"] {
  if (!hasTable(state, "runner_hosted_media_asset")) return [];
  return state.storage.sql!.exec<Record<string, DurableObjectSqlValue>>(`
    SELECT media_id, user_id, media_kind, byte_size, sha256, expires_at,
      retired_at, purged_at, revision, object_key, updated_at
    FROM runner_hosted_media_asset WHERE media_id > ? ORDER BY media_id LIMIT ?
  `, after, PAGE_SIZE).toArray().map(row => {
    if (typeof row.media_id !== "string") throw new Error("Legacy media identity is invalid.");
    return { kind: "media", key: row.media_id, value: row };
  });
}
async function readResourcePage(state: DurableObjectStateLike, prefix: string, after: string): Promise<LegacyRuntimeExportPage["records"]> {
  if (!state.storage.list) throw new Error("Legacy runtime migration requires bounded storage listing.");
  const values = await state.storage.list<Record<string, unknown>>({ prefix, limit: PAGE_SIZE, ...(after ? { startAfter: after } : {}) });
  return [...values].map(([key, value]) => ({ kind: "resource", key, value }));
}

/** Fail closed on unclassified durable KV state. This finite scan is paginated;
 * resources themselves are exported separately in resumable pages. */
export async function requireLegacyRuntimeStorageCoverage(state: DurableObjectStateLike, requireTerminalUploads = false): Promise<Set<string>> {
  if (!state.storage.list) throw new Error("Legacy migration requires bounded storage listing.");
  const members = new Set<string>();
  let after = "";
  for (;;) {
    const page = await state.storage.list<unknown>({ limit: PAGE_SIZE, ...(after ? { startAfter: after } : {}) });
    for (const [key, value] of page) {
      const userId = classifyLegacyStorageRecord(key, value, requireTerminalUploads);
      if (userId !== null) members.add(userId);
      if (members.size > 1) throw new Error("Legacy runtime contains conflicting member identities.");
    }
    if (page.size < PAGE_SIZE) return members;
    const next = [...page.keys()].at(-1)!;
    if (next <= after) throw new Error("Legacy storage listing did not advance.");
    after = next;
  }
}

function storageKeyFamily(key: string): string {
  const family = /^[a-z0-9-]{1,40}/u.exec(key)?.[0];
  return family && family.length < key.length ? `${family}:*` : family ?? "unrecognized";
}

function classifyLegacyStorageRecord(key: string, value: unknown, requireTerminalUploads: boolean): string | null {
  if (key === "runtime-migration-freeze:v1" || RETIRED_KV_PREFIXES.some(prefix => key.startsWith(prefix))) return null;
  if (key.startsWith(LEGACY_MANAGED_SNAPSHOT_PREFIX)) {
    const upload = parseLegacyManagedSnapshot(value);
    if (key !== `${LEGACY_MANAGED_SNAPSHOT_PREFIX}${upload.snapshotId}`) throw new Error("Legacy managed upload key mismatch.");
    if (requireTerminalUploads && upload.completedAt === null) throw new Error("Legacy snapshot upload remains pending.");
    return upload.userId;
  }
  if (!DRAIN_KEYS.includes(key) && !EXPORT_KV_PREFIXES.some(prefix => key.startsWith(prefix))) {
    // Name only the key's leading identifier segment so the operator can extend
    // coverage; identifiers, member data and values never enter the error.
    throw new Error(`Legacy migration encountered unclassified durable state (${storageKeyFamily(key)}).`);
  }
  if (!value || typeof value !== "object" || !("userId" in value) || typeof value.userId !== "string" || !value.userId) {
    throw new Error("Legacy resource member identity is missing.");
  }
  return value.userId;
}

function hasTable(state: DurableObjectStateLike, table: string): boolean {
  return state.storage.sql!.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length === 1;
}
