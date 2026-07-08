import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type LinqContactCardShareRouteModule = typeof import(
  "../app/api/internal/hosted-runtime/linq/contact-card/share-after-outbound/route"
);

let route: LinqContactCardShareRouteModule;

describe("hosted runtime Linq contact-card share callback route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/linq/contact-card/share-after-outbound/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("authenticates stale runtime callbacks and returns success without sharing", async () => {
    const response = await route.POST(buildRequest({
      authority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "member_123",
        threadId: "linq_chat_123",
      },
      chatId: "linq_chat_123",
      service: "iMessage",
      threadIsDirect: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(expect.any(Request), {
      maxBodyBytes: 4096,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.hostedLinqContactCardShare.create).not.toHaveBeenCalled();
    expect(mocks.hostedLinqContactCardShare.findMany).not.toHaveBeenCalled();
    expect(mocks.hostedLinqContactCardShare.updateMany).not.toHaveBeenCalled();
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
