import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedSignupWelcomeEmailError,
  sendHostedSignupWelcomeEmail,
  sendHostedSignupWelcomeEmailForMemberBestEffort,
  sendHostedSignupWelcomeEmailForMember,
  sendHostedSignupWelcomeEmailForRecentMember,
} from "@/src/lib/hosted-onboarding/signup-welcome-email";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  prisma: {
    hostedMember: {
      updateMany: vi.fn(),
    },
    readonly: true,
  },
  readHostedMemberCoreState: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
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
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-routing-store");

  return {
    ...actual,
    readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  };
});

describe("hosted signup welcome email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.prisma.hostedMember.updateMany.mockResolvedValue({
      count: 1,
    });
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  });

  it("sends the configured founder welcome through Resend with a member idempotency key", async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer\s+\S+$/u),
        "Content-Type": "application/json",
        "Idempotency-Key": "hosted-signup-welcome/member_123",
      });

      const payload = JSON.parse(String(init?.body));
      expect(payload).toEqual({
        from: "Murph founder <founder@example.com>",
        subject: "Welcome to Murph",
        text: expect.stringContaining("I'm Murph founder, the founder."),
        to: ["member@example.com"],
      });
      expect(payload).not.toHaveProperty("html");
      expect(payload.text).toContain("- Murph founder");
      expect(payload.text).toContain("Hit reply if anything's confusing or broken.");
      expect(payload.text).not.toContain("<");
      expect(payload.text).not.toContain("style=");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSignupWelcomeEmail({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      recipientEmail: "member@example.com",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("includes the assigned Murph text route for member welcome sends", async () => {
    const fetchMock = vi.fn(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Best next step: bring Murph one real health question, task, data point, decision, or goal.",
      );
      expect(payload.text).toContain(
        "Text Murph at (+1) 555-010-0099 with whatever is on your mind about your health.",
      );
      expect(payload.text).not.toContain(
        "connect your wearable",
      );
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "chat_123",
      linqRecipientPhone: "+15550100099",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.prisma.hostedMember.updateMany).toHaveBeenCalledWith({
      data: {
        signupWelcomeEmailAttemptedAt: expect.any(Date),
      },
      where: {
        billingStatus: "active",
        id: "member_123",
        signupWelcomeEmailAttemptedAt: null,
        suspendedAt: null,
      },
    });
    expect(
      mocks.prisma.hostedMember.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(fetchMock).mock.invocationCallOrder[0]);
  });

  it("falls back to the Murph Telegram route when the member is linked on Telegram", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Message Murph on Telegram at @murph_test_bot with whatever is on your mind about your health.",
      );
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: null,
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
        TELEGRAM_BOT_USERNAME: "murph_test_bot",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("uses the Murph Telegram username override in welcome copy", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Message Murph on Telegram at @murphdevelopment_bot with whatever is on your mind about your health.",
      );
      expect(payload.text).not.toContain("@murph_test_bot");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: null,
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        MURPH_TELEGRAM_USERNAME_OVERRIDE: "@murphdevelopment_bot",
        RESEND_API_KEY: "re_test",
        TELEGRAM_BOT_USERNAME: "murph_test_bot",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("falls back to the legacy Telegram bot username when the welcome override is invalid", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Message Murph on Telegram at @murph_test_bot with whatever is on your mind about your health.",
      );
      expect(payload.text).not.toContain("not valid");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: null,
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        MURPH_TELEGRAM_USERNAME_OVERRIDE: "not valid",
        RESEND_API_KEY: "re_test",
        TELEGRAM_BOT_USERNAME: "murph_test_bot",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("falls back to the Murph email route when no chat route is assigned yet", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Email Murph at mail@mail.withmurph.ai. Murph will send a private reply so you can start the conversation securely.",
      );
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("sends for recently created members when email is linked after signup", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.text).toContain(
        "Email Murph at mail@mail.withmurph.ai. Murph will send a private reply so you can start the conversation securely.",
      );

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });

    await expect(sendHostedSignupWelcomeEmailForRecentMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      now: new Date("2026-05-14T23:59:59.999Z"),
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });

    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });

  it("skips later email-link sends for accounts that are not less than two weeks old", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    await expect(sendHostedSignupWelcomeEmailForRecentMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      now: new Date("2026-05-15T00:00:00.000Z"),
    })).resolves.toEqual({
      reason: "member_too_old",
      status: "skipped",
    });

    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
  });

  it("uses the unverified Stripe checkout email when no verified email is linked yet", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.to).toEqual(["payer@example.com"]);
      expect(payload.text).toContain("Hey, welcome to Murph!");
      expect(payload.text).toContain(
        "Best next step: connect any data you want Murph to use, then start with one real health need.",
      );
      expect(payload.text).not.toContain("Shoot Murph an email at");
      expect(payload.text).not.toContain("mail@mail.withmurph.ai");

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

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("skips sending for members without a welcome email recipient", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: null,
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      reason: "no_welcome_email_recipient",
      status: "skipped",
    });

    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("skips member sends until the member has active billing", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    mocks.readHostedMemberCoreState.mockResolvedValueOnce({
      billingStatus: "not_started",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      reason: "member_not_active",
      status: "skipped",
    });

    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("skips member sends without burning the durable attempt marker when Resend is not configured", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      reason: "not_configured",
      status: "skipped",
    });

    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });

  it("skips member sends when the durable attempt marker is already claimed", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };

    mocks.prisma.hostedMember.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });

    await expect(sendHostedSignupWelcomeEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toEqual({
      reason: "already_attempted",
      status: "skipped",
    });
  });

  it("skips sending until all sender env config is present", async () => {
    let called = false;
    const fetchMock: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };

    await expect(sendHostedSignupWelcomeEmail({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      recipientEmail: "member@example.com",
    })).resolves.toEqual({
      reason: "not_configured",
      status: "skipped",
    });
    expect(called).toBe(false);
  });

  it("throws only provider status metadata for Resend failures", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
      });

    await expect(sendHostedSignupWelcomeEmail({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      recipientEmail: "member@example.com",
    })).rejects.toMatchObject({
      code: "RESEND_SEND_FAILED",
      providerStatus: 401,
    } satisfies Partial<HostedSignupWelcomeEmailError>);
  });

  it("logs sanitized metadata and resolves when the best-effort member send fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
      });

    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "member@example.com",
      },
    });

    await expect(sendHostedSignupWelcomeEmailForMemberBestEffort({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
    })).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith("Hosted signup welcome email send failed.", {
      errorCode: "RESEND_SEND_FAILED",
      providerStatus: 401,
    });
  });
});
