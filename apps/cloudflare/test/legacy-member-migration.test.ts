import { advanceRuntimeMemberMigration } from "../src/worker/route-handlers/runtime-member-migration.ts";
import { describe, expect, it, vi } from "vitest";
import { UserRunnerDurableObject } from "../src/worker/user-runner-durable-object.ts";
import { ensureRunnerStateSchema } from "../src/user-runner/runner-state-schema.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

const canonical = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: canonical.command }));
const identity = { namespaceId: "synthetic-namespace", workerVersion: "synthetic-version", objectId: "a".repeat(64),
  userId: "synthetic-member", migrationId: "synthetic-handoff" };
function harness() {
  const sql = createTestSqlStorage();
  ensureRunnerStateSchema(sql);
  sql.exec("INSERT INTO runner_meta (singleton, user_id, active_generation, active_attempt_id, active_runner_container_name, active_workspace_version) VALUES (1, ?, 7, 'synthetic-attempt', 'synthetic-target', '3')", identity.userId);
  const values = new Map<string, unknown>();
  const state: DurableObjectStateLike = { storage: { sql,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key, value) => { values.set(key, value); }, delete: async key => values.delete(key),
    getAlarm: async () => null, deleteAlarm: vi.fn(async () => {}), setAlarm: vi.fn(async () => {}),
    list: async <T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}) => new Map(
      [...values].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(options.prefix ?? "") && key > (options.startAfter ?? ""))
        .slice(0, options.limit).map(([key, value]) => [key, value as T])),
  }, waitUntil: vi.fn() };
  const supports = vi.fn(async () => true);
  const checkpoint = vi.fn(async () => "accepted" as const);
  const unused = async (): Promise<never> => { throw new Error("Unexpected runtime operation."); };
  const getByName = vi.fn(() => ({ supportsMigrationCheckpoint: supports, requestMigrationCheckpoint: checkpoint,
    destroyInstance: unused, invoke: unused, smokeHealth: unused }));
  const source: WorkerEnvironmentSource = { CF_VERSION_METADATA: { id: identity.workerVersion }, RUNNER_CONTAINER: { getByName },
    RUNNER_CONTAINER_SMOKE: { getByName }, BUNDLES: { put: unused, get: unused }, USER_RUNNER: { getByName: () => ({ bindUser: unused, deleteHostedUserData: unused, publishHostedPrivateMedia: unused, ensureRuntimeProcessingForUser: unused, runnerStatus: unused }) } };
  const stop = vi.fn(async () => { sql.exec("UPDATE runner_meta SET active_attempt_id = NULL, active_runner_container_name = NULL"); });
  const drained = vi.fn(async () => true);
  const runner = { stopLegacyRuntimeForMigration: stop, legacyRuntimeUploadsDrained: drained };
  canonical.command.mockReset().mockResolvedValue({ member: { ...identity, migrationPhase: "quiescing" } });
  const object = new UserRunnerDurableObject(state, source, runner as never);
  return { sql, values, state, source, supports, checkpoint, getByName, stop, drained, object };
}

describe("conditional member checkpoint handoff", () => {
  it("leaves an old busy process live until its image supports managed checkpointing", async () => {
    const h = harness(); h.supports.mockResolvedValue(false);
    expect(await h.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: false, checkpointStatus: null });
    expect(h.values.has("runtime-migration-freeze:v1")).toBe(false);
    expect((await h.object.inspectPostgresMigration()).freeze.phase).toBeNull();
    expect(h.checkpoint).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });

  it("drains old direct URLs before persisting a pause", async () => {
    const h = harness();
    h.values.set("workspace-snapshot:r2-put-drain:v1", { schema: "murph.hosted-workspace-snapshot-r2-put-drain.v1",
      userId: identity.userId, drainUntil: new Date(Date.now() + 600_000).toISOString() });
    expect((await h.object.preparePostgresMemberMigration(identity)).quiesced).toBe(false);
    expect(h.supports).not.toHaveBeenCalled(); expect(h.checkpoint).not.toHaveBeenCalled();
    expect(h.values.has("runtime-migration-freeze:v1")).toBe(false);
  });

  it("checkpoints the exact settled target and refuses to stop until its completion clears the attempt", async () => {
    const h = harness();
    expect(await h.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: true, checkpointStatus: "accepted" });
    expect(h.getByName).toHaveBeenCalledWith("synthetic-target");
    expect(h.checkpoint).toHaveBeenCalledExactlyOnceWith({ userId: identity.userId, attemptId: "synthetic-attempt", generation: "7" });
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "quiescing", migrationId: identity.migrationId });
    canonical.command.mockResolvedValue({ member: { ...identity, migrationPhase: "freezing" } });
    expect(await h.object.freezeForPostgresMigration(identity)).toEqual({ frozen: false });
    expect(h.stop).not.toHaveBeenCalled();
    h.sql.exec("UPDATE runner_meta SET active_attempt_id = NULL");
    expect(await h.object.freezeForPostgresMigration(identity)).toEqual({ frozen: true });
    expect(h.stop).toHaveBeenCalledTimes(2);
    expect(h.drained).toHaveBeenCalledOnce();
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "frozen", migrationId: identity.migrationId });
    expect(await h.object.exportPostgresMigrationPage({ section: 0, after: "" })).toMatchObject({ userId: identity.userId, generation: "7" });
  });

  it("rejects stale serving versions and canonical tokens before admission closes", async () => {
    const h = harness();
    await expect(h.object.preparePostgresMemberMigration({ ...identity, workerVersion: "old-version" })).rejects.toThrow("incompatible");
    canonical.command.mockResolvedValue({ member: { ...identity, migrationId: "different-token", migrationPhase: "quiescing" } });
    await expect(h.object.preparePostgresMemberMigration(identity)).rejects.toThrow("identity changed");
    expect(h.values.has("runtime-migration-freeze:v1")).toBe(false);
    expect(h.checkpoint).not.toHaveBeenCalled();
  });
});


describe("resumable member handoff continuation", () => {
  it("waits on unsupported busy code, then checkpoints, freezes, imports bounded pages and activates on retry", async () => {
    const h = harness();
    let phase = "quiescing";
    let section = 0;
    let imported = false;
    const operations: string[] = [];
    canonical.command.mockImplementation(async ({ command }) => {
      operations.push(command.operation);
      expect(command.objectId).toBe(identity.objectId);
      if (command.operation === "read_object") return { object: { completedAt: imported ? "synthetic-complete" : null, nextCursor: { section, after: "" } } };
      if (command.operation === "freeze_member") phase = "freezing";
      if (command.operation === "import_member") {
        expect(phase === "freezing" || phase === "importing").toBe(true);
        expect(command.page.cursor.section).toBe(section);
        expect(command.page.userId).toBe(identity.userId);
        expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "frozen" });
        phase = "importing"; imported = command.page.next === null; section++;
        return { object: { completedAt: imported ? "synthetic-complete" : null } };
      }
      if (command.operation === "activate_member") { expect(imported).toBe(true); phase = "postgres"; }
      return { member: { ...identity, migrationPhase: phase } };
    });
    const advance = () => advanceRuntimeMemberMigration({ source: h.source, stub: h.object, identity });
    h.supports.mockResolvedValue(false);
    expect(await advance()).toEqual({ pending: "readiness" });
    expect(operations).not.toContain("freeze_member");
    expect(h.stop).not.toHaveBeenCalled();
    h.supports.mockResolvedValue(true);
    expect(await advance()).toEqual({ pending: "checkpoint", checkpointStatus: "accepted" });
    expect(operations).not.toContain("freeze_member");
    h.sql.exec("UPDATE runner_meta SET active_attempt_id = NULL");
    for (let i = 0; i < 4; i++) await advance();
    expect(phase).toBe("importing");
    expect((await advance())).toMatchObject({ member: { migrationPhase: "postgres" } });
    expect((await advance())).toMatchObject({ member: { migrationPhase: "postgres" } });
    expect(operations.filter(op => op === "import_member")).toHaveLength(4);
    expect(h.stop).toHaveBeenCalledTimes(2);
  });
});
