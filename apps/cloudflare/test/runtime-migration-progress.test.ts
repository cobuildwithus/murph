import { createHash } from "node:crypto";
import type { LegacyRuntimeExportCursor } from "@murphai/hosted-execution/runtime-migration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressRuntimeMigrationForMember } from "../src/runtime-migration-progress.ts";
import { commandHostedRuntimeMigration } from "../src/runtime-migration-client.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: vi.fn() }));
const caller = "synthetic-first-use";
const callerObject = "a".repeat(64);
const selectedObject = "b".repeat(64);
const gate = { phase: "rolling", namespaceId: "synthetic_namespace", workerVersion: "synthetic_version",
  namespaceProbeId: callerObject, creationClosedAt: "synthetic-closed", inventorySealedAt: "synthetic-sealed" };
function harness() {
  const unused = async (): Promise<never> => { throw new Error("Ordinary legacy execution is forbidden."); };
  const stub = {
    inspectPostgresMigration: vi.fn(async () => ({ kind: "observed" as const, schemaVersion: null,
      userId: null as string | null, generation: "0", activeAttemptId: null, activeRunnerContainerName: null,
      workspaceVersion: null, snapshotPutDrainUntil: null, replicaPendingWrites: 0,
      replicaRecoveryDrainUntil: null, managedSnapshotPendingUploads: 0, observedAt: "2026-09-16T00:00:00.000Z",
      freeze: { phase: null, pendingOperations: 0 } })),
    preparePostgresMemberMigration: vi.fn(async () => ({ quiesced: false, checkpointStatus: null })),
    freezeForPostgresMigration: vi.fn(async () => ({ frozen: false })),
    freezeEmptyForPostgresMigration: vi.fn(async () => ({ frozen: true })),
    exportPostgresMigrationPage: vi.fn(async (cursor: LegacyRuntimeExportCursor) => ({ schema: "murph.legacy-runtime-export.v1" as const,
      userId: null, generation: "0", cursor,
      next: cursor.section < 3 ? { section: cursor.section + 1, after: "" } : null, records: [], hash: "c".repeat(64) })),
    bindUser: unused, deleteHostedUserData: unused, publishHostedPrivateMedia: unused,
    ensureRuntimeProcessingForUser: unused, runnerStatus: unused,
  };
  const namespace = { idFromName: vi.fn(() => ({ toString: () => callerObject })),
    idFromString: vi.fn((id: string) => ({ toString: () => id })), get: vi.fn(() => stub), getByName: vi.fn(() => stub) };
  const source = { ...createHostedExecutionTestEnv(), HOSTED_RUNTIME_POSTGRES_ENABLED: "true", CF_VERSION_METADATA: { id: gate.workerVersion }, USER_RUNNER: namespace };
  const run = (duration = 1_000) => progressRuntimeMigrationForMember({ source, userId: caller, budget: { deadlineAtMs: Date.now() + duration } });
  return { source, namespace, stub, run };
}
describe("bounded automatic migration progress", () => {
  beforeEach(() => {
    let nextCursor: LegacyRuntimeExportCursor | null = { section: 0, after: "" };
    vi.mocked(commandHostedRuntimeMigration).mockReset().mockImplementation(async ({ command }) => {
      if (command.operation === "status") return { gate };
      if (command.operation === "enroll_sources") return { enrolled: 0 };
      if (command.operation === "select_first_use") return { objectId: selectedObject };
      if (command.operation === "read_member") return { member: { migrationPhase: "legacy" } };
      if (command.operation === "read_object") return { object: { completedAt: nextCursor === null ? "synthetic-complete" : null, nextCursor } };
      if (command.operation === "import_empty") {
        nextCursor = command.page.next;
        return { object: { completedAt: nextCursor === null ? "synthetic-complete" : null, nextCursor } };
      }
      if (command.operation === "activate_empty") return { done: true };
      throw new Error("Unexpected automatic migration command.");
    });
  });
  afterEach(() => vi.useRealTimers());

  it("does no migration work on a deployment without mixed-runtime capability", async () => {
    const h = harness(); h.source.HOSTED_RUNTIME_POSTGRES_ENABLED = "false";
    await h.run(); expect(commandHostedRuntimeMigration).not.toHaveBeenCalled();
    expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it.each(["legacy", "draining", "postgres"])("does not start an automatic campaign from %s", async phase => {
    const h = harness(); vi.mocked(commandHostedRuntimeMigration).mockResolvedValue({ gate: { ...gate, phase } });
    await h.run();
    expect(commandHostedRuntimeMigration).toHaveBeenCalledTimes(1);
    expect(h.namespace.idFromName).not.toHaveBeenCalled();
    expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it("waits for the operator's closed sealed census before first-use handoff", async () => {
    const h = harness(); vi.mocked(commandHostedRuntimeMigration).mockResolvedValue({ gate: { ...gate, inventorySealedAt: null } });
    await h.run(); expect(h.namespace.get).not.toHaveBeenCalled();
    expect(commandHostedRuntimeMigration).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed namespace binding before enrollment or source access", async () => {
    const h = harness(); h.namespace.idFromName.mockReturnValue({ toString: () => "e".repeat(64) });
    await expect(h.run()).rejects.toThrow("serving identity changed");
    expect(h.namespace.get).not.toHaveBeenCalled();
    expect(commandHostedRuntimeMigration).toHaveBeenCalledTimes(1);
  });
  it("continues first use on a later compatible Worker with the original namespace", async () => {
    const h = harness(); h.source.CF_VERSION_METADATA.id = "synthetic-compatible-release";
    await h.run();
    expect(commandHostedRuntimeMigration).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({
      operation: "enroll_sources", namespaceId: gate.namespaceId, workerVersion: "synthetic-compatible-release" }) }));
    expect(h.stub.exportPostgresMigrationPage).toHaveBeenCalledTimes(4);
  });
  it("does not touch a source after losing the enrollment acknowledgement", async () => {
    const h = harness(); vi.mocked(commandHostedRuntimeMigration).mockResolvedValueOnce({ gate }).mockRejectedValueOnce(new Error("synthetic enrollment reply lost"));
    await expect(h.run()).rejects.toThrow("reply lost"); expect(h.namespace.get).not.toHaveBeenCalled();
  });
  it("resumes the durable selection with its own member and token, rather than pausing the caller", async () => {
    const h = harness(); const observation = await h.stub.inspectPostgresMigration();
    h.stub.inspectPostgresMigration.mockResolvedValue({ ...observation, userId: "synthetic-selected-member" });
    await h.run(); await h.run();
    expect(h.namespace.idFromString.mock.calls).toEqual([[selectedObject], [selectedObject]]);
    expect(h.namespace.getByName).not.toHaveBeenCalled();
    expect(commandHostedRuntimeMigration).toHaveBeenCalledWith(expect.objectContaining({ command: { operation: "enroll_sources",
      namespaceId: gate.namespaceId, workerVersion: gate.workerVersion, bindings: [{ userId: caller, objectId: callerObject }] } }));
    const migrationId = createHash("sha256").update(JSON.stringify([gate.namespaceId, selectedObject, "synthetic-selected-member"])).digest("hex");
    expect(h.stub.preparePostgresMemberMigration).toHaveBeenCalledWith({ namespaceId: gate.namespaceId,
      workerVersion: gate.workerVersion, objectId: selectedObject, userId: "synthetic-selected-member", migrationId });
    expect(h.stub.freezeForPostgresMigration).not.toHaveBeenCalled();
  });
  it("rejects a nonadvancing canonical empty cursor without another export or activation", async () => {
    const h = harness();
    const command = vi.mocked(commandHostedRuntimeMigration).getMockImplementation()!;
    vi.mocked(commandHostedRuntimeMigration).mockImplementation(async input => input.command.operation === "import_empty"
      ? { object: { completedAt: null, nextCursor: { section: 0, after: "" } } }
      : command(input));
    await expect(h.run()).rejects.toThrow("cursor did not advance");
    expect(h.stub.exportPostgresMigrationPage).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeMigration).mock.calls.some(([input]) => input.command.operation === "activate_empty")).toBe(false);
  });

  it("resumes a committed empty page after losing its acknowledgement", async () => {
    const h = harness();
    const command = vi.mocked(commandHostedRuntimeMigration).getMockImplementation()!;
    let loseReply = true;
    vi.mocked(commandHostedRuntimeMigration).mockImplementation(async input => {
      const result = await command(input);
      if (input.command.operation === "import_empty" && loseReply) {
        loseReply = false;
        throw new Error("synthetic import reply lost");
      }
      return result;
    });
    await expect(h.run()).rejects.toThrow("import reply lost");
    expect(h.stub.exportPostgresMigrationPage).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeMigration).mock.calls.some(([input]) => input.command.operation === "activate_empty")).toBe(false);
    await expect(h.run()).resolves.toEqual({ done: true });
    expect(h.stub.exportPostgresMigrationPage.mock.calls.map(([cursor]) => cursor.section)).toEqual([0, 1, 2, 3]);
  });

  it("does not continue or activate after an import outlives the shared request deadline", async () => {
    vi.useFakeTimers(); const h = harness();
    const command = vi.mocked(commandHostedRuntimeMigration).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(commandHostedRuntimeMigration).mockImplementation(async input => {
      const result = await command(input);
      if (input.command.operation === "import_empty") await held;
      return result;
    });
    const running = h.run(25);
    const rejected = expect(running).rejects.toThrow("command budget timed out");
    await vi.advanceTimersByTimeAsync(26); await rejected;
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(h.stub.exportPostgresMigrationPage).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeMigration).mock.calls.some(([input]) => input.command.operation === "activate_empty")).toBe(false);
  });

  it("starts no later handoff step after a timed-out freeze eventually acknowledges", async () => {
    vi.useFakeTimers(); const h = harness(); let release!: (value: { frozen: boolean }) => void;
    h.stub.freezeEmptyForPostgresMigration.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const running = h.run(25);
    const rejected = expect(running).rejects.toThrow("command budget timed out");
    await vi.advanceTimersByTimeAsync(26); await rejected;
    expect(h.stub.freezeEmptyForPostgresMigration).toHaveBeenCalledOnce();
    release({ frozen: true }); await Promise.resolve(); await Promise.resolve();
    expect(h.stub.exportPostgresMigrationPage).not.toHaveBeenCalled();
    expect(vi.mocked(commandHostedRuntimeMigration).mock.calls.some(([input]) => input.command.operation === "import_empty")).toBe(false);
  });
});
