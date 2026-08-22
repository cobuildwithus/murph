import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  scheduleHostedSignupNotificationEmails,
  sendHostedSignupNotificationEmailForMember,
  sendHostedSignupNotificationEmailForMemberBestEffort,
} from "@/src/lib/hosted-onboarding/signup-notification-email";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));

vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

const mocks = vi.hoisted(() => ({
  claimHostedMemberSignupNotificationEmailAttempt: vi.fn(),
  getPrisma: vi.fn(),
  prisma: {
    hostedMember: {
      findUnique: vi.fn(),
    },
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberSignupNotificationContext: vi.fn(),
}));

vi.mock("@/src/lib/prisma", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/prisma")>(
    "@/src/lib/prisma",
  );

  return {
    ...actual,
    getPrisma: mocks.getPrisma,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    claimHostedMemberSignupNotificationEmailAttempt:
      mocks.claimHostedMemberSignupNotificationEmailAttempt,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
    readHostedMemberSignupNotificationContext:
      mocks.readHostedMemberSignupNotificationContext,
  };
});

describe("hosted signup notification email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimHostedMemberSignupNotificationEmailAttempt.mockResolvedValue(true);
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [],
      billingStatus: "active",
      suspendedAt: null,
      threadContainer: null,
    });
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: null,
    });
    mocks.readHostedMemberSignupNotificationContext.mockResolvedValue({
      context: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips when HOSTED_SIGNUP_NOTIFICATION_EMAILS is unset", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      reason: "not_configured",
      status: "skipped",
    });

    expect(mocks.getPrisma).toHaveBeenCalledOnce();
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledWith({
      attemptedAt: expect.any(Date),
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("sends to multiple comma-separated recipients", async () => {
    mocks.readHostedMemberSignupNotificationContext.mockResolvedValue({
      context: {
        schema: "murph.hosted-signup-notification-context.v1",
        occurredAt: "2026-08-21T00:07:00.000Z",
        surface: "website",
        timeZone: "America/New_York",
        location: {
          city: "Atlanta",
          country: "US",
          countryRegion: "GA",
        },
      },
      createdAt: new Date("2026-08-21T00:07:00.000Z"),
    });
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer\s+\S+$/u),
        "Content-Type": "application/json",
        "Idempotency-Key": "hosted-signup-notification/member_123",
      });

      const payload = JSON.parse(String(init?.body));
      expect(payload).toEqual({
        from: "Murph <welcome@example.com>",
        subject: "New Murph signup near Atlanta",
        text: [
          "New Murph signup near Atlanta.",
          "",
          "Signed up: Aug 20, 2026, 8:07 PM (America/New_York)",
          "Signed up via: Website",
          "Approximate location (network): Atlanta, GA, US",
        ].join("\n"),
        to: ["Founder@example.com", "cofounder@example.com"],
      });
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      activationSurface: "telegram",
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "Founder@example.com, cofounder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledWith({
      attemptedAt: expect.any(Date),
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("dedupes repeated recipient emails", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.to).toEqual(["founder@example.com", "cofounder@example.com"]);

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS:
          "founder@example.com, FOUNDER@example.com\ncofounder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it.each([
    {
      accountGroupMemberships: [],
      billingStatus: "past_due",
      suspendedAt: null,
      threadContainer: null,
    },
    {
      accountGroupMemberships: [],
      billingStatus: "active",
      suspendedAt: new Date("2026-05-03T00:00:00.000Z"),
      threadContainer: null,
    },
  ])(
    "skips members without canonical active access (%s)",
    async (memberAccess) => {
      const fetchMock: typeof fetch = async () => {
        throw new Error("fetch should not be called");
      };
      mocks.prisma.hostedMember.findUnique.mockResolvedValue(memberAccess);
      mocks.readHostedMemberCoreState.mockResolvedValue({
        billingStatus: memberAccess.billingStatus,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt: memberAccess.suspendedAt,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      });

      await expect(sendHostedSignupNotificationEmailForMember({
        env: {
          HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
          HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
          RESEND_API_KEY: "re_test",
        },
        fetchImpl: fetchMock,
        memberId: "member_123",
      })).resolves.toEqual({
        reason: "member_not_active",
        status: "skipped",
      });

      expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
      expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).not.toHaveBeenCalled();
    },
  );

  it("sends for active Family access without presenting direct billing as access state", async () => {
    mocks.prisma.hostedMember.findUnique.mockResolvedValue({
      accountGroupMemberships: [{
        group: {
          billingStatus: "active",
          suspendedAt: null,
        },
        status: "active",
      }],
      billingStatus: "canceled",
      suspendedAt: null,
      threadContainer: null,
    });
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain("Signed up: May 1, 2026, 12:00 AM (UTC)");
      expect(payload.text).not.toContain("Member ID:");
      expect(payload.text).not.toContain("Billing status:");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      activationSurface: "website",
    })).resolves.toMatchObject({ status: "sent" });

    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledOnce();
  });

  it("skips when the notification attempt was already claimed", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    mocks.claimHostedMemberSignupNotificationEmailAttempt.mockResolvedValue(false);

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      now: new Date("2026-05-04T00:00:00.000Z"),
    })).resolves.toEqual({
      reason: "already_attempted",
      status: "skipped",
    });

    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-05-04T00:00:00.000Z"),
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("claims and sends a truthful fallback when optional context is unavailable", async () => {
    mocks.readHostedMemberSignupNotificationContext.mockResolvedValue({
      context: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({
        subject: "New Murph signup",
        text: [
          "New Murph signup.",
          "",
          "Signed up: May 1, 2026, 12:00 AM (UTC)",
          "Activated via: Telegram",
        ].join("\n"),
      });

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      activationSurface: "telegram",
    })).resolves.toMatchObject({ status: "sent" });
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledOnce();
  });

  it("claims and sends the fallback when optional email authorization is unreadable", async () => {
    mocks.readHostedMemberSignupNotificationContext.mockResolvedValue({
      context: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberEmailAuthorization.mockRejectedValue(
      new Error("synthetic email authorization decrypt failure"),
    );
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toBe([
        "New Murph signup.",
        "",
        "Signed up: May 1, 2026, 12:00 AM (UTC)",
        "Activated via: Telegram",
      ].join("\n"));
      expect(payload.text).not.toContain("Email:");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    });

    await expect(sendHostedSignupNotificationEmailForMember({
      activationSurface: "telegram",
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toMatchObject({ status: "sent" });
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("includes verified email when available", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain("Email: verified@example.com");
      expect(payload.text).not.toContain("payer@example.com");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      verifiedEmail: {
        address: "verified@example.com",
        lookupKey: "lookup",
        verifiedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
    });

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toMatchObject({
      status: "sent",
    });
  });

  it("falls back to Stripe checkout email", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain("Email: payer@example.com");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      verifiedEmail: null,
    });

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toMatchObject({
      status: "sent",
    });
  });

  it("does not throw from the best-effort wrapper when Resend fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
      });

    await expect(sendHostedSignupNotificationEmailForMemberBestEffort({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith("Hosted signup notification email send failed.", {
      errorCode: "RESEND_SEND_FAILED",
      providerStatus: 401,
    });
  });

  it("does not log thrown provider error messages from the best-effort wrapper", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock: typeof fetch = async () => {
      throw new Error(
        "delivery failed for founder@example.com with api key re_sensitive_test",
      );
    };

    await expect(sendHostedSignupNotificationEmailForMemberBestEffort({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "founder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_sensitive_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith("Hosted signup notification email send failed.", {
      errorName: "Error",
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("founder@example.com");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("re_sensitive_test");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("delivery failed");
  });

  it("registers one post-response task and sends distinct members serially", async () => {
    vi.stubEnv("HOSTED_SIGNUP_NOTIFICATION_EMAILS", "founder@example.com");
    vi.stubEnv(
      "HOSTED_SIGNUP_WELCOME_EMAIL_FROM",
      "Murph <welcome@example.com>",
    );
    vi.stubEnv("RESEND_API_KEY", "re_test");
    let requestsInFlight = 0;
    let peakRequestsInFlight = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requestsInFlight += 1;
      peakRequestsInFlight = Math.max(
        peakRequestsInFlight,
        requestsInFlight,
      );
      await Promise.resolve();
      requestsInFlight -= 1;
      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    scheduleHostedSignupNotificationEmails({
      activationSurface: "website",
      memberIds: ["member_1", "member_2", "member_1"],
      prisma: mocks.prisma as never,
    });

    expect(nextServerMocks.after).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    const task = nextServerMocks.after.mock.calls[0]?.[0];
    if (!task) {
      throw new Error("Expected one scheduled signup-notification task.");
    }
    await task();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(peakRequestsInFlight).toBe(1);
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt)
      .toHaveBeenNthCalledWith(1, expect.objectContaining({ memberId: "member_1" }));
    expect(mocks.claimHostedMemberSignupNotificationEmailAttempt)
      .toHaveBeenNthCalledWith(2, expect.objectContaining({ memberId: "member_2" }));
  });
});
