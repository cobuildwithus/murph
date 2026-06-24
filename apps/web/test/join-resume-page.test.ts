import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  issueHostedInvite: vi.fn(),
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

describe("/join session resume page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
    mocks.issueHostedInvite.mockResolvedValue({
      inviteCode: "resume invite",
    });
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

  it("does not issue an invite for blocked members", async () => {
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

    await expect(renderJoinResumePage()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
});

async function renderJoinResumePage() {
  const { default: JoinResumePage } = await import("../app/join/page");
  return JoinResumePage();
}

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}
