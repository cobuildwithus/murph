import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtimeEnv: {
    privyAppId: "cm_app_123" as string | null,
    privyVerificationKey: "line-1\\nline-2" as string | null,
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  verifyIdentityToken: mocks.verifyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
}));

import {
  readHostedPrivyIdentityTokenFromCookieHeader,
  requireHostedPrivyIdentity,
  verifyHostedPrivyIdentityToken,
} from "@/src/lib/hosted-onboarding/privy";

describe("hosted Privy verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeEnv.privyAppId = "cm_app_123";
    mocks.runtimeEnv.privyVerificationKey = "line-1\\nline-2";
  });

  it("verifies the identity token locally and uses the verified linked accounts", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
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

    await expect(requireHostedPrivyIdentity("  signed-identity-token  ")).resolves.toEqual({
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
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
      phone: {
        number: "+14155552671",
        verifiedAt: 1741194420,
      },
      userId: "did:privy:user_123",
      wallet: {
        address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        chainType: "ethereum",
        id: "wallet_123",
        type: "wallet",
      },
    });

    expect(mocks.verifyIdentityToken).toHaveBeenCalledWith({
      app_id: "cm_app_123",
      identity_token: "signed-identity-token",
      verification_key: "line-1\nline-2",
    });
  });

  it("requires the Privy verification key config for hosted verification", async () => {
    mocks.runtimeEnv.privyVerificationKey = null;

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_CONFIG_REQUIRED",
      httpStatus: 500,
    });
    expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
  });

  it("maps local token-verifier failures to hosted auth errors", async () => {
    mocks.verifyIdentityToken.mockRejectedValue(new Error("bad token"));

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("rejects malformed verifier results", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({});

    await expect(verifyHostedPrivyIdentityToken("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("rejects verified sessions whose linked phone account is not actually verified", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
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

    await expect(requireHostedPrivyIdentity("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_PHONE_REQUIRED",
      httpStatus: 400,
    });
  });

  it("rejects verified sessions that do not include an embedded wallet account", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          type: "wallet",
          wallet_client: "metamask",
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_WALLET_REQUIRED",
      httpStatus: 400,
    });
  });

  it("rejects verified sessions that only include a non-ethereum embedded wallet", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phoneNumber: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "So11111111111111111111111111111111111111112",
          chain_type: "solana",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_solana",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });

    await expect(requireHostedPrivyIdentity("signed-identity-token")).rejects.toMatchObject({
      code: "PRIVY_WALLET_REQUIRED",
      httpStatus: 400,
    });
  });

  it("reads the Privy identity token from request cookies", () => {
    expect(
      readHostedPrivyIdentityTokenFromCookieHeader(
        "other-cookie=abc; privy-id-token=identity-token; hb_hosted_session=session-token",
      ),
    ).toBe("identity-token");
    expect(readHostedPrivyIdentityTokenFromCookieHeader("other-cookie=abc")).toBeNull();
  });
});
