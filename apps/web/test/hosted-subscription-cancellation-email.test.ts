import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendHostedSubscriptionCancellationEmailForMember,
} from "@/src/lib/hosted-onboarding/subscription-cancellation-email";

const mocks = vi.hoisted(() => ({
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
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
  };
});

describe("hosted subscription cancellation email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "canceled",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: {
        address: "member@example.com",
      },
    });
  });

  it("sends the founder cancellation feedback email through Resend", async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      expect(input).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer\s+\S+$/u),
        "Content-Type": "application/json",
        "Idempotency-Key": "hosted-subscription-cancellation/sub_123",
      });

      const payload = JSON.parse(String(init?.body));
      expect(payload).toEqual({
        from: "Murph founder <founder@example.com>",
        subject: "Quick question about your Murph subscription",
        text: expect.stringContaining("I saw your subscription was canceled"),
        to: ["member@example.com"],
      });
      expect(payload).not.toHaveProperty("html");
      expect(payload.text).toContain("If you want a refund, reply here");
      expect(payload.text).toContain("Best,\nMurph founder");
      expect(payload.text).not.toContain("<");
      expect(payload.text).not.toContain("style=");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };

    await expect(sendHostedSubscriptionCancellationEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      stripeSubscriptionId: "sub_123",
    })).resolves.toEqual({
      status: "sent",
    });
  });

  it("uses Stripe checkout email when no verified email is linked", async () => {
    const fetchMock: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.to).toEqual(["payer@example.com"]);
      expect(payload).not.toHaveProperty("html");

      return new Response(JSON.stringify({ id: "resend_email_123" }), {
        status: 200,
      });
    };
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
      },
      verifiedEmail: null,
    });

    await expect(sendHostedSubscriptionCancellationEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: fetchMock,
      memberId: "member_123",
      stripeSubscriptionId: "sub_123",
    })).resolves.toEqual({
      status: "sent",
    });
  });

  it("skips when Resend is not configured", async () => {
    await expect(sendHostedSubscriptionCancellationEmailForMember({
      env: {},
      fetchImpl: vi.fn() as unknown as typeof fetch,
      memberId: "member_123",
      stripeSubscriptionId: "sub_123",
    })).resolves.toEqual({
      reason: "not_configured",
      status: "skipped",
    });
  });

  it("skips members that are not currently canceled", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue({
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    await expect(sendHostedSubscriptionCancellationEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      memberId: "member_123",
      stripeSubscriptionId: "sub_123",
    })).resolves.toEqual({
      reason: "member_not_canceled",
      status: "skipped",
    });

    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
  });

  it("throws only provider status metadata for Resend failures", async () => {
    await expect(sendHostedSubscriptionCancellationEmailForMember({
      env: {
        HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME: "Murph founder",
        HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph founder <founder@example.com>",
        RESEND_API_KEY: "re_test",
      },
      fetchImpl: async () => new Response("bad", { status: 503 }),
      memberId: "member_123",
      stripeSubscriptionId: "sub_123",
    })).rejects.toMatchObject({
      code: "RESEND_SEND_FAILED",
      providerStatus: 503,
    });
  });
});
