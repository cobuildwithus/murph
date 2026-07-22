import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readCurrentHostedMemberDirectRoute: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/member-direct-route", () => ({
  readCurrentHostedMemberDirectRoute: mocks.readCurrentHostedMemberDirectRoute,
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

import { POST } from "../app/api/internal/hosted-runtime/direct-route/current/route";

describe("hosted runtime current direct route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readCurrentHostedMemberDirectRoute.mockResolvedValue({
      channel: "telegram",
      threadId: "telegram_home_123",
    });
  });

  it("returns only the authenticated member's current private route", async () => {
    const request = new Request(
      "https://example.test/api/internal/hosted-runtime/direct-route/current",
      { body: "{}", method: "POST" },
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channel: "telegram",
      threadId: "telegram_home_123",
    });
    expect(mocks.readCurrentHostedMemberDirectRoute).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("retries instead of inventing a recipient when no route exists", async () => {
    mocks.readCurrentHostedMemberDirectRoute.mockResolvedValue(null);
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/direct-route/current",
      { body: "{}", method: "POST" },
    ));

    expect(response.status).toBe(503);
  });
});
