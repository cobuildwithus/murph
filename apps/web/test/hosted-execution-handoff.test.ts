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

const workflowMocks = vi.hoisted(() => ({
  startHostedWebhookNudgeWorkflow: vi.fn(),
}));

const mailboxStoreMocks = vi.hoisted(() => ({
  readHostedMailboxItemOwnerById: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-workflow-start", () => ({
  startHostedWebhookNudgeWorkflow: workflowMocks.startHostedWebhookNudgeWorkflow,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxItemOwnerById: mailboxStoreMocks.readHostedMailboxItemOwnerById,
}));

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  deleteHostedRunnerUserDataBestEffort,
  nudgeHostedRunnerBestEffort,
} from "@/src/lib/hosted-runner/control";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

describe("nudgeHostedRunnerBestEffort", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
    workflowMocks.startHostedWebhookNudgeWorkflow.mockReset();
    workflowMocks.startHostedWebhookNudgeWorkflow.mockResolvedValue({
      runId: "workflow-run-123",
    });
    mailboxStoreMocks.readHostedMailboxItemOwnerById.mockReset();
    mailboxStoreMocks.readHostedMailboxItemOwnerById.mockResolvedValue({
      id: "mailbox_123",
      userId: "user-123",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows nudge failures because the handoff is best-effort", async () => {
    const nudgeUserRunner = vi.fn().mockRejectedValue(new Error("nudge failed"));
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      nudgeHostedRunnerBestEffort({
        userId: "user-123",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted runner nudge failed.",
      expect.objectContaining({ message: "nudge failed" }),
    );
  });

  it("nudges the user immediately when configured", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "1",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await nudgeHostedRunnerBestEffort({
      context: "member-activation",
      timeoutMs: 25,
      userId: "user-123",
    });

    expect(nudgeUserRunner).toHaveBeenCalledWith("user-123");
  });

  it("starts the Linq runner direct nudge before pointer workflow bookkeeping", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "1",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

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
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });

    await vi.waitFor(() =>
      expect(readHostedExecutionControlClientIfConfigured).toHaveBeenCalledWith(5000),
    );
    await vi.waitFor(() => expect(nudgeUserRunner).toHaveBeenCalledWith("user-123"));
    expect(mailboxStoreMocks.readHostedMailboxItemOwnerById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
    expect(
      mailboxStoreMocks.readHostedMailboxItemOwnerById.mock.invocationCallOrder[0],
    ).toBeLessThan(workflowMocks.startHostedWebhookNudgeWorkflow.mock.invocationCallOrder[0]);
  });

  it("does not wait for pointer workflow start before nudging the runner", async () => {
    const workflowStart = createDeferred<{ runId: string }>();
    workflowMocks.startHostedWebhookNudgeWorkflow.mockReturnValueOnce(workflowStart.promise);
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "1",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    const handoff = maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_inline_gap",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    });

    await vi.waitFor(() => expect(nudgeUserRunner).toHaveBeenCalledWith("user-123"));
    let settled = false;
    void handoff.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    workflowStart.resolve({
      runId: "workflow-run-123",
    });
    await expect(handoff).resolves.toMatchObject({
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });
  });

  it("does not wait for the success-path direct nudge before returning workflow handoff", async () => {
    let resolveDirectNudge!: (value: {
      accepted: boolean;
      alarmScheduled: boolean;
      alreadyRunning: boolean;
      inFlight: boolean;
      leaseGeneration: string;
    }) => void;
    const directNudge = new Promise<{
      accepted: boolean;
      alarmScheduled: boolean;
      alreadyRunning: boolean;
      inFlight: boolean;
      leaseGeneration: string;
    }>((resolve) => {
      resolveDirectNudge = resolve;
    });
    const nudgeUserRunner = vi.fn().mockReturnValue(directNudge);
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await expect(maybeHandoffHostedExecutionWebhookWake({
      eventId: "evt_direct_nudge_pending",
      mailboxItemId: "mailbox_123",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    })).resolves.toMatchObject({
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });

    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
    await vi.waitFor(() => expect(nudgeUserRunner).toHaveBeenCalledWith("user-123"));

    resolveDirectNudge({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "1",
    });
  });

  it("starts the Linq pointer workflow when direct nudge config is unavailable", async () => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue(null);

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
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });

    expect(readHostedExecutionControlClientIfConfigured).toHaveBeenCalledWith(5000);
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("skips the success-path direct nudge when mailbox ownership mismatches", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      inFlight: false,
      leaseGeneration: "1",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    mailboxStoreMocks.readHostedMailboxItemOwnerById.mockResolvedValueOnce({
      id: "mailbox_123",
      userId: "owner-456",
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
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });

    expect(nudgeUserRunner).not.toHaveBeenCalled();
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("keeps webhook handoff best-effort when the workflow cannot start", async () => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue(null);
    workflowMocks.startHostedWebhookNudgeWorkflow.mockRejectedValueOnce(
      new Error("workflow unavailable"),
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
    ).resolves.toMatchObject({
      directRunnerNudgeStatus: "not-accepted",
      reason: "workflow-start-failed",
      started: false,
    });

    expect(readHostedExecutionControlClientIfConfigured).toHaveBeenCalledWith(5000);
    expect(mailboxStoreMocks.readHostedMailboxItemOwnerById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("falls back to the direct runner nudge when workflow start fails", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
      leaseGeneration: "1",
      nextAlarmAt: "2026-05-09T00:00:00.000Z",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    workflowMocks.startHostedWebhookNudgeWorkflow.mockRejectedValueOnce(
      new Error("workflow unavailable"),
    );

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        eventId: "evt_inline_gap",
        mailboxItemId: "mailbox_123",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "telegram",
        userId: "user-123",
      }),
    ).resolves.toMatchObject({
      directRunnerNudgeStatus: "accepted",
      reason: "workflow-start-failed",
      started: false,
      workflowStarted: false,
    });

    expect(nudgeUserRunner).toHaveBeenCalledWith("user-123");
    expect(mailboxStoreMocks.readHostedMailboxItemOwnerById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });
  });

  it("does not direct-nudge a mismatched mailbox owner after workflow start fails", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
      immediateDriveStarted: true,
      inFlight: false,
      leaseGeneration: "1",
      nextAlarmAt: "2026-05-09T00:00:00.000Z",
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
      nudgeUserRunner,
      scheduleBrowserVaultRefresh: vi.fn(),
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    mailboxStoreMocks.readHostedMailboxItemOwnerById.mockResolvedValueOnce({
      id: "mailbox_123",
      userId: "owner-456",
    });
    workflowMocks.startHostedWebhookNudgeWorkflow.mockRejectedValueOnce(
      new Error("workflow unavailable"),
    );

    await expect(
      maybeHandoffHostedExecutionWebhookWake({
        eventId: "evt_inline_gap",
        mailboxItemId: "mailbox_123",
        response: {
          ok: true,
          reason: "wake-appended-active-member",
        },
        source: "telegram",
        userId: "user-123",
      }),
    ).resolves.toMatchObject({
      directRunnerNudgeStatus: "not-accepted",
      reason: "workflow-start-failed",
      started: false,
      workflowStarted: false,
    });

    expect(nudgeUserRunner).not.toHaveBeenCalled();
  });

  it("keeps webhook handoff best-effort when no mailbox pointer exists", async () => {
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
    ).resolves.toMatchObject({
      reason: "missing-mailbox-item",
      started: false,
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).not.toHaveBeenCalled();
  });

  it("starts the pointer workflow even when the direct nudge control plane is not configured", async () => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue(null);

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
      directRunnerNudgeStatus: "deferred",
      reason: "workflow-started",
      started: true,
      workflowStarted: true,
    });

    expect(readHostedExecutionControlClientIfConfigured).toHaveBeenCalledWith(5000);
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    });
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
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
      nudgeUserRunner: vi.fn(),
      scheduleBrowserVaultRefresh: vi.fn(),
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
