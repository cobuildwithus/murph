import { describe, expect, it } from "vitest";

import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyPreferredEmailAccount,
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyTelegramAccount,
  extractHostedPrivyVerifiedEmailAccount,
  extractHostedPrivyWalletAccount,
  isHostedPrivyEmailAccountVerified,
  resolveHostedPrivyTelegramAccountSelection,
  resolveHostedPrivyLinkedAccountState,
} from "@/src/lib/hosted-onboarding/privy-shared";

describe("hosted Privy identity helpers", () => {
  it("normalizes SDK-style linked accounts into hosted phone and wallet state", () => {
    const state = resolveHostedPrivyLinkedAccountState({
      linkedAccounts: [
        {
          latestVerifiedAt: new Date(1741194420 * 1000),
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    expect(state.linkedAccounts).toHaveLength(2);
    expect(state.phone).toEqual({
      number: "+14155552671",
      verifiedAt: 1741194420,
    });
    expect(state.wallet).toEqual({
      address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainType: "ethereum",
      id: "wallet_123",
      type: "wallet",
    });
  });

  it("normalizes verified token-style linked accounts into hosted phone and wallet state", () => {
    const state = resolveHostedPrivyLinkedAccountState({
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    expect(state.phone).toEqual({
      number: "+14155552671",
      verifiedAt: 1741194420,
    });
    expect(state.wallet).toEqual({
      address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainType: "ethereum",
      id: "wallet_123",
      type: "wallet",
    });
  });

  it("returns null when a required linked account is absent", () => {
    const linkedAccounts = [
      {
        address: "user@example.com",
        type: "email",
      },
    ];

    expect(extractHostedPrivyPhoneAccount(linkedAccounts)).toBeNull();
    expect(extractHostedPrivyWalletAccount(linkedAccounts, "ethereum")).toBeNull();
  });

  it("rejects phone accounts that do not have a verification timestamp", () => {
    expect(
      extractHostedPrivyPhoneAccount([
        {
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ]),
    ).toBeNull();
  });

  it("selects the newest verified phone number instead of trusting linked-account order", () => {
    expect(
      extractHostedPrivyPhoneAccount([
        {
          latest_verified_at: 1741194300,
          phone_number: "+1 415 555 0000",
          type: "phone",
        },
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ]),
    ).toEqual({
      number: "+14155552671",
      verifiedAt: 1741194420,
    });
  });

  it("extracts a verified email account from either SDK or token linked-account shapes", () => {
    expect(
      extractHostedPrivyEmailAccount([
        {
          address: "user@example.com",
          latestVerifiedAt: new Date(1741194420 * 1000),
          type: "email",
        },
      ]),
    ).toEqual({
      address: "user@example.com",
      verifiedAt: 1741194420,
    });

    expect(
      extractHostedPrivyEmailAccount([
        {
          address: "user@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
      ]),
    ).toEqual({
      address: "user@example.com",
      verifiedAt: 1741194420,
    });
  });

  it("prefers the best verified email account when one is available", () => {
    expect(
      extractHostedPrivyPreferredEmailAccount([
        {
          address: "first@example.com",
          type: "email",
        },
        {
          address: "verified@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
      ]),
    ).toEqual({
      address: "verified@example.com",
      verifiedAt: 1741194420,
    });

    expect(
      extractHostedPrivyPreferredEmailAccount([
        {
          address: "first@example.com",
          type: "email",
        },
        {
          address: "second@example.com",
          type: "email",
        },
      ]),
    ).toEqual({
      address: "first@example.com",
      verifiedAt: null,
    });
  });

  it("detects whether a linked email account is actually verified", () => {
    expect(isHostedPrivyEmailAccountVerified({
      address: "user@example.com",
      verifiedAt: 1741194420,
    })).toBe(true);
    expect(isHostedPrivyEmailAccountVerified({
      address: "user@example.com",
      verifiedAt: null,
    })).toBe(false);
    expect(
      extractHostedPrivyVerifiedEmailAccount([
        {
          address: "stale@example.com",
          type: "email",
        },
        {
          address: "user@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
      ]),
    ).toEqual({
      address: "user@example.com",
      verifiedAt: 1741194420,
    });
    expect(
      extractHostedPrivyVerifiedEmailAccount([
        {
          address: "older@example.com",
          latest_verified_at: 1741194300,
          type: "email",
        },
        {
          address: "newer@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
      ]),
    ).toEqual({
      address: "newer@example.com",
      verifiedAt: 1741194420,
    });
    expect(
      extractHostedPrivyVerifiedEmailAccount([
        {
          address: "user@example.com",
          type: "email",
        },
      ]),
    ).toBeNull();
  });

  it("fails closed when two verified email accounts tie for the newest verification timestamp", () => {
    expect(
      extractHostedPrivyVerifiedEmailAccount([
        {
          address: "first@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
        {
          address: "second@example.com",
          latest_verified_at: 1741194420,
          type: "email",
        },
      ]),
    ).toBeNull();
  });

  it("accepts the compact Privy identity-token verification timestamp field", () => {
    expect(
      extractHostedPrivyPhoneAccount([
        {
          lv: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ]),
    ).toEqual({
      number: "+14155552671",
      verifiedAt: 1741194420,
    });

    expect(
      extractHostedPrivyVerifiedEmailAccount([
        {
          address: "user@example.com",
          lv: 1741194420,
          type: "email",
        },
      ]),
    ).toEqual({
      address: "user@example.com",
      verifiedAt: 1741194420,
    });
  });

  it("only accepts embedded Privy wallets when selecting a hosted wallet", () => {
    expect(
      extractHostedPrivyWalletAccount([
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          type: "wallet",
          wallet_client: "metamask",
        },
      ]),
    ).toBeNull();

    expect(
      extractHostedPrivyWalletAccount([
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ]),
    ).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      chainType: "ethereum",
      id: null,
      type: "wallet",
    });
  });

  it("requires the preferred wallet chain when one is requested", () => {
    expect(
      extractHostedPrivyWalletAccount(
        [
          {
            address: "So11111111111111111111111111111111111111112",
            chain_type: "solana",
            connector_type: "embedded",
            delegated: false,
            imported: false,
            type: "wallet",
            wallet_client: "privy",
            wallet_client_type: "privy",
            wallet_index: 0,
          },
        ],
        "ethereum",
      ),
    ).toBeNull();
  });

  it("selects the lowest-index embedded wallet instead of trusting payload order", () => {
    expect(
      extractHostedPrivyWalletAccount([
        {
          address: "0x00000000000000000000000000000000000000bb",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 1,
        },
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ]),
    ).toEqual({
      address: "0x00000000000000000000000000000000000000aa",
      chainType: "ethereum",
      id: null,
      type: "wallet",
    });
  });

  it("fails closed when multiple embedded wallets are equally primary", () => {
    expect(
      extractHostedPrivyWalletAccount([
        {
          address: "0x00000000000000000000000000000000000000aa",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
        {
          address: "0x00000000000000000000000000000000000000bb",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ]),
    ).toBeNull();
  });

  it("extracts a Telegram account from direct or linked-account Privy shapes", () => {
    expect(extractHostedPrivyTelegramAccount({
      telegram: {
        first_name: "Alice",
        id: 456,
        username: "alice",
      },
    })).toEqual({
      firstName: "Alice",
      lastName: null,
      photoUrl: null,
      telegramUserId: "456",
      username: "alice",
    });

    expect(extractHostedPrivyTelegramAccount({
      linked_accounts: [
        {
          first_name: "Alice",
          id: "456",
          type: "telegram",
          username: "alice",
        },
      ],
    })).toEqual({
      firstName: "Alice",
      lastName: null,
      photoUrl: null,
      telegramUserId: "456",
      username: "alice",
    });
  });

  it("fails closed when direct and linked Telegram accounts disagree", () => {
    expect(resolveHostedPrivyTelegramAccountSelection({
      linked_accounts: [
        {
          first_name: "Alice",
          id: "456",
          type: "telegram",
          username: "alice",
        },
      ],
      telegram: {
        first_name: "Bob",
        id: 789,
        username: "bob",
      },
    })).toEqual({
      account: null,
      ambiguous: true,
    });
    expect(extractHostedPrivyTelegramAccount({
      linked_accounts: [
        {
          first_name: "Alice",
          id: "456",
          type: "telegram",
          username: "alice",
        },
      ],
      telegram: {
        first_name: "Bob",
        id: 789,
        username: "bob",
      },
    })).toBeNull();
  });
});
