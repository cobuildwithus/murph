import { advanceRuntimeEmptyMigration, advanceRuntimeMemberMigration } from "../src/worker/route-handlers/runtime-member-migration.ts";
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
  const supports = vi.fn(async (): Promise<"absent" | "ready" | "unsupported"> => "ready");
  const checkpoint = vi.fn(async (): Promise<"absent" | "accepted" | "stale" | "unconfirmed"> => "accepted");
  const unused = async (): Promise<never> => { throw new Error("Unexpected runtime operation."); };
  const getByName = vi.fn(() => ({ supportsMigrationCheckpoint: supports, requestMigrationCheckpoint: checkpoint,
    destroyInstance: unused, invoke: unused, smokeHealth: unused }));
  const source: WorkerEnvironmentSource = { CF_VERSION_METADATA: { id: identity.workerVersion }, RUNNER_CONTAINER: { getByName },
    RUNNER_CONTAINER_SMOKE: { getByName }, BUNDLES: { put: unused, get: unused }, USER_RUNNER: { getByName: () => ({ bindUser: unused, deleteHostedUserData: unused, publishHostedPrivateMedia: unused, ensureRuntimeProcessingForUser: unused, runnerStatus: unused }) } };
  const stop = vi.fn(async () => { sql.exec("UPDATE runner_meta SET active_attempt_id = NULL, active_runner_container_name = NULL"); });
  const drained = vi.fn(async () => true);
  const deletion = vi.fn(async () => { values.clear(); sql.exec("DELETE FROM runner_meta"); return { ok: true }; });
  const runner = { stopLegacyRuntimeForMigration: stop, legacyRuntimeUploadsDrained: drained, deleteHostedUserData: deletion };
  canonical.command.mockReset().mockResolvedValue({ member: { ...identity, migrationPhase: "quiescing" } });
  const object = new UserRunnerDurableObject(state, source, runner as never);
  return { sql, values, state, source, supports, checkpoint, getByName, stop, drained, deletion, object, runner };
}

describe("conditional member checkpoint handoff", () => {
  it("leaves an old busy process live until its image supports managed checkpointing", async () => {
    const h = harness(); h.supports.mockResolvedValue("unsupported");
    expect(await h.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: false, checkpointStatus: null });
    expect(h.values.has("runtime-migration-freeze:v1")).toBe(false);
    expect((await h.object.inspectPostgresMigration()).freeze.phase).toBeNull();
    expect(h.checkpoint).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });

  it("quiesces a recorded attempt whose process is gone instead of holding the member on readiness", async () => {
    const h = harness(); h.supports.mockResolvedValue("absent"); h.checkpoint.mockResolvedValue("absent");
    // The stopped process cannot be executing the recorded attempt, so the
    // handoff continues to the freeze, which owns the exact-target stop.
    expect(await h.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: true, checkpointStatus: "absent" });
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "quiescing" });
    const unreachable = harness(); unreachable.supports.mockResolvedValue("unsupported");
    expect(await unreachable.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: false, checkpointStatus: null });
    expect(unreachable.values.has("runtime-migration-freeze:v1")).toBe(false);
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

  it("reconciles a recorded attempt whose exact target reports no invocation instead of waiting forever", async () => {
    const h = harness();
    expect(await h.object.preparePostgresMemberMigration(identity)).toEqual({ quiesced: true, checkpointStatus: "accepted" });
    canonical.command.mockResolvedValue({ member: { ...identity, migrationPhase: "freezing" } });
    h.checkpoint.mockResolvedValue("unconfirmed" as never);
    expect(await h.object.freezeForPostgresMigration(identity)).toEqual({ frozen: false });
    expect(h.stop).not.toHaveBeenCalled();
    h.checkpoint.mockResolvedValue("absent" as never);
    expect(await h.object.freezeForPostgresMigration(identity)).toEqual({ frozen: true });
    expect(h.stop).toHaveBeenCalledTimes(2);
    expect(h.drained).toHaveBeenCalledOnce();
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "frozen", migrationId: identity.migrationId });
  });

  it("preserves a frozen source and token after eviction into a compatible later release", async () => {
    const h = harness(); await h.object.preparePostgresMemberMigration(identity);
    h.sql.exec("UPDATE runner_meta SET active_attempt_id = NULL");
    canonical.command.mockResolvedValue({ member: { ...identity, migrationPhase: "freezing" } });
    expect(await h.object.freezeForPostgresMigration(identity)).toEqual({ frozen: true });
    const before = await h.object.exportPostgresMigrationPage({ section: 0, after: "" });
    const resumed = new UserRunnerDurableObject(h.state, { ...h.source, CF_VERSION_METADATA: { id: "synthetic-compatible-release" } }, h.runner as never);
    await expect(resumed.freezeForPostgresMigration(identity)).rejects.toThrow("incompatible migration version");
    expect(await resumed.freezeForPostgresMigration({ ...identity, workerVersion: "synthetic-compatible-release" })).toEqual({ frozen: true });
    expect(await resumed.exportPostgresMigrationPage({ section: 0, after: "" })).toEqual(before);
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "frozen", migrationId: identity.migrationId });
    await expect(resumed.bindUser(identity.userId)).rejects.toThrow("frozen");
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
  it.each(["legacy", "pending", "quiescing"])("checkpoints, freezes, imports and activates from %s on retry", async initialPhase => {
    const h = harness();
    let phase = initialPhase;
    let section = 0;
    let imported = false;
    const operations: string[] = [];
    canonical.command.mockImplementation(async ({ command }) => {
      operations.push(command.operation);
      expect(command.objectId).toBe(identity.objectId);
      if (command.operation === "read_object") return { object: { completedAt: imported ? "synthetic-complete" : null, nextCursor: { section, after: "" } } };
      if (command.operation === "quiesce_member") phase = "quiescing";
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
      return { member: { ...identity, migrationId: phase === "legacy" || phase === "pending" ? null : identity.migrationId, migrationPhase: phase } };
    });
    const advance = () => advanceRuntimeMemberMigration({ source: h.source, stub: h.object, identity });
    h.supports.mockResolvedValue("unsupported");
    expect(await advance()).toEqual({ pending: "readiness" });
    expect(operations).not.toContain("freeze_member");
    expect(h.stop).not.toHaveBeenCalled();
    h.supports.mockResolvedValue("ready");
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


describe("handoff continuation after a lost attempt completion", () => {
  it("freezes, imports and activates a member whose recorded attempt has no live process", async () => {
    const h = harness();
    let phase = "legacy";
    let section = 0;
    let imported = false;
    const operations: string[] = [];
    canonical.command.mockImplementation(async ({ command }) => {
      operations.push(command.operation);
      if (command.operation === "read_object") return { object: { completedAt: imported ? "synthetic-complete" : null, nextCursor: { section, after: "" } } };
      if (command.operation === "quiesce_member") phase = "quiescing";
      if (command.operation === "freeze_member") phase = "freezing";
      if (command.operation === "import_member") { phase = "importing"; imported = command.page.next === null; section++; return { object: { completedAt: imported ? "synthetic-complete" : null } }; }
      if (command.operation === "activate_member") { expect(imported).toBe(true); phase = "postgres"; }
      return { member: { ...identity, migrationId: phase === "legacy" ? null : identity.migrationId, migrationPhase: phase } };
    });
    const advance = () => advanceRuntimeMemberMigration({ source: h.source, stub: h.object, identity });
    h.checkpoint.mockResolvedValue("absent" as never);
    const first = await advance();
    expect(first).not.toMatchObject({ pending: "checkpoint" });
    expect(operations).toContain("freeze_member");
    expect(h.stop).toHaveBeenCalled();
    for (let i = 0; i < 8 && phase !== "postgres"; i++) await advance();
    expect(phase).toBe("postgres");
    expect((await advance())).toMatchObject({ member: { migrationPhase: "postgres" } });
  });
});

describe("member deletion and migration ordering", () => {
  it("waits for a pre-admitted deletion before reserving source identity", async () => {
    const h = harness();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const erase = h.deletion.getMockImplementation()!;
    h.deletion.mockImplementation(async () => { await held; return erase(); });
    let phase = "legacy";
    canonical.command.mockImplementation(async ({ command }) => {
      if (command.operation === "quiesce_member") phase = "quiescing";
      return { member: { ...identity, migrationId: phase === "legacy" ? null : identity.migrationId, migrationPhase: phase } };
    });
    const deleting = h.object.deleteHostedUserData(identity.userId);
    await vi.waitFor(() => expect(h.deletion).toHaveBeenCalledOnce());
    const advancing = advanceRuntimeMemberMigration({ source: h.source, stub: h.object, identity });
    try {
      await vi.waitFor(() => expect(canonical.command).toHaveBeenCalled());
      expect(canonical.command.mock.calls.some(([arg]) => arg.command.operation === "quiesce_member")).toBe(false);
    } finally { release(); await deleting; }
    expect(await advancing).toEqual({ pending: "readiness" });
    expect(canonical.command.mock.calls.some(([arg]) => arg.command.operation === "quiesce_member")).toBe(false);
    expect(h.values.has("runtime-migration-freeze:v1")).toBe(false);
  });

  it("keeps deletion closed when canonical reservation commits but its reply is lost", async () => {
    const h = harness(); let reserved = false; let loseReply = true;
    canonical.command.mockImplementation(async ({ command }) => {
      if (command.operation === "quiesce_member") {
        reserved = true;
        if (loseReply) { loseReply = false; throw new Error("synthetic reservation response lost"); }
      }
      return { member: { ...identity, migrationId: reserved ? identity.migrationId : null, migrationPhase: reserved ? "quiescing" : "legacy" } };
    });
    await expect(h.object.preparePostgresMemberMigration(identity)).rejects.toThrow("response lost");
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "quiescing", migrationId: identity.migrationId });
    expect(await h.object.deleteHostedUserData(identity.userId)).toMatchObject({ ok: false, reason: "runtime_migration_pending" });
    expect(h.deletion).not.toHaveBeenCalled();
    expect(await h.object.preparePostgresMemberMigration(identity)).toMatchObject({ quiesced: true, checkpointStatus: "accepted" });
  });

  it("defers a deletion arriving after local closure to durable cleanup retries", async () => {
    const h = harness();
    await h.object.preparePostgresMemberMigration(identity);
    expect(await h.object.deleteHostedUserData(identity.userId)).toEqual({ ok: false,
      reason: "runtime_migration_pending", retryAfterSeconds: 3, userId: identity.userId });
    expect(h.deletion).not.toHaveBeenCalled();
    expect((await h.object.inspectPostgresMigration()).freeze.phase).toBe("quiescing");
  });
});


describe("empty namespace object migration", () => {
  it("freezes, exports and activates a schema-free object in one call without initializing a runner or stopping a container", async () => {
    const h = harness();
    h.sql.exec("DROP TABLE runner_meta"); h.sql.exec("DROP TABLE runner_hosted_media_asset"); h.sql.exec("DROP TABLE runner_schema_meta");
    let section = 0; let completed = false;
    canonical.command.mockImplementation(async ({ command }) => {
      if (command.operation === "status") return { gate: { phase: "rolling", inventorySealedAt: "synthetic-sealed" } };
      if (command.operation === "read_object") return { object: { userId: null, completedAt: completed ? "synthetic-complete" : null, nextCursor: { section, after: "" } } };
      if (command.operation === "activate_empty") { expect(completed).toBe(true); return { done: true, member: { userId: identity.userId, mailboxItemId: "synthetic-wake" } }; }
      if (command.operation !== "import_empty") throw new Error("Unexpected empty migration command.");
      expect(command.page).toMatchObject({ userId: null, generation: "0", records: [], cursor: { section, after: "" } });
      section++; completed = command.page.next === null;
      return { object: { completedAt: completed ? "synthetic-complete" : null, nextCursor: command.page.next } };
    });
    expect(await advanceRuntimeEmptyMigration({ source: h.source, stub: h.object, identity })).toEqual({ done: true, member: { userId: identity.userId, mailboxItemId: "synthetic-wake" } });
    expect(section).toBe(4);
    expect(h.stop).not.toHaveBeenCalled(); expect(h.drained).not.toHaveBeenCalled(); expect(h.checkpoint).not.toHaveBeenCalled();
    expect(h.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()).toEqual([]);
    expect(h.values.get("runtime-migration-freeze:v1")).toMatchObject({ phase: "frozen", migrationId: `empty-${identity.objectId}` });
  });
});
