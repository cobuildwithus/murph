import { describe, expect, it } from "vitest";

import {
  findHostedPrivyPasskeyCredentialIds,
  hasOnlyHostedPrivyPasskeyMfa,
  selectHostedPrivyEmbeddedEthereumWallet,
} from "@/src/lib/hosted-onboarding/privy-wallet-mfa";

const PRIMARY_ADDRESS = "0x1111111111111111111111111111111111111111";
const SECONDARY_ADDRESS = "0x2222222222222222222222222222222222222222";

describe("Privy wallet MFA selectors", () => {
  it("selects the canonical client-shape embedded Ethereum wallet", () => {
    expect(selectHostedPrivyEmbeddedEthereumWallet({
      linkedAccounts: [
        {
          address: PRIMARY_ADDRESS,
          chainType: "ethereum",
          connectorType: "embedded",
          type: "wallet",
          walletClientType: "privy",
          walletIndex: 0,
        },
      ],
    })).toEqual({
      status: "ready",
      wallet: {
        address: PRIMARY_ADDRESS,
        walletIndex: 0,
      },
    });
  });

  it("selects the index-zero server-shape wallet and ignores external or non-EVM wallets", () => {
    expect(selectHostedPrivyEmbeddedEthereumWallet({
      linked_accounts: [
        {
          address: SECONDARY_ADDRESS,
          chain_type: "ethereum",
          connector_type: "embedded",
          type: "wallet",
          wallet_client_type: "privy-v2",
          wallet_index: 1,
        },
        {
          address: PRIMARY_ADDRESS,
          chain_type: "ethereum",
          connector_type: "embedded",
          type: "wallet",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
        {
          address: SECONDARY_ADDRESS,
          chain_type: "ethereum",
          connector_type: "injected",
          type: "wallet",
          wallet_client_type: "metamask",
        },
        {
          address: "11111111111111111111111111111111",
          chain_type: "solana",
          connector_type: "embedded",
          type: "wallet",
          wallet_client_type: "privy",
        },
      ],
    })).toMatchObject({
      status: "ready",
      wallet: { address: PRIMARY_ADDRESS, walletIndex: 0 },
    });
  });

  it("fails closed when embedded wallets are ambiguous", () => {
    expect(selectHostedPrivyEmbeddedEthereumWallet({
      linkedAccounts: [
        {
          address: PRIMARY_ADDRESS,
          chainType: "ethereum",
          connectorType: "embedded",
          type: "wallet",
          walletClientType: "privy",
        },
        {
          address: SECONDARY_ADDRESS,
          chainType: "ethereum",
          connectorType: "embedded",
          type: "wallet",
          walletClientType: "privy",
        },
      ],
    })).toEqual({ status: "ambiguous" });
  });

  it("requires passkey to be the only wallet MFA method", () => {
    expect(hasOnlyHostedPrivyPasskeyMfa({ mfaMethods: ["passkey"] })).toBe(true);
    expect(hasOnlyHostedPrivyPasskeyMfa({ mfa_methods: [{ type: "passkey" }] })).toBe(true);
    expect(hasOnlyHostedPrivyPasskeyMfa({ mfaMethods: ["passkey", "sms"] })).toBe(false);
    expect(hasOnlyHostedPrivyPasskeyMfa({ mfaMethods: [] })).toBe(false);
  });

  it("reads and deduplicates passkey credential IDs across client and server shapes", () => {
    expect(findHostedPrivyPasskeyCredentialIds({
      linkedAccounts: [
        { type: "passkey", credentialId: "credential-a" },
        { type: "passkey", credential_id: "credential-a" },
        { type: "passkey", credentialId: "credential-b" },
      ],
    })).toEqual(["credential-a", "credential-b"]);
  });
});
