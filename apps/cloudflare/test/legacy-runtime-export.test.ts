import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readLegacyRuntimeExportPage, readLegacyRuntimeMigrationIdentity, requireLegacyRuntimeStorageCoverage } from "../src/user-runner/legacy-runtime-export.ts";
import { ensureRunnerStateSchema, assertRunnerStateSchemaVersionSupported } from "../src/user-runner/runner-state-schema.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

function harness() {
  const sql = createTestSqlStorage();
  ensureRunnerStateSchema(sql);
  const kv = new Map<string, unknown>();
  const listCalls: Array<{ limit?: number }> = [];
  const list = async <T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}) => { listCalls.push(options); return new Map(
    [...kv.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(options.prefix ?? "") && key > (options.startAfter ?? ""))
      .slice(0, options.limit).map(([key, value]) => [key, value as T]),
  ); };
  const state: DurableObjectStateLike = { storage: { sql, list, get: async <T>(key: string) => kv.get(key) as T | undefined,
    put: async (key, value) => { kv.set(key, value); }, delete: async key => kv.delete(key), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {},
  }, waitUntil() {} };
  return { sql, kv, state, listCalls };
}
function addMedia(h: ReturnType<typeof harness>, index: number) {
  const id = index.toString(16).padStart(64, "0");
  h.sql.exec(`INSERT INTO runner_hosted_media_asset (media_id, user_id, media_kind, byte_size, sha256, object_key, updated_at)
    VALUES (?, 'synthetic_member', 'image', 1, ?, ?, '2026-01-01T00:00:00.000Z')`, id, id, `synthetic/${id}`);
}

describe("frozen legacy resource export", () => {
  it("exports dormant media-only objects in stable bounded keyset pages", async () => {
    const h = harness();
    for (let i = 1; i <= 51; i++) addMedia(h, i);
    const page = await readLegacyRuntimeExportPage(h.state, { section: 0, after: "" });
    expect(page.userId).toBe("synthetic_member");
    expect(page.generation).toBe("0");
    expect(page.records).toHaveLength(50);
    expect(page.next).toEqual({ section: 0, after: (50).toString(16).padStart(64, "0") });
    const { hash, ...payload } = page;
    expect(hash).toBe(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    expect(await readLegacyRuntimeExportPage(h.state, page.cursor)).toEqual(page);
    expect((await readLegacyRuntimeExportPage(h.state, page.next!)).records).toHaveLength(1);
    expect(h.listCalls.every(options => options.limit !== undefined && options.limit <= 50)).toBe(true);
  });
  it("preserves only the generation high-water and refuses a retained target", async () => {
    const h = harness();
    h.sql.exec(`INSERT INTO runner_meta (singleton, user_id, active_generation, active_provider_egress_token_hash,
      active_custom_inference_envelope, active_runner_container_name) VALUES (1, 'synthetic_member', 17, 'synthetic_secret_hash', 'synthetic_private_envelope', 'synthetic_target')`);
    await expect(readLegacyRuntimeExportPage(h.state, { section: 0, after: "" })).rejects.toThrow("execution target");
    h.sql.exec("UPDATE runner_meta SET active_runner_container_name = NULL");
    const page = await readLegacyRuntimeExportPage(h.state, { section: 0, after: "" });
    expect(page.generation).toBe("17");
    expect(JSON.stringify(page)).not.toMatch(/synthetic_secret_hash|synthetic_private_envelope/);
    expect(() => assertRunnerStateSchemaVersionSupported({ observedVersion: 20, supportedVersion: 19 })).toThrow("newer than supported");
  });
  it("finds drain-only identity, rejects conflicting members, and refuses unknown KV state", async () => {
    const h = harness();
    expect(await readLegacyRuntimeMigrationIdentity(h.state)).toEqual({ userId: null, generation: "0" });
    h.kv.set("workspace-snapshot:r2-put-drain:v1", { userId: "synthetic_member" });
    expect((await readLegacyRuntimeMigrationIdentity(h.state)).userId).toBe("synthetic_member");
    h.kv.set("workspace-snapshot-orphan-candidate:a", { userId: "synthetic_other" });
    await expect(readLegacyRuntimeMigrationIdentity(h.state)).rejects.toThrow("conflicting");
    h.kv.set("future-unknown-resource", { synthetic: true });
    await expect(requireLegacyRuntimeStorageCoverage(h.state)).rejects.toThrow("unclassified durable state (future-unknown-resource)");
    h.kv.delete("future-unknown-resource");
    h.kv.set("legacy-thing:v1:synthetic-suffix", { synthetic: true });
    await expect(requireLegacyRuntimeStorageCoverage(h.state)).rejects.toThrow("unclassified durable state (legacy-thing:*)");
    h.kv.delete("legacy-thing:v1:synthetic-suffix");
    h.kv.set("Ünknown", { synthetic: true });
    await expect(requireLegacyRuntimeStorageCoverage(h.state)).rejects.toThrow("unclassified durable state (unrecognized)");
  });
});
