import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_USAGE_SCHEMA } from "@murphai/hosted-execution/assistant-usage";

const mocks = vi.hoisted(() => ({
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

type HostedExecutionUsageRecordRouteModule = typeof import(
  "../app/api/internal/hosted-execution/usage/record/route"
);

let hostedExecutionUsageRecordRoute: HostedExecutionUsageRecordRouteModule;

const USAGE_ATTRIBUTION = {
  groupId: "hbag_family",
  kind: "family",
} as const;

describe("hosted execution usage record route", () => {
  beforeAll(async () => {
    hostedExecutionUsageRecordRoute = await import(
      "../app/api/internal/hosted-execution/usage/record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
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
        body: JSON.stringify({
          noticeDeliveryTarget,
          usage,
          usageAttribution: USAGE_ATTRIBUTION,
        }),
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
      usageAttribution: USAGE_ATTRIBUTION,
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
        body: JSON.stringify({
          ...requestFields,
          usage,
          usageAttribution: USAGE_ATTRIBUTION,
        }),
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

  it("rejects usage that is missing its admission-time attribution", async () => {
    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
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
});
