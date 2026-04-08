import { describe, expect, it, vi } from "vitest";

import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneReady,
  resolveHostedPrivyClientSessionIssue,
  shouldShowHostedPrivyManualResumeState,
  shouldShowHostedPrivyRestartState,
} from "@/src/lib/hosted-onboarding/privy-client";

describe("hosted Privy client wallet readiness", () => {
  it("treats a missing wallet as continuable but a missing phone as blocking", () => {
    expect(resolveHostedPrivyClientSessionIssue(null)).toBeNull();
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
    ).toContain("still syncing account details");
  });

  it("treats a partially hydrated non-null user shell as indeterminate", async () => {
    const createWallet = vi.fn();

    await expect(
      ensureHostedPrivyPhoneReady({
        createWallet,
        user: {},
      }),
    ).resolves.toBeUndefined();

    expect(createWallet).not.toHaveBeenCalled();
    expect(resolveHostedPrivyClientSessionIssue(null)).toBeNull();
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

  it("creates a wallet when the verified session is phone-only", async () => {
    const createWallet = vi.fn().mockResolvedValue({});

    await expect(
      ensureHostedPrivyPhoneReady({
        createWallet,
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

  it("treats wallet creation as best effort when setup completion still has no linked embedded account", async () => {
    const createWallet = vi.fn().mockResolvedValue({});

    await expect(
      ensureHostedPrivyPhoneReady({
        createWallet,
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
  });

  it("treats missing local user state as indeterminate instead of forcing a refresh", async () => {
    const createWallet = vi.fn();

    await expect(
      ensureHostedPrivyPhoneReady({
        createWallet,
        user: null,
      }),
    ).resolves.toBeUndefined();

    expect(createWallet).not.toHaveBeenCalled();
  });

  it("still returns control when wallet creation throws and the session remains phone-only", async () => {
    const createWallet = vi.fn().mockRejectedValue(new Error("wallet create failed"));

    await expect(
      ensureHostedPrivyPhoneReady({
        createWallet,
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
});
