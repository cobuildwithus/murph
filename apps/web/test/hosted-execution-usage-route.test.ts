import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importHostedAiUsageRecords: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  importHostedAiUsageRecords: mocks.importHostedAiUsageRecords,
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
    mocks.importHostedAiUsageRecords.mockResolvedValue({
      recordedIds: ["turn_123.attempt-1"],
      records: [],
    });
  });

  it("stores usage rows and runs allowance accounting during callback import", async () => {
    const usage = [
      {
        usageId: "turn_123.attempt-1",
      },
    ];

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
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.importHostedAiUsageRecords).toHaveBeenCalledWith({
      accountAllowance: true,
      trustedUserId: "member_123",
      usage,
    });
    await expect(response.json()).resolves.toEqual({
      recorded: 1,
      usageIds: ["turn_123.attempt-1"],
    });
  });
});
