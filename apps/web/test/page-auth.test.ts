import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedAppSession: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberOwnsSubscription: vi.fn().mockResolvedValue(false),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberOwnsSubscription: mocks.readHostedMemberOwnsSubscription,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSession: mocks.getHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

describe("hosted page auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getHostedAppSession.mockResolvedValue(null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
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

  it("returns an anonymous snapshot when the database pool checkout times out", async () => {
    mocks.getHostedAppSession.mockRejectedValue(
      new Error("timeout exceeded when trying to connect"),
    );
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
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
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
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
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
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
  });

  it("builds dashboard layout auth from one strict session read without checkout redirects", async () => {
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
    const { getHostedDashboardLayoutAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardLayoutAuthSnapshot()).resolves.toEqual({
      pageAuth: {
        authenticated: true,
        authenticatedMember: member,
        session,
      },
      sidebarAuth: {
        authenticated: true,
        label: null,
      },
      status: "ready",
    });
    expect(mocks.getHostedAppSession).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
  });

  it("returns a distinct unavailable dashboard layout state for a session-store outage", async () => {
    const error = Object.assign(
      new Error("Connection refused while opening a database connection."),
      {
        code: "P1001",
        name: "PrismaClientKnownRequestError",
      },
    );
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedDashboardLayoutAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardLayoutAuthSnapshot()).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
  });

  it("rethrows unexpected dashboard layout auth failures", async () => {
    const error = new Error("session row invariant failed");
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedDashboardLayoutAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardLayoutAuthSnapshot()).rejects.toBe(error);
  });

  it("rethrows a session-store outage instead of presenting an anonymous dashboard", async () => {
    const error = Object.assign(
      new Error("Connection refused while opening a database connection."),
      {
        code: "P1001",
        name: "PrismaClientKnownRequestError",
      },
    );
    mocks.getHostedAppSession.mockRejectedValue(error);
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).rejects.toBe(error);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
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
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/join");
  });

  it("exposes the same first-checkout requirement to authenticated recovery surfaces", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
    });
    const auth = {
      authenticated: true,
      authenticatedMember: member,
      session: null,
    };
    const { readHostedDashboardCheckoutRequired } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(readHostedDashboardCheckoutRequired(auth)).resolves.toBe(true);
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps an incomplete member who already owns a subscription out of the checkout redirect", async () => {
    mocks.readHostedMemberOwnsSubscription.mockResolvedValue(true);
    mocks.getHostedAppSession.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        billingStatus: HostedBillingStatus.incomplete,
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    // Owning a subscription is recovery, not a first checkout, so this member
    // reaches the dashboard instead of being bounced back into the invite flow.
    await getHostedDashboardPageAuthSnapshot();

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps paused members on the dashboard recovery surface", async () => {
    const member = createHostedMember({
      billingStatus: HostedBillingStatus.paused,
    });
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
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
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
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    const { getHostedDashboardPageAuthSnapshot } =
      await import("@/src/lib/hosted-onboarding/page-auth");

    await expect(getHostedDashboardPageAuthSnapshot()).resolves.toEqual({
      authenticated: true,
      authenticatedMember: member,
      session,
    });
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith({
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
    expect(mocks.readActiveHostedMemberAccess).not.toHaveBeenCalled();
  });
});

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
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationContextEncrypted: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    usageCreditBalanceUsdMicros: null,
    usageCreditLedgerVersion: null,
    ...overrides,
  };
}
