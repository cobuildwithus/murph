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

    const response = await hostedExecutionUsageRecordRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({ usage }),
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
});
