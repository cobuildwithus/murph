import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberForPrivyIdentity: vi.fn(),
  resolveHostedPrivySessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyIdentity: mocks.lookupHostedMemberForPrivyIdentity,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  resolveHostedPrivySessionFromRequest: mocks.resolveHostedPrivySessionFromRequest,
}));

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
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
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
      },
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
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.lookupHostedMemberForPrivyIdentity.mockResolvedValue(
      createHostedMemberLookup(),
    );
  });

  it("returns null when no Privy session cookie is present", async () => {
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue(null);

    await expect(
      resolveHostedPrivyRequestAuthContext(
        new Request("https://join.example.test/api/settings/email/sync"),
        prisma,
      ),
    ).resolves.toBeNull();
    expect(mocks.lookupHostedMemberForPrivyIdentity).not.toHaveBeenCalled();
  });

  it("requires the hosted Privy identity cookie", async () => {
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue(null);

    await expect(
      requireHostedPrivyRequestAuthContext(
        new Request("https://join.example.test/api/settings/email/sync"),
        prisma,
      ),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("returns the authenticated hosted member when the cookie-backed session verifies", async () => {
    await expect(requireHostedPrivyRequestAuthContext(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      memberLookup: {
        matchedBy: [
          "privyUserId",
          "phoneNumber",
        ],
      },
      member: {
        id: "member_123",
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    expect(mocks.resolveHostedPrivySessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  });

  it("allows the completion route to verify the cookie-backed session before a member exists", async () => {
    mocks.lookupHostedMemberForPrivyIdentity.mockResolvedValue(null);

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
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
      ],
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.lookupHostedMemberForPrivyIdentity.mockResolvedValue(null);

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
    expect(mocks.lookupHostedMemberForPrivyIdentity).toHaveBeenCalledTimes(1);
  });

  it("blocks suspended members from active hosted mutations", async () => {
    mocks.lookupHostedMemberForPrivyIdentity.mockResolvedValue(
      createHostedMemberLookup({
        core: createHostedMember({
          suspendedAt: new Date("2025-03-27T08:00:00.000Z"),
        }),
      }),
    );

    await expect(requireHostedPrivyActiveRequestAuthContext(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("blocks unpaid members from active hosted mutations", async () => {
    mocks.lookupHostedMemberForPrivyIdentity.mockResolvedValue(
      createHostedMemberLookup({
        core: createHostedMember({
          billingStatus: HostedBillingStatus.unpaid,
        }),
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
      cookie: "privy-id-token=signed-identity-token",
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

function createHostedMemberLookup(overrides: Partial<{
  core: HostedMember;
  matchedBy: string[];
}> = {}) {
  return {
    core: createHostedMember(),
    identity: {
      maskedPhoneNumberHint: "*** 2671",
      memberId: "member_123",
      phoneNumber: "+14155552671",
      phoneNumberVerifiedAt: new Date("2025-03-27T08:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      walletAddress: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2025-03-27T08:00:00.000Z"),
      walletProvider: "privy",
    },
    matchedBy: [
      "privyUserId",
      "phoneNumber",
    ],
    ...overrides,
  };
}
