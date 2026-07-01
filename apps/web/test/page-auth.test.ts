import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedAppSession: vi.fn(),
  hasActiveHostedFamilyAccess: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSession: mocks.getHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  hasActiveHostedFamilyAccess: mocks.hasActiveHostedFamilyAccess,
}));

describe("hosted page auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
    mocks.hasActiveHostedFamilyAccess.mockResolvedValue(false);
  });

  it("returns an anonymous snapshot when no hosted app session exists", async () => {
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
  });

  it("returns the member-backed snapshot when the hosted app session verifies", async () => {
    const member = createHostedMember();
    const session = {
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member,
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    };
    mocks.getHostedAppSession.mockResolvedValue(session);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      session,
    });
  });

  it("returns an anonymous snapshot when the hosted session table is missing", async () => {
    mocks.getHostedAppSession.mockRejectedValue(Object.assign(
      new Error("The table `public.hosted_web_session` does not exist in the current database."),
      {
        code: "P2021",
        name: "PrismaClientKnownRequestError",
      },
    ));
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
  });

  it("returns an anonymous snapshot when the session store is not configured", async () => {
    mocks.getHostedAppSession.mockRejectedValue(new TypeError(
      "DATABASE_URL is required for the hosted web control plane.",
    ));
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
  });

  it("rethrows unexpected app-session failures", async () => {
    const error = new Error("session store unavailable");
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).rejects.toBe(error);
  });

  it("rethrows generic Prisma driver failures", async () => {
    const error = Object.assign(new Error("Driver adapter failed while decoding a session row."), {
      name: "DriverAdapterError",
    });
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedPageAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedPageAuthSnapshot()).rejects.toBe(error);
  });
});

describe("hosted sidebar auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
    mocks.hasActiveHostedFamilyAccess.mockResolvedValue(false);
  });

  it("returns anonymous sidebar auth without an app session", async () => {
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      label: null,
    });
  });

  it("returns no visible account label for a verified app session", async () => {
    mocks.getHostedAppSession.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      label: null,
    });
  });

  it("keeps checkout state out of sidebar auth", async () => {
    mocks.getHostedAppSession.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      label: null,
    });
  });

  it("returns anonymous sidebar auth when the hosted session store is unreachable", async () => {
    mocks.getHostedAppSession.mockRejectedValue(Object.assign(
      new Error("Connection refused while opening a database connection."),
      {
        code: "P1001",
        name: "PrismaClientKnownRequestError",
      },
    ));
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      label: null,
    });
  });

  it("rethrows unexpected sidebar auth failures", async () => {
    const error = new Error("session store unavailable");
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedSidebarAuthSnapshot } = await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedSidebarAuthSnapshot()).rejects.toBe(error);
  });
});

describe("hosted dashboard page auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
    mocks.hasActiveHostedFamilyAccess.mockResolvedValue(false);
  });

  it("returns the current auth snapshot for active members", async () => {
    const member = createHostedMember();
    const session = {
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member,
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    };
    mocks.getHostedAppSession.mockResolvedValue(session);
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      session,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.hasActiveHostedFamilyAccess).not.toHaveBeenCalled();
  });

  it.each([
    HostedBillingStatus.incomplete,
    HostedBillingStatus.not_started,
  ])("redirects %s members to the join resume route before dashboard loaders run", async (billingStatus) => {
    mocks.getHostedAppSession.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        billingStatus,
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).rejects.toThrow("NEXT_REDIRECT:/join");
    expect(mocks.hasActiveHostedFamilyAccess).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/join");
  });

  it("does not redirect Family-sponsored dashboard reads that no longer have direct member billing", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
    });
    const session = {
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member,
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    };
    mocks.getHostedAppSession.mockResolvedValue(session);
    mocks.hasActiveHostedFamilyAccess.mockResolvedValue(true);
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      session,
    });
    expect(mocks.hasActiveHostedFamilyAccess).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not redirect anonymous dashboard reads", async () => {
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).resolves.toEqual({
      authenticated: false,
      authenticatedMember: null,
      session: null,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.hasActiveHostedFamilyAccess).not.toHaveBeenCalled();
  });
});

function createHostedMember(overrides: Partial<HostedMember> = {}): HostedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    ...overrides,
  };
}
