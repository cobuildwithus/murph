import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userGet: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  PrivyClient: class PrivyClient {
    users() {
      return {
        get: mocks.userGet,
      };
    }
  },
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    privyAppId: "cm_app_123",
    privyAppSecret: "privy-secret",
  }),
}));

import { requireHostedPrivyIdentity } from "@/src/lib/hosted-onboarding/privy";

describe("hosted Privy verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { __healthybobHostedPrivyClient?: unknown }).__healthybobHostedPrivyClient;
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __healthybobHostedPrivyClient?: unknown }).__healthybobHostedPrivyClient;
  });

  it("verifies the identity token server-side and falls back to the verified user linked accounts", async () => {
    const token = buildIdentityToken({
      linked_accounts: JSON.stringify([
        {
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          connector_type: "injected",
          type: "wallet",
          wallet_client: "metamask",
        },
      ]),
      sub: "did:privy:user_123",
    });
    mocks.userGet.mockResolvedValue({
      id: "did:privy:user_123",
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

    await expect(requireHostedPrivyIdentity(`  ${token}  `)).resolves.toEqual({
      linkedAccounts: [
        {
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          connector_type: "injected",
          type: "wallet",
          wallet_client: "metamask",
        },
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

    expect(mocks.userGet).toHaveBeenCalledWith({
      id_token: token,
    });
  });

  it("rejects verified sessions whose linked phone account is not actually verified", async () => {
    mocks.userGet.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
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

    await expect(
      requireHostedPrivyIdentity(
        buildIdentityToken({
          linked_accounts: [],
          sub: "did:privy:user_123",
        }),
      ),
    ).rejects.toMatchObject({
      code: "PRIVY_PHONE_REQUIRED",
      httpStatus: 400,
    });
  });

  it("rejects identity tokens whose subject does not match the verified Privy user", async () => {
    mocks.userGet.mockResolvedValue({
      id: "did:privy:user_456",
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

    await expect(
      requireHostedPrivyIdentity(
        buildIdentityToken({
          linked_accounts: [],
          sub: "did:privy:user_123",
        }),
      ),
    ).rejects.toMatchObject({
      code: "PRIVY_AUTH_FAILED",
      httpStatus: 401,
    });
  });

  it("rejects verified sessions that do not include an embedded wallet account", async () => {
    mocks.userGet.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0x1111111111111111111111111111111111111111",
          chain_type: "ethereum",
          connector_type: "injected",
          id: "wallet_external",
          type: "wallet",
          wallet_client: "metamask",
        },
      ],
    });

    await expect(
      requireHostedPrivyIdentity(
        buildIdentityToken({
          linked_accounts: [],
          sub: "did:privy:user_123",
        }),
      ),
    ).rejects.toMatchObject({
      code: "PRIVY_WALLET_REQUIRED",
      httpStatus: 400,
    });
  });
});

function buildIdentityToken(payload: Record<string, unknown>): string {
  return `${encodeJwtSegment({ alg: "none", typ: "JWT" })}.${encodeJwtSegment(payload)}.`;
}

function encodeJwtSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
