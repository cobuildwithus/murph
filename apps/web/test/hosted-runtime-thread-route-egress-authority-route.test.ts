import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  prisma: {},
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority: mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type ThreadRouteEgressAuthorityRouteModule = typeof import(
  "../app/api/internal/hosted-runtime/thread-route/egress-authority/route"
);

let route: ThreadRouteEgressAuthorityRouteModule;

describe("hosted runtime thread-route egress-authority callback route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/thread-route/egress-authority/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it("dispatches Linq authority to the Linq route assertion", async () => {
    const authority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      containerMemberId: "member_123",
      threadId: "chat_home_123",
    } as const;

    const response = await route.POST(buildRequest({
      authority,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith({
      authority,
      prisma: mocks.prisma,
    });
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
  });

  it("keeps non-Linq authorities on the explicit thread-route assertion", async () => {
    const authority = {
      accountLookupKey: "hbidx:telegram:v1:account",
      channel: "telegram",
      containerMemberId: "member_123",
      threadId: "telegram_thread_123",
    } as const;

    const response = await route.POST(buildRequest({
      authority,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority,
      prisma: mocks.prisma,
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
  });

  it("rejects authority bound to a different runtime user before route assertion", async () => {
    const response = await route.POST(buildRequest({
      authority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member_other",
        threadId: "chat_home_123",
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_THREAD_ROUTE_EGRESS_BOUND_USER_MISMATCH",
      },
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
  });
});

function buildRequest(body: unknown): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/thread-route/egress-authority",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}
