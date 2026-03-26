import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    isProduction: true,
    sessionCookieName: "hb_hosted_session",
    sessionTtlDays: 30,
  }),
}));

import { hashHostedSessionToken } from "@/src/lib/hosted-onboarding/shared";
import {
  createHostedSession,
  revokeHostedSessionFromRequest,
} from "@/src/lib/hosted-onboarding/session";

const NOW = new Date("2026-03-26T12:00:00.000Z");

describe("hosted onboarding session lifecycle", () => {
  let prisma: {
    hostedSession: {
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      hostedSession: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
  });

  it("revokes older active sessions when a new hosted session is created", async () => {
    const result = await createHostedSession({
      inviteId: "invite-1",
      memberId: "member-1",
      now: NOW,
      prisma: prisma as never,
      userAgent: "test-agent",
    });

    expect(prisma.hostedSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: expect.any(Date),
        id: result.sessionId,
        inviteId: "invite-1",
        lastSeenAt: NOW,
        memberId: "member-1",
        tokenHash: expect.any(String),
        userAgent: "test-agent",
      }),
    });
    expect(prisma.hostedSession.updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: NOW,
        },
        id: {
          not: result.sessionId,
        },
        memberId: "member-1",
        revokedAt: null,
      },
      data: {
        revokedAt: NOW,
        revokeReason: "rotated",
      },
    });
  });

  it("revokes the stored session record when logout presents the hosted session cookie", async () => {
    const revoked = await revokeHostedSessionFromRequest(
      new Request("https://join.example.test/api/hosted-onboarding/session/logout", {
        headers: {
          cookie: "other=value; hb_hosted_session=session-token; third=1",
        },
        method: "POST",
      }),
      prisma as never,
      NOW,
    );

    expect(revoked).toBe(true);
    expect(prisma.hostedSession.updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: NOW,
        },
        revokedAt: null,
        tokenHash: hashHostedSessionToken("session-token"),
      },
      data: {
        revokedAt: NOW,
        revokeReason: "logout",
      },
    });
  });
});
