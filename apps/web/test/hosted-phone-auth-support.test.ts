import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishBrowserVaultSessionInvalidation: vi.fn(),
  reloadCurrentHostedAuthDocument: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  waitForRetryDelay: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/session-invalidation", () => ({
  publishBrowserVaultSessionInvalidation:
    mocks.publishBrowserVaultSessionInvalidation,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-navigation", () => ({
  reloadCurrentHostedAuthDocument: mocks.reloadCurrentHostedAuthDocument,
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

vi.mock("@/src/components/hosted-onboarding/hosted-retry-support", () => ({
  waitForRetryDelay: mocks.waitForRetryDelay,
}));

describe("hosted phone auth support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the pending action after a handled pending-action failure", async () => {
    const { runHostedPhonePendingAction } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-support"
    );
    const pendingActions: Array<string | null> = [];
    const errors: unknown[] = [];

    const result = await runHostedPhonePendingAction({
      action: "send-code",
      onError(error) {
        errors.push(error);
      },
      run: async () => {
        throw new Error("send failed");
      },
      setPendingAction(action) {
        pendingActions.push(action);
      },
    });

    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(pendingActions).toEqual(["send-code", null]);
  });

  it("syncs a linked phone from settings without client-authored email state", async () => {
    const { requestHostedPhoneLinkSyncWithRetry } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-support"
    );
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
    });

    await expect(requestHostedPhoneLinkSyncWithRetry()).resolves.toEqual({
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
    });

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/settings/phone/sync",
    });
  });

  it("retries Telegram completion lag with the Telegram auth intent", async () => {
    const { HostedOnboardingApiError } = await import(
      "@/src/components/hosted-onboarding/client-api"
    );
    const { requestHostedPrivyCompletionWithRetry } = await import(
      "@/src/components/hosted-onboarding/hosted-phone-auth-support"
    );
    const completionPayload = {
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      messagingSetupRequired: false,
      ok: true,
      stage: "checkout",
    };
    mocks.requestHostedOnboardingJson
      .mockRejectedValueOnce(new HostedOnboardingApiError({
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Telegram is still syncing.",
        retryable: true,
      }))
      .mockResolvedValueOnce(completionPayload);

    await expect(requestHostedPrivyCompletionWithRetry({
      authMethod: "telegram",
      inviteCode: "invite-code",
    })).resolves.toEqual(completionPayload);

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
      onSuccessfulResponseError: mocks.reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: mocks.publishBrowserVaultSessionInvalidation,
      payload: {
        authIntent: {
          method: "telegram",
        },
        inviteCode: "invite-code",
      },
      url: "/api/hosted-onboarding/privy/complete",
    });
    expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
      onSuccessfulResponseError: mocks.reloadCurrentHostedAuthDocument,
      onSuccessfulResponseHeaders: mocks.publishBrowserVaultSessionInvalidation,
      payload: {
        authIntent: {
          method: "telegram",
        },
        inviteCode: "invite-code",
      },
      url: "/api/hosted-onboarding/privy/complete",
    });
    expect(mocks.waitForRetryDelay).toHaveBeenCalledWith(500);
  });
});
