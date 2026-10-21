import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ step: vi.fn(), sleep: vi.fn(), process: vi.fn(), prisma: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.prisma }));
vi.mock("@/src/lib/hosted-onboarding/linq-terminal-retry", () => ({ processHostedLinqTerminalRetry: mocks.process }));
vi.mock("workflow", () => ({ sleep: mocks.sleep }));
vi.mock("@/src/lib/hosted-onboarding/linq-terminal-retry-workflow-step", () => ({
  processHostedLinqTerminalRetryStep: mocks.step,
}));
import { hostedLinqTerminalRetryWorkflow } from "@/src/lib/hosted-onboarding/linq-terminal-retry-workflow";

describe("Linq terminal recovery durable timer", () => {
  beforeEach(() => vi.resetAllMocks());

  it("waits for the persisted due time and passes only an opaque row pointer", async () => {
    const due = new Date(Date.now() + 30_000);
    mocks.step.mockResolvedValueOnce(due).mockResolvedValueOnce(null);
    await hostedLinqTerminalRetryWorkflow({ messageRowId: "synthetic-row" });
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(due);
    expect(mocks.step.mock.calls).toEqual([[{ messageRowId: "synthetic-row" }], [{ messageRowId: "synthetic-row" }]]);
  });

  it("rechecks the durable fence after an interrupted step", async () => {
    mocks.step.mockRejectedValueOnce(new Error("interrupted")).mockResolvedValueOnce(null);
    await hostedLinqTerminalRetryWorkflow({ messageRowId: "synthetic-row" });
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith("5s");
    expect(mocks.step).toHaveBeenCalledTimes(2);
  });

  it("bounds outage retries even when the database cannot return the expiry", async () => {
    mocks.step.mockRejectedValue(new Error("database unavailable"));
    await hostedLinqTerminalRetryWorkflow({ messageRowId: "synthetic-row" });
    expect(mocks.step).toHaveBeenCalledTimes(40);
    expect(mocks.sleep).toHaveBeenCalledTimes(40);
  });
});

it("sanitizes durable step errors and disables implicit SDK step retries", async () => {
  const { processHostedLinqTerminalRetryStep } = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq-terminal-retry-workflow-step")>("@/src/lib/hosted-onboarding/linq-terminal-retry-workflow-step");
  mocks.process.mockRejectedValue(new Error("synthetic private provider body"));
  await expect(processHostedLinqTerminalRetryStep({ messageRowId: "synthetic-row" }))
    .rejects.toThrow(/^Linq terminal recovery step incomplete\.$/u);
  expect(processHostedLinqTerminalRetryStep).toHaveProperty("maxRetries", 0);
});
