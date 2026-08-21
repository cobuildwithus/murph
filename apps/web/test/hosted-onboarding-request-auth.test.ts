import { HostedBillingStatus, type HostedMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  resolveHostedPrivySessionFromRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: mocks.lookupHostedMemberForPrivyPrincipal,
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
  const hostedMemberAccessFindUnique = vi.fn();
  const prisma = {
    hostedMember: {
      findUnique: hostedMemberAccessFindUnique,
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState());
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
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(createHostedMember());
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
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).not.toHaveBeenCalled();
  });

  it("returns the authenticated hosted member when the cookie-backed session verifies", async () => {
    await expect(requirePrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
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

  it("uses the canonical member already returned by the Privy principal lookup", async () => {
    const member = createHostedMember();
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(member);

    await expect(resolvePrivyMemberAuthFromSession({
      identity: {
        phone: {
          number: "+14155552671",
          verifiedAt: 1741194420,
        },
        telegram: null,
        userId: "did:privy:user_123",
      },
      prisma,
    })).resolves.toBe(member);

    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledTimes(1);
  });

  it("resolves only through the canonical Privy-user binding when provider metadata is stale", async () => {
    const resolvedMember = createHostedMember({
      id: "member_resolved",
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
      verifiedPrivyUser: {
        custom_metadata: {
          murph_member_id: "member_stale",
        },
        id: "did:privy:user_123",
      },
    });
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(resolvedMember);

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: resolvedMember.id,
      },
    });
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledWith({
      identity: expect.objectContaining({
        userId: "did:privy:user_123",
      }),
      prisma,
    });
  });

  it("does not authenticate when the canonical Privy-user binding is absent", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);

    await expect(getPrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: null,
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
      createHostedMember({
        suspendedAt: new Date("2025-03-27T08:00:00.000Z"),
      }),
    );
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      suspendedAt: new Date("2025-03-27T08:00:00.000Z"),
    }));

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
      httpStatus: 403,
    });
  });

  it("blocks unpaid members from active hosted mutations with a billing-specific message", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMember({
        billingStatus: HostedBillingStatus.unpaid,
      }),
    );
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      billingStatus: HostedBillingStatus.unpaid,
    }));

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Your subscription is unpaid. Update billing before continuing.",
    });
  });

  it("blocks canceled members from active hosted mutations with a cancellation-specific message", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMember({
        billingStatus: HostedBillingStatus.canceled,
      }),
    );
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      billingStatus: HostedBillingStatus.canceled,
    }));

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Your subscription is canceled. Open billing to resume access.",
    });
  });

  it("allows Family-sponsored members without direct billing through active hosted mutations", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(
      createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
      }),
    );
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      accountGroupMemberships: [
        {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          status: "active",
        },
      ],
      billingStatus: HostedBillingStatus.not_started,
    }));

    await expect(requireActivePrivyMemberAuth(createAuthenticatedRequest(), prisma)).resolves.toMatchObject({
      member: {
        id: "member_123",
      },
    });
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_123",
      },
    }));
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
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.resolveHostedPrivySessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledTimes(1);
  });

  it("rejects fresh Privy proof for a different hosted member than the app session", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        id: "member_other",
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_other",
    });

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toMatchObject({
      code: "PRIVY_SESSION_MEMBER_MISMATCH",
      httpStatus: 409,
    });
    expect(hostedMemberAccessFindUnique).not.toHaveBeenCalled();
  });

  it("rejects fresh Privy proof for a different Privy user than the app session", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember(),
      privyUserId: "did:privy:user_other",
      sessionId: "hws_other",
    });

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toMatchObject({
      code: "PRIVY_SESSION_MEMBER_MISMATCH",
      httpStatus: 409,
    });
    expect(hostedMemberAccessFindUnique).not.toHaveBeenCalled();
  });

  it("uses the app-session member when the matching fresh Privy identity is not persisted yet", async () => {
    mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(null);

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).resolves.toMatchObject({
      appSession: {
        member: {
          id: "member_123",
        },
      },
      freshPrivy: {
        identity: {
          userId: "did:privy:user_123",
        },
        member: {
          id: "member_123",
        },
      },
    });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledTimes(1);
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledTimes(1);
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_123",
      },
    }));
  });

  it("keeps app-session verification independent from fresh Privy verification", async () => {
    const appSessionError = Object.assign(new Error("Sign in to continue."), {
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
    mocks.requireHostedAppSessionFromRequest.mockRejectedValue(appSessionError);

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toBe(appSessionError);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.resolveHostedPrivySessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.lookupHostedMemberForPrivyPrincipal).toHaveBeenCalledTimes(1);
    expect(hostedMemberAccessFindUnique).not.toHaveBeenCalled();
  });

  it("applies one active-member check after app-session and fresh-Privy members match", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      expiresAt: new Date("2026-04-26T00:00:00.000Z"),
      member: createHostedMember({
        billingStatus: HostedBillingStatus.unpaid,
      }),
      privyUserId: "did:privy:user_123",
      sessionId: "hws_123",
    });
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      billingStatus: HostedBillingStatus.unpaid,
    }));

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).rejects.toMatchObject({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
    });
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledTimes(1);
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_123",
      },
    }));
  });

  it("preserves thread-container access semantics with the single post-match check", async () => {
    hostedMemberAccessFindUnique.mockResolvedValue(createHostedMemberAccessState({
      billingStatus: HostedBillingStatus.not_started,
      threadContainer: {
        owner: {
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
      },
    }));

    await expect(
      requireFreshActivePrivyMemberAuthForHostedAppSession(createAuthenticatedRequest(), prisma),
    ).resolves.toMatchObject({
      appSession: {
        member: {
          id: "member_123",
        },
      },
      freshPrivy: {
        member: {
          id: "member_123",
        },
      },
    });
    expect(hostedMemberAccessFindUnique).toHaveBeenCalledTimes(1);
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
    assistantPersona: null,
    assistantPersonaCausalSeq: null,
    assistantDetail: null,
    assistantDetailCausalSeq: null,
    assistantHumor: null,
    assistantHumorCausalSeq: null,
    assistantModelPreference: null,
    assistantProviderPreference: null,
    assistantReasoningEffortPreference: null,
    assistantPush: null,
    assistantPushCausalSeq: null,
    assistantUnhinged: null,
    assistantUnhingedCausalSeq: null,
    assistantTone: null,
    assistantToneCausalSeq: null,
    assistantVoice: null,
    assistantVoiceCausalSeq: null,
    initialOnboardingCompletedAt: null,
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2025-03-27T08:00:00.000Z"),
    id: "member_123",
    pendingActivationTimeZone: null,
    signupNotificationContextEncrypted: null,
    signupNotificationEmailAttemptedAt: null,
    signupWelcomeEmailAttemptedAt: null,
    suspendedAt: null,
    updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    usageCreditBalanceUsdMicros: null,
    usageCreditLedgerVersion: null,
    ...overrides,
  };
}

interface HostedMemberAccessStateFixture {
  accountGroupMemberships: Array<{
    group: {
      billingStatus: HostedBillingStatus;
      suspendedAt: Date | null;
    };
    status: string;
  }>;
  billingStatus: HostedBillingStatus;
  suspendedAt: Date | null;
  threadContainer: null | {
    owner: {
      accountGroupMemberships: HostedMemberAccessStateFixture["accountGroupMemberships"];
      billingStatus: HostedBillingStatus;
      suspendedAt: Date | null;
    };
  };
}

function createHostedMemberAccessState(
  overrides: Partial<HostedMemberAccessStateFixture> = {},
): HostedMemberAccessStateFixture {
  return {
    accountGroupMemberships: [],
    billingStatus: HostedBillingStatus.active,
    suspendedAt: null,
    threadContainer: null,
    ...overrides,
  };
}
