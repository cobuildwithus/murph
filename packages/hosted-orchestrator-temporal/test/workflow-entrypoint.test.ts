import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeDemand,
} from "../src/index.js";

const continueAsNewError = new Error("continue-as-new");
const condition = vi.fn(async () => undefined);
const continueAsNew = vi.fn(async () => {
  throw continueAsNewError;
});
const defineQuery = vi.fn((name: string) => ({ name, type: "query" }));
const defineSignal = vi.fn((name: string) => ({ name, type: "signal" }));
const patched = vi.fn((_patchId: string) => true);
const setHandler = vi.fn();
const uuid4 = vi.fn(() => "orchestration-attempt-test");
const workflowInfo = vi.fn(() => ({
  continueAsNewSuggested: false,
}));
const proxyActivities = vi.fn(() => ({
  ensureRuntimeProcessing,
  prewarmRuntimeContainer,
  readRuntimeDemand,
}));
const readRuntimeDemand = vi.fn(async (): Promise<HostedRuntimeDemand> => ({
  kind: "idle",
  mailboxLag: [],
  nextWakeAt: null,
  workspace: null,
}));
const ensureRuntimeProcessing = vi.fn();
const prewarmRuntimeContainer = vi.fn();

class MockCancellationScope {
  cancel = vi.fn();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }
}

vi.mock("@temporalio/workflow", () => ({
  ActivityCancellationType: { ABANDON: "ABANDON" },
  CancellationScope: MockCancellationScope,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
}));

describe("hostedUserRuntimeWorkflow entrypoint", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers handlers before running awaited workflow work", async () => {
    vi.resetModules();
    const {
      hostedUserRuntimeWorkflow,
    } = await import("../src/workflows/hosted-user-runtime.js");

    await expect(hostedUserRuntimeWorkflow({
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    })).rejects.toBe(continueAsNewError);

    expect(setHandler).toHaveBeenCalledTimes(2);
    expect(readRuntimeDemand).toHaveBeenCalledTimes(1);
    const firstDemandOrder = readRuntimeDemand.mock.invocationCallOrder[0];
    const handlerOrders = setHandler.mock.invocationCallOrder;
    expect(handlerOrders[0]).toBeLessThan(firstDemandOrder);
    expect(handlerOrders[1]).toBeLessThan(firstDemandOrder);
    expect(condition).toHaveBeenCalledWith(expect.any(Function));
    expect(proxyActivities).toHaveBeenCalledWith(expect.objectContaining({
      startToCloseTimeout: 10_000,
    }));
    expect(proxyActivities).toHaveBeenCalledWith(expect.objectContaining({
      startToCloseTimeout: 15_000,
    }));
  });

  it("emits the ensure-processing patch marker at the execution decision", async () => {
    vi.resetModules();
    readRuntimeDemand.mockResolvedValueOnce({
      kind: "run",
      mailboxLag: [],
      reason: "nudge",
      source: "mailbox_backlog",
      workspace: null,
    });
    ensureRuntimeProcessing.mockResolvedValueOnce({
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-20T12:01:00.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    });
    const {
      hostedUserRuntimeWorkflow,
    } = await import("../src/workflows/hosted-user-runtime.js");

    await expect(hostedUserRuntimeWorkflow({
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    })).rejects.toBe(continueAsNewError);

    expect(patched).toHaveBeenCalledWith(
      "hosted-user-runtime-drop-device-sync-recovery-v1",
    );
    expect(patched).toHaveBeenCalledWith(
      "hosted-user-runtime-ensure-runtime-processing-v1",
    );
    const recoveryDeletionPatchOrder = readPatchInvocationOrder(
      "hosted-user-runtime-drop-device-sync-recovery-v1",
    );
    const ensureProcessingPatchOrder = readPatchInvocationOrder(
      "hosted-user-runtime-ensure-runtime-processing-v1",
    );
    expect(recoveryDeletionPatchOrder).toBeLessThan(
      readRuntimeDemand.mock.invocationCallOrder[0],
    );
    expect(ensureProcessingPatchOrder).toBeGreaterThan(
      readRuntimeDemand.mock.invocationCallOrder[0],
    );
    expect(ensureProcessingPatchOrder).toBeLessThan(
      ensureRuntimeProcessing.mock.invocationCallOrder[0],
    );
  });
});

function readPatchInvocationOrder(patchId: string): number {
  const callIndex = patched.mock.calls.findIndex((call) => call[0] === patchId);
  if (callIndex < 0) {
    throw new Error(`Missing patch call ${patchId}.`);
  }
  return patched.mock.invocationCallOrder[callIndex];
}
