import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeReconciliationFacts,
} from "../src/index.js";

const continueAsNewError = new Error("continue-as-new");
const condition = vi.fn(async () => undefined);
const continueAsNew = vi.fn(async () => {
  throw continueAsNewError;
});
const defineQuery = vi.fn((name: string) => ({ name, type: "query" }));
const defineSignal = vi.fn((name: string) => ({ name, type: "signal" }));
const setHandler = vi.fn();
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
  defineQuery,
  defineSignal,
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
      startToCloseTimeout: 10_000,
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
});
