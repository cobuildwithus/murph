import { describe, expect, it } from "vitest";

import {
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyWalletAccount,
  parseHostedPrivyIdentityToken,
} from "@/src/lib/hosted-onboarding/privy-shared";

describe("hosted Privy identity helpers", () => {
  it("parses linked accounts out of an identity token payload", () => {
    const token = buildIdentityToken({
      linked_accounts: JSON.stringify([
        {
          type: "phone",
          phone_number: "+1 415 555 2671",
          latest_verified_at: 1741194420,
        },
        {
          type: "wallet",
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ]),
      sub: "did:privy:member_123",
    });

    const parsed = parseHostedPrivyIdentityToken(token);

    expect(parsed.subject).toBe("did:privy:member_123");
    expect(parsed.linkedAccounts).toHaveLength(2);
    expect(extractHostedPrivyPhoneAccount(parsed.linkedAccounts)).toEqual({
      number: "+14155552671",
      verifiedAt: 1741194420,
    });
    expect(extractHostedPrivyWalletAccount(parsed.linkedAccounts, "ethereum")).toEqual({
      address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainType: "ethereum",
      id: "wallet_123",
      type: "wallet",
    });
  });

  it("returns null when a required linked account is absent", () => {
    const linkedAccounts = [
      {
        address: "[email protected]",
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
});

function buildIdentityToken(payload: Record<string, unknown>): string {
  return `${encodeJwtSegment({ alg: "none", typ: "JWT" })}.${encodeJwtSegment(payload)}.`;
}

function encodeJwtSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
