import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeReconciliationFacts,
} from "../src/index.js";

const continueAsNewError = new Error("continue-as-new");
const condition = vi.fn(async () => undefined);
const continueAsNew = vi.fn(async () => {
  throw continueAsNewError;
});
const deprecatePatch = vi.fn();
const defineQuery = vi.fn((name: string) => ({ name, type: "query" }));
const defineSignal = vi.fn((name: string) => ({ name, type: "signal" }));
const setHandler = vi.fn();
const patched = vi.fn(() => true);
const uuid4 = vi.fn(() => "orchestration-attempt-test");
let workflowInfoResponse = {
  continueAsNewSuggested: false,
  historyLength: 0,
};
const workflowInfo = vi.fn(() => workflowInfoResponse);
const proxyActivities = vi.fn(() => ({
  ensureRuntimeProcessing,
  readRuntimeReconciliationFacts,
}));
const readRuntimeReconciliationFacts = vi.fn(
  async (): Promise<HostedRuntimeReconciliationFacts> => ({
    blocked: null,
    mailboxLag: [],
    workspace: null,
  }),
);
const ensureRuntimeProcessing = vi.fn();

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
  deprecatePatch,
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
    workflowInfoResponse = {
      continueAsNewSuggested: false,
      historyLength: 0,
    };
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
    expect(readRuntimeReconciliationFacts).toHaveBeenCalledTimes(1);
    const firstFactsReadOrder =
      readRuntimeReconciliationFacts.mock.invocationCallOrder[0];
    const handlerOrders = setHandler.mock.invocationCallOrder;
    expect(handlerOrders[0]).toBeLessThan(firstFactsReadOrder);
    expect(handlerOrders[1]).toBeLessThan(firstFactsReadOrder);
    expect(condition).toHaveBeenCalledWith(expect.any(Function));
    expect(proxyActivities).toHaveBeenCalledWith(expect.objectContaining({
      startToCloseTimeout: 60_000,
    }));
    expect(proxyActivities).toHaveBeenCalledWith(expect.objectContaining({
      startToCloseTimeout: 15_000,
    }));
  });

  it("continues as new before reading facts when history rollover is due", async () => {
    vi.resetModules();
    workflowInfoResponse = {
      continueAsNewSuggested: false,
      historyLength: 1,
    };
    const {
      hostedUserRuntimeWorkflow,
    } = await import("../src/workflows/hosted-user-runtime.js");

    await expect(hostedUserRuntimeWorkflow({
      options: {
        continueAsNewAfterHistoryEvents: 1,
        continueAsNewAfterIterations: 100,
      },
      userId: "member_test",
    })).rejects.toBe(continueAsNewError);

    expect(readRuntimeReconciliationFacts).not.toHaveBeenCalled();
    expect(continueAsNew).toHaveBeenCalledWith(expect.objectContaining({
      userId: "member_test",
    }));
  });

  it("binds inactive system maintenance to the Temporal patch marker", async () => {
    vi.resetModules();
    readRuntimeReconciliationFacts.mockResolvedValueOnce({
      blocked: {
        reason: "user_not_active",
        retryAt: null,
      },
      mailboxLag: [{
        importedSeq: "0",
        lag: "1",
        lane: "system",
        maxSeq: "1",
        maxUpdatedAt: "2026-01-01T00:00:00.000Z",
      }],
      workspace: {
        inboxMediaRetentionWakeAt: null,
        nextWakeAt: null,
        nextWakeReason: null,
        version: "1",
      },
    });
    ensureRuntimeProcessing.mockResolvedValueOnce({
      action: "started",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-01-01T00:00:00.000Z",
      runtimeAttemptId: "runtime-attempt-test",
    });
    const {
      HOSTED_USER_RUNTIME_INACTIVE_SYSTEM_MAINTENANCE_PATCH_ID,
      hostedUserRuntimeWorkflow,
    } = await import("../src/workflows/hosted-user-runtime.js");

    await expect(hostedUserRuntimeWorkflow({
      options: { continueAsNewAfterIterations: 1 },
      userId: "member_test",
    })).rejects.toBe(continueAsNewError);

    expect(patched).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_INACTIVE_SYSTEM_MAINTENANCE_PATCH_ID,
    );
    expect(ensureRuntimeProcessing).toHaveBeenCalledWith(expect.objectContaining({
      processingMode: "inbox_media_retention",
    }));
  });
});
