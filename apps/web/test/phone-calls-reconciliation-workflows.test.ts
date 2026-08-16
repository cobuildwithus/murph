import { beforeEach, describe, expect, it, vi } from "vitest";
import { HookConflictError, HookNotFoundError } from "workflow/errors";
import { RetryableError } from "workflow";

const mocks = vi.hoisted(() => ({
  createHook: vi.fn(),
  getPrisma: vi.fn(),
  processHostedPhoneCallRecoveryById: vi.fn(),
  resumeHook: vi.fn(),
  sleep: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("workflow/api", () => ({
  resumeHook: mocks.resumeHook,
  start: mocks.start,
}));

vi.mock("workflow", async () => {
  const actual = await vi.importActual<typeof import("workflow")>("workflow");
  return {
    ...actual,
    createHook: mocks.createHook,
    sleep: mocks.sleep,
  };
});

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
  signalHostedPhoneCallResultNotificationRecovery,
  startHostedPhoneCallReconciliationWorkflow,
} from "@/src/lib/phone-calls/reconciliation-workflow-start";
import { reconcileHostedPhoneCallStep } from "@/src/lib/phone-calls/reconciliation-workflow-steps";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
} from "@/src/lib/phone-calls/reconciliation-workflow-types";
import { hostedPhoneCallReconciliationWorkflow } from "@/src/lib/phone-calls/reconciliation-workflows";

describe("hosted phone-call reconciliation Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ runId: "run_123" });
    mocks.resumeHook.mockResolvedValue({ runId: "run_123" });
    mocks.sleep.mockReturnValue(new Promise(() => undefined));
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
    expect(mocks.resumeHook).toHaveBeenCalledWith(
      buildHostedPhoneCallReconciliationHookToken(input.phoneCallId),
      { reason: "reconcile" },
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

  it("signals the oldest pending Telegram result without creating another Workflow", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({
        id: "hpc_result_pending",
        resultDeliveryStatus: "pending",
      })
      .mockResolvedValueOnce(null);
    const prisma = {
      hostedPhoneCall: { findFirst },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    const hookResumer = vi.fn(async () => ({ runId: "run_result_recovery" }));

    await expect(signalHostedPhoneCallResultNotificationRecovery({
      hookResumer,
      memberId: "member_123",
    })).resolves.toBe(true);
    await expect(signalHostedPhoneCallResultNotificationRecovery({
      hookResumer,
      memberId: "member_123",
    })).resolves.toBe(false);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        resultDeliveryStatus: true,
      },
      where: expect.objectContaining({
        analyzedAt: { not: null },
        memberId: "member_123",
        resultDeliveryStatus: {
          in: ["pending", "queued", "sending"],
        },
        resultNotificationChannel: "telegram",
      }),
    }));
    expect(hookResumer).toHaveBeenCalledOnce();
    expect(hookResumer).toHaveBeenCalledWith(
      buildHostedPhoneCallReconciliationHookToken("hpc_result_pending"),
      { reason: "reconcile" },
    );
  });

  it("requires a pending recovery signal to succeed so an exact retry can repair it", async () => {
    const prisma = {
      hostedPhoneCall: {
        findFirst: vi.fn().mockResolvedValue({
          id: "hpc_result_pending",
          resultDeliveryStatus: "pending",
        }),
      },
    };
    const hookResumer = vi.fn().mockRejectedValue(new Error("workflow unavailable"));
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(signalHostedPhoneCallResultNotificationRecovery({
      hookResumer,
      memberId: "member_123",
    })).rejects.toThrow("workflow unavailable");

    expect(hookResumer).toHaveBeenCalledOnce();
  });

  it("does not signal past an older provider-owned delivery", async () => {
    const hookResumer = vi.fn();
    mocks.getPrisma.mockReturnValue({
      hostedPhoneCall: {
        findFirst: vi.fn().mockResolvedValue({
          id: "hpc_result_sending",
          resultDeliveryStatus: "sending",
        }),
      },
    });

    await expect(signalHostedPhoneCallResultNotificationRecovery({
      hookResumer,
      memberId: "member_123",
    })).resolves.toBe(false);
    expect(hookResumer).not.toHaveBeenCalled();
  });

  it("waits for the per-call hook registration before acknowledging a start", async () => {
    const token = buildHostedPhoneCallReconciliationHookToken("hpc_123");
    mocks.resumeHook
      .mockRejectedValueOnce(new HookNotFoundError(token))
      .mockResolvedValueOnce({ runId: "run_123" });

    await expect(startHostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    }, { signal: new AbortController().signal })).resolves.toEqual({
      runId: "run_123",
    });

    expect(mocks.resumeHook).toHaveBeenCalledTimes(2);
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

  it("keeps one deterministic hook owner and resumes after a bounded step window", async () => {
    let hookAwaitCount = 0;
    let resumeRecovery!: () => void;
    const recoverySignal = new Promise<void>((resolve) => {
      resumeRecovery = resolve;
    });
    const dispose = vi.fn();
    const hook = {
      dispose,
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        hookAwaitCount += 1;
        const pending = hookAwaitCount === 1
          ? Promise.resolve({ reason: "reconcile" })
          : recoverySignal.then(() => ({ reason: "reconcile" }));
        return pending.then(onFulfilled, onRejected);
      },
      token: "unused-by-mock",
      [Symbol.asyncIterator]: () => {
        throw new Error("async iteration is not used by this workflow");
      },
      [Symbol.dispose]: dispose,
    };
    mocks.createHook.mockReturnValue(hook);
    mocks.processHostedPhoneCallRecoveryById
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("complete");

    const running = hostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    });
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledOnce();
    });
    resumeRecovery();

    await expect(running).resolves.toBeUndefined();
    expect(mocks.createHook).toHaveBeenCalledWith({
      token: buildHostedPhoneCallReconciliationHookToken("hpc_123"),
    });
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects a duplicate run at the deterministic hook before it can poll", async () => {
    const dispose = vi.fn();
    const conflict = new HookConflictError(
      buildHostedPhoneCallReconciliationHookToken("hpc_123"),
    );
    const hook = {
      dispose,
      then: (_onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.reject(conflict).then(undefined, onRejected),
      token: "unused-by-mock",
      [Symbol.asyncIterator]: () => {
        throw new Error("async iteration is not used by this workflow");
      },
      [Symbol.dispose]: dispose,
    };
    mocks.createHook.mockReturnValue(hook);

    await expect(hostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    })).rejects.toBe(conflict);

    expect(mocks.processHostedPhoneCallRecoveryById).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
