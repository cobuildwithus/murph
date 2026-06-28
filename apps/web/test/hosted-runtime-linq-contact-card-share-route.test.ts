import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  hostedLinqContactCardShare: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  requireHostedCloudflareCallbackRequest: vi.fn(),
  shareHostedLinqContactCard: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  shareHostedLinqContactCard: mocks.shareHostedLinqContactCard,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type LinqContactCardShareRouteModule = typeof import(
  "../app/api/internal/hosted-runtime/linq/contact-card/share-after-outbound/route"
);

let route: LinqContactCardShareRouteModule;

const AUTHORITY = {
  accountLookupKey: "hbidx:phone:v1:account",
  channel: "linq",
  containerMemberId: "member_123",
  threadId: "linq_chat_123",
} as const;

describe("hosted runtime Linq contact-card share callback route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/linq/contact-card/share-after-outbound/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue(undefined);
    mocks.getPrisma.mockReturnValue({
      hostedLinqContactCardShare: mocks.hostedLinqContactCardShare,
    });
    mocks.hostedLinqContactCardShare.create.mockResolvedValue({});
    mocks.hostedLinqContactCardShare.findMany.mockResolvedValue([]);
    mocks.hostedLinqContactCardShare.updateMany.mockResolvedValue({ count: 1 });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.shareHostedLinqContactCard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asserts authority and shares the contact card through the shared helper", async () => {
    const response = await route.POST(buildRequest({
      authority: AUTHORITY,
      chatId: "linq_chat_123",
      service: "iMessage",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith({
      authority: AUTHORITY,
      prisma: {
        hostedLinqContactCardShare: mocks.hostedLinqContactCardShare,
      },
    });
    expect(mocks.hostedLinqContactCardShare.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: "member_123",
      }),
    });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledWith({
      chatId: "linq_chat_123",
    });
  });

  it("rejects callbacks whose authority is bound to a different runtime user", async () => {
    const response = await route.POST(buildRequest({
      authority: {
        ...AUTHORITY,
        containerMemberId: "member_other",
      },
      chatId: "linq_chat_123",
      service: "iMessage",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_CONTACT_CARD_SHARE_BOUND_USER_MISMATCH",
      },
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("rejects callbacks whose authority thread does not match the requested chat", async () => {
    const response = await route.POST(buildRequest({
      authority: {
        ...AUTHORITY,
        threadId: "linq_chat_other",
      },
      chatId: "linq_chat_123",
      service: "iMessage",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
      },
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

});

function buildRequest(body: unknown): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/linq/contact-card/share-after-outbound",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}
