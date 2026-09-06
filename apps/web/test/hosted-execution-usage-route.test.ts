import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_USAGE_SCHEMA } from "@murphai/hosted-execution/assistant-usage";
import { HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES } from "@murphai/hosted-execution/runtime-control";
import { readRawBodyBuffer } from "../src/lib/http";

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

describe("hosted execution usage record route", () => {
  beforeAll(async () => {
    hostedExecutionUsageRecordRoute = await import(
      "../app/api/internal/hosted-execution/usage/record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request, options: { maxBodyBytes: number }) => ({
        // Keep the actual pre-parse body reader; only callback authentication
        // and persistence are outside this route/size contract test.
        payload: JSON.parse((await readRawBodyBuffer(request, {
          limitBytes: options.maxBodyBytes,
        })).toString("utf8")),
        userId: "member_123",
      }),
    );
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices.mockResolvedValue({
      platformAiUsageAllowedAfter: false,
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
      platformAiUsageAllowedAfter: false,
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

  it.each(["streamed", "declared"])("enforces the shared UTF-8 request ceiling before accounting (%s)", async (mode) => {
    expect(HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES).toBe(16_384);
    const body = {
      noticeDeliveryTarget: { channel: "telegram", replyToMessageId: "synthetic-reply", target: "🧪".repeat(64) },
      usage: {
        schema: ASSISTANT_USAGE_SCHEMA, provider: "codex-cli", credentialSource: "platform",
        occurredAt: "2026-09-01T12:00:00.000Z", sessionId: "synthetic-session", turnId: "turn_123",
        usageId: "turn_123.attempt-1", attemptCount: 1, inputTokens: 53, outputTokens: 29,
      },
    };
    body.noticeDeliveryTarget.target += "x".repeat(
      HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES - Buffer.byteLength(JSON.stringify(body)),
    );
    const atLimit = JSON.stringify(body);
    expect(Buffer.byteLength(atLimit)).toBe(HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES);
    expect(atLimit.length).toBeLessThan(HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES);
    const request = (text: string) => new Request(
      "https://example.test/api/internal/hosted-execution/usage/record", {
        method: "POST", body: text,
        headers: {
          "content-type": "application/json",
          ...(mode === "declared" ? { "content-length": String(Buffer.byteLength(text)) } : {}),
        },
      },
    );
    expect((await hostedExecutionUsageRecordRoute.POST(request(atLimit))).status).toBe(200);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).toHaveBeenCalledWith({
      accountAllowance: true, trustedUserId: "member_123", noticeDeliveryTarget: body.noticeDeliveryTarget,
      usage: [expect.objectContaining({ inputTokens: 53, outputTokens: 29, usageId: body.usage.usageId })],
    });
    mocks.recordHostedAiUsageRecordsAndSendLimitNotices.mockClear();
    // Whitespace keeps valid JSON; it must be rejected for size, before parsing
    // and allowance settlement, even when JS string length is below the cap.
    expect((await hostedExecutionUsageRecordRoute.POST(request(atLimit + " "))).status).toBe(413);
    expect(mocks.recordHostedAiUsageRecordsAndSendLimitNotices).not.toHaveBeenCalled();
  });
});
