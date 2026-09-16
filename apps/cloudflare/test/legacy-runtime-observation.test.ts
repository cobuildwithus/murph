import { describe, expect, it, vi } from "vitest";
import { UserRunnerDurableObject } from "../src/worker/user-runner-durable-object.ts";
import { observeLegacyRuntime } from "../src/user-runner/legacy-runtime-observation.ts";
import { ensureRunnerStateSchema } from "../src/user-runner/runner-state-schema.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({
  commandHostedRuntimeOwner: vi.fn(async () => ({ cutover: "legacy" })),
}));

function harness(initialized = true) {
  const queries: string[] = [];
  const sql = createTestSqlStorage({ beforeExec: query => { queries.push(query); } });
  sql.exec("DROP TABLE runner_meta");
  if (initialized) ensureRunnerStateSchema(sql);
  queries.length = 0;
  const kv = new Map<string, unknown>();
  const mutation = vi.fn(async () => { throw new Error("Inspection attempted a storage mutation."); });
  const listCalls: Array<{ prefix?: string; startAfter?: string; limit?: number }> = [];
  const list = async <T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}) => {
    listCalls.push(options);
    return new Map(
    [...kv].sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => key.startsWith(options.prefix ?? "") && key > (options.startAfter ?? ""))
      .slice(0, options.limit).map(([key, value]) => [key, value as T]),
    );
  };
  const state: DurableObjectStateLike = {
    storage: { sql, get: async <T>(key: string) => kv.get(key) as T | undefined,
      list, put: mutation, delete: mutation, getAlarm: async () => null,
      setAlarm: mutation, deleteAlarm: mutation },
    waitUntil: vi.fn(),
  };
  return { sql, kv, state, queries, mutation, listCalls };
}

describe("live legacy migration inspection", () => {
  it("defers new work at a durable member quiescence barrier without initializing the runner", async () => {
    const h = harness(false);
    h.kv.set("runtime-migration-freeze:v1", {
      schema: "murph.legacy-runtime-freeze.v2", phase: "quiescing", migrationId: "migration-synthetic",
    });
    const object = new UserRunnerDurableObject(h.state, {} as never);
    expect(await object.ensureRuntimeProcessingForUser({
      userId: "synthetic_member", orchestrationAttemptId: "synthetic_orchestration",
    })).toMatchObject({ kind: "retry_later" });
    expect(await object.inspectPostgresMigration()).toMatchObject({
      kind: "observed", schemaVersion: null, freeze: { phase: "quiescing", pendingOperations: 0 },
    });
    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()).toEqual([]);
  });

  it("constructs and inspects an empty object without schema, alarm, or KV writes", async () => {
    const h = harness(false);
    const object = new UserRunnerDurableObject(h.state, {} as never);
    expect(await object.inspectPostgresMigration()).toMatchObject({
      kind: "observed", schemaVersion: null, userId: null, generation: "0",
      activeAttemptId: null, snapshotPutDrainUntil: null,
      replicaPendingWrites: 0, freeze: { phase: null, pendingOperations: 0 },
    });
    expect(h.queries.every(query => query.trim().startsWith("SELECT"))).toBe(true);
    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()).toEqual([]);
  });

  it("reports active execution and both upload obligations without starting a recovery clock", async () => {
    const h = harness();
    h.sql.exec(`INSERT INTO runner_meta (singleton, user_id, active_generation, active_attempt_id,
      active_runner_container_name, active_workspace_version) VALUES (1, 'synthetic_member', 7, 'synthetic_attempt', 'synthetic_target', 'synthetic_workspace')`);
    h.kv.set("workspace-snapshot:r2-put-drain:v1", {
      schema: "murph.hosted-workspace-snapshot-r2-put-drain.v1",
      userId: "synthetic_member", drainUntil: "2026-09-15T22:20:00.000Z",
    });
    h.kv.set("browser-vault-replica:active-direct-puts:v1", {
      schema: "murph.hosted-browser-vault-replica-active-put-state.v1",
      userId: "synthetic_member",
      writes: [{ admittedAt: "2026-09-15T22:00:00.000Z", attemptId: "synthetic_attempt", generation: "7", writeId: "synthetic_write" }],
    });
    h.queries.length = 0;
    expect(await observeLegacyRuntime(h.state)).toMatchObject({
      kind: "observed", userId: "synthetic_member", generation: "7",
      activeAttemptId: "synthetic_attempt", activeRunnerContainerName: "synthetic_target",
      workspaceVersion: "synthetic_workspace", snapshotPutDrainUntil: "2026-09-15T22:20:00.000Z",
      replicaPendingWrites: 1, replicaRecoveryDrainUntil: null,
    });
    expect(h.queries.every(query => query.trim().startsWith("SELECT"))).toBe(true);
    expect(h.mutation).not.toHaveBeenCalled();
  });

  it("reports unsupported dormant schemas without upgrading or dropping their state", async () => {
    const h = harness(false);
    h.sql.exec("CREATE TABLE retired_runtime_state (id TEXT PRIMARY KEY)");
    h.queries.length = 0;
    expect(await observeLegacyRuntime(h.state)).toEqual({ kind: "unsupported_schema", schemaVersion: null });
    expect(h.queries.every(query => query.trim().startsWith("SELECT"))).toBe(true);
    expect(h.mutation).not.toHaveBeenCalled();
  });

  it("rejects a contradictory resource after the first page even when runner metadata is bound", async () => {
    const h = harness();
    h.sql.exec("INSERT INTO runner_meta (singleton, user_id) VALUES (1, 'synthetic_member')");
    for (let i = 0; i < 60; i++) h.kv.set(`workspace-snapshot-orphan-candidate:${String(i).padStart(3, "0")}`, {
      userId: i === 59 ? "synthetic_other" : "synthetic_member",
    });
    await expect(observeLegacyRuntime(h.state)).rejects.toThrow("conflicting member identities");
    expect(h.listCalls).toHaveLength(2);
    expect(h.listCalls.every(options => options.limit === 50)).toBe(true);
    expect(h.mutation).not.toHaveBeenCalled();
  });
});
