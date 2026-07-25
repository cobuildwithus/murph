import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readCurrentHostedMemberVerifiedEmailAddress: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/member-direct-route", () => ({
  readCurrentHostedMemberVerifiedEmailAddress:
    mocks.readCurrentHostedMemberVerifiedEmailAddress,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { POST } from "../app/api/internal/hosted-runtime/email-egress/recipient/route";

describe("hosted runtime email egress recipient route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it("returns the bound member's current verified email", async () => {
    mocks.readCurrentHostedMemberVerifiedEmailAddress.mockResolvedValue(
      "current@example.test",
    );

    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/email-egress/recipient",
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryTarget: "current@example.test",
    });
    expect(mocks.readCurrentHostedMemberVerifiedEmailAddress).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
    });
  });

  it("returns no target after verified email is cleared", async () => {
    mocks.readCurrentHostedMemberVerifiedEmailAddress.mockResolvedValue(null);

    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/email-egress/recipient",
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deliveryTarget: null });
  });
});
