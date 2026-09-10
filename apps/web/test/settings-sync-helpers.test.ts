import { afterEach, describe, expect, it, vi } from "vitest";

import {
  retrySyncOperation,
} from "@/src/components/settings/hosted-settings-sync-helpers";

describe("hosted settings sync helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reuses the provided sleep implementation across retry delays", async () => {
    const sleepImpl = vi.fn(async () => {});
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("retry-1"))
      .mockRejectedValueOnce(new Error("retry-2"))
      .mockResolvedValueOnce("ok");

    await expect(retrySyncOperation({
      errorFactory: (message) => new Error(message),
      operation,
      retryDelaysMs: [0, 25, 50],
      retryable: () => true,
      sleepImpl,
      timeoutMessage: "timed out",
    })).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl.mock.calls).toEqual([[25], [50]]);
  });

  it("routes hosted email sync through the authenticated onboarding request helper by default", async () => {
    const { syncHostedVerifiedEmailAddress } = await import(
      "@/src/components/settings/hosted-email-settings-helpers"
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      emailAddress: "verified@example.com",
      runTriggered: true,
      verifiedAt: "2026-03-28T12:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(syncHostedVerifiedEmailAddress({
      mode: "resync",
      verifiedEmailAddress: "verified@example.com",
    })).resolves.toEqual({
      errorMessage: null,
      successMessage: "Email connected: verified@example.com",
      syncResult: {
        emailAddress: "verified@example.com",
        runTriggered: true,
        verifiedAt: "2026-03-28T12:00:00.000Z",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/settings/email/sync", expect.objectContaining({
      body: JSON.stringify({
        expectedEmailAddress: "verified@example.com",
      }),
      credentials: "same-origin",
      cache: "no-store",
      method: "POST",
    }));
  });

  it("routes hosted telegram sync through the authenticated onboarding request helper by default", async () => {
    const { syncHostedLinkedTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      botLink: "https://t.me/murph_bot",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: "murph_user",
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(syncHostedLinkedTelegram({
      expectedTelegramUserId: "12345",
      mode: "resync",
    })).resolves.toEqual({
      errorMessage: null,
      successMessage: "Telegram connected @murph_user.",
      syncResult: {
        botLink: "https://t.me/murph_bot",
        runTriggered: true,
        telegramUserId: "12345",
        telegramUsername: "murph_user",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/settings/telegram/sync", expect.objectContaining({
      body: JSON.stringify({
        expectedTelegramUserId: "12345",
      }),
      credentials: "same-origin",
      cache: "no-store",
      method: "POST",
    }));
  });

  it("syncs Telegram from settings without client-authored email state", async () => {
    const { syncHostedLinkedTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      botLink: "https://t.me/murph_bot",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: "murph_user",
    }));
    vi.stubGlobal("fetch", fetchImpl);

    await syncHostedLinkedTelegram({
      expectedTelegramUserId: "12345",
      mode: "resync",
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/settings/telegram/sync", expect.objectContaining({
      body: JSON.stringify({
        expectedTelegramUserId: "12345",
      }),
      credentials: "same-origin",
      cache: "no-store",
      method: "POST",
    }));
  });

  it("builds a displayable telegram account from the slim sync override shape", async () => {
    const { resolveHostedTelegramSettingsDisplayState } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );

    await expect(resolveHostedTelegramSettingsDisplayState({
      syncedTelegramOverride: {
        telegramUserId: "12345",
        username: "murph_user",
      },
    })).toEqual({
      currentTelegram: {
        firstName: null,
        lastName: null,
        photoUrl: null,
        telegramUserId: "12345",
        username: "murph_user",
      },
    });
  });

  it("builds a server-bound Telegram account without client-only Privy enrichment", async () => {
    const { resolveHostedTelegramSettingsDisplayState } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );

    await expect(resolveHostedTelegramSettingsDisplayState({
      initialTelegramAccount: {
        telegramUserId: "12345",
        username: null,
      },
    })).toEqual({
      currentTelegram: {
        firstName: null,
        lastName: null,
        photoUrl: null,
        telegramUserId: "12345",
        username: null,
      },
    });
  });

  it("formats trusted Telegram display values without exposing raw ids", async () => {
    const { formatHostedTelegramDisplayValue } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );

    expect(formatHostedTelegramDisplayValue({
      telegramUserId: "12345",
      username: "sample_user",
    })).toBe("@sample_user");
    expect(formatHostedTelegramDisplayValue({
      telegramUserId: "12345",
      username: null,
    })).toBe("Connected");
    expect(formatHostedTelegramDisplayValue(null)).toBeNull();
  });
  for (const channel of ["email", "telegram"] as const) {
    const success = channel === "email"
      ? { ok: true, emailAddress: "verified@example.com", verifiedAt: "2026-09-01T12:00:00.000Z" }
      : { ok: true, telegramUserId: "12345" };
    const code = channel === "email" ? "PRIVY_EMAIL_NOT_READY" : "PRIVY_TELEGRAM_NOT_READY";
    const sync = async (fetchImpl: typeof fetch, sleepImpl = vi.fn(async (_delay: number) => {})) => {
      if (channel === "email") {
        const { syncHostedVerifiedEmailAddress } = await import("@/src/components/settings/hosted-email-settings-helpers");
        return syncHostedVerifiedEmailAddress({ fetchImpl, sleepImpl, mode: "resync", verifiedEmailAddress: "verified@example.com" });
      }
      const { syncHostedLinkedTelegram } = await import("@/src/components/settings/hosted-telegram-settings-helpers");
      return syncHostedLinkedTelegram({ fetchImpl, sleepImpl, mode: "resync", expectedTelegramUserId: "12345" });
    };

    it(`${channel} retries readiness through the shared transport and preserves defaults`, async () => {
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ error: { code, message: "Still synchronizing." } }, { status: 409 }))
        .mockResolvedValueOnce(Response.json(success));
      const sleepImpl = vi.fn(async (_delay: number) => {});
      const result = await sync(fetchImpl, sleepImpl);
      expect(result.errorMessage).toBeNull();
      expect(result.syncResult?.runTriggered).toBe(channel === "email");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleepImpl).toHaveBeenCalledWith(250);
      expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    });

    it.each([{}, { ok: true }, { ...success, ok: false }])(`${channel} rejects an incomplete success body: %j`, async (payload) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
      const result = await sync(fetchImpl);
      expect(result.syncResult).toBeNull();
      expect(result.successMessage).toBeNull();
      expect(result.errorMessage).toContain("couldn't confirm the connection");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it(`${channel} preserves terminal API errors without readiness retries`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "SYNC_DENIED", message: "Connection denied." } }, { status: 403 }));
      expect((await sync(fetchImpl)).errorMessage).toBe("Connection denied.");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  }

});
