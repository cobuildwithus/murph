import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  issueHostedInvite: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberOwnsSubscription: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.issueHostedInvite,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberOwnsSubscription: mocks.readHostedMemberOwnsSubscription,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

describe("/join session resume page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.readHostedMemberOwnsSubscription.mockResolvedValue(false);
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
    mocks.issueHostedInvite.mockResolvedValue({
      inviteCode: "resume invite",
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
  });

  it("redirects anonymous visitors to the public entry", async () => {
    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it.each([
    HostedBillingStatus.incomplete,
    HostedBillingStatus.not_started,
  ])("reuses or creates a web invite for %s members", async (billingStatus) => {
    const member = createHostedMember({
      billingStatus,
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage()).rejects.toThrow(
      "NEXT_REDIRECT:/join/resume%20invite",
    );

    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/join/resume%20invite");
  });

  it("preserves a Family success Session for immediate verified reconciliation", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage({
      family_checkout: "success",
      session_id: "cs_test_familySuccess123",
    })).rejects.toThrow(
      "NEXT_REDIRECT:/join/resume%20invite/success?session_id=cs_test_familySuccess123",
    );

    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
    });
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/join/resume%20invite/success?session_id=cs_test_familySuccess123",
    );
  });

  it("redirects active members home without issuing an invite", async () => {
    const member = createHostedMember();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/home");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/home");
  });

  it("redirects paused members to the Subscription controls without issuing a fresh checkout invite", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.paused,
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/settings#subscription");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/settings#subscription");
  });

  it("redirects Family-sponsored members home without issuing an invite", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/home");

    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/home");
  });

  it("sends a lapsed member to the Subscription controls", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.past_due,
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/settings#subscription");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/settings#subscription");
  });

  it("sends an incomplete member who already owns a subscription to the Subscription controls", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.incomplete,
    });
    mocks.readHostedMemberOwnsSubscription.mockResolvedValue(true);
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    // Owning a subscription means recovery, not a first checkout, so this member
    // must reach billing controls rather than a new invite or a generic dashboard.
    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/settings#subscription");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/settings#subscription");
    expect(mocks.redirect).not.toHaveBeenCalledWith("/home");
  });

  it("does not issue an invite for blocked members", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.past_due,
      suspendedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: true,
      authenticatedMember: member,
      session: {
        expiresAt: new Date("2026-06-25T00:00:00.000Z"),
        member,
        privyUserId: "did:privy:user_123",
        sessionId: "hws_123",
      },
    });

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
});

async function renderJoinResumePage(searchParams: {
  family_checkout?: string | string[];
  session_id?: string | string[];
} = {}) {
  const { default: JoinResumePage } = await import("../app/join/page");
  return JoinResumePage({
    searchParams: Promise.resolve(searchParams),
  });
}

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    assistantPersona: null,
    assistantPersonaCausalSeq: null,
    assistantDetail: null,
    assistantDetailCausalSeq: null,
    assistantHumor: null,
    assistantHumorCausalSeq: null,
    assistantModelPreference: null,
    assistantProviderPreference: null,
    assistantReasoningEffortPreference: null,
    assistantPush: null,
    assistantPushCausalSeq: null,
    assistantUnhinged: null,
    assistantUnhingedCausalSeq: null,
    assistantTone: null,
    assistantToneCausalSeq: null,
    assistantVoice: null,
    assistantVoiceCausalSeq: null,
    initialOnboardingCompletedAt: null,
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationContextEncrypted: null,
    signupNotificationContextExpiresAt: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    usageCreditBalanceUsdMicros: null,
    usageCreditLedgerVersion: null,
    ...overrides,
  };
}
