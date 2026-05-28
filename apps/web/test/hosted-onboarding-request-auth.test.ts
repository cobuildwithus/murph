import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  resolveHostedPrivySessionFromRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  resolveHostedPrivySessionFromRequest: mocks.resolveHostedPrivySessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

import {
  requirePrivyCompletionSession,
  requireActivePrivyMemberAuth,
  requireFreshActivePrivyMemberAuthForHostedAppSession,
  requireFreshPrivyMemberAuthForHostedAppSession,
  resolvePrivyMemberAuthFromSession,
  requirePrivyMemberAuth,
  requirePrivySession,
  getPrivySession,
  getPrivyMemberAuth,
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
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(null);
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMemberLookup(),
    );
  });

  it("returns null when no Privy session cookie is present", async () => {
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue(null);

    await expect(
      getPrivyMemberAuth(
        new Request("https://join.example.test/api/settings/email/sync"),
        prisma,
      ),
    ).resolves.toBeNull();
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("requires the hosted Privy identity cookie", async () => {
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue(null);

    await expect(
      requirePrivyMemberAuth(
        new Request("https://join.example.test/api/settings/email/sync"),
        prisma,
      ),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("resolves a session-only auth context without member lookup", async () => {
    await expect(
      getPrivySession(createAuthenticatedRequest()),
    ).resolves.toMatchObject({
      identity: {
        userId: "did:privy:user_123",
      },
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("returns the authenticated hosted member when the cookie-backed session verifies", async () => {
    await expect(requirePrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      memberLookup: {
        matchedBy: [
          "privyUserId",
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
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledWith(expect.objectContaining({
      prisma,
    }));
  });

  it("starts the identity lookup and direct member read in parallel", async () => {
    const member = createHostedMember();
    const memberLookup = createHostedMemberLookup({
      core: member,
    });
    const lookupDeferred = createDeferred<typeof memberLookup | null>();
    const readDeferred = createDeferred<HostedMember | null>();

    mocks.lookupHostedMemberForPrivyPrincipal.mockReturnValue(lookupDeferred.promise);
    mocks.readHostedMemberCoreState.mockReturnValue(readDeferred.promise);

    const authPromise = resolvePrivyMemberAuthFromSession({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        telegram: null,
        userId: "did:privy:user_123",
        wallet: null,
      },
      memberId: member.id,
      prisma,
    });

    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledTimes(1);

    lookupDeferred.resolve(memberLookup);
    readDeferred.resolve(member);

    await expect(authPromise).resolves.toMatchObject({
      member,
      memberLookup: null,
    });
  });

  it("requires identity lookup confirmation before trusting the session Murph member id", async () => {
    const member = createHostedMember();
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: member.id,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(member);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(createHostedMemberLookup({
      core: member,
    }));

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: member.id,
      },
      memberLookup: null,
    });
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: member.id,
      prisma,
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        userId: "did:privy:user_123",
      }),
      prisma,
    }));
  });

  it("falls back to the Privy principal lookup when the trusted member id is stale", async () => {
    const memberLookup = createHostedMemberLookup();
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: "member_missing",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(null);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(memberLookup);

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: memberLookup.core.id,
      },
      memberLookup,
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        userId: "did:privy:user_123",
      }),
      prisma,
    }));
  });

  it("rejects stale session metadata when the stored Murph member id points at a different member", async () => {
    const staleMember = createHostedMember({
      id: "member_stale",
    });
    const resolvedMember = createHostedMember({
      id: "member_resolved",
    });
    const memberLookup = createHostedMemberLookup({
      core: resolvedMember,
      identity: {
        maskedPhoneNumberHint: "*** 2671",
        memberId: resolvedMember.id,
        phoneNumber: "+14155552671",
        phoneNumberVerifiedAt: new Date("2025-03-27T08:00:00.000Z"),
        privyUserId: "did:privy:user_123",
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      },
      matchedBy: ["privyUserId"],
    });

    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: staleMember.id,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(staleMember);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(memberLookup);

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: resolvedMember.id,
      },
      memberLookup,
    });
  });

  it("does not authenticate a stale session member id when identity probes find no hosted member", async () => {
    const staleMember = createHostedMember({
      id: "member_stale",
    });

    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [],
      memberId: staleMember.id,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.readHostedMemberCoreState.mockResolvedValue(staleMember);
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: null,
      memberLookup: null,
    });
  });

  it("requires the hosted Privy identity cookie for the session-only auth path", async () => {
    mocks.resolveHostedPrivySessionFromRequest.mockResolvedValue(null);

    await expect(
      requirePrivySession(createAuthenticatedRequest()),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("allows the completion route to verify the cookie-backed session before a member exists", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);

    await expect(requirePrivyCompletionSession(createAuthenticatedRequest())).resolves.toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
        },
        userId: "did:privy:user_123",
        wallet: {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        },
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("allows the completion route to proceed with a phone-only Privy session", async () => {
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
      memberId: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);

    await expect(requirePrivyCompletionSession(createAuthenticatedRequest())).resolves.toMatchObject({
      identity: {
        phone: {
          number: "+14155552671",
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("blocks suspended members from active hosted mutations", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMemberLookup({
        core: createHostedMember({
          suspendedAt: new Date("2025-03-27T08:00:00.000Z"),
        }),
      }),
    );

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("blocks unpaid members from active hosted mutations with a billing-specific message", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMemberLookup({
        core: createHostedMember({
          billingStatus: HostedBillingStatus.unpaid,
        }),
      }),
    );

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Your subscription is unpaid. Update billing before continuing.",
    });
  });

  it("blocks canceled members from active hosted mutations with a cancellation-specific message", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMemberLookup({
        core: createHostedMember({
          billingStatus: HostedBillingStatus.canceled,
        }),
      }),
    );

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Your subscription is canceled. Open billing to resume access.",
    });
  });

  it("requires a valid app session and fresh Privy proof for identity-sensitive member operations", async () => {
    await expect(
      requireFreshPrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).resolves.toMatchObject({
      appSession: {
        member: {
          id: "member_123",
        },
        sessionId: "hws_123",
      },
      freshPrivy: {
        member: {
          id: "member_123",
        },
      },
    });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.resolveHostedPrivySessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  });

  it("rejects fresh Privy proof for a different hosted member than the app session", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        id: "member_other",
      }),
      privyUserId: "did:privy:user_other",
      sessionId: "hws_other",
    });

    await expect(
      requireFreshPrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toMatchObject({
      code: "PRIVY_SESSION_MEMBER_MISMATCH",
      httpStatus: 409,
    });
  });

  it("applies active-member checks to both app session and fresh Privy proof", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        billingStatus: HostedBillingStatus.unpaid,
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toMatchObject({
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
    pendingActivationTimeZone: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    ...overrides,
  };
}

function createHostedMemberLookup(overrides: Partial<{
  core: HostedMember;
  identity: {
    maskedPhoneNumberHint: string | null;
    memberId: string;
    phoneNumber: string | null;
    phoneNumberVerifiedAt: Date | null;
    privyUserId: string | null;
    signupPhoneCodeSendAttemptId: string | null;
    signupPhoneCodeSendAttemptStartedAt: Date | null;
    signupPhoneCodeSentAt: Date | null;
    signupPhoneNumber: string | null;
    walletAddress: string | null;
    walletChainType: string | null;
    walletCreatedAt: Date | null;
    walletProvider: string | null;
  };
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
    ],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
