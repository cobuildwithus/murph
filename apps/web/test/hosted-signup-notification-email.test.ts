import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendHostedSignupNotificationEmailForMember,
  sendHostedSignupNotificationEmailForMemberBestEffort,
} from "@/src/lib/hosted-onboarding/signup-notification-email";

const mocks = vi.hoisted(() => ({
  claimHostedMemberSignupNotificationEmailAttempt: vi.fn(),
  getPrisma: vi.fn(),
  prisma: {
    readonly: true,
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
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
  };
});

describe("hosted signup notification email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimHostedMemberSignupNotificationEmailAttempt.mockResolvedValue(true);
    mocks.getPrisma.mockReturnValue(mocks.prisma);
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

    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberCoreState).not.toHaveBeenCalled();
  });

  it("sends to multiple comma-separated recipients", async () => {
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
        subject: "New Murph signup",
        text: [
          "New Murph signup.",
          "",
          "Member ID: member_123",
          "Billing status: active",
          "Stripe event: invoice.paid",
          "Stripe event ID: evt_123",
        ].join("\n"),
        to: ["Founder@example.com", "cofounder@example.com"],
      });
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupNotificationEmailForMember({
      env: {
        HOSTED_SIGNUP_NOTIFICATION_EMAILS: "Founder@example.com, cofounder@example.com",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <welcome@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      sourceEventId: "evt_123",
      sourceEventType: "invoice.paid",
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
      billingStatus: "past_due",
      suspendedAt: null,
    },
    {
      billingStatus: "active",
      suspendedAt: new Date("2026-05-03T00:00:00.000Z"),
    },
  ])(
    "skips members without active unsuspended billing access (%s)",
    async ({ billingStatus, suspendedAt }) => {
      const fetchMock: typeof fetch = async () => {
        throw new Error("fetch should not be called");
      };
      mocks.readHostedMemberCoreState.mockResolvedValue({
        billingStatus,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "member_123",
        suspendedAt,
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
});
