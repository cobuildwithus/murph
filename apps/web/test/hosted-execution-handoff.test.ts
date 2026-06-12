import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn(),
  afterCallbacks: [] as Array<() => void | Promise<void>>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: nextServerMocks.after,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/logging", () => ({
  formatHostedExecutionSafeLogError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
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

describe("hosted webhook Temporal handoff", () => {
  beforeEach(() => {
    vi.useRealTimers();
    nextServerMocks.afterCallbacks.length = 0;
    nextServerMocks.after.mockReset();
    nextServerMocks.after.mockImplementation((callback: () => void | Promise<void>) => {
      nextServerMocks.afterCallbacks.push(callback);
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
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
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
        eventId: "evt_inline_gap",
        mailboxItemId: "mailbox_123",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "linq",
        userId: "user-123",
      }),
    ).rejects.toThrow("Temporal unavailable");

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
    });
  });

  it("does not await Linq latency-trace writes before returning a successful handoff", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();

    await flushScheduledAfterCallbacks();

    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
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
        eventId: "evt_inline_gap",
        mailboxItemId: "mailbox_123",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "linq",
        userId: "user-123",
      }),
    ).rejects.toThrow("Temporal unavailable");

    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
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

  it("rethrows the original signal failure even when after() itself throws", async () => {
    signalMocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );
    nextServerMocks.after.mockImplementationOnce(() => {
      throw new Error("after() called outside a request scope");
    });

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        eventId: "evt_after_throws_on_failure",
        mailboxItemId: "mailbox_123",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "linq",
        userId: "user-123",
      }),
    ).rejects.toThrow("Temporal unavailable");

    // The fallback fired the trace task directly instead of queueing it.
    expect(nextServerMocks.afterCallbacks).toHaveLength(0);
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
    const writeOrder: string[] = [];
    vi.setSystemTime(new Date("2026-06-12T14:59:59.000Z"));
    signalMocks.signalHostedMailboxAppendRuntime.mockImplementationOnce(async () => {
      vi.setSystemTime(signalAcceptedAt);
      return {
        signalAccepted: true,
        workflowId: "hosted-user-runtime:user-123",
      };
    });
    latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem.mockImplementationOnce(async () => {
      writeOrder.push("accepted");
    });
    latencyStoreMocks.recordHostedIngressTemporalSignalAccepted.mockImplementationOnce(async () => {
      writeOrder.push("temporal_signal");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();

    vi.setSystemTime(afterCallbackRunsAt);
    await flushScheduledAfterCallbacks();

    expect(writeOrder).toEqual(["accepted", "temporal_signal"]);
    expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith({
      at: signalAcceptedAt,
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("falls back to direct trace writes without failing the handoff when after() throws", async () => {
    nextServerMocks.after.mockImplementationOnce(() => {
      throw new Error("after() unavailable outside request scope");
    });

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
    expect(nextServerMocks.afterCallbacks).toHaveLength(0);

    await vi.waitFor(() => {
      expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).toHaveBeenCalledWith({
        mailboxItemId: "mailbox_123",
        source: "linq",
      });
      expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedUserId: "user-123",
          mailboxItemId: "mailbox_123",
          source: "linq",
        }),
      );
    });
  });

  it("still records the temporal-signal trace when the accepted trace write fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem.mockRejectedValueOnce(
      new Error("latency trace db down"),
    );

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      workflowId: "hosted-user-runtime:user-123",
    });

    await expect(flushScheduledAfterCallbacks()).resolves.toBeUndefined();

    expect(latencyStoreMocks.recordHostedIngressTemporalSignalAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUserId: "user-123",
        mailboxItemId: "mailbox_123",
        source: "linq",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted ingress latency accepted write failed.",
      expect.objectContaining({ stage: "accepted" }),
    );
  });

  it("skips webhook handoff when no mailbox pointer exists", async () => {
    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        eventId: "evt_inline_gap",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "linq",
        userId: "user-123",
      }),
    ).resolves.toBeNull();

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("signals Temporal for duplicate webhook handoff with an existing mailbox item", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_duplicate",
      mailboxItemId: "mailbox_existing",
      response: {
        duplicate: true,
        ignored: true,
        ok: true,
        reason: "duplicate-webhook-event",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_existing",
    });
  });

  it("signals Temporal for Telegram handoff", async () => {
    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "telegram",
      userId: "user-123",
    })).resolves.toMatchObject({
      reason: "temporal-signaled",
      signalAccepted: true,
      started: true,
      workflowId: "hosted-user-runtime:user-123",
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(signalMocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "user-123",
      mailboxItemId: "mailbox_123",
    });
    expect(nextServerMocks.after).not.toHaveBeenCalled();
    expect(latencyStoreMocks.recordHostedIngressAcceptedFromMailboxItem).not.toHaveBeenCalled();
    expect(
      latencyStoreMocks.recordHostedIngressTemporalSignalAccepted,
    ).not.toHaveBeenCalled();
  });
});

async function flushScheduledAfterCallbacks(): Promise<void> {
  const callbacks = nextServerMocks.afterCallbacks.splice(0);
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
      createBrowserVaultSession: vi.fn(),
      deleteUserData,
      getRunnerStatus: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await expect(deleteHostedRunnerUserDataBestEffort({
      userId: "user-123",
    })).resolves.toEqual({
      alarmCleared: true,
      configured: true,
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
});
