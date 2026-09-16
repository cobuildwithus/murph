import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAdmittedLegacyUserRunner } from "../src/legacy-runtime-admission.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { UserRunnerDurableObject } from "../src/worker/user-runner-durable-object.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { handleRuntimeEnsureProcessingRoute } from "../src/worker/route-handlers/runtime-control.ts";
import { handleUserDataDeleteRoute } from "../src/worker/route-handlers/user-data-delete.ts";
import { mapWorkerRouteError } from "../src/worker/errors.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/runtime-processing.ts", () => ({ ensurePostgresRuntimeProcessing: vi.fn(async () => null) }));
const userId = "synthetic-admission-member";
const objectId = "a".repeat(64);
function harness() {
  const unused = async (): Promise<never> => { throw new Error("Unexpected execution operation."); };
  const getByName = vi.fn(() => ({ bindUser: unused, deleteHostedUserData: unused, publishHostedPrivateMedia: unused, ensureRuntimeProcessingForUser: unused, runnerStatus: unused }));
  const source: WorkerEnvironmentSource = { HOSTED_RUNTIME_POSTGRES_ENABLED: "true", CF_VERSION_METADATA: { id: "synthetic-version" },
    USER_RUNNER: { idFromName: vi.fn(() => ({ toString: () => objectId })), getByName },
    BUNDLES: { put: unused, get: unused }, RUNNER_CONTAINER: { getByName: () => ({ destroyInstance: unused, invoke: unused, smokeHealth: unused }) },
    RUNNER_CONTAINER_SMOKE: { getByName: () => ({ destroyInstance: unused, invoke: unused, smokeHealth: unused }) },
  };
  const sql = createTestSqlStorage();
  sql.exec("DROP TABLE runner_meta");
  const state: DurableObjectStateLike = { id: { toString: () => objectId }, storage: { sql,
    get: async () => undefined, put: vi.fn(async () => {}), delete: vi.fn(async () => false),
    getAlarm: async () => null, setAlarm: vi.fn(async () => {}), deleteAlarm: vi.fn(async () => {}),
    list: async () => new Map(),
  }, waitUntil: vi.fn() };
  return { source, getByName, state, sql };
}

describe("durable legacy materialization admission", () => {
  beforeEach(() => { vi.mocked(commandHostedRuntimeOwner).mockReset().mockResolvedValue({ cutover: "legacy", status: "observed", owner: null }); });

  it("waits for intent acknowledgement before obtaining a legacy stub", async () => {
    const h = harness(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async () => { await pending; return { cutover: "legacy", status: "observed", owner: null }; });
    const getting = resolveAdmittedLegacyUserRunner(h.source, userId);
    await vi.waitFor(() => expect(commandHostedRuntimeOwner).toHaveBeenCalledOnce());
    expect(h.getByName).not.toHaveBeenCalled();
    release(); await getting;
    expect(h.getByName).toHaveBeenCalledExactlyOnceWith(userId);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledWith(expect.objectContaining({ userId, command: { operation: "resolve_legacy", objectId, workerVersion: "synthetic-version" } }));
  });

  it("does not instantiate a source after routing changes or an admission reply is lost", async () => {
    const h = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: null });
    await expect(resolveAdmittedLegacyUserRunner(h.source, userId)).rejects.toThrow("handoff");
    vi.mocked(commandHostedRuntimeOwner).mockRejectedValue(new Error("synthetic lost response"));
    await expect(resolveAdmittedLegacyUserRunner(h.source, userId)).rejects.toThrow("lost response");
    expect(h.getByName).not.toHaveBeenCalled();
  });

  it("rechecks a direct source RPC without initializing an empty object's schema", async () => {
    const h = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: null });
    const object = new UserRunnerDurableObject(h.state, h.source);
    await expect(object.bindUser(userId)).rejects.toThrow("handoff");
    expect(h.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()).toEqual([]);
    expect(h.state.storage.put).not.toHaveBeenCalled();
    expect(h.state.storage.setAlarm).not.toHaveBeenCalled();
  });

  it("registers once per source activation and retries an unknown acknowledgement", async () => {
    const h = harness();
    const bindUser = vi.fn(async () => ({ userId }));
    const object = new UserRunnerDurableObject(h.state, h.source, { bindUser } as never);
    vi.mocked(commandHostedRuntimeOwner).mockRejectedValueOnce(new Error("synthetic unknown registration"));
    await expect(object.bindUser(userId)).rejects.toThrow("unknown registration");
    expect(bindUser).not.toHaveBeenCalled();
    await object.bindUser(userId); await object.bindUser(userId);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(2);
    expect(bindUser).toHaveBeenCalledTimes(2);
  });

  it("defers direct deletion rather than initialize or erase a source after closure", async () => {
    const h = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: null });
    const deletion = vi.fn(async () => ({ ok: true }));
    const object = new UserRunnerDurableObject(h.state, h.source, { deleteHostedUserData: deletion } as never);
    expect(await object.deleteHostedUserData(userId)).toMatchObject({ ok: false, reason: "runtime_migration_pending" });
    expect(deletion).not.toHaveBeenCalled();
  });

  it.each(["signed", "oidc"])("returns normal processing retry when a %s request's legacy route changes before first use", async authorization => {
    const h = harness();
    const url = new URL(`https://synthetic.example.test/internal/users/${userId}/runtime/ensure-processing`);
    const request = new Request(url, { method: "POST", headers: authorization === "oidc" ? { authorization: "Bearer synthetic-token" } : {},
      body: JSON.stringify({ orchestrationAttemptId: "synthetic-orchestration" }) });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: null });
    const response = await handleRuntimeEnsureProcessingRoute({ env: h.source,
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()), url, request }, userId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "retry_later", retryAt: expect.any(String) });
    expect(h.getByName).not.toHaveBeenCalled();
  });

  it("returns retryable deletion without touching either backend when source admission changes", async () => {
    const h = harness(); const url = new URL(`https://synthetic.example.test/internal/users/${userId}/data`);
    const request = new Request(url, { method: "DELETE" });
    vi.mocked(commandHostedRuntimeOwner)
      .mockResolvedValueOnce({ cutover: "legacy", status: "observed", owner: null })
      .mockResolvedValueOnce({ cutover: "postgres", status: "observed", owner: null });
    const response = await handleUserDataDeleteRoute({ env: h.source, request, url,
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()) }, userId).catch(error => mapWorkerRouteError(request, error));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(await response.json()).toEqual({ code: "runtime_migration_pending", retryAfterSeconds: 3 });
    expect(h.getByName).not.toHaveBeenCalled();
  });
});
