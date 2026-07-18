import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareHostedGroupNewsletterParticipants: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
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
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_runtime",
      }),
    );
    mocks.prepareHostedGroupNewsletterParticipants.mockResolvedValue({
      authorizationProof: "a".repeat(64),
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

  it("rejects unsupported actions without reading participant state", async () => {
    const response = await route.POST(buildRequest("retired_action"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(mocks.prepareHostedGroupNewsletterParticipants).not.toHaveBeenCalled();
  });

  it("returns the address-free current grant snapshot", async () => {
    const response = await route.POST(buildRequest("prepare"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "prepare",
      result: {
        authorizationProof: "a".repeat(64),
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
      runtimeMemberId: "member_runtime",
    });
  });

  it("ignores the legacy group selector and derives the group from runtime identity", async () => {
    const response = await route.POST(buildRequest("prepare", {
      groupId: "group_other",
    }));

    expect(response.status).toBe(200);
    expect(mocks.prepareHostedGroupNewsletterParticipants).toHaveBeenCalledWith({
      runtimeMemberId: "member_runtime",
    });
  });
});

function buildRequest(
  action: string,
  extra: Record<string, unknown> = {},
): Request {
  return new Request(
    "https://web.test/api/internal/hosted-execution/groups/newsletter-tool",
    {
      body: JSON.stringify({
        action,
        ...extra,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
