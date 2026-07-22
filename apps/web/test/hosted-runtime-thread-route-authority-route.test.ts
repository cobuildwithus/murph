import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { POST } from "../app/api/internal/hosted-runtime/thread-route/authority/route";

describe("hosted runtime thread route authority route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue({});
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
  });

  it("delegates exact Telegram route authority to the Web-owned route store", async () => {
    const authority = {
      channel: "telegram",
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify(authority),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority,
      prisma: {},
    });
  });

  it("rejects authority for a different runtime container before reading routes", async () => {
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({
          channel: "telegram",
          containerMemberId: "member_other",
          threadId: "telegram_group_123",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
  });
});
