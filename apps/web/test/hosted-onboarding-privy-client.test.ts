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
      ensureHostedPrivyPhoneReady({
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

  it("treats wallet creation as best effort when setup completion still has no linked embedded account", async () => {
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
      ensureHostedPrivyPhoneReady({
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
  });

  it("refreshes the client session once when the initial user state is incomplete", async () => {
    const createWallet = vi.fn();
    const refreshUser = vi
      .fn<() => Promise<{ linkedAccounts?: unknown } | null>>()
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
      ensureHostedPrivyPhoneReady({
        createWallet,
        refreshUser,
        user: null,
      }),
    ).resolves.toBeUndefined();

    expect(createWallet).not.toHaveBeenCalled();
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it("still returns control when wallet creation throws and the session remains phone-only", async () => {
    const createWallet = vi.fn().mockRejectedValue(new Error("wallet create failed"));
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
      ensureHostedPrivyPhoneReady({
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
});
