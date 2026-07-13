import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareHostedGroupNewsletterParticipants: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-groups/group-newsletter", () => ({
  prepareHostedGroupNewsletterParticipants:
    mocks.prepareHostedGroupNewsletterParticipants,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/groups/newsletter-tool/route"
);

let route: RouteModule;

describe("hosted group newsletter route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/groups/newsletter-tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_runtime");
    mocks.prepareHostedGroupNewsletterParticipants.mockResolvedValue({
      groupId: "group_123",
      missingEmailParticipants: [
        {
          authorizedShares: [],
          hasEmail: false,
          memberId: "member_missing",
        },
      ],
      participants: [
        {
          authorizedShares: [
            { projectionScopeKey: "steps-days.v0", shareId: "share_steps" },
          ],
          hasEmail: true,
          memberId: "member_ready",
        },
        {
          authorizedShares: [],
          hasEmail: false,
          memberId: "member_missing",
        },
      ],
      status: "ok",
    });
  });

  it("rejects snapshot-less prepare requests without reading participant state", async () => {
    const response = await route.POST(buildRequest("prepare"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "prepare",
      result: {
        status: "unavailable",
        unavailableReason: "newsletter_runner_upgrade_required",
      },
    });
    expect(mocks.prepareHostedGroupNewsletterParticipants).not.toHaveBeenCalled();
  });

  it("rejects legacy read_stats without reading participant state", async () => {
    const response = await route.POST(buildRequest("read_stats"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "read_stats",
      result: {
        status: "unavailable",
        unavailableReason: "newsletter_runner_upgrade_required",
      },
    });
    expect(mocks.prepareHostedGroupNewsletterParticipants).not.toHaveBeenCalled();
  });

  it("returns the address-free current grant snapshot only when requested", async () => {
    const response = await route.POST(buildRequest("prepare", true));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "prepare",
      result: {
        groupId: "group_123",
        missingEmailParticipants: [
          {
            authorizedShares: [],
            hasEmail: false,
            memberId: "member_missing",
          },
        ],
        participants: [
          {
            authorizedShares: [
              { projectionScopeKey: "steps-days.v0", shareId: "share_steps" },
            ],
            hasEmail: true,
            memberId: "member_ready",
          },
          {
            authorizedShares: [],
            hasEmail: false,
            memberId: "member_missing",
          },
        ],
        status: "ok",
      },
    });
    expect(mocks.prepareHostedGroupNewsletterParticipants).toHaveBeenCalledWith({
      groupId: "group_123",
      runtimeMemberId: "member_runtime",
    });
  });
});

function buildRequest(
  action: "prepare" | "read_stats",
  includeAuthorizationSnapshot = false,
): Request {
  return new Request(
    "https://web.test/api/internal/hosted-execution/groups/newsletter-tool",
    {
      body: JSON.stringify({
        action,
        groupId: "group_123",
        ...(includeAuthorizationSnapshot ? { includeAuthorizationSnapshot: true } : {}),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
