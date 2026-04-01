import { describe, expect, it, vi } from "vitest";

import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneAndWalletReady,
  resolveHostedPrivyClientSessionIssue,
  shouldAutoContinueHostedPrivyClientSession,
  shouldResetHostedPrivyClientSessionToSms,
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
    ).toContain("almost ready");
  });

  it("auto-continues authenticated sessions only when setup can proceed without another click", () => {
    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        issue: null,
        pendingAction: null,
      }),
    ).toBe(true);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        issue: "missing-wallet",
        pendingAction: null,
      }),
    ).toBe(true);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        issue: "missing-phone",
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: true,
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: false,
        checkingAuthenticatedSession: false,
        issue: null,
        pendingAction: "logout",
      }),
    ).toBe(false);

    expect(
      shouldAutoContinueHostedPrivyClientSession({
        authenticated: true,
        autoContinueTriggered: true,
        checkingAuthenticatedSession: false,
        issue: null,
        pendingAction: null,
      }),
    ).toBe(false);
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
});
