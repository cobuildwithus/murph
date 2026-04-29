import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPrivySession: vi.fn(),
  getPrisma: vi.fn(),
  prisma: { __tag: "page-auth-prisma" },
  resolvePrivyMemberAuthFromSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  getHostedPrivySession: mocks.getHostedPrivySession,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  resolvePrivyMemberAuthFromSession: mocks.resolvePrivyMemberAuthFromSession,
}));

describe("hosted page auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedPrivySession.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.resolvePrivyMemberAuthFromSession.mockResolvedValue({
      member: null,
      memberLookup: null,
    });
  });

  it("returns an anonymous snapshot when no hosted Privy session exists", async () => {
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      linkedAccounts: [],
      memberLookup: null,
      session: null,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("degrades invalid hosted Privy cookies to an anonymous snapshot", async () => {
    const { hostedOnboardingError } = await import("@/src/lib/hosted-onboarding/errors");
    mocks.getHostedPrivySession.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_AUTH_FAILED",
        message: "We could not verify your Privy session. Request a fresh code and try again.",
        httpStatus: 401,
      }),
    );
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      linkedAccounts: [],
      memberLookup: null,
      session: null,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("rethrows unexpected session failures", async () => {
    const error = new Error("privy verifier misconfigured");
    mocks.getHostedPrivySession.mockRejectedValue(error);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).rejects.toBe(error);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("returns the member-backed snapshot when the hosted Privy session verifies", async () => {
    const session = {
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ],
      memberId: "member_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    };
    const member = createHostedMember();
    const memberLookup = {
      core: member,
      identity: {
        memberId: member.id,
        phoneNumber: "+14155552671",
        phoneNumberVerifiedAt: new Date("2025-03-05T18:27:00.000Z"),
        privyUserId: "did:privy:user_123",
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      matchedBy: ["privyUserId"],
    };
    mocks.getHostedPrivySession.mockResolvedValue(session);
    mocks.resolvePrivyMemberAuthFromSession.mockResolvedValue({
      member,
      memberLookup,
    });
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      linkedAccounts: session.linkedAccounts,
      memberLookup,
      session,
    });
    expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
    expect(mocks.resolvePrivyMemberAuthFromSession).toHaveBeenCalledWith({
      identity: session.identity,
      memberId: "member_123",
      prisma: mocks.prisma,
    });
  });
});

describe("hosted sidebar auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedPrivySession.mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.resolvePrivyMemberAuthFromSession.mockResolvedValue({
      member: null,
      memberLookup: null,
    });
  });

  it("returns anonymous sidebar auth without resolving member state", async () => {
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      label: null,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("returns only the browser-safe sidebar label for a verified session", async () => {
    mocks.getHostedPrivySession.mockResolvedValue({
      identity: {
        email: {
          address: "test@example.com",
          verifiedAt: 1741194420,
        },
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        telegram: null,
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: "member_123",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      label: "test@example.com",
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("degrades Privy session-shape errors to anonymous sidebar auth", async () => {
    const { hostedOnboardingError } = await import("@/src/lib/hosted-onboarding/errors");
    mocks.getHostedPrivySession.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_ACCOUNT_REQUIRED",
        message: "Finish email, phone, or Telegram verification before continuing.",
        httpStatus: 400,
      }),
    );
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      label: null,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });

  it("rethrows Privy configuration failures", async () => {
    const { hostedOnboardingError } = await import("@/src/lib/hosted-onboarding/errors");
    const error = hostedOnboardingError({
      code: "PRIVY_CONFIG_REQUIRED",
      message: "Privy config is required.",
      httpStatus: 500,
    });
    mocks.getHostedPrivySession.mockRejectedValue(error);
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).rejects.toBe(error);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.resolvePrivyMemberAuthFromSession).not.toHaveBeenCalled();
  });
});

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    ...overrides,
  };
}
