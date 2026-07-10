import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeAssistantPersonalizationTool: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));
vi.mock("@/src/lib/hosted-execution/assistant-personalization-tool", () => ({
  handleHostedRuntimeAssistantPersonalizationTool:
    mocks.handleHostedRuntimeAssistantPersonalizationTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/assistant-personalization/tool/route"
);

let route: RouteModule;

describe("hosted assistant personalization internal route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/assistant-personalization/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(
      "member_personalization_route",
    );
    mocks.handleHostedRuntimeAssistantPersonalizationTool.mockResolvedValue({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: "warm",
      },
    });
  });

  it("binds the parsed operation to the signed callback member", async () => {
    const payload = JSON.stringify({ action: "read" });
    const request = new Request(
      "https://join.example.test/api/internal/hosted-execution/assistant-personalization/tool",
      {
        body: payload,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 2_048, payloadText: payload },
    );
    expect(mocks.handleHostedRuntimeAssistantPersonalizationTool).toHaveBeenCalledWith({
      memberId: "member_personalization_route",
      request: { action: "read" },
    });
  });
});
