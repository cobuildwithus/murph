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
  readHostedMailboxItemOwnerById: vi.fn(),
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
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import { startHostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflow-start";
import { nudgeHostedWebhookMailboxItemStep } from "@/src/lib/hosted-onboarding/webhook-workflow-steps";
import { hostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflows";

describe("hosted onboarding webhook workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({
      runId: "run_123",
    });
    mocks.readHostedMailboxItemOwnerById.mockResolvedValue({
      id: "mailbox_123",
      userId: "member_123",
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
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

  it("looks up the mailbox owner and nudges the hosted runner", async () => {
    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).resolves.toEqual({
      accepted: true,
    });

    expect(mocks.readHostedMailboxItemOwnerById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:telegram:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
  });

  it("marks missing mailbox pointers fatal inside Workflow", async () => {
    mocks.readHostedMailboxItemOwnerById.mockResolvedValue(null);

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_missing",
      source: "linq",
    })).rejects.toBeInstanceOf(FatalError);

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("marks unaccepted nudge handoffs retryable inside Workflow", async () => {
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: false,
      alarmScheduled: null,
      alreadyRunning: null,
      configured: false,
      errorCode: null,
      inFlight: null,
      nextAlarmAtPresent: null,
    });

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).rejects.toBeInstanceOf(RetryableError);
  });
});
