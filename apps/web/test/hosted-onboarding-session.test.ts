import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostedMemberStatus } from "@prisma/client";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    isProduction: true,
    sessionCookieName: "hosted_session",
    sessionTtlDays: 30,
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
}));

import { hashHostedSessionToken } from "@/src/lib/hosted-onboarding/shared";
import {
  createHostedSession,
  resolveHostedSessionFromRequest,
  revokeHostedSessionFromRequest,
} from "@/src/lib/hosted-onboarding/session";

const NOW = new Date("2026-03-26T12:00:00.000Z");

describe("hosted onboarding session lifecycle", () => {
  let prisma: {
    hostedMember: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    hostedSession: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          status: HostedMemberStatus.active,
        }),
      },
      hostedSession: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
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
    });

    expect(prisma.hostedSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: expect.any(Date),
        id: result.sessionId,
        inviteId: "invite-1",
        lastSeenAt: NOW,
        memberId: "member-1",
        tokenHash: expect.any(String),
      }),
    });
    expect(prisma.hostedSession.create.mock.calls[0]?.[0].data).not.toHaveProperty("userAgent");
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

  it("refuses to create a hosted session for a suspended member", async () => {
    prisma.hostedMember.findUnique.mockResolvedValue({
      status: HostedMemberStatus.suspended,
    });

    await expect(
      createHostedSession({
        inviteId: "invite-1",
        memberId: "member-1",
        now: NOW,
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });

    expect(prisma.hostedSession.create).not.toHaveBeenCalled();
  });

  it("stops persisting raw user-agent data", async () => {
    await createHostedSession({
      inviteId: "invite-1",
      memberId: "member-1",
      now: NOW,
      prisma: prisma as never,
    });

    const createInput = prisma.hostedSession.create.mock.calls[0]?.[0];
    expect(createInput.data).toEqual(
      expect.objectContaining({
        inviteId: "invite-1",
        lastSeenAt: NOW,
        memberId: "member-1",
      }),
    );
    expect(createInput.data).not.toHaveProperty("userAgent");
  });

  it("revokes the stored session record when logout presents the hosted session cookie", async () => {
    const revoked = await revokeHostedSessionFromRequest(
      new Request("https://join.example.test/api/hosted-onboarding/session/logout", {
        headers: {
          cookie: "other=value; hosted_session=session-token; third=1",
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

  it("treats a suspended member session as invalid and revokes the cookie-backed session", async () => {
    prisma.hostedSession.findFirst.mockResolvedValue({
      expiresAt: new Date("2026-03-30T12:00:00.000Z"),
      id: "session-1",
      member: {
        status: HostedMemberStatus.suspended,
      },
      revokedAt: null,
    });

    await expect(
      resolveHostedSessionFromRequest(
        new Request("https://join.example.test/join/invite-1", {
          headers: {
            cookie: "hosted_session=session-token",
          },
        }),
        prisma as never,
        NOW,
      ),
    ).resolves.toBeNull();

    expect(prisma.hostedSession.updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: NOW,
        },
        id: "session-1",
        revokedAt: null,
      },
      data: {
        revokedAt: NOW,
        revokeReason: "member_suspended",
      },
    });
  });
});
