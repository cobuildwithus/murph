import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findHostedMemberForPrivyIdentity: vi.fn(),
  revnetEnabled: false,
  verifyHostedPrivyAccessToken: vi.fn(),
  verifyHostedPrivyIdentityToken: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  findHostedMemberForPrivyIdentity: mocks.findHostedMemberForPrivyIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", () => ({
  isHostedOnboardingRevnetEnabled: () => mocks.revnetEnabled,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/privy")>(
    "@/src/lib/hosted-onboarding/privy",
  );

  return {
    ...actual,
    verifyHostedPrivyAccessToken: mocks.verifyHostedPrivyAccessToken,
    verifyHostedPrivyIdentityToken: mocks.verifyHostedPrivyIdentityToken,
  };
});

import {
  requireHostedPrivyCompletionRequestAuthContext,
  requireHostedPrivyActiveRequestAuthContext,
  requireHostedPrivyRequestAuthContext,
  resolveHostedPrivyRequestAuthContext,
} from "@/src/lib/hosted-onboarding/request-auth";

describe("hosted Privy request auth", () => {
  const prisma = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revnetEnabled = false;
    mocks.verifyHostedPrivyAccessToken.mockResolvedValue({
      appId: "cm_app_123",
      expiration: 1743067800,
      issuedAt: 1743064200,
      issuer: "privy.io",
      sessionId: "session_123",
      userId: "did:privy:user_123",
    });
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
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
        {
          address: "user@example.com",
          latest_verified_at: 1743064200,
          type: "email",
        },
      ],
    });
    mocks.findHostedMemberForPrivyIdentity.mockResolvedValue(createHostedMember());
  });

  it("returns null when no Privy auth headers are present", async () => {
    await expect(
      resolveHostedPrivyRequestAuthContext(
        new Request("https://join.example.test/api/settings/email/sync"),
        prisma,
      ),
    ).resolves.toBeNull();
    expect(mocks.verifyHostedPrivyAccessToken).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyIdentityToken).not.toHaveBeenCalled();
  });

  it("requires the full bearer plus identity-token auth header set", async () => {
    await expect(
      requireHostedPrivyRequestAuthContext(
        new Request("https://join.example.test/api/settings/email/sync", {
          headers: {
            "x-privy-identity-token": "identity-token",
          },
        }),
        prisma,
      ),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
    expect(mocks.verifyHostedPrivyAccessToken).not.toHaveBeenCalled();
    expect(mocks.verifyHostedPrivyIdentityToken).not.toHaveBeenCalled();
  });

  it("rejects requests when the verified access token and identity token resolve to different users", async () => {
    mocks.verifyHostedPrivyAccessToken.mockResolvedValue({
      appId: "cm_app_123",
      expiration: 1743067800,
      issuedAt: 1743064200,
      issuer: "privy.io",
      sessionId: "session_123",
      userId: "did:privy:user_other",
    });

    await expect(requireHostedPrivyRequestAuthContext(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "PRIVY_SESSION_MISMATCH",
      httpStatus: 403,
    });
    expect(mocks.findHostedMemberForPrivyIdentity).not.toHaveBeenCalled();
  });

  it("returns the authenticated hosted member when both Privy tokens verify for the same user", async () => {
    await expect(requireHostedPrivyRequestAuthContext(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: "member_123",
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    expect(mocks.verifyHostedPrivyAccessToken).toHaveBeenCalledWith("signed-access-token");
    expect(mocks.verifyHostedPrivyIdentityToken).toHaveBeenCalledWith("signed-identity-token");
  });

  it("allows the completion route to verify the same strict auth contract before a member exists", async () => {
    mocks.findHostedMemberForPrivyIdentity.mockResolvedValue(null);

    await expect(requireHostedPrivyCompletionRequestAuthContext(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
        },
        userId: "did:privy:user_123",
        wallet: {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        },
      },
      member: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
  });

  it("allows the completion route to proceed with a phone-only Privy session when RevNet is disabled", async () => {
    mocks.verifyHostedPrivyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ],
    });
    mocks.findHostedMemberForPrivyIdentity.mockResolvedValue(null);

    await expect(requireHostedPrivyCompletionRequestAuthContext(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      member: null,
    });
    expect(mocks.findHostedMemberForPrivyIdentity).toHaveBeenCalledTimes(1);
  });

  it("blocks suspended members from active hosted mutations", async () => {
    mocks.findHostedMemberForPrivyIdentity.mockResolvedValue(
      createHostedMember({
        suspendedAt: new Date("2025-03-27T08:00:00.000Z"),
      }),
    );

    await expect(requireHostedPrivyActiveRequestAuthContext(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("blocks unpaid members from active hosted mutations", async () => {
    mocks.findHostedMemberForPrivyIdentity.mockResolvedValue(
      createHostedMember({
        billingStatus: HostedBillingStatus.unpaid,
      }),
    );

    await expect(requireHostedPrivyActiveRequestAuthContext(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
    });
  });
});

function createAuthenticatedRequest(): Request {
  return new Request("https://join.example.test/api/settings/email/sync", {
    headers: {
      authorization: "Bearer signed-access-token",
      "x-privy-identity-token": "signed-identity-token",
    },
  });
}

function createHostedMember(
  overrides: Partial<HostedMember> = {},
): HostedMember {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    ...overrides,
  };
}
