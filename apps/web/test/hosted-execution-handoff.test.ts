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

vi.mock("@/src/lib/hosted-onboarding/webhook-workflow-start", () => ({
  startHostedWebhookNudgeWorkflow: workflowMocks.startHostedWebhookNudgeWorkflow,
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
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    await nudgeHostedRunnerBestEffort({
      context: "member-activation",
      timeoutMs: 25,
      userId: "user-123",
    });

    expect(nudgeUserRunner).toHaveBeenCalledWith("user-123");
  });

  it("starts the Linq pointer workflow for webhook handoff after mailbox append", async () => {
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
      reason: "workflow-started",
      runnerNudgeAccepted: false,
      started: true,
      workflowStarted: true,
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(nudgeUserRunner).not.toHaveBeenCalled();
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("does not require direct webhook nudge config for Linq handoff", async () => {
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
      reason: "workflow-started",
      runnerNudgeAccepted: false,
      started: true,
      workflowStarted: true,
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
  });

  it("keeps webhook handoff best-effort when the workflow cannot start", async () => {
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
      reason: "workflow-start-failed",
      started: false,
    });

    expect(readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(workflowMocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
      source: "linq",
    });
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
      reason: "workflow-started",
      runnerNudgeAccepted: false,
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
