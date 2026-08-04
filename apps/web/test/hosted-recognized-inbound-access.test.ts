import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedInviteUrl: vi.fn((inviteCode: string) =>
    `https://withmurph.ai/join/${inviteCode}`
  ),
  issueHostedInvite: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInviteUrl: mocks.buildHostedInviteUrl,
  issueHostedInvite: mocks.issueHostedInvite,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

import {
  resolveHostedRecognizedInboundAccess,
} from "@/src/lib/hosted-onboarding/recognized-inbound-access";

describe("recognized inbound access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through active access without issuing an invite", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });

    await expect(resolveHostedRecognizedInboundAccess({
      allowSignupFallback: true,
      inviteChannel: "linq",
      member: { id: "member_active", suspendedAt: null },
      noticeSeed: "event_active",
      prisma: {} as never,
    })).resolves.toEqual({ kind: "allowed" });

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });

  it("preserves the canonical billing notice for recoverable access", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "hosted_access_inactive",
      retryAfter: new Date("2026-07-25T12:15:00.000Z"),
      userNotice: {
        code: "billing_inactive",
        message: "Billing needs attention.",
      },
    });

    await expect(resolveHostedRecognizedInboundAccess({
      allowSignupFallback: true,
      inviteChannel: "web",
      member: { id: "member_lapsed", suspendedAt: null },
      noticeSeed: "event_lapsed",
      prisma: {} as never,
    })).resolves.toEqual({
      kind: "access_notice",
      message: "Billing needs attention.",
      noticeCode: "billing_inactive",
      responseReason: "sent-billing-inactive-notice",
    });

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });

  it("returns the Settings recovery path after health-data withdrawal", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "health_data_consent_withdrawn",
      retryAfter: new Date("2026-07-25T12:15:00.000Z"),
      userNotice: {
        code: "health_data_consent_withdrawn",
        message: "Murph is paused. Use Murph again in Settings.",
      },
    });

    await expect(resolveHostedRecognizedInboundAccess({
      allowSignupFallback: true,
      inviteChannel: "linq",
      member: { id: "member_withdrawn", suspendedAt: null },
      noticeSeed: "event_withdrawn",
      prisma: {} as never,
    })).resolves.toEqual({
      kind: "access_notice",
      message: "Murph is paused. Use Murph again in Settings.",
      noticeCode: "health_data_consent_withdrawn",
      responseReason: "sent-health-data-consent-withdrawn-notice",
    });

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });

  it("returns a fresh signup handoff for a recognized member with no billing to recover", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "hosted_access_inactive",
      retryAfter: new Date("2026-07-25T12:15:00.000Z"),
      userNotice: null,
    });
    mocks.issueHostedInvite.mockResolvedValue({
      id: "invite_123",
      inviteCode: "code_123",
    });

    await expect(resolveHostedRecognizedInboundAccess({
      allowSignupFallback: true,
      inviteChannel: "linq",
      member: { id: "member_signup", suspendedAt: null },
      noticeSeed: "event_signup",
      prisma: {} as never,
    })).resolves.toEqual({
      inviteCode: "code_123",
      inviteId: "invite_123",
      joinUrl: "https://withmurph.ai/join/code_123",
      kind: "signup",
      message:
        "Murph isn't fully set up on this account yet. Finish setup here:\nhttps://withmurph.ai/join/code_123",
      responseReason: "sent-signup-link",
    });
    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "linq",
      memberId: "member_signup",
      prisma: {},
    });
  });

  it("answers a suspended recognized account without exposing why it was suspended", async () => {
    const resolution = await resolveHostedRecognizedInboundAccess({
      allowSignupFallback: true,
      inviteChannel: "web",
      member: {
        id: "member_suspended",
        suspendedAt: new Date("2026-07-25T12:00:00.000Z"),
      },
      noticeSeed: "event_suspended",
      prisma: {} as never,
    });

    expect(resolution).toMatchObject({
      kind: "access_notice",
      noticeCode: "billing_inactive",
      responseReason: "sent-account-unavailable-notice",
    });
    expect(resolution.kind === "access_notice" ? resolution.message : "")
      .not.toMatch(/refund|dispute|suspend/iu);
    expect(mocks.readHostedRuntimeAiAccessDecision).not.toHaveBeenCalled();
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });
});
