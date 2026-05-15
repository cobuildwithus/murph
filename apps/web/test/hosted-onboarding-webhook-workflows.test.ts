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

interface MockAssistantNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean | null;
  kind: "caught-up" | "processing-ensured" | "retry-scheduled" | null;
  configured: boolean;
  errorCode: string | null;
  immediateDriveStarted: boolean | null;
  inFlight: boolean | null;
  nextAlarmAtPresent: boolean | null;
  usageGateDenied: boolean;
}

const mocks = vi.hoisted(() => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(async (
    input: { aiUsageAllowDecision?: unknown; context?: string; timeoutMs?: number; userId: string },
  ): Promise<MockAssistantNudgeResult> => {
    void input;
    return {
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "caught-up",
      nextAlarmAtPresent: false,
      usageGateDenied: false,
    };
  }),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  readHostedMailboxItemCheckpointById: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
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
    readHostedMailboxItemCheckpointById: mocks.readHostedMailboxItemCheckpointById,
    readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
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

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

import { startHostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflow-start";
import {
  nudgeHostedWebhookMailboxItemStep,
} from "@/src/lib/hosted-onboarding/webhook-workflow-steps";
import { hostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflows";

describe("hosted onboarding webhook workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({
      runId: "run_123",
    });
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue(
      buildHostedMailboxItemCheckpoint(),
    );
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([{
      lane: "conversation",
      maxSeq: "1",
    }]);
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "1",
      hostedMailboxSystemImportedSeq: "0",
    }));
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "caught-up",
      nextAlarmAtPresent: false,
    });
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      kind: "caught-up",
      nextAlarmAtPresent: false,
      usageGateDenied: false,
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

    expect(mocks.readHostedMailboxItemCheckpointById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:telegram:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.readHostedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("completes the pointer workflow after an accepted runner nudge", async () => {
    mockMailboxProgressBehind();

    await expect(hostedWebhookNudgeWorkflow({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:linq:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxItemCheckpointById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.readHostedWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps the durable nudge retry window long enough for short outages", () => {
    expect(
      Object.getOwnPropertyDescriptor(nudgeHostedWebhookMailboxItemStep, "maxRetries")?.value,
    ).toBe(120);
  });

  it("uses the device-sync wake context for device-sync workflow nudges", async () => {
    mockMailboxProgressBehind();

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "device-sync",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("uses the email source label for email ingress wake retry workflows", async () => {
    mockMailboxProgressBehind();

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "email",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:email:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("marks missing mailbox pointers fatal inside Workflow", async () => {
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue(null);

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_missing",
      source: "linq",
    })).rejects.toBeInstanceOf(FatalError);

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("marks unaccepted nudge handoffs retryable inside Workflow", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "0",
      hostedMailboxSystemImportedSeq: "0",
    }));
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValue({
      accepted: false,
      alarmScheduled: null,
      kind: null,
      configured: false,
      errorCode: null,
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
      usageGateDenied: false,
    });

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).rejects.toBeInstanceOf(RetryableError);
  });

  it("does not retry or nudge when the assistant usage gate denies a workflow nudge", async () => {
    mockMailboxProgressBehind();
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValue({
      accepted: false,
      alarmScheduled: null,
      kind: null,
      configured: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
      usageGateDenied: true,
    });

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:telegram:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("skips runner nudge for older mailbox pointers in the same lane", async () => {
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue(
      buildHostedMailboxItemCheckpoint({
        laneSeq: "4",
      }),
    );
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "0",
      hostedMailboxSystemImportedSeq: "0",
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([{
      lane: "conversation",
      maxSeq: "5",
    }]);

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedMailboxMaxSeqByLane).toHaveBeenCalledWith({
      lanes: ["conversation"],
      userId: "member_123",
    });
    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("skips runner nudge when the mailbox item is already checkpointed", async () => {
    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedWorkspace).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("uses the mailbox item's lane for nudge preflight checks", async () => {
    mocks.readHostedMailboxItemCheckpointById.mockResolvedValue(buildHostedMailboxItemCheckpoint({
      lane: "system",
      laneSeq: "2",
    }));
    mocks.readHostedWorkspace.mockResolvedValue(buildHostedWorkspace({
      hostedMailboxConversationImportedSeq: "99",
      hostedMailboxSystemImportedSeq: "1",
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([{
      lane: "system",
      maxSeq: "2",
    }]);

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "device-sync",
    })).resolves.toBeUndefined();

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).toHaveBeenCalledWith({
      lanes: ["system"],
      userId: "member_123",
    });
  });
});

function buildHostedMailboxItemCheckpoint(input: {
  lane?: "conversation" | "system";
  laneSeq?: string;
} = {}) {
  return {
    id: "mailbox_123",
    lane: input.lane ?? "conversation",
    laneSeq: input.laneSeq ?? "1",
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
