import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const schedulerMocks = vi.hoisted(() => ({
  callbacks: [] as Array<() => void | Promise<void>>,
  scheduleAfterResponse: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/logging", () => ({
  describeHostedExecutionSafeLogErrorCode: (error: unknown) =>
    error instanceof Error && error.name ? error.name : "UnknownError",
  formatHostedExecutionSafeLogError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
  formatHostedExecutionSafeLogErrorDetails: (
    error: unknown,
    options: { code?: string | null } = {},
  ) => ({
    errorCode: options.code ?? (error instanceof Error && error.name ? error.name : "UnknownError"),
    errorMessage: error instanceof Error ? error.message : String(error),
    errorType: error instanceof Error ? "Error" : typeof error,
  }),
}));

const signalMocks = vi.hoisted(() => ({
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: signalMocks.signalHostedMailboxAppendRuntime,
}));

const latencyStoreMocks = vi.hoisted(() => ({
  recordHostedIngressAcceptedFromMailboxItem: vi.fn(),
  recordHostedIngressTemporalSignalAccepted: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-latency/store", () => ({
  recordHostedIngressAcceptedFromMailboxItem:
    latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressTemporalSignalAccepted:
    latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
}));

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  deleteHostedRunnerUserDataBestEffort,
} from "@/src/lib/hosted-execution/user-data-delete";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

function buildWakeHandoff(
  overrides: Partial<NonNullable<Parameters<typeof maybeHandoffHostedExecutionWebhookWake>[0]["wakeHandoff"]>> = {},
) {
  return {
    eventId: "evt_inline_gap",
    mailboxItemId: "mailbox_123",
    source: "linq" as const,
    userId: "user-123",
    ...overrides,
  };
}

describe("hosted webhook Temporal handoff", () => {
  beforeEach(() => {
    vi.useRealTimers();
    schedulerMocks.callbacks.length = 0;
    schedulerMocks.scheduleAfterResponse.mockReset();
    schedulerMocks.scheduleAfterResponse.mockImplementation((
      callback: () => void | Promise<void>,
    ) => {
      schedulerMocks.callbacks.push(callback);
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
    signalMocks.signalHostedMailboxAppendRuntime.mockReset();
    signalMocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:user-123",
    });
    latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem.mockReset();
    latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem.mockResolvedValue(undefined);
    latencyStoreMocks.recordHostedIngressTemporalSignalAccepted.mockReset();
    latencyStoreMocks.recordHostedIngressTemporalSignalAccepted.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signals Temporal for Linq mailbox handoff without a direct runner nudge", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("fails webhook handoff when Temporal signaling fails after a mailbox pointer exists", async () => {
    signalMocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
        wakeHandoff: buildWakeHandoff(),
      }),
    ).rejects.toThrow("Temporal unavailable");

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("does not await Linq latency-trace writes before returning a successful handoff", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.scheduleAfterResponse).toHaveBeenCalledTimes(1);
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();

    await flushScheduledAfterCallbacks();

    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).toHaveBeenCalledTimes(1);
  });

  it("schedules the accepted trace before rethrowing a Temporal signal failure", async () => {
    signalMocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
        wakeHandoff: buildWakeHandoff(),
      }),
    ).rejects.toThrow("Temporal unavailable");

    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.scheduleAfterResponse).toHaveBeenCalledTimes(1);
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();

    await flushScheduledAfterCallbacks();

    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();
  });

  it("schedules the Telegram accepted trace before rethrowing a Temporal signal failure", async () => {
    signalMocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
        wakeHandoff: buildWakeHandoff({
          eventId: "evt_telegram_signal_failure",
          mailboxItemId: "mailbox_telegram_123",
          source: "telegram",
        }),
      }),
    ).rejects.toThrow("Temporal unavailable");

    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.scheduleAfterResponse).toHaveBeenCalledTimes(1);
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();

    await flushScheduledAfterCallbacks();

    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_telegram_123",
      source: "telegram",
    });
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();
  });

  it("rethrows the original signal failure even when the scheduler itself throws", async () => {
    signalMocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    schedulerMocks.scheduleAfterResponse.mockImplementationOnce(() => {
      throw new Error("post-response scheduler unavailable");
    });

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
        wakeHandoff: buildWakeHandoff({
          eventId: "evt_after_throws_on_failure",
        }),
      }),
    ).rejects.toThrow("Temporal unavailable");

    // The fallback fired the trace task directly instead of queueing it.
    expect(schedulerMocks.callbacks).toHaveLength(0);
    await vi.waitFor(() => {
      expect(
        latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem,
      ).toHaveBeenCalledWith({
        mailboxItemId: "mailbox_123",
        source: "linq",
      });
    });
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();
  });

  it("schedules the temporal-signal trace only on success with the signal-time timestamp", async () => {
    vi.useFakeTimers();
    const signalAcceptedAt = new Date("2026-06-12T15:00:00.000Z");
    const afterCallbackRunsAt = new Date("2026-06-12T15:00:05.000Z");
    vi.setSystemTime(new Date("2026-06-12T14:59:59.000Z"));
    signalMocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async () => {
      vi.setSystemTime(signalAcceptedAt);
      return {
        signalAccepted: true,
        workflowId: "hosted-user-runtime:user-123",
      };
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();

    vi.setSystemTime(afterCallbackRunsAt);
    await flushScheduledAfterCallbacks();

    expect(
      latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem,
    ).not.toHaveBeenCalled();
    expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith({
      at: signalAcceptedAt,
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("falls back to a direct temporal-signal trace write when the scheduler throws", async () => {
    schedulerMocks.scheduleAfterResponse.mockImplementationOnce(() => {
      throw new Error("after() unavailable outside request scope");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      wakeHandoff: buildWakeHandoff(),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(schedulerMocks.scheduleAfterResponse).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.callbacks).toHaveLength(0);

    await vi.waitFor(() => {
      expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedUserId: "user-123",
          mailboxItemId: "mailbox_123",
          source: "linq",
        }),
      );
    });
    expect(
      latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem,
    ).not.toHaveBeenCalled();
  });

  it("skips webhook handoff when no mailbox pointer exists", async () => {
    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      }),
    ).resolves.toBeNull();

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("signals Temporal for duplicate webhook handoff with an existing mailbox item", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        duplicate: true,
        ignored: true,
        ok: true,
        reason: "duplicate-webhook-event",
      },
      scheduleAfterResponse: schedulerMocks.scheduleAfterResponse,
      wakeHandoff: buildWakeHandoff({
        eventId: "evt_duplicate",
        mailboxItemId: "mailbox_existing",
      }),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_existing",
    });
  });

  it("signals Temporal and records latency traces for Telegram handoff", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      wakeHandoff: buildWakeHandoff({ source: "telegram" }),
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
    });
    expect(schedulerMocks.scheduleAfterResponse).not.toHaveBeenCalled();
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedUserId: "user-123",
          mailboxItemId: "mailbox_123",
          source: "telegram",
        }),
      );
    });
  });

});

async function flushScheduledAfterCallbacks(): Promise<void> {
  const callbacks = schedulerMocks.callbacks.splice(0);
  for (const callback of callbacks) {
    await callback();
  }
}

describe("deleteHostedRunnerUserDataBestEffort", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves partial Cloudflare cleanup details instead of marking skipped R2 deletion complete", async () => {
    const deleteUserData = vi.fn().mockResolvedValue({
      deletedAt: "2026-04-29T00:00:00.000Z",
      durableObject: {
        alarmCleared: true,
        deleteAllCompleted: true,
        stateDeleted: true,
      },
      ok: true,
      r2: {
        deletedObjectCount: 1,
        skippedUserScopedPrefixes: true,
        supported: false,
        userScopedSkipReason: "HostedUserCryptoRepairNeededError",
      },
      userId: "user-123",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultExportSession: vi.fn(),
      createBrowserVaultSession: vi.fn(),
      deleteEnvironmentVoice: vi.fn(),
      deleteMealPhoto: vi.fn(),
      deleteUserData,
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell: vi.fn(),
      getRunnerStatus: vi.fn(),
      reconcileRuntimeHealthDataConsent: vi.fn(),
      sendTelegramUsageLimitNotice: vi.fn(),
      stageEnvironmentVoice: vi.fn(),
      stageMealPhoto: vi.fn(),
      verifyInferenceConnection: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await expect(deleteHostedRunnerUserDataBestEffort({
      userId: "user-123",
    })).resolves.toEqual({
      alarmCleared: true,
      configured: true,
      deleteAllCompleted: true,
      deleted: false,
      errorCode: null,
      r2DeletedObjectCount: 1,
      r2SkippedUserScopedPrefixes: true,
      r2Supported: false,
      r2UserScopedSkipReason: "HostedUserCryptoRepairNeededError",
      runnerStateDeleted: true,
    });

    expect(deleteUserData).toHaveBeenCalledWith("user-123");
  });

  it("keeps a legacy Worker response pending without deleteAll completion evidence", async () => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultExportSession: vi.fn(),
      createBrowserVaultSession: vi.fn(),
      deleteEnvironmentVoice: vi.fn(),
      deleteMealPhoto: vi.fn(),
      deleteUserData: vi.fn().mockResolvedValue({
        deletedAt: "2026-04-29T00:00:00.000Z",
        durableObject: {
          alarmCleared: true,
          stateDeleted: true,
        },
        ok: true,
        r2: {
          deletedObjectCount: 0,
          skippedUserScopedPrefixes: false,
          supported: true,
          userScopedSkipReason: null,
        },
        userId: "user-123",
      }),
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell: vi.fn(),
      getRunnerStatus: vi.fn(),
      reconcileRuntimeHealthDataConsent: vi.fn(),
      sendTelegramUsageLimitNotice: vi.fn(),
      stageEnvironmentVoice: vi.fn(),
      stageMealPhoto: vi.fn(),
      verifyInferenceConnection: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await expect(deleteHostedRunnerUserDataBestEffort({
      userId: "user-123",
    })).resolves.toMatchObject({
      deleteAllCompleted: false,
      deleted: false,
    });
  });

  it("logs runner deletion failures with a stable code and redacted message payload", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deleteUserData = vi.fn().mockRejectedValue(Object.assign(
      new Error("delete failed upstream"),
      { name: "CloudflareDeletionError" },
    ));
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultExportSession: vi.fn(),
      createBrowserVaultSession: vi.fn(),
      deleteEnvironmentVoice: vi.fn(),
      deleteMealPhoto: vi.fn(),
      deleteUserData,
      ensureRuntimeProcessing: vi.fn(),
      prewarmRuntimeShell: vi.fn(),
      getRunnerStatus: vi.fn(),
      reconcileRuntimeHealthDataConsent: vi.fn(),
      sendTelegramUsageLimitNotice: vi.fn(),
      stageEnvironmentVoice: vi.fn(),
      stageMealPhoto: vi.fn(),
      verifyInferenceConnection: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await expect(deleteHostedRunnerUserDataBestEffort({
      context: "account-deletion",
      userId: "user-123",
    })).resolves.toMatchObject({
      configured: true,
      deleted: false,
      errorCode: "CloudflareDeletionError",
    });

    expect(consoleError).toHaveBeenCalledWith(
      "Hosted runner user-data deletion failed.",
      expect.objectContaining({
        contextPresent: true,
        errorCode: "CloudflareDeletionError",
        errorMessage: "delete failed upstream",
      }),
    );
  });
});
