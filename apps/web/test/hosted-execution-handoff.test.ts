import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  deleteHostedRunnerUserDataBestEffort,
} from "@/src/lib/hosted-execution/user-data-delete";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

describe("hosted webhook Temporal handoff", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
    signalMocks.signalHostedMailboxAppendRuntime.mockReset();
    signalMocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:user-123",
    });
  });

  afterEach(() => {
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
  });
});

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
