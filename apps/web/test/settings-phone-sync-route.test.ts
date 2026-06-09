import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getPrisma: vi.fn(),
  prismaClient: {
    label: "test-prisma",
    $transaction: vi.fn(),
  },
  readHostedPhoneHint: vi.fn(),
  reconcileHostedPrivyIdentityOnMemberTx: vi.fn(),
  requireFreshPrivyMemberAuthForHostedAppSession: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  readHostedPhoneHint: mocks.readHostedPhoneHint,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  reconcileHostedPrivyIdentityOnMemberTx: mocks.reconcileHostedPrivyIdentityOnMemberTx,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshPrivyMemberAuthForHostedAppSession: mocks.requireFreshPrivyMemberAuthForHostedAppSession,
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsPhoneSyncRouteModule = typeof import("../app/api/settings/phone/sync/route");

let settingsPhoneSyncRoute: SettingsPhoneSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("settings phone sync route", () => {
  beforeAll(async () => {
    settingsPhoneSyncRoute = await import("../app/api/settings/phone/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.readHostedPhoneHint.mockReturnValue("+1 415 555 2671");
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.reconcileHostedPrivyIdentityOnMemberTx.mockResolvedValue(undefined);
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValue({
      mailboxItemId: "mailbox_item_channels_phone_123",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.requireFreshPrivyMemberAuthForHostedAppSession.mockImplementation(async (...args: unknown[]) => {
      const freshPrivy = await mocks.requirePrivyMemberAuth(...args);
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
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
    });
  });

  it("verifies the server-side Privy cookie-backed session and syncs the phone identity onto the hosted member", async () => {
    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireFreshPrivyMemberAuthForHostedAppSession).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledWith({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      now: expect.any(Date),
      prisma: mocks.prismaClient,
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.phone.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_phone_123",
    });
    expect(mocks.readHostedPhoneHint).toHaveBeenCalledWith("+14155552671");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
      runTriggered: true,
    });
  });

  it("updates the hosted member identity without dispatching channel sync before activation", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      linkedAccounts: [],
      member: {
        billingStatus: "not_started",
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValueOnce(null);

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.phone.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
      runTriggered: false,
    });
  });

  it("skips the hosted channel dispatch when hosted access is not active yet", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      linkedAccounts: [],
      member: {
        billingStatus: "incomplete",
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValueOnce(null);

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.phone.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
      runTriggered: false,
    });
  });

  it("blocks suspended hosted members before syncing the phone identity", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: new Date("2026-04-07T01:00:00.000Z"),
      },
    });

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        retryable: false,
      },
    });
  });

  it("requires Privy-authenticated hosted member context before syncing the phone number", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the phone number has not reached the server-side Privy session yet", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: null,
      },
      member: {
        id: "member_123",
      },
    });

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_PHONE_NOT_READY",
        message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("rejects sync attempts when the cookie-backed Privy session no longer maps to a hosted member", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        retryable: false,
      },
    });
  });

  it("surfaces identity conflicts when the verified phone belongs to a different hosted member", async () => {
    mocks.reconcileHostedPrivyIdentityOnMemberTx.mockRejectedValue(hostedOnboardingError({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "That phone number is already linked to a different Murph account.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMemberTx).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_IDENTITY_CONFLICT",
        message: "That phone number is already linked to a different Murph account.",
        retryable: false,
      },
    });
  });
});
