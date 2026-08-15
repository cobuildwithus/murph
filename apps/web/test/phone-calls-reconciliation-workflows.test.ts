import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "workflow";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  processHostedPhoneCallRecoveryById: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
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

import {
  rearmHostedPhoneCallResultNotificationRecovery,
  startHostedPhoneCallReconciliationWorkflow,
} from "@/src/lib/phone-calls/reconciliation-workflow-start";
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
    const signal = new AbortController().signal;

    await expect(startHostedPhoneCallReconciliationWorkflow(input, { signal })).resolves.toEqual({
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
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      retryable: true,
    });
  });

  it("re-arms the oldest nonterminal Telegram result without consulting transport retention", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "hpc_result_pending" })
      .mockResolvedValueOnce(null);
    const prisma = {
      hostedPhoneCall: { findFirst },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    const workflowStarter = vi.fn(async () => ({ runId: "run_result_recovery" }));

    await expect(rearmHostedPhoneCallResultNotificationRecovery({
      memberId: "member_123",
      workflowStarter,
    })).resolves.toBe(true);
    await expect(rearmHostedPhoneCallResultNotificationRecovery({
      memberId: "member_123",
      workflowStarter,
    })).resolves.toBe(false);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "asc" },
      select: { id: true },
      where: expect.objectContaining({
        analyzedAt: { not: null },
        memberId: "member_123",
        resultDeliveryStatus: {
          in: ["pending", "queued", "sending"],
        },
        resultNotificationChannel: "telegram",
      }),
    }));
    expect(workflowStarter).toHaveBeenCalledOnce();
    expect(workflowStarter).toHaveBeenCalledWith({
      phoneCallId: "hpc_result_pending",
    }, {
      signal: expect.any(AbortSignal),
    });
  });

  it("requires route restoration to re-arm result recovery", async () => {
    const prisma = {
      hostedPhoneCall: {
        findFirst: vi.fn().mockResolvedValue({ id: "hpc_result_pending" }),
      },
    };
    const workflowStarter = vi.fn().mockRejectedValue(new Error("workflow unavailable"));
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(rearmHostedPhoneCallResultNotificationRecovery({
      memberId: "member_123",
      workflowStarter,
    })).rejects.toThrow("workflow unavailable");

    expect(workflowStarter).toHaveBeenCalledOnce();
  });

  it("bounds a stalled Workflow start and observes late settlement", async () => {
    let resolveStart: ((value: { runId: string }) => void) | undefined;
    mocks.start.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve;
    }));
    const controller = new AbortController();
    const pending = startHostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    }, { signal: controller.signal });

    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      retryable: true,
    });

    resolveStart?.({ runId: "run_late" });
    await Promise.resolve();
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
