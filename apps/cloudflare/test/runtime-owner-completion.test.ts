import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHostedExecutionStructuredLogRecord, emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import type { HostedRuntimeOwnerResponse } from "@murphai/hosted-execution/runtime-owner";
import { recordHostedRuntimeOwnerCompletion } from "../src/runtime-owner-completion.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("@murphai/hosted-execution", async () => ({
  ...await vi.importActual<typeof import("@murphai/hosted-execution")>("@murphai/hosted-execution"),
  emitHostedExecutionStructuredLog: vi.fn(),
}));
const input = { source: createHostedExecutionTestEnv(), userId: "synthetic-member", attemptId: "attempt-a", generation: "1", result: {} };
const nonUpdatedStatuses = ["claimed", "existing", "blocked", "stale", "observed", "authorized"] as const satisfies readonly Exclude<HostedRuntimeOwnerResponse["status"], "updated">[];

describe("native completion publication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "updated", owner: null });
    vi.mocked(emitHostedExecutionStructuredLog).mockImplementation(buildHostedExecutionStructuredLogRecord);
  });

  it("publishes settled completion and its scheduling hint in one request", async () => {
    const call = { ...input, settledRunnerContainerName: "synthetic-target", result: { immediateRecheckRequested: true as const } };
    expect(await recordHostedRuntimeOwnerCompletion(call)).toBe(true);
    expectOriginalCommand(call);
    expectObservation("native_invocation", "updated");
  });

  it("cannot claim native settlement from an early runtime callback", async () => {
    expect(await recordHostedRuntimeOwnerCompletion(input)).toBe(true);
    expectOriginalCommand(input);
    expectObservation("runtime_callback", "updated");
  });

  describe.each([
    { caller: "runtime_callback", settledRunnerContainerName: undefined },
    { caller: "native_invocation", settledRunnerContainerName: "synthetic-target" },
  ] as const)("$caller observations", ({ caller, settledRunnerContainerName }) => {
    const call = { ...input, settledRunnerContainerName };

    it.each(nonUpdatedStatuses)("does not claim completion for %s", async (status) => {
      vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status, owner: null });
      expect(await recordHostedRuntimeOwnerCompletion(call)).toBe(false);
      expectOriginalCommand(call);
      expectObservation(caller, "not_updated");
    });

    it("preserves the exact thrown value without logging private failure fields", async () => {
      const failure = Object.assign(new Error("synthetic-private-error"), {
        owner: "synthetic-private-owner", result: { value: "synthetic-private-result" },
        target: "synthetic-private-target", generation: "81347",
      });
      vi.mocked(commandHostedRuntimeOwner).mockRejectedValueOnce(failure);
      await expect(recordHostedRuntimeOwnerCompletion(call)).rejects.toBe(failure);
      expectOriginalCommand(call);
      expectObservation(caller, "unconfirmed");
      expect(JSON.stringify(vi.mocked(emitHostedExecutionStructuredLog).mock.calls)).not.toContain("synthetic-private");
    });

    it.each(["updated", "stale", "unconfirmed"] as const)("isolates logger failure after %s", async (outcome) => {
      const failure = { privateError: "synthetic-original-failure" };
      vi.mocked(emitHostedExecutionStructuredLog).mockImplementation(() => { throw new Error("synthetic logger failure"); });
      if (outcome === "unconfirmed") {
        vi.mocked(commandHostedRuntimeOwner).mockRejectedValueOnce(failure);
        await expect(recordHostedRuntimeOwnerCompletion(call)).rejects.toBe(failure);
      } else {
        vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce({ cutover: "postgres", status: outcome, owner: null });
        expect(await recordHostedRuntimeOwnerCompletion(call)).toBe(outcome === "updated");
      }
      expectOriginalCommand(call);
      expectObservation(caller, outcome === "stale" ? "not_updated" : outcome);
    });

    it.each(["updated", "stale", "unconfirmed"] as const)("emits nothing before a pending command settles as %s", async (outcome) => {
      let resolve!: (value: HostedRuntimeOwnerResponse) => void;
      let reject!: (error: unknown) => void;
      vi.mocked(commandHostedRuntimeOwner).mockReturnValueOnce(new Promise<HostedRuntimeOwnerResponse>((done, fail) => {
        resolve = done;
        reject = fail;
      }));
      const pending = recordHostedRuntimeOwnerCompletion(call);
      expectOriginalCommand(call);
      expect(emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
      if (outcome === "unconfirmed") {
        const failure = new Error("synthetic response loss");
        const rejected = expect(pending).rejects.toBe(failure);
        reject(failure);
        await rejected;
      } else {
        resolve({ cutover: "postgres", status: outcome, owner: null });
        expect(await pending).toBe(outcome === "updated");
      }
      expectOriginalCommand(call);
      expectObservation(caller, outcome === "stale" ? "not_updated" : outcome);
    });
  });

  it.each(["attempt-a", "attempt-b"])("correlates a native acknowledgment only to its exact attempt: %s", async (attemptId) => {
    vi.mocked(commandHostedRuntimeOwner)
      .mockResolvedValueOnce({ cutover: "postgres", status: "stale", owner: null })
      .mockResolvedValueOnce({ cutover: "postgres", status: "updated", owner: null });
    expect(await recordHostedRuntimeOwnerCompletion(input)).toBe(false);
    expectObservation("runtime_callback", "not_updated");
    expect(await recordHostedRuntimeOwnerCompletion({ ...input, attemptId,
      generation: attemptId === input.attemptId ? input.generation : "2",
      settledRunnerContainerName: "synthetic-target" })).toBe(true);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(2);
    const entries = vi.mocked(emitHostedExecutionStructuredLog).mock.calls.map(([entry]) => entry);
    expect(entries.map(entry => entry.details)).toEqual([
      { runtimeCompletionCaller: "runtime_callback", runtimeCompletionOutcome: "not_updated", workspaceAttemptId: "attempt-a" },
      { runtimeCompletionCaller: "native_invocation", runtimeCompletionOutcome: "updated", workspaceAttemptId: attemptId },
    ]);
    const exactOuterAcknowledgments = entries.filter(entry => entry.userId === input.userId
      && entry.details?.workspaceAttemptId === input.attemptId
      && entry.details.runtimeCompletionCaller === "native_invocation"
      && entry.details.runtimeCompletionOutcome === "updated");
    expect(exactOuterAcknowledgments).toHaveLength(attemptId === input.attemptId ? 1 : 0);
  });

  it.each(["updated", "stale"] as const)("omits private source, result, owner, target and generation fields for %s", async (status) => {
    const call = { ...input, generation: "482761", settledRunnerContainerName: "synthetic-private-target",
      source: { ...input.source, PRIVATE_SYNTHETIC_VALUE: "synthetic-private-source" },
      result: { immediateRecheckRequested: true as const, privateResult: "synthetic-private-result" } };
    const response: HostedRuntimeOwnerResponse & { privateResult: string } = {
      cutover: "postgres", status, privateResult: "synthetic-private-response",
      owner: {
        userId: "synthetic-private-owner", attemptId: "attempt-private-owner", generation: "934872",
        phase: "active", processingMode: "default", allocationId: "synthetic-private-allocation",
        runnerContainerName: "synthetic-private-owner-target", workspaceVersion: "18",
        customInferenceEnvelope: "synthetic-private-envelope", platformAiUsageAllowed: true,
        startedAt: null, acceptedAt: null, completedAt: null, failureCount: 0,
        lastErrorCode: "synthetic-private-owner-error",
      },
    };
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValueOnce(response);
    expect(await recordHostedRuntimeOwnerCompletion(call)).toBe(status === "updated");
    expectOriginalCommand(call);
    expectObservation("native_invocation", status === "updated" ? "updated" : "not_updated");
    const [entry] = vi.mocked(emitHostedExecutionStructuredLog).mock.calls[0]!;
    const serialized = JSON.stringify([entry, buildHostedExecutionStructuredLogRecord(entry)]);
    for (const excluded of ["synthetic-private", "attempt-private-owner", "482761", "934872"]) {
      expect(serialized).not.toContain(excluded);
    }
  });
});

function expectOriginalCommand(call: Parameters<typeof recordHostedRuntimeOwnerCompletion>[0]) {
  expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: call.source, userId: call.userId,
    command: { operation: "complete", attemptId: call.attemptId, generation: call.generation,
      settledRunnerContainerName: call.settledRunnerContainerName ?? null,
      immediateRecheckRequested: call.result.immediateRecheckRequested === true } });
  expect(vi.mocked(commandHostedRuntimeOwner).mock.calls[0]![0].source).toBe(call.source);
}

function expectObservation(caller: "runtime_callback" | "native_invocation", outcome: "updated" | "not_updated" | "unconfirmed") {
  const expected = {
    component: "container", level: "info", phase: "checkpoint",
    message: "Hosted runtime canonical completion call settled.", userId: input.userId,
    details: { runtimeCompletionCaller: caller, runtimeCompletionOutcome: outcome, workspaceAttemptId: input.attemptId },
  };
  expect(emitHostedExecutionStructuredLog).toHaveBeenCalledExactlyOnceWith(expected);
  const [entry] = vi.mocked(emitHostedExecutionStructuredLog).mock.calls[0]!;
  const record = buildHostedExecutionStructuredLogRecord(entry);
  expect(record.details).toEqual(expected.details);
  expect(record.userId).toBeNull();
  expect(record.userIdPresent).toBe(true);
  expect(vi.mocked(commandHostedRuntimeOwner).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(emitHostedExecutionStructuredLog).mock.invocationCallOrder[0]!);
}
