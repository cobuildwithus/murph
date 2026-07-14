import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isHostedGroupMembershipEpochActive: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  isHostedGroupMembershipEpochActive: mocks.isHostedGroupMembershipEpochActive,
}));

import { POST } from "../app/api/internal/hosted-execution/groups/membership-epoch/route";

describe("hosted group membership epoch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.isHostedGroupMembershipEpochActive.mockResolvedValue(false);
  });

  it("binds the asserted membership epoch to the signed runtime member", async () => {
    const response = await POST(new Request("https://murph.example/api/internal/hosted-execution/groups/membership-epoch", {
      body: JSON.stringify({
        joinedAt: "2026-07-10T14:00:00.000Z",
        membershipId: "membership_123",
      }),
      method: "POST",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false, ok: true });
    expect(mocks.isHostedGroupMembershipEpochActive).toHaveBeenCalledWith({
      joinedAt: new Date("2026-07-10T14:00:00.000Z"),
      memberId: "member_123",
      membershipId: "membership_123",
    });
  });

  it("rejects non-canonical epoch timestamps before reading membership", async () => {
    const response = await POST(new Request("https://murph.example/api/internal/hosted-execution/groups/membership-epoch", {
      body: JSON.stringify({
        joinedAt: "2026-07-10T14:00:00Z",
        membershipId: "membership_123",
      }),
      method: "POST",
    }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.isHostedGroupMembershipEpochActive).not.toHaveBeenCalled();
  });
});
