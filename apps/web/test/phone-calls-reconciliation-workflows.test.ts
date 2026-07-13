import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "workflow";

const mocks = vi.hoisted(() => ({
  processHostedPhoneCallRecoveryById: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: mocks.start,
}));

vi.mock("@/src/lib/phone-calls/reconciliation", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/phone-calls/reconciliation")
  >("@/src/lib/phone-calls/reconciliation");
  return {
    ...actual,
    processHostedPhoneCallRecoveryById: mocks.processHostedPhoneCallRecoveryById,
  };
});

import { startHostedPhoneCallReconciliationWorkflow } from "@/src/lib/phone-calls/reconciliation-workflow-start";
import { reconcileHostedPhoneCallStep } from "@/src/lib/phone-calls/reconciliation-workflow-steps";
import { HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES } from "@/src/lib/phone-calls/reconciliation-workflow-types";
import { hostedPhoneCallReconciliationWorkflow } from "@/src/lib/phone-calls/reconciliation-workflows";

describe("hosted phone-call reconciliation Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ runId: "run_123" });
    mocks.processHostedPhoneCallRecoveryById.mockResolvedValue("complete");
  });

  it("starts with only the durable phone-call pointer", async () => {
    const input = { phoneCallId: "hpc_123" };

    await expect(startHostedPhoneCallReconciliationWorkflow(input)).resolves.toEqual({
      runId: "run_123",
    });
    expect(mocks.start).toHaveBeenCalledWith(
      hostedPhoneCallReconciliationWorkflow,
      [input],
    );
  });

  it("maps workflow-start failure to a retryable service error", async () => {
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));

    await expect(startHostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      retryable: true,
    });
  });

  it("retries while provider authority remains unresolved", async () => {
    mocks.processHostedPhoneCallRecoveryById.mockResolvedValue("pending");

    await expect(reconcileHostedPhoneCallStep({
      phoneCallId: "hpc_123",
    })).rejects.toBeInstanceOf(RetryableError);
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledWith({
      phoneCallId: "hpc_123",
      signal: expect.any(AbortSignal),
    });
  });

  it("finishes after the stored call reaches authoritative state or disappears", async () => {
    await expect(reconcileHostedPhoneCallStep({
      phoneCallId: "hpc_123",
    })).resolves.toBeUndefined();

    mocks.processHostedPhoneCallRecoveryById.mockResolvedValue("missing");
    await expect(reconcileHostedPhoneCallStep({
      phoneCallId: "hpc_missing",
    })).resolves.toBeUndefined();
  });

  it("keeps a bounded durable retry window", () => {
    expect(Object.getOwnPropertyDescriptor(
      reconcileHostedPhoneCallStep,
      "maxRetries",
    )?.value).toBe(HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES);
  });
});
