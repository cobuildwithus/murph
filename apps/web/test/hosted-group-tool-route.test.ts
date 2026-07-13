import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedRuntimeGroupTool: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-groups/group-tool", () => ({
  handleHostedRuntimeGroupTool: mocks.handleHostedRuntimeGroupTool,
}));

type GroupToolRoute =
  typeof import("../app/api/internal/hosted-execution/groups/tool/route");

let route: GroupToolRoute;

describe("hosted group-tool route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-execution/groups/tool/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_1");
    mocks.handleHostedRuntimeGroupTool.mockResolvedValue({
      action: "post_join_offer",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "test",
      },
    });
  });

  it("reads the stable join-offer effect from the signed request query", async () => {
    const effectId = `group_join_offer_${"a".repeat(64)}`;
    const response = await route.POST(new Request(
      `https://web.example.test/api/internal/hosted-execution/groups/tool?joinOfferEffectId=${effectId}`,
      {
        body: JSON.stringify({
          action: "post_join_offer",
          joinOffer: {
            messageTemplate:
              "React here to join. Shares {{share_scope}}. Page: {{join_url}}.",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.handleHostedRuntimeGroupTool).toHaveBeenCalledWith({
      memberId: "member_1",
      request: {
        action: "post_join_offer",
        effectId,
        joinOffer: {
          displayName: null,
          messageTemplate:
            "React here to join. Shares {{share_scope}}. Page: {{join_url}}.",
          projectionKinds: null,
          projectionScopes: null,
        },
      },
    });
  });

  it("passes a missing effect as unavailable input instead of inventing identity", async () => {
    await route.POST(new Request(
      "https://web.example.test/api/internal/hosted-execution/groups/tool",
      {
        body: JSON.stringify({
          action: "post_join_offer",
          joinOffer: {
            messageTemplate:
              "React here to join. Shares {{share_scope}}. Page: {{join_url}}.",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(mocks.handleHostedRuntimeGroupTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ effectId: null }),
      }),
    );
  });

  it("rejects noncanonical query effects before the group owner sees them", async () => {
    await route.POST(new Request(
      "https://web.example.test/api/internal/hosted-execution/groups/tool"
        + "?joinOfferEffectId=tool_call_attempt_1",
      {
        body: JSON.stringify({
          action: "post_join_offer",
          joinOffer: {
            messageTemplate:
              "React here to join. Shares {{share_scope}}. Page: {{join_url}}.",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(mocks.handleHostedRuntimeGroupTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ effectId: null }),
      }),
    );
  });
});
