import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerContainer } from "../src/runner-container.ts";
import { RunnerSlotBindingStore } from "../src/runner-slot-binding.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { buildHostedRunnerJobRuntimeConfig } from "../src/runner-env.ts";
import type { HostedExecutionWorkspaceInvocationJobInput } from "../src/runner-job-transport.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/runtime-owner-completion.ts", () => ({ recordHostedRuntimeOwnerCompletion: vi.fn() }));
const userId = "member-native-proof";
const target = `runner--v-release_1--${"1".repeat(32)}`;

function harness() {
  const sql = createTestSqlStorage();
  const binding = new RunnerSlotBindingStore(sql);
  const slot = { slotName: target, releaseId: "release_1", region: "GLOBAL" as const };
  binding.initialize(slot);
  binding.bind({ ...slot, userId, claimId: "standby-claim-11111111-1111-4111-8111-111111111111" });
  const pending: Promise<unknown>[] = [];
  const create = () => new RunnerContainer({
    id: { name: target }, storage: { sql }, waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  }, { CF_VERSION_METADATA: { id: "release_1" } });
  return { create, pending };
}

function job(attemptId = "attempt-a", generation = "1"): HostedExecutionWorkspaceInvocationJobInput {
  return { kind: "workspace-invocation", request: {
    attemptId, leaseGeneration: generation, userId, workspaceVersion: "0", workspace: null, runnerIdleTtlMs: 54_000,
  }, runtime: buildHostedRunnerJobRuntimeConfig({ forwardedEnv: {}, runnerSecrets: {} }) };
}

describe("native supervised invocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "authorized", owner: {
      userId, attemptId: "attempt-a", generation: "1", phase: "active", workspaceVersion: "0", processingMode: "default",
      allocationId: "standby-claim-11111111-1111-4111-8111-111111111111", runnerContainerName: target,
      customInferenceEnvelope: null, platformAiUsageAllowed: true, startedAt: null, acceptedAt: null, completedAt: null,
      failureCount: 0, lastErrorCode: null,
    } });
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockResolvedValue(false);
  });

  it("persists completion before its acknowledgment and does not rerun it after eviction", async () => {
    const { create, pending } = harness();
    const container = create();
    const invoke = vi.spyOn(container, "invoke").mockResolvedValue({ status: "idle", immediateRecheckRequested: true });
    vi.mocked(recordHostedRuntimeOwnerCompletion).mockRejectedValue(new Error("synthetic lost completion acknowledgment"));
    await expect(container.startSupervisedInvocation({ userId, job: job() })).resolves.toEqual({ accepted: true });
    await Promise.all(pending);
    expect(invoke).toHaveBeenCalledTimes(1);
    const recovered = create();
    const replay = vi.spyOn(recovered, "invoke");
    expect(await recovered.readSupervisedInvocation({ userId })).toEqual({ attemptId: "attempt-a", generation: "1", state: "completed", immediateRecheckRequested: true });
    await recovered.startSupervisedInvocation({ userId, job: job() });
    expect(replay).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous launch receipt rather than executing again after eviction", async () => {
    const { create, pending } = harness();
    const container = create();
    vi.spyOn(container, "invoke").mockRejectedValue(new Error("synthetic launch transport loss"));
    await container.startSupervisedInvocation({ userId, job: job() });
    await Promise.all(pending);
    const recovered = create();
    const replay = vi.spyOn(recovered, "invoke");
    await recovered.startSupervisedInvocation({ userId, job: job() });
    expect(replay).not.toHaveBeenCalled();
    await expect(recovered.startSupervisedInvocation({ userId, job: job("attempt-b", "2") })).rejects.toThrow("unresolved");
  });

  it("releases the retained assignment only after the native invocation settles", async () => {
    const { create, pending } = harness();
    const container = create();
    let finish!: (result: { status: "idle" }) => void;
    vi.spyOn(container, "invoke").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await container.startSupervisedInvocation({ userId, job: job() });
    expect(recordHostedRuntimeOwnerCompletion).not.toHaveBeenCalled();
    await container.recordSupervisedRuntimeCompletion({ userId, attemptId: "attempt-a", generation: "1", result: { status: "idle" } });
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenLastCalledWith(expect.not.objectContaining({ settledRunnerContainerName: expect.anything() }));
    finish({ status: "idle" });
    await Promise.all(pending);
    expect(recordHostedRuntimeOwnerCompletion).toHaveBeenLastCalledWith(expect.objectContaining({
      attemptId: "attempt-a", generation: "1", settledRunnerContainerName: target,
    }));
  });

  it("rejects revoked or mismatched workspace authority before registering execution", async () => {
    const { create } = harness();
    const container = create();
    const invoke = vi.spyOn(container, "invoke");
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "blocked", owner: null });
    await expect(container.startSupervisedInvocation({ userId, job: job() })).rejects.toThrow("stale");
    expect(await container.readSupervisedInvocation({ userId })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
