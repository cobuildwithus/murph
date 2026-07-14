import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_USAGE_SCHEMA } from "@murphai/hosted-execution/assistant-usage";

const mocks = vi.hoisted(() => ({
  readHostedMailboxItemByLaneSeq: vi.fn(),
  recordHostedAiUsageRecordsAndSendLimitNotices: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecordsAndSendLimitNotices:
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxItemByLaneSeq: mocks.readHostedMailboxItemByLaneSeq,
}));

type HostedExecutionUsageRecordRouteModule = typeof import(
  "../app/api/internal/hosted-execution/usage/record/route"
);

let hostedExecutionUsageRecordRoute: HostedExecutionUsageRecordRouteModule;

describe("hosted execution usage record route", () => {
  beforeAll(async () => {
    hostedExecutionUsageRecordRoute = await import(
      "../app/api/internal/hosted-execution/usage/record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readHostedMailboxItemByLaneSeq.mockResolvedValue({
      acceptedAllowancePeriodStart: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-29T11:59:00.000Z",
      kind: "conversation.message",
    });
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices.mockResolvedValue({
      recordedIds: ["turn_123.attempt-1"],
    });
  });

  it("records usage rows and runs allowance accounting during callback", async () => {
    const usage = {
      attemptCount: 1,
      credentialSource: "platform",
      occurredAt: "2026-03-29T12:00:00.000Z",
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      stripeMeterSource: "murph",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
      usageExtractionVersion: "legacy",
    };
    const noticeDeliveryTarget = {
      channel: "linq",
      replyToMessageId: "linq_message_usage_1",
      routeAuthority: {
        channel: "linq",
        containerMemberId: "container_member_usage_1",
        threadId: "linq_thread_usage_1",
      },
      target: "linq_chat_usage_1",
    };

    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({ noticeDeliveryTarget, usage }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        maxBodyBytes: 16_384,
        payloadText: expect.any(String),
      }),
    );
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).toHaveBeenCalledWith({
      accountAllowance: true,
      noticeDeliveryTarget,
      trustedUserId: "member_123",
      usage: [
        expect.objectContaining({
          provider: "codex-cli",
          schema: ASSISTANT_USAGE_SCHEMA,
          stripeMeterSource: "murph",
          usageId: "turn_123.attempt-1",
        }),
      ],
    });
    await expect(response.json()).resolves.toEqual({
      recorded: true,
      usageId: "turn_123.attempt-1",
    });
  });

  it("carries conversation-replay authority into allowance accounting", async () => {
    const usage = {
      attemptCount: 1,
      credentialSource: "platform",
      occurredAt: "2026-03-29T12:00:00.000Z",
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      stripeMeterSource: "murph",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
      usageExtractionVersion: "legacy",
    };

    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          acceptedConversationAt: "2026-03-29T11:59:00.000Z",
          acceptedConversationSeq: "7",
          processingMode: "conversation_replay",
          usage,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readHostedMailboxItemByLaneSeq).toHaveBeenCalledWith({
      lane: "conversation",
      laneSeq: "7",
      userId: "member_123",
    });
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).toHaveBeenCalledWith({
      acceptedConversation: true,
      acceptedConversationPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      accountAllowance: true,
      trustedUserId: "member_123",
      usage: [expect.objectContaining({ usageId: "turn_123.attempt-1" })],
    });
  });

  it("rejects replay accounting when the signed tuple does not match its mailbox row", async () => {
    mocks.readHostedMailboxItemByLaneSeq.mockResolvedValueOnce({
      acceptedAllowancePeriodStart: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-03-29T11:58:00.000Z",
      kind: "conversation.message",
    });

    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          acceptedConversationAt: "2026-03-29T11:59:00.000Z",
          acceptedConversationSeq: "7",
          processingMode: "conversation_replay",
          usage: {
            attemptCount: 1,
            credentialSource: "platform",
            occurredAt: "2026-03-29T12:00:00.000Z",
            provider: "codex-cli",
            schema: ASSISTANT_USAGE_SCHEMA,
            sessionId: "asst_123",
            stripeMeterSource: "murph",
            turnId: "turn_123",
            usageId: "turn_123.attempt-1",
            usageExtractionVersion: "legacy",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).not.toHaveBeenCalled();
  });

  it("rejects replay accounting when the exact mailbox row has no period binding", async () => {
    mocks.readHostedMailboxItemByLaneSeq.mockResolvedValueOnce({
      acceptedAllowancePeriodStart: null,
      createdAt: "2026-03-29T11:59:00.000Z",
      kind: "conversation.message",
    });

    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          acceptedConversationAt: "2026-03-29T11:59:00.000Z",
          acceptedConversationSeq: "7",
          processingMode: "conversation_replay",
          usage: {
            attemptCount: 1,
            credentialSource: "platform",
            occurredAt: "2026-03-29T12:00:00.000Z",
            provider: "codex-cli",
            schema: ASSISTANT_USAGE_SCHEMA,
            sessionId: "asst_123",
            stripeMeterSource: "murph",
            turnId: "turn_123",
            usageId: "turn_123.attempt-1",
            usageExtractionVersion: "legacy",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).not.toHaveBeenCalled();
  });

  it.each([
    ["an omitted target", {}, undefined],
    ["an explicit unavailable target", { noticeDeliveryTarget: null }, null],
  ])("preserves %s through the signed callback", async (
    _label,
    requestFields,
    expectedTarget,
  ) => {
    const usage = {
      attemptCount: 1,
      credentialSource: "platform",
      occurredAt: "2026-03-29T12:00:00.000Z",
      provider: "codex-cli",
      schema: ASSISTANT_USAGE_SCHEMA,
      sessionId: "asst_123",
      stripeMeterSource: "murph",
      turnId: "turn_123",
      usageId: "turn_123.attempt-1",
      usageExtractionVersion: "legacy",
    };

    await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({ ...requestFields, usage }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    const call = mocks.recordHostedAiUsageRecordsAndSendLimitNotices.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    if (expectedTarget === undefined) {
      expect(call).not.toHaveProperty("noticeDeliveryTarget");
    } else {
      expect(call).toHaveProperty("noticeDeliveryTarget", expectedTarget);
    }
  });
});
