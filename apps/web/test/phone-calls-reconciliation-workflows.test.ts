import { Prisma, type HostedPhoneCall } from "@prisma/client";
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
import { handleRetellCallAnalyzed } from "@/src/lib/phone-calls/result";
import {
  reconcileHostedPhoneCallDurableStep,
  reconcileHostedPhoneCallStep,
} from "@/src/lib/phone-calls/reconciliation-workflow-steps";
import {
  buildHostedPhoneCallReconciliationHookToken,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK,
  HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK,
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

  it("runs one non-retrying canonical durable recovery pass", async () => {
    mocks.processHostedPhoneCallRecoveryById.mockResolvedValue("pending");

    await expect(reconcileHostedPhoneCallDurableStep({
      phoneCallId: "hpc_123",
    })).resolves.toBe("pending");
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledWith({
      phoneCallId: "hpc_123",
      signal: expect.any(AbortSignal),
    });
    expect(Object.getOwnPropertyDescriptor(
      reconcileHostedPhoneCallDurableStep,
      "maxRetries",
    )?.value).toBe(0);
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

  it("runs one canonical recovery pass per timer until every sibling settles", async () => {
    const firstRecheck = Promise.resolve();
    const firstDailyRecheck = createDeferred();
    const secondDailyRecheck = createDeferred();
    const dispose = vi.fn();
    let hookAwaitCount = 0;
    const hook = {
      dispose,
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        hookAwaitCount += 1;
        const pending = hookAwaitCount === 1
          ? Promise.resolve({ reason: "reconcile" })
          : new Promise(() => undefined);
        return pending.then(onFulfilled, onRejected);
      },
      token: "unused-by-mock",
      [Symbol.asyncIterator]: () => {
        throw new Error("async iteration is not used by this workflow");
      },
      [Symbol.dispose]: dispose,
    };
    mocks.createHook.mockReturnValue(hook);
    mocks.sleep
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockReturnValueOnce(firstRecheck)
      .mockReturnValueOnce(firstDailyRecheck.promise)
      .mockReturnValueOnce(secondDailyRecheck.promise)
      .mockReturnValue(new Promise(() => undefined));
    mocks.processHostedPhoneCallRecoveryById
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("complete");

    const running = hostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    });
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(2);
      expect(mocks.sleep).toHaveBeenCalledWith(
        HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK,
      );
    });
    firstDailyRecheck.resolve();
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(3);
    });
    secondDailyRecheck.resolve();

    await expect(running).resolves.toBeUndefined();
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(4);
    expect(mocks.sleep.mock.calls.filter(([duration]) =>
      duration === HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK
    )).toHaveLength(2);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps the short durable cadence until a failed pass classifies the row", async () => {
    const firstRecheck = Promise.resolve();
    const retryRecheck = Promise.resolve();
    const dailyRecheck = createDeferred();
    const dispose = vi.fn();
    let hookAwaitCount = 0;
    const hook = {
      dispose,
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        hookAwaitCount += 1;
        const pending = hookAwaitCount === 1
          ? Promise.resolve({ reason: "reconcile" })
          : new Promise(() => undefined);
        return pending.then(onFulfilled, onRejected);
      },
      token: "unused-by-mock",
      [Symbol.asyncIterator]: () => {
        throw new Error("async iteration is not used by this workflow");
      },
      [Symbol.dispose]: dispose,
    };
    mocks.createHook.mockReturnValue(hook);
    mocks.sleep
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockReturnValueOnce(firstRecheck)
      .mockReturnValueOnce(retryRecheck)
      .mockReturnValueOnce(dailyRecheck.promise);
    mocks.processHostedPhoneCallRecoveryById
      .mockResolvedValueOnce("pending")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("complete");

    const running = hostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_123",
    });
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(3);
      expect(mocks.sleep).toHaveBeenCalledWith(
        HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK,
      );
    });

    expect(mocks.sleep.mock.calls.filter(([duration]) =>
      duration === HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK
    )).toHaveLength(2);
    dailyRecheck.resolve();
    await expect(running).resolves.toBeUndefined();
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(4);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([
    {
      completionPolicy: undefined,
      label: "ordinary result",
    },
    {
      completionPolicy: "transfer_follow_up_required" as const,
      label: "transferred result",
    },
  ])("recovers a durably accepted late $label when its wake and webhook retry are lost", async ({
    completionPolicy,
  }) => {
    type AnalyzedStore = NonNullable<
      Parameters<typeof handleRetellCallAnalyzed>[0]["prisma"]
    >;
    const endedAt = new Date("2026-08-16T12:00:00.000Z");
    let currentCall: HostedPhoneCall | null = {
      analyzedAt: null,
      briefEncrypted: null,
      briefJson: {
        allowTransferToUser: false,
        goal: "Confirm the office schedule.",
        instructions: [],
        shareableFacts: {},
        successCriteria: "The office confirms its schedule.",
        timeZone: "America/Chicago",
        to: {
          label: "the office",
          phoneNumber: "+15550102020",
        },
      },
      createdAt: endedAt,
      endedAt,
      id: "hpc_late_analysis",
      memberId: "member_late_analysis",
      originSessionId: null,
      provider: "retell",
      providerCallId: "retell_late_analysis",
      requestKey: "phone_call_late_analysis",
      resultDeliveryGeneration: 0,
      resultDeliveryStatus: null,
      resultDeliveryTerminalAt: null,
      resultEncrypted: null,
      resultJson: null,
      resultNotificationChannel: "telegram",
      status: "failed",
      updatedAt: endedAt,
    };
    const resultCommitted = createDeferred();
    const durableRecheck = createDeferred();
    const dailyRecheck = createDeferred();
    const phases: string[] = [];
    const dispose = vi.fn();
    let hookAwaitCount = 0;
    const hook = {
      dispose,
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        hookAwaitCount += 1;
        const pending = hookAwaitCount === 1
          ? Promise.resolve({ reason: "reconcile" })
          : new Promise(() => undefined);
        return pending.then(onFulfilled, onRejected);
      },
      token: "unused-by-mock",
      [Symbol.asyncIterator]: () => {
        throw new Error("async iteration is not used by this workflow");
      },
      [Symbol.dispose]: dispose,
    };
    mocks.createHook.mockReturnValue(hook);
    mocks.sleep
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockReturnValueOnce(durableRecheck.promise)
      .mockReturnValueOnce(dailyRecheck.promise);

    let mailboxItemCount = 0;
    let telegramRequestCount = 0;
    let encryptedResult: unknown;
    mocks.processHostedPhoneCallRecoveryById
      .mockResolvedValueOnce("pending")
      .mockImplementationOnce(async () => {
        await resultCommitted.promise;
        return "pending";
      })
      .mockImplementationOnce(async () => {
        await resultCommitted.promise;
        if (!currentCall?.analyzedAt || currentCall.resultDeliveryStatus !== "pending") {
          return "pending";
        }
        mailboxItemCount += 1;
        telegramRequestCount += 1;
        currentCall = {
          ...currentCall,
          resultDeliveryGeneration: 1,
          resultDeliveryStatus: "delivered",
          resultDeliveryTerminalAt: new Date("2026-08-16T12:01:00.000Z"),
        };
        return "complete";
      });

    const hostedPhoneCall: AnalyzedStore["hostedPhoneCall"] = {
      findUnique: async ({ where }) => {
        if (!currentCall) {
          return null;
        }
        return "id" in where
          ? currentCall.id === where.id ? currentCall : null
          : currentCall.providerCallId === where.providerCallId ? currentCall : null;
      },
      updateMany: async (args) => {
        phases.push("cas");
        if (
          !currentCall
          || currentCall.id !== args.where.id
          || currentCall.provider !== args.where.provider
          || currentCall.analyzedAt !== null
        ) {
          return { count: 0 };
        }
        currentCall = {
          ...currentCall,
          analyzedAt: args.data.analyzedAt ?? currentCall.analyzedAt,
          endedAt: args.data.endedAt ?? currentCall.endedAt,
          providerCallId: args.data.providerCallId ?? currentCall.providerCallId,
          resultDeliveryStatus:
            args.data.resultDeliveryStatus ?? currentCall.resultDeliveryStatus,
          resultEncrypted: args.data.resultEncrypted ?? currentCall.resultEncrypted,
          resultJson: args.data.resultJson === Prisma.DbNull
            ? null
            : currentCall.resultJson,
          status: args.data.status,
        };
        resultCommitted.resolve();
        return { count: 1 };
      },
    };
    mocks.getPrisma.mockReturnValue({ hostedPhoneCall });
    let appendAttempt = 0;
    const prisma: AnalyzedStore = {
      hostedPhoneCall,
      $transaction: async (callback) => callback({ hostedPhoneCall }),
      appendResultNotification: async (call) => {
        appendAttempt += 1;
        phases.push("append");
        if (call.resultDeliveryStatus === "pending") {
          throw new Error("mailbox unavailable after result commit");
        }
        return {
          notificationMailboxItemId: null,
          notificationUserId: null,
        };
      },
      encryptResult: async ({ value }) => {
        encryptedResult = value;
        return "encrypted-late-analysis-result";
      },
    };
    const signalReconciliation = vi.fn(async (input: {
      phoneCallId: string;
      signal: AbortSignal;
    }) => {
      expect(input.phoneCallId).toBe("hpc_late_analysis");
      expect(input.signal.aborted).toBe(false);
      phases.push("signal");
      throw new Error("workflow control plane unavailable");
    });

    const running = hostedPhoneCallReconciliationWorkflow({
      phoneCallId: "hpc_late_analysis",
    });
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledOnce();
      expect(hookAwaitCount).toBe(2);
    });
    expect(Object.getOwnPropertyDescriptor(
      reconcileHostedPhoneCallStep,
      "maxRetries",
    )?.value).toBe(120);

    const analyzedCall = {
      call_analysis: {
        custom_analysis_data: {
          outcome: "not_completed",
          result: "The office line was busy.",
        },
      },
      call_id: "retell_late_analysis",
      data_storage_setting: "basic_attributes_only" as const,
      end_timestamp: endedAt.toISOString(),
      metadata: {
        murph_phone_call_id: "hpc_late_analysis",
      },
    };
    await expect(handleRetellCallAnalyzed({
      call: analyzedCall,
      ...(completionPolicy ? { completionPolicy } : {}),
      prisma,
      signalReconciliation,
    })).rejects.toThrow("mailbox unavailable after result commit");
    expect(currentCall).toMatchObject({
      analyzedAt: expect.any(Date),
      resultDeliveryStatus: "pending",
      resultEncrypted: "encrypted-late-analysis-result",
      status: "failed",
    });
    expect(encryptedResult).toMatchObject({
      ...(completionPolicy ? { completionPolicy } : {}),
      outcome: "not_completed",
      summary: "The office line was busy.",
    });
    durableRecheck.resolve();
    await vi.waitFor(() => {
      expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(2);
      expect(mocks.sleep).toHaveBeenCalledWith(
        HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_DURABLE_RECHECK,
      );
    });
    expect(currentCall).toMatchObject({
      resultDeliveryGeneration: 0,
      resultDeliveryStatus: "pending",
    });
    expect(mailboxItemCount).toBe(0);
    expect(telegramRequestCount).toBe(0);
    dailyRecheck.resolve();
    await expect(running).resolves.toBeUndefined();

    expect(phases.indexOf("cas")).toBeLessThan(phases.indexOf("signal"));
    expect(mocks.sleep).toHaveBeenCalledWith(
      HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_FIRST_DURABLE_RECHECK,
    );
    expect(currentCall).toMatchObject({
      analyzedAt: expect.any(Date),
      resultDeliveryGeneration: 1,
      resultDeliveryStatus: "delivered",
      resultEncrypted: "encrypted-late-analysis-result",
      status: "failed",
    });
    expect(mailboxItemCount).toBe(1);
    expect(telegramRequestCount).toBe(1);
    expect(signalReconciliation).toHaveBeenCalledOnce();
    expect(mocks.processHostedPhoneCallRecoveryById).toHaveBeenCalledTimes(3);
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();

    await expect(handleRetellCallAnalyzed({
      call: analyzedCall,
      ...(completionPolicy ? { completionPolicy } : {}),
      prisma,
      signalReconciliation,
    })).resolves.toEqual({
      notificationMailboxItemId: null,
      notificationUserId: null,
    });
    expect(signalReconciliation).toHaveBeenCalledOnce();
    expect(appendAttempt).toBe(2);
    expect(mailboxItemCount).toBe(1);
    expect(telegramRequestCount).toBe(1);
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

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}
