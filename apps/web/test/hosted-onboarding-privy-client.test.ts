import { describe, expect, it, vi } from "vitest";

import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneAndWalletReady,
  resolveHostedPrivyClientSessionIssue,
  shouldSuppressHostedPrivyAutoContinueAfterError,
  shouldAutoContinueHostedPrivyClientSession,
  shouldResetHostedPrivyAutoContinueTrigger,
  shouldResetHostedPrivyClientSessionToSms,
  shouldShowHostedPrivyAuthenticatedLoadingState,
  shouldShowHostedPrivyManualResumeState,
  shouldShowHostedPrivyRestartState,
} from "@/src/lib/hosted-onboarding/privy-client";
import { HostedOnboardingApiError } from "@/src/components/hosted-onboarding/client-api";

describe("hosted Privy client wallet readiness", () => {
  it("treats a missing wallet as continuable but a missing phone as blocking", () => {
    expect(
      resolveHostedPrivyClientSessionIssue({
        linkedAccounts: [],
        phone: null,
        wallet: null,
      }),
    ).toBe("missing-phone");
    expect(
      resolveHostedPrivyClientSessionIssue({
        linkedAccounts: [],
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        wallet: null,
      }),
    ).toBe("missing-wallet");
    expect(canContinueHostedPrivyClientSession("missing-phone")).toBe(false);
    expect(canContinueHostedPrivyClientSession("missing-wallet")).toBe(true);
    expect(
      describeHostedPrivyClientSessionIssue("missing-wallet"),
    ).toContain("almost ready");
  });

  it("auto-continues authenticated sessions only when setup can proceed without another click", () => {
    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(true);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: "missing-wallet",
        pendingAction: null,
      }),
    ).toBe(true);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: "missing-phone",
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: true,
        finalizationState: "idle",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "running",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "completed",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: null,
        pendingAction: "logout",
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: false,
        autoContinueTriggered: true,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueSuppressed: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        finalizationState: "idle",
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);
  });

  it("keeps authenticated users in the loading state unless they need to restart with SMS", () => {
    expect(
      shouldShowHostedPrivyAuthenticatedLoadingState({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: null,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyAuthenticatedLoadingState({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: "missing-wallet",
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyAuthenticatedLoadingState({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: "missing-phone",
      }),
    ).toBe(false);

    expect(
      shouldShowHostedPrivyAuthenticatedLoadingState({
        authenticated: true,
        autoContinueSuppressed: true,
        issue: null,
      }),
    ).toBe(false);
  });

  it("switches from manual resume to restart mode when the authenticated session is missing a phone", () => {
    expect(
      shouldShowHostedPrivyManualResumeState({
        authenticated: true,
        issue: null,
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyManualResumeState({
        authenticated: true,
        issue: "missing-wallet",
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyManualResumeState({
        authenticated: true,
        issue: "missing-phone",
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(false);

    expect(
      shouldShowHostedPrivyRestartState({
        authenticated: true,
        issue: "missing-phone",
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(true);

    expect(
      shouldShowHostedPrivyRestartState({
        authenticated: true,
        issue: null,
        showAuthenticatedLoadingState: false,
      }),
    ).toBe(false);
  });

  it("does not reset the auto-continue trigger during temporary in-flight states", () => {
    expect(
      shouldResetHostedPrivyAutoContinueTrigger({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: null,
      }),
    ).toBe(false);

    expect(
      shouldResetHostedPrivyAutoContinueTrigger({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: "missing-wallet",
      }),
    ).toBe(false);

    expect(
      shouldResetHostedPrivyAutoContinueTrigger({
        authenticated: false,
        autoContinueSuppressed: false,
        issue: null,
      }),
    ).toBe(true);

    expect(
      shouldResetHostedPrivyAutoContinueTrigger({
        authenticated: true,
        autoContinueSuppressed: true,
        issue: null,
      }),
    ).toBe(true);

    expect(
      shouldResetHostedPrivyAutoContinueTrigger({
        authenticated: true,
        autoContinueSuppressed: false,
        issue: "missing-phone",
      }),
    ).toBe(true);
  });

  it("suppresses further auto-continue attempts after a terminal completion API error", () => {
    expect(
      shouldSuppressHostedPrivyAutoContinueAfterError(
        new HostedOnboardingApiError({
          code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
          message: "A Privy identity cookie is required to continue.",
          retryable: false,
        }),
      ),
    ).toBe(true);

    expect(
      shouldSuppressHostedPrivyAutoContinueAfterError(
        new HostedOnboardingApiError({
          code: "PRIVY_WALLET_NOT_READY",
          message: "Wait a moment and try again.",
          retryable: true,
        }),
      ),
    ).toBe(false);

    expect(shouldSuppressHostedPrivyAutoContinueAfterError(new Error("network"))).toBe(false);
  });

  it("silently restarts authenticated sessions that are missing a verified phone number", () => {
    expect(
      shouldResetHostedPrivyClientSessionToSms({
        authenticated: true,
        autoResetTriggered: false,
        checkingAuthenticatedSession: false,
        issue: "missing-phone",
        pendingAction: null,
      }),
    ).toBe(true);

    expect(
      shouldResetHostedPrivyClientSessionToSms({
        authenticated: true,
        autoResetTriggered: false,
        checkingAuthenticatedSession: false,
        issue: "missing-wallet",
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldResetHostedPrivyClientSessionToSms({
        authenticated: true,
        autoResetTriggered: true,
        checkingAuthenticatedSession: false,
        issue: "missing-phone",
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldResetHostedPrivyClientSessionToSms({
        authenticated: true,
        autoResetTriggered: false,
        checkingAuthenticatedSession: false,
        issue: "missing-phone",
        pendingAction: "logout",
      }),
    ).toBe(false);
  });

  it("creates a wallet when the verified session is phone-only", async () => {
    const createWallet = vi.fn().mockResolvedValue({});
    const refreshUser = vi
      .fn<() => Promise<{ linkedAccounts?: unknown } | null>>()
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            latest_verified_at: 1741194420,
            phone_number: "+1 415 555 2671",
            type: "phone",
          },
        ],
      })
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            latest_verified_at: 1741194420,
            phone_number: "+1 415 555 2671",
            type: "phone",
          },
          {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            chain_type: "ethereum",
            connector_type: "embedded",
            id: "wallet_123",
            type: "wallet",
            wallet_client: "privy",
            wallet_client_type: "privy",
          },
        ],
      });

    await expect(
      ensureHostedPrivyPhoneAndWalletReady({
        createWallet,
        refreshUser,
        user: {
          linkedAccounts: [
            {
              latest_verified_at: 1741194420,
              phone_number: "+1 415 555 2671",
              type: "phone",
            },
          ],
        },
      }),
    ).resolves.toBeUndefined();

    expect(createWallet).toHaveBeenCalledTimes(1);
  });

  it("fails cleanly when setup completion does not produce a linked embedded account", async () => {
    const createWallet = vi.fn().mockResolvedValue({});
    const refreshUser = vi.fn<() => Promise<{ linkedAccounts?: unknown } | null>>().mockResolvedValue({
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ],
    });

    await expect(
      ensureHostedPrivyPhoneAndWalletReady({
        createWallet,
        refreshUser,
        user: {
          linkedAccounts: [
            {
              latest_verified_at: 1741194420,
              phone_number: "+1 415 555 2671",
              type: "phone",
            },
          ],
        },
      }),
    ).rejects.toThrow("We could not finish preparing your account. Wait a moment and try again.");
  });

  it("retries client session refresh long enough for the verified phone to appear", async () => {
    const createWallet = vi.fn();
    const refreshUser = vi
      .fn<() => Promise<{ linkedAccounts?: unknown } | null>>()
      .mockResolvedValueOnce({
        linkedAccounts: [],
      })
      .mockResolvedValueOnce({
        linkedAccounts: [
          {
            latest_verified_at: 1741194420,
            phone_number: "+1 415 555 2671",
            type: "phone",
          },
          {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            chain_type: "ethereum",
            connector_type: "embedded",
            id: "wallet_123",
            type: "wallet",
            wallet_client: "privy",
            wallet_client_type: "privy",
          },
        ],
      });

    await expect(
      ensureHostedPrivyPhoneAndWalletReady({
        createWallet,
        refreshUser,
        user: null,
      }),
    ).resolves.toBeUndefined();

    expect(createWallet).not.toHaveBeenCalled();
    expect(refreshUser).toHaveBeenCalledTimes(2);
  });
});
