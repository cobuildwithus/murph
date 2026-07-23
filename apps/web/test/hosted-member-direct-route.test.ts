import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedThreadRouteContainerAccess: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
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
} from "@/src/lib/hosted-routing/member-direct-route";

const prisma = {} as Parameters<
  typeof readCurrentHostedMemberDirectRoute
>[0]["prisma"];

describe("current hosted member direct route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedThreadRouteContainerAccess.mockResolvedValue(undefined);
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
});
