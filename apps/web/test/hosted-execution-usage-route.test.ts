import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_USAGE_SCHEMA } from "@murphai/hosted-execution/assistant-usage";

const mocks = vi.hoisted(() => ({
  recordHostedAiUsageRecordsAndSendLimitNotices: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecordsAndSendLimitNotices:
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices,
}));

type HostedExecutionUsageRecordRouteModule = typeof import(
  "../app/api/internal/hosted-execution/usage/record/route"
);

let hostedExecutionUsageRecordRoute: HostedExecutionUsageRecordRouteModule;

const USAGE_RECORD = {
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
} as const;

describe("hosted execution usage record route", () => {
  beforeAll(async () => {
    hostedExecutionUsageRecordRoute = await import(
      "../app/api/internal/hosted-execution/usage/record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_123",
      }),
    );
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices.mockResolvedValue({
      recordedIds: ["turn_123.attempt-1"],
    });
  });

  it("records usage rows and runs allowance accounting during callback", async () => {
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
        body: JSON.stringify({ noticeDeliveryTarget, usage: USAGE_RECORD }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 16_384 },
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

  it.each([
    ["an omitted target", {}, undefined],
    ["an explicit unavailable target", { noticeDeliveryTarget: null }, null],
  ])("preserves %s through the signed callback", async (
    _label,
    requestFields,
    expectedTarget,
  ) => {
    await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({ ...requestFields, usage: USAGE_RECORD }),
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

  it("forwards a validated reservation correlation to allowance accounting", async () => {
    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          reservationId: "image_request_123",
          usage: USAGE_RECORD,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices)
      .toHaveBeenCalledExactlyOnceWith({
        accountAllowance: true,
        reservationId: "image_request_123",
        trustedUserId: "member_123",
        usage: [expect.objectContaining({
          usageId: "turn_123.attempt-1",
        })],
      });
  });

  it.each([
    [
      "an untrimmed reservation id",
      {
        reservationId: " image_request_123",
        usage: USAGE_RECORD,
      },
    ],
    [
      "an extra field",
      {
        reservationId: "image_request_123",
        unexpected: "private_extra_value",
        usage: USAGE_RECORD,
      },
    ],
    [
      "payload-supplied member authority",
      {
        memberId: "member_payload_private",
        reservationId: "image_request_123",
        usage: USAGE_RECORD,
      },
    ],
  ])("rejects %s before recording usage", async (_label, body) => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await hostedExecutionUsageRecordRoute.POST(
        new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      });
      expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).not.toHaveBeenCalled();
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("member_payload_private");
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("private_extra_value");
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
