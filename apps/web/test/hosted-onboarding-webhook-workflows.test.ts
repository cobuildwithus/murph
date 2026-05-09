import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  FatalError,
  RetryableError,
} from "workflow";

const mocks = vi.hoisted(() => ({
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedWorkspace: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: mocks.start,
}));

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>(
    "@/src/lib/hosted-mailbox/store",
  );

  return {
    ...actual,
    readHostedMailboxItemById: mocks.readHostedMailboxItemById,
  };
});

vi.mock("@/src/lib/hosted-workspace/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-workspace/store")>(
    "@/src/lib/hosted-workspace/store",
  );

  return {
    ...actual,
    readHostedWorkspace: mocks.readHostedWorkspace,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import { startHostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflow-start";
import {
  nudgeHostedWebhookMailboxItemStep,
  waitHostedWebhookMailboxItemCheckpointStep,
} from "@/src/lib/hosted-onboarding/webhook-workflow-steps";
import { hostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflows";

describe("hosted onboarding webhook workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({
      runId: "run_123",
    });
    mocks.readHostedMailboxItemById.mockResolvedValue(buildHostedMailboxItem());
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "1",
      hostedMailboxSystemImportedSeq: "0",
    }));
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
  });

  it("starts the nudge workflow with only a mailbox pointer", async () => {
    const input = {
      mailboxItemId: "mailbox_123",
      source: "linq" as const,
    };

    await expect(startHostedWebhookNudgeWorkflow(input)).resolves.toEqual({
      runId: "run_123",
    });

    expect(mocks.start).toHaveBeenCalledWith(hostedWebhookNudgeWorkflow, [input]);
  });

  it("maps workflow start failures to provider-retryable errors", async () => {
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));

    await expect(startHostedWebhookNudgeWorkflow({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).rejects.toMatchObject({
      code: "HOSTED_WEBHOOK_NUDGE_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Webhook processing is temporarily unavailable.",
      retryable: true,
    });
  });

  it("nudges the hosted runner when the mailbox item is not checkpointed", async () => {
    mockMailboxProgressBehind();

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedMailboxItemById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:telegram:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.readHostedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("nudges once, then waits for checkpoint progress in the pointer workflow", async () => {
    mockMailboxProgressBehindThenCaughtUp();

    await expect(hostedWebhookNudgeWorkflow({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.readHostedMailboxItemById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.readHostedWorkspace).toHaveBeenCalledTimes(2);
  });

  it("keeps the durable nudge retry window long enough for short outages", () => {
    expect(
      Object.getOwnPropertyDescriptor(nudgeHostedWebhookMailboxItemStep, "maxRetries")?.value,
    ).toBe(120);
    expect(
      Object.getOwnPropertyDescriptor(
        waitHostedWebhookMailboxItemCheckpointStep,
        "maxRetries",
      )?.value,
    ).toBe(720);
  });

  it("uses the device-sync wake context for device-sync workflow nudges", async () => {
    mockMailboxProgressBehind();

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "device-sync",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
  });

  it("uses the email source label for email ingress wake retry workflows", async () => {
    mockMailboxProgressBehind();

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "email",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:email:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
  });

  it("marks missing mailbox pointers fatal inside Workflow", async () => {
    mocks.readHostedMailboxItemById.mockResolvedValue(null);

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_missing",
      source: "linq",
    })).rejects.toBeInstanceOf(FatalError);

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("marks unaccepted nudge handoffs retryable inside Workflow", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "0",
      hostedMailboxSystemImportedSeq: "0",
    }));
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: false,
      errorCode: null,
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
    });

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).rejects.toBeInstanceOf(RetryableError);
  });

  it("skips runner nudge when the mailbox item is already checkpointed", async () => {
    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedWorkspace).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("waits for checkpoint progress without nudging again", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "0",
      hostedMailboxSystemImportedSeq: "0",
    }));

    await expect(waitHostedWebhookMailboxItemCheckpointStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).rejects.toBeInstanceOf(RetryableError);

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.readHostedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("uses the mailbox item's lane when checking checkpoint progress", async () => {
    mocks.readHostedMailboxItemById.mockResolvedValue(buildHostedMailboxItem({
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    }));
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "99",
      hostedMailboxSystemImportedSeq: "1",
    }));

    await expect(waitHostedWebhookMailboxItemCheckpointStep({
      mailboxItemId: "mailbox_123",
      source: "device-sync",
    })).rejects.toBeInstanceOf(RetryableError);

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.readHostedMailboxItemById.mockResolvedValue(buildHostedMailboxItem({
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    }));
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "99",
      hostedMailboxSystemImportedSeq: "2",
    }));

    await expect(waitHostedWebhookMailboxItemCheckpointStep({
      mailboxItemId: "mailbox_123",
      source: "device-sync",
    })).resolves.toBeUndefined();
  });
});

function buildHostedMailboxItem(input: {
  kind?:
    | "assistant.notification.requested"
    | "conversation.message"
    | "device-sync.wake"
    | "member.activated"
    | "member.channels.updated";
  lane?: "conversation" | "system";
  laneSeq?: string;
} = {}) {
  return {
    createdAt: "2026-05-03T00:00:00.000Z",
    dedupeKey: "evt_123",
    expiresAt: null,
    id: "mailbox_123",
    kind: input.kind ?? "conversation.message",
    lane: input.lane ?? "conversation",
    laneSeq: input.laneSeq ?? "1",
    occurredAt: "2026-05-03T00:00:00.000Z",
    payloadBytes: 256,
    payloadInlineCiphertext: null,
    payloadRef: "payload_ref_123",
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: "2026-05-03T00:00:00.000Z",
    userId: "member_123",
  };
}

function buildHostedWorkspace(redactedStatusJson: Record<string, unknown> | null) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: "2026-05-03T00:00:00.000Z",
    createdAt: "2026-05-03T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson,
    snapshotRef: null,
    updatedAt: "2026-05-03T00:00:00.000Z",
    userId: "member_123",
    version: "1",
  };
}

function mockMailboxProgressBehind() {
  mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
    hostedMailboxConversationImportedSeq: "0",
    hostedMailboxSystemImportedSeq: "0",
  }));
}

function mockMailboxProgressBehindThenCaughtUp() {
  mocks.readHostedWorkspace
    .mockResolvedValueOnce(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "0",
      hostedMailboxSystemImportedSeq: "0",
    }))
    .mockResolvedValueOnce(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "1",
      hostedMailboxSystemImportedSeq: "0",
    }));
}
