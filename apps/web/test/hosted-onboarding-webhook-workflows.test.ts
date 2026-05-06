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
  decodeHostedMailboxStoredPayload: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  readHostedMailboxItemById: vi.fn(),
  readHostedMailboxItemOwnerById: vi.fn(),
  readHostedMailboxPayload: vi.fn(),
  sendHostedLinqReadReceipt: vi.fn(),
  start: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
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
    decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
    readHostedMailboxItemById: mocks.readHostedMailboxItemById,
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
    readHostedMailboxPayload: mocks.readHostedMailboxPayload,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    sendHostedLinqReadReceipt: mocks.sendHostedLinqReadReceipt,
  };
});

vi.mock("@/src/lib/hosted-onboarding/logging", () => ({
  deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
  startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
}));

import { startHostedWebhookNudgeWorkflow } from "@/src/lib/hosted-onboarding/webhook-workflow-start";
import {
  nudgeHostedWebhookMailboxItemStep,
  sendHostedWebhookLinqReadReceiptStep,
} from "@/src/lib/hosted-onboarding/webhook-workflow-steps";
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
    mocks.readHostedMailboxItemById.mockResolvedValue(buildHostedMailboxItem());
    mocks.readHostedMailboxPayload.mockResolvedValue({
      payloadCiphertext: "payload_ciphertext_123",
    });
    mocks.decodeHostedMailboxStoredPayload.mockResolvedValue(buildHostedLinqWake());
    mocks.sendHostedLinqReadReceipt.mockResolvedValue({
      ok: true,
      status: 204,
    });
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

  it("looks up the mailbox owner and nudges the hosted runner", async () => {
    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedMailboxItemOwnerById).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "webhook:telegram:workflow",
      timeoutMs: 5_000,
      userId: "member_123",
    });
  });

  it("runs the runner nudge and Linq read receipt in the same pointer workflow", async () => {
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
    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 5_000,
    });
    expect(
      mocks.nudgeHostedRunnerUserBestEffortResult.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.sendHostedLinqReadReceipt.mock.invocationCallOrder[0]);
    expect(mocks.readHostedMailboxPayload).toHaveBeenCalledWith({
      dedupeKey: "evt_123",
      mailboxItemId: "mailbox_123",
      payloadRef: "payload_ref_123",
      userId: "member_123",
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "evt_123",
      kind: "conversation.message",
      lane: "conversation",
      mailboxItemId: "mailbox_123",
      payloadCiphertext: "payload_ciphertext_123",
      payloadInlineCiphertext: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      userId: "member_123",
    }));
  });

  it("skips the read receipt step for non-Linq workflow sources", async () => {
    await expect(sendHostedWebhookLinqReadReceiptStep({
      mailboxItemId: "mailbox_123",
      source: "telegram",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedMailboxItemById).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("keeps Linq workflow read receipts best-effort", async () => {
    mocks.sendHostedLinqReadReceipt.mockRejectedValueOnce(new Error("read receipt failed"));

    await expect(sendHostedWebhookLinqReadReceiptStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.workflow.linq.ingress-read-receipt",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
      }),
    );
  });

  it("resolves Linq read receipts from inline mailbox payloads", async () => {
    mocks.readHostedMailboxItemById.mockResolvedValue({
      ...buildHostedMailboxItem(),
      payloadInlineCiphertext: "inline_ciphertext_123",
      payloadRef: null,
    });

    await expect(sendHostedWebhookLinqReadReceiptStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).resolves.toBeUndefined();

    expect(mocks.readHostedMailboxPayload).not.toHaveBeenCalled();
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledWith(expect.objectContaining({
      payloadCiphertext: null,
      payloadInlineCiphertext: "inline_ciphertext_123",
    }));
    expect(mocks.sendHostedLinqReadReceipt).toHaveBeenCalledWith({
      chatId: "chat_123",
      timeoutMs: 5_000,
    });
  });

  it("keeps the durable nudge retry window long enough for short outages", () => {
    expect(
      Object.getOwnPropertyDescriptor(nudgeHostedWebhookMailboxItemStep, "maxRetries")?.value,
    ).toBe(120);
  });

  it("uses the device-sync wake context for device-sync workflow nudges", async () => {
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
      immediateDriveStarted: null,
      inFlight: null,
      nextAlarmAtPresent: null,
    });

    await expect(nudgeHostedWebhookMailboxItemStep({
      mailboxItemId: "mailbox_123",
      source: "linq",
    })).rejects.toBeInstanceOf(RetryableError);
  });
});

function buildHostedMailboxItem() {
  return {
    createdAt: "2026-05-03T00:00:00.000Z",
    dedupeKey: "evt_123",
    expiresAt: null,
    id: "mailbox_123",
    kind: "conversation.message" as const,
    lane: "conversation" as const,
    laneSeq: "1",
    occurredAt: "2026-05-03T00:00:00.000Z",
    payloadBytes: 256,
    payloadInlineCiphertext: null,
    payloadRef: "payload_ref_123",
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: "2026-05-03T00:00:00.000Z",
    userId: "member_123",
  };
}

function buildHostedLinqWake() {
  return {
    eventId: "evt_123",
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqMessage: {
        chatId: "chat_123",
        from: "sender",
        isFromMe: false,
        messageId: "msg_123",
        parts: [],
      },
      phoneLookupKey: "lookup_123",
    },
    occurredAt: "2026-05-03T00:00:00.000Z",
    userId: "member_123",
  };
}
