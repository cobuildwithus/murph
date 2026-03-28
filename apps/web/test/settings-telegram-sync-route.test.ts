import { Prisma } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  buildHostedTelegramBotLink: vi.fn(),
  cookies: vi.fn(),
  getPrisma: vi.fn(),
  hostedMemberUpdate: vi.fn(),
  requireHostedPrivyUserForSession: vi.fn(),
  resolveHostedSessionFromCookieStore: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  requireHostedPrivyUserForSession: mocks.requireHostedPrivyUserForSession,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  resolveHostedSessionFromCookieStore: mocks.resolveHostedSessionFromCookieStore,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram", () => ({
  buildHostedTelegramBotLink: mocks.buildHostedTelegramBotLink,
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
    mocks.cookies.mockResolvedValue({
      get: vi.fn(),
    });
    mocks.getPrisma.mockReturnValue({
      hostedMember: {
        update: mocks.hostedMemberUpdate,
      },
    });
    mocks.hostedMemberUpdate.mockResolvedValue({});
    mocks.resolveHostedSessionFromCookieStore.mockResolvedValue({
      member: {
        id: "member_123",
        privyUserId: "did:privy:user_123",
      },
    });
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [],
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

  it("verifies the server-side Privy session and links the Telegram identity onto the hosted member", async () => {
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
    expect(mocks.resolveHostedSessionFromCookieStore).toHaveBeenCalledWith({ get: expect.any(Function) });
    expect(mocks.requireHostedPrivyUserForSession).toHaveBeenCalledWith(
      { get: expect.any(Function) },
      {
        member: {
          id: "member_123",
          privyUserId: "did:privy:user_123",
        },
      },
    );
    expect(mocks.hostedMemberUpdate).toHaveBeenCalledWith({
      data: {
        telegramUserId: "456",
        telegramUsername: "alice",
      },
      where: {
        id: "member_123",
      },
    });
    expect(mocks.buildHostedTelegramBotLink).toHaveBeenCalledWith("connect");
    await expect(response.json()).resolves.toEqual({
      botLink: "https://t.me/murph_bot?start=connect",
      ok: true,
      runTriggered: false,
      telegramUserId: "456",
      telegramUsername: "alice",
    });
  });

  it("requires an active hosted session before syncing Telegram", async () => {
    mocks.resolveHostedSessionFromCookieStore.mockResolvedValue(null);

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
    expect(mocks.requireHostedPrivyUserForSession).not.toHaveBeenCalled();
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in again before you sync Telegram.",
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
    expect(mocks.requireHostedPrivyUserForSession).not.toHaveBeenCalled();
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TELEGRAM_USER_ID_REQUIRED",
        message: "Refresh Privy and confirm the Telegram account you want to sync before continuing.",
        retryable: false,
      },
    });
  });

  it("rejects sync attempts whose Privy session does not match the hosted session", async () => {
    mocks.requireHostedPrivyUserForSession.mockRejectedValue(hostedOnboardingError({
      code: "PRIVY_SESSION_MISMATCH",
      httpStatus: 403,
      message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
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
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_SESSION_MISMATCH",
        message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the Telegram account has not reached the server-side Privy session yet", async () => {
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [],
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
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("surfaces unique-constraint conflicts when the Telegram identity is already linked elsewhere", async () => {
    mocks.hostedMemberUpdate.mockRejectedValue(createUniqueConstraintError());

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
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TELEGRAM_IDENTITY_CONFLICT",
        message: "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict when the server-side Privy cookie is still on an older Telegram account", async () => {
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [],
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
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("rejects ambiguous Telegram state when top-level and linked Telegram accounts disagree", async () => {
    mocks.requireHostedPrivyUserForSession.mockResolvedValue({
      linkedAccounts: [],
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
    expect(mocks.hostedMemberUpdate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_TELEGRAM_AMBIGUOUS",
        message: "The current Privy session has conflicting Telegram accounts. Reconnect Telegram in Privy and try again.",
        retryable: false,
      },
    });
  });
});

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    clientVersion: "test",
    code: "P2002",
  });
}
