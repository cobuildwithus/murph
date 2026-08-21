import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  enqueueHostedMemberChannelsUpdatedTx: vi.fn(),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  prepareHostedMemberVerifiedEmailReplyAlias: vi.fn(),
  prismaClient: {
    label: "test-prisma",
    $transaction: vi.fn(),
  },
  readHostedMemberEmailAuthorization: vi.fn(),
  requireFreshActivePrivyMemberAuthForHostedAppSession: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
  sendHostedSignupWelcomeEmailForRecentMember: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  syncHostedMemberVerifiedEmailAuthorization: vi.fn(),
  upsertHostedMemberEmailAuthorization: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  prepareHostedMemberVerifiedEmailReplyAlias:
    mocks.prepareHostedMemberVerifiedEmailReplyAlias,
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
  syncHostedMemberVerifiedEmailAuthorization:
    mocks.syncHostedMemberVerifiedEmailAuthorization,
  upsertHostedMemberEmailAuthorization: mocks.upsertHostedMemberEmailAuthorization,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedTx: mocks.enqueueHostedMemberChannelsUpdatedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshActivePrivyMemberAuthForHostedAppSession: mocks.requireFreshActivePrivyMemberAuthForHostedAppSession,
  requireActivePrivyMemberAuth: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/signup-welcome-email", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/signup-welcome-email")
  >("@/src/lib/hosted-onboarding/signup-welcome-email");

  return {
    ...actual,
    sendHostedSignupWelcomeEmailForRecentMember: mocks.sendHostedSignupWelcomeEmailForRecentMember,
  };
});

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/shared")>(
    "@/src/lib/hosted-onboarding/shared",
  );

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsEmailSyncRouteModule = typeof import("../app/api/settings/email/sync/route");

let settingsEmailSyncRoute: SettingsEmailSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("settings email sync route", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00.000Z"));
    settingsEmailSyncRoute = await import("../app/api/settings/email/sync/route");
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession.mockImplementation(async (...args: unknown[]) => {
      const freshPrivy = await mocks.requireActivePrivyMemberAuth(...args);
      return {
        appSession: {
          expiresAt: new Date("2026-04-26T00:00:00.000Z"),
          member: freshPrivy.member,
          privyUserId: "did:privy:user_123",
          sessionId: "hws_123",
        },
        freshPrivy,
      };
    });
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [
        {
          address: "user@example.com",
          latest_verified_at: 1743064200,
          type: "email",
        },
      ],
      member: {
        billingStatus: "active",
        id: "member_123",
        privyUserId: "did:privy:user_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.prepareHostedMemberVerifiedEmailReplyAlias.mockResolvedValue({
      generation: 0,
      lookupKey: "0123456789abcdef0123456789abcdef",
      memberId: "member_123",
      verifiedEmailLookupKeys: ["lookup-email"],
    });
    mocks.upsertHostedMemberEmailAuthorization.mockResolvedValue({});
    mocks.syncHostedMemberVerifiedEmailAuthorization.mockResolvedValue({});
    mocks.enqueueHostedMemberChannelsUpdatedTx.mockResolvedValue({
      mailboxItemId: "mailbox_item_channels_email_123",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.sendHostedSignupWelcomeEmailForRecentMember.mockResolvedValue({
      providerMessageId: "resend_email_123",
      status: "sent",
    });
  });

  it("verifies the server-side Privy cookie-backed session and writes canonical verified-email facts", async () => {
    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireFreshActivePrivyMemberAuthForHostedAppSession).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(mocks.prismaClient, "member_123");
    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.syncHostedMemberVerifiedEmailAuthorization).toHaveBeenCalledWith({
      address: "user@example.com",
      memberId: "member_123",
      preparedReplyAlias: {
        generation: 0,
        lookupKey: "0123456789abcdef0123456789abcdef",
        memberId: "member_123",
        verifiedEmailLookupKeys: ["lookup-email"],
      },
      prisma: mocks.prismaClient,
      verifiedAt: new Date("2025-03-27T08:30:00.000Z"),
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedTx).toHaveBeenCalledWith({
      emailLinked: true,
      memberId: "member_123",
      occurredAt: "2026-04-22T10:00:00.000Z",
      prisma: mocks.prismaClient,
      sourceType: "settings.email.sync",
    });
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readHostedMemberEmailAuthorization.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedSignupWelcomeEmailForRecentMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_email_123",
    });
    await expect(response.json()).resolves.toEqual({
      emailAddress: "user@example.com",
      ok: true,
      runTriggered: true,
      verifiedAt: "2025-03-27T08:30:00.000Z",
    });
  });

  it("rechecks authorization but does not nudge when verified email is already synced", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValueOnce({
      directPublicSender: {
        address: "USER@example.com",
        authorizedAt: new Date("2025-03-27T08:30:00.000Z"),
        lookupKey: "lk_direct",
      },
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: {
        address: "user@example.com",
        lookupKey: "lk_verified",
        verifiedAt: new Date("2025-03-27T08:30:00.000Z"),
      },
    });

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(mocks.prismaClient, "member_123");
    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.syncHostedMemberVerifiedEmailAuthorization).toHaveBeenCalledWith({
      address: "user@example.com",
      memberId: "member_123",
      preparedReplyAlias: {
        generation: 0,
        lookupKey: "0123456789abcdef0123456789abcdef",
        memberId: "member_123",
        verifiedEmailLookupKeys: ["lookup-email"],
      },
      prisma: mocks.prismaClient,
      verifiedAt: new Date("2025-03-27T08:30:00.000Z"),
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      emailAddress: "user@example.com",
      ok: true,
      runTriggered: false,
      verifiedAt: "2025-03-27T08:30:00.000Z",
    });
  });

  it("accepts an empty POST body when the server-side Privy cookie session already has the verified email", async () => {
    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.syncHostedMemberVerifiedEmailAuthorization).toHaveBeenCalledWith({
      address: "user@example.com",
      memberId: "member_123",
      preparedReplyAlias: {
        generation: 0,
        lookupKey: "0123456789abcdef0123456789abcdef",
        memberId: "member_123",
        verifiedEmailLookupKeys: ["lookup-email"],
      },
      prisma: mocks.prismaClient,
      verifiedAt: new Date("2025-03-27T08:30:00.000Z"),
    });
  });

  it("does not fail settings email sync when the welcome email provider fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sendHostedSignupWelcomeEmailForRecentMember.mockRejectedValueOnce(
      new Error("Resend unavailable"),
    );

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_email_123",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted signup welcome email send failed after settings email sync.",
      {
        errorName: "Error",
      },
    );
    warnSpy.mockRestore();
  });

  it("rejects sync attempts when the cookie-backed Privy session no longer maps to a hosted member", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the updated verified email has not reached the server-side identity token yet", async () => {
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        body: JSON.stringify({
          expectedEmailAddress: "user@example.com",
        }),
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.upsertHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_EMAIL_NOT_READY",
        message: "Your verified email has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("requires Privy-authenticated hosted member context before syncing the verified email", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted access is suspended", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
      message: "This hosted account is suspended. Contact support to restore access.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted billing access is no longer active", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Finish hosted activation before continuing.",
    }));

    const response = await settingsEmailSyncRoute.POST(
      new Request("https://join.example.test/api/settings/email/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ACCESS_REQUIRED",
        message: "Finish hosted activation before continuing.",
        retryable: false,
      },
    });
  });
});
