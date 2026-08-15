import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedTelegramBotLink: vi.fn(),
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getPrisma: vi.fn(),
  prismaClient: {
    label: "test-prisma",
    $transaction: vi.fn(),
  },
  requireFreshPrivyMemberAuthForHostedAppSession: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
  rearmHostedPhoneCallResultNotificationRecovery: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  upsertHostedMemberTelegramRoutingBindingTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshPrivyMemberAuthForHostedAppSession: mocks.requireFreshPrivyMemberAuthForHostedAppSession,
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram", () => ({
  buildHostedTelegramBotLink: mocks.buildHostedTelegramBotLink,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  upsertHostedMemberTelegramRoutingBindingTx: mocks.upsertHostedMemberTelegramRoutingBindingTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/phone-calls/reconciliation-workflow-start", () => ({
  rearmHostedPhoneCallResultNotificationRecovery:
    mocks.rearmHostedPhoneCallResultNotificationRecovery,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsTelegramSyncRouteModule = typeof import("../app/api/settings/telegram/sync/route");

let settingsTelegramSyncRoute: SettingsTelegramSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("settings telegram sync route", () => {
  beforeAll(async () => {
    settingsTelegramSyncRoute = await import("../app/api/settings/telegram/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(mocks.prismaClient)
    );
    mocks.upsertHostedMemberTelegramRoutingBindingTx.mockResolvedValue(undefined);
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValue({
      mailboxItemId: "mailbox_item_channels_telegram_123",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
    mocks.rearmHostedPhoneCallResultNotificationRecovery.mockResolvedValue(false);
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
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        privyUserId: "did:privy:user_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 456,
            type: "telegram",
            username: "alice",
          },
        ],
      },
    });
    mocks.buildHostedTelegramBotLink.mockReturnValue("https://t.me/murph_bot?start=connect");
  });

  it("verifies the server-side Privy cookie-backed session and links the Telegram identity onto the hosted member", async () => {
    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireFreshPrivyMemberAuthForHostedAppSession).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      telegramUserId: "456",
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.telegram.sync",
    });
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      signal: expect.any(AbortSignal),
    });
    expect(
      mocks.upsertHostedMemberTelegramRoutingBindingTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mock.invocationCallOrder[0]
      ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_telegram_123",
    });
    expect(mocks.buildHostedTelegramBotLink).toHaveBeenCalledWith("connect");
    await expect(response.json()).resolves.toEqual({
      botLink: "https://t.me/murph_bot?start=connect",
      ok: true,
      runTriggered: true,
      telegramUserId: "456",
      telegramUsername: "alice",
    });
  });

  it("returns a retryable error when committed route restoration cannot re-arm recovery", async () => {
    mocks.rearmHostedPhoneCallResultNotificationRecovery.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
        httpStatus: 503,
        message: "Phone call recovery is temporarily unavailable.",
        retryable: true,
      }),
    );

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({ expectedTelegramUserId: "456" }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).toHaveBeenCalledOnce();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_PHONE_CALL_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
        retryable: true,
      },
    });
  });

  it("skips the hosted channel dispatch when hosted access is not active yet", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "incomplete",
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 456,
            type: "telegram",
            username: "alice",
          },
        ],
      },
    });
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValueOnce(null);

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.telegram.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      botLink: "https://t.me/murph_bot?start=connect",
      ok: true,
      runTriggered: false,
      telegramUserId: "456",
      telegramUsername: "alice",
    });
  });

  it("updates Telegram routing without dispatching channel sync before activation", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "not_started",
        id: "member_123",
        privyUserId: "did:privy:user_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 456,
            type: "telegram",
            username: "alice",
          },
        ],
      },
    });
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValueOnce(null);

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.telegram.sync",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      botLink: "https://t.me/murph_bot?start=connect",
      ok: true,
      runTriggered: false,
      telegramUserId: "456",
      telegramUsername: "alice",
    });
  });

  it("ignores client-supplied Telegram thread targets and binds only the authenticated Telegram user id", async () => {
    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
          telegramThreadId: "-1009999999999",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      telegramThreadId: undefined,
      telegramUserId: "456",
    });
    expect(response.status).toBe(200);
  });

  it("requires Privy-authenticated hosted member context before syncing Telegram", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("requires a client-confirmed Telegram user id before syncing Telegram", async () => {
    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TELEGRAM_USER_ID_REQUIRED",
        message: "Refresh Privy and confirm the Telegram account you want to sync before continuing.",
        retryable: false,
      },
    });
  });

  it("rejects sync attempts when the cookie-backed Privy session no longer maps to a hosted member", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    }));

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the Telegram account has not reached the server-side Privy session yet", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [],
      },
    });

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("surfaces unique-constraint conflicts when the Telegram identity is already linked elsewhere", async () => {
    mocks.upsertHostedMemberTelegramRoutingBindingTx.mockRejectedValue(hostedOnboardingError({
      code: "TELEGRAM_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
    }));

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TELEGRAM_IDENTITY_CONFLICT",
        message: "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict when the server-side Privy identity token is still on an older Telegram account", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 111,
            type: "telegram",
            username: "alice_old",
          },
        ],
      },
    });

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("rejects ambiguous Telegram state when top-level and linked Telegram accounts disagree", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 456,
            type: "telegram",
            username: "alice",
          },
        ],
        telegram: {
          first_name: "Bob",
          id: 789,
          username: "bob",
        },
      },
    });

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_AMBIGUOUS",
        message: "The current Privy session has conflicting Telegram accounts. Reconnect Telegram in Privy and try again.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted access is suspended", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [],
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: new Date("2026-04-07T01:00:00.000Z"),
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
        linked_accounts: [
          {
            first_name: "Alice",
            id: 456,
            type: "telegram",
            username: "alice",
          },
        ],
      },
    });

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        retryable: false,
      },
    });
  });

  it("blocks sync when hosted billing access is no longer active", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Finish hosted activation before continuing.",
    }));

    const response = await settingsTelegramSyncRoute.POST(
      new Request("https://join.example.test/api/settings/telegram/sync", {
        body: JSON.stringify({
          expectedTelegramUserId: "456",
        }),
        headers: {
          "content-type": "application/json",
          origin: SAME_ORIGIN_HEADERS.origin,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.upsertHostedMemberTelegramRoutingBindingTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ACCESS_REQUIRED",
        message: "Finish hosted activation before continuing.",
        retryable: false,
      },
    });
  });
});
