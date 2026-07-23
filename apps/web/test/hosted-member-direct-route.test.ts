import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedThreadRouteContainerAccess: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedMemberVerifiedEmailSnapshots: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberVerifiedEmailSnapshots:
    mocks.readHostedMemberVerifiedEmailSnapshots,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertActiveHostedThreadRouteContainerAccess:
    mocks.assertActiveHostedThreadRouteContainerAccess,
}));

import {
  readCurrentHostedMemberDirectRoute,
  readCurrentHostedMemberVerifiedEmailAddress,
} from "@/src/lib/hosted-routing/member-direct-route";

const prisma = {} as Parameters<
  typeof readCurrentHostedMemberDirectRoute
>[0]["prisma"];

describe("current hosted member direct route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedThreadRouteContainerAccess.mockResolvedValue(undefined);
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([]);
  });

  it("prefers the current Linq home route and verifies active access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: " linq_home_123 ",
      telegramThreadId: "telegram_home_123",
    });

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({ channel: "linq", threadId: "linq_home_123" });
    expect(mocks.readHostedMemberVerifiedEmailSnapshots).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });

  it("falls back to Telegram and fails closed on revoked access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      telegramThreadId: "telegram_home_123",
    });
    mocks.assertActiveHostedThreadRouteContainerAccess.mockRejectedValue(
      new Error("access revoked"),
    );

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).rejects.toThrow("access revoked");
  });

  it("falls back to the member's verified email and verifies active access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      telegramThreadId: null,
    });
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([{
      memberId: "member_123",
      verifiedEmail: {
        address: " member@example.test ",
        lookupKey: "hbidx:email:v1:member",
        verifiedAt: new Date("2026-07-23T12:00:00.000Z"),
      },
    }]);

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({
      channel: "email",
      deliveryTarget: "member@example.test",
    });
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });

  it("returns no route without performing an access assertion", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: " ",
      telegramThreadId: null,
    });

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toBeNull();
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).not.toHaveBeenCalled();
  });

  it("re-resolves the current verified email and enforces active access", async () => {
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([{
      memberId: "member_123",
      verifiedEmail: {
        address: " current@example.test ",
        lookupKey: "hbidx:email:v1:current",
        verifiedAt: new Date("2026-07-23T12:00:00.000Z"),
      },
    }]);

    await expect(readCurrentHostedMemberVerifiedEmailAddress({
      memberId: "member_123",
      prisma,
    })).resolves.toBe("current@example.test");
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });
});
