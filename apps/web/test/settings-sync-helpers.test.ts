import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
    readonly code: string | null;
    readonly retryable: boolean;

    constructor(input: { code: string | null; message: string; retryable?: boolean }) {
      super(input.message);
      this.code = input.code;
      this.retryable = input.retryable ?? false;
    }
  },
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

import {
  readJsonErrorDetails,
  retrySyncOperation,
} from "@/src/components/settings/hosted-settings-sync-helpers";

describe("hosted settings sync helpers", () => {
  it("extracts nested JSON error details only when the payload shape is valid", () => {
    expect(readJsonErrorDetails(null)).toEqual({
      code: null,
      message: null,
    });
    expect(readJsonErrorDetails({
      error: "bad-shape",
    })).toEqual({
      code: null,
      message: null,
    });
    expect(readJsonErrorDetails({
      error: {
        code: "HOSTED_SYNC_UNAVAILABLE",
        message: "Hosted sync unavailable right now.",
      },
    })).toEqual({
      code: "HOSTED_SYNC_UNAVAILABLE",
      message: "Hosted sync unavailable right now.",
    });
  });

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
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      emailAddress: "verified@example.com",
      runTriggered: true,
      verifiedAt: "2026-03-28T12:00:00.000Z",
    });

    await expect(syncHostedVerifiedEmailAddress({
      mode: "resync",
      verifiedEmailAddress: "verified@example.com",
    })).resolves.toEqual({
      errorMessage: null,
      successMessage: "Hosted email synced: verified@example.com",
      syncResult: {
        emailAddress: "verified@example.com",
        runTriggered: true,
        verifiedAt: "2026-03-28T12:00:00.000Z",
      },
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      payload: {
        expectedEmailAddress: "verified@example.com",
      },
      url: "/api/settings/email/sync",
    });
  });

  it("routes hosted telegram sync through the authenticated onboarding request helper by default", async () => {
    const { syncHostedLinkedTelegram } = await import(
      "@/src/components/settings/hosted-telegram-settings-helpers"
    );
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      botLink: "https://t.me/murph_bot",
      runTriggered: true,
      telegramUserId: "12345",
      telegramUsername: "murph_user",
    });

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

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      payload: {
        expectedTelegramUserId: "12345",
      },
      url: "/api/settings/telegram/sync",
    });
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
      user: null,
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
});
