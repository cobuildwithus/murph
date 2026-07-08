import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedMemberIdentityPrivateColumns,
  buildHostedMemberRoutingPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";

const mocks = vi.hoisted(() => ({
  isHostedMemberActivationPending: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    contactPrivacyKeyring: {
      currentVersion: "v2",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
        v2: Buffer.alloc(32, 11),
      },
      readVersions: ["v2", "v1"],
    },
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    privyAppId: "cm_app_123",
    privyVerificationKey: "privy-verification-key",
    publicBaseUrl: "https://join.example.test",
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
}));

vi.mock("@/src/lib/hosted-onboarding/activation-progress", () => ({
  isHostedMemberActivationPending: mocks.isHostedMemberActivationPending,
}));

import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";

const NOW = new Date("2026-04-06T12:00:00.000Z");

const ACTIVE_MEMBER_ACCESS_RECORD = {
  accountGroupMemberships: [],
  billingStatus: HostedBillingStatus.active,
  suspendedAt: null,
  threadContainer: null,
};

describe("getHostedInviteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isHostedMemberActivationPending.mockResolvedValue(false);
  });

  it("loads the identity relation when reading invite status", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique,
      },
    } as never;

    await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        inviteCode: "invite-code",
      },
      include: {
        member: {
          include: {
            identity: true,
            routing: true,
          },
        },
      },
    });
  });

  it("keeps the invite active while exposing queued background activation after transport handoff", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity(),
          }),
        })),
      },
    } as never;
    mocks.isHostedMemberActivationPending.mockResolvedValue(true);

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: null,
      session: {
        authenticated: true,
        matchesInvite: true,
      },
      stage: "activating",
    });
  });

  it("does not authenticate a stored Privy binding without an app-session member", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: await createIdentity({
              privyUserId: "did:privy:user_123",
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: false,
        matchesInvite: false,
      },
      stage: "verify",
    });
  });

  it("keeps a resolved app member match active regardless of stored identity lookup keys", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity({
              phoneLookupKey: null,
              privyUserLookupKey: null,
              walletAddressLookupKey: null,
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      session: {
        authenticated: true,
        matchesInvite: true,
      },
      stage: "active",
    });
  });

  it("returns only the masked phone hint for a verify-stage invite", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: null,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: "+1 (202) 555-0123",
              })),
              phoneNumberVerifiedAt: null,
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      stage: "verify",
    });
    expect(status.invite).toEqual({
      code: "invite-code",
      expiresAt: "2026-04-07T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 4567",
      },
      phoneHint: "*** 4567",
      verificationMode: "invite_phone",
    });
    expect(status.invite).not.toHaveProperty("phonePrefill");
    expect(JSON.stringify(status)).not.toContain("+12025550123");
    expect(JSON.stringify(status)).not.toContain("+1 (202) 555-0123");
  });

  it("derives a saved phone target from signup phone when the stored hint is missing", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: null,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: "+1 (202) 555-0123",
              })),
              maskedPhoneNumberHint: null,
              phoneNumberVerifiedAt: null,
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      stage: "verify",
    });
    expect(status.invite).toEqual({
      code: "invite-code",
      expiresAt: "2026-04-07T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 0123",
      },
      phoneHint: "*** 0123",
      verificationMode: "invite_phone",
    });
    expect(status.invite).not.toHaveProperty("phonePrefill");
    expect(JSON.stringify(status)).not.toContain("+12025550123");
    expect(JSON.stringify(status)).not.toContain("+1 (202) 555-0123");
  });

  it("uses manual phone entry when no stored invite phone can be texted", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: null,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              })),
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status.invite).toMatchObject({
      phoneAuthTarget: {
        kind: "manual",
      },
      phoneHint: null,
      verificationMode: "manual_phone",
    });
  });

  it("uses email verification for pending Linq email participant contacts", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: null,
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              })),
              maskedPhoneNumberHint: null,
              phoneLookupKey: null,
              phoneNumberVerifiedAt: null,
            }),
            routing: await createRouting({
              pendingLinqChatId: "chat_email",
              pendingLinqParticipantContact: "buddy@icloud.com",
              pendingLinqParticipantContactKind: "email",
              pendingLinqParticipantContactLookupKey: "hbidx:email:v1:member_123",
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      messagingSetupRequired: false,
      stage: "verify",
    });
    expect(status.invite).toEqual({
      code: "invite-code",
      emailAuthTarget: {
        emailAddress: "buddy@icloud.com",
        kind: "saved",
      },
      expiresAt: "2026-04-07T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "manual",
      },
      phoneHint: null,
      verificationMode: "invite_email",
    });
  });

  it("does not expose the stored phone after the invite is already active", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: "+12025550123",
                privyUserId: null,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: "+12025550123",
              })),
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      authenticatedMember: createAuthenticatedMember(),
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      stage: "active",
    });
    expect(status.invite).not.toHaveProperty("phonePrefill");
    expect(JSON.stringify(status)).not.toContain("+12025550123");
  });

  it("does not expose a verified phone as a prefill to an unauthenticated invite holder", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: "+12025550123",
                privyUserId: "did:privy:user_123",
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              })),
              phoneNumberVerifiedAt: NOW,
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      session: {
        authenticated: false,
        matchesInvite: false,
      },
      stage: "verify",
    });
    expect(status.invite).not.toHaveProperty("phonePrefill");
    expect(JSON.stringify(status)).not.toContain("+12025550123");
  });

  it("does not expose a refreshed signup phone once the member phone is verified", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity({
              ...(await buildHostedMemberIdentityPrivateColumns({
                memberId: "member_123",
                phoneNumber: "+12025550123",
                privyUserId: "did:privy:user_123",
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: "+12025550123",
              })),
              phoneNumberVerifiedAt: NOW,
            }),
          }),
        })),
      },
    } as never;

    const status = await getHostedInviteStatus({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    expect(status).toMatchObject({
      session: {
        authenticated: false,
        matchesInvite: false,
      },
      stage: "verify",
    });
    expect(status.invite).not.toHaveProperty("phonePrefill");
    expect(JSON.stringify(status)).not.toContain("+12025550123");
  });

  it("returns the assigned Murph phone number only for matched active sessions", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity(),
            routing: await createRouting({
              linqChatId: "chat_123",
              linqRecipientPhone: "+1 (555) 010-0001",
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: "+15550100001",
      stage: "active",
    });
  });

  it("redacts the assigned Murph phone number for unmatched sessions", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity(),
            routing: await createRouting({
              linqChatId: "chat_123",
              linqRecipientPhone: "+15550100001",
            }),
          }),
        })),
      },
    } as never;

    await expect(
      getHostedInviteStatus({
        authenticatedMember: {
          ...createAuthenticatedMember(),
          id: "member_other",
        },
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      murphPhoneNumber: null,
      session: {
        authenticated: true,
        matchesInvite: false,
      },
    });
  });

  it("reports a family-sponsored not_started member as active instead of checkout", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [{
            group: {
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
            },
            status: "active",
          }],
          billingStatus: HostedBillingStatus.not_started,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.not_started,
            identity: await createIdentity(),
          }),
        })),
      },
    } as never;
    mocks.isHostedMemberActivationPending.mockResolvedValue(false);

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      stage: "active",
    });
  });

  it("stays active once activation is no longer pending", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(ACTIVE_MEMBER_ACCESS_RECORD),
      },
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(createInvite({
          member: createMember({
            billingStatus: HostedBillingStatus.active,
            identity: await createIdentity(),
          }),
        })),
      },
    } as never;
    mocks.isHostedMemberActivationPending.mockResolvedValue(false);

    await expect(
      getHostedInviteStatus({
        authenticatedMember: createAuthenticatedMember(),
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toMatchObject({
      stage: "active",
    });
  });

});

function createInvite(overrides: Record<string, unknown> = {}) {
  const member = createMember();

  return {
    channel: "web",
    createdAt: NOW,
    expiresAt: new Date("2026-04-07T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: "invite-code",
    member,
    memberId: member.id,
    sentAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function createIdentity(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: NOW,
    maskedPhoneNumberHint: "*** 4567",
    memberId: "member_123",
    phoneLookupKey: "hbidx:phone:v1:member_123",
    phoneNumberVerifiedAt: NOW,
    privyUserLookupKey: null,
    privyUserId: null,
    updatedAt: NOW,
    walletAddress: null,
    walletAddressLookupKey: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...(await buildHostedMemberIdentityPrivateColumns({
      memberId: "member_123",
      phoneNumber: "+14155554567",
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
    })),
    ...overrides,
  };
}

async function createRouting(input?: {
  linqChatId?: string | null;
  linqRecipientPhone?: string | null;
  pendingLinqChatId?: string | null;
  pendingLinqParticipantContact?: string | null;
  pendingLinqParticipantContactKind?: string | null;
  pendingLinqParticipantContactLookupKey?: string | null;
  pendingLinqRecipientPhone?: string | null;
  telegramUserLookupKey?: string | null;
}) {
  return {
    createdAt: NOW,
    memberId: "member_123",
    pendingLinqParticipantContactKind: input?.pendingLinqParticipantContactKind ?? null,
    pendingLinqParticipantContactLookupKey: input?.pendingLinqParticipantContactLookupKey ?? null,
    pendingLinqParticipantContactObservedAt: input?.pendingLinqParticipantContact
      ? NOW
      : null,
    telegramUserLookupKey: input?.telegramUserLookupKey ?? null,
    updatedAt: NOW,
    ...(await buildHostedMemberRoutingPrivateColumns({
      linqChatId: input?.linqChatId ?? null,
      linqRecipientPhone: input?.linqRecipientPhone ?? null,
      memberId: "member_123",
      pendingLinqChatId: input?.pendingLinqChatId ?? null,
      pendingLinqParticipantContact: input?.pendingLinqParticipantContact ?? null,
      pendingLinqRecipientPhone: input?.pendingLinqRecipientPhone ?? null,
      telegramThreadId: null,
      telegramUserId: null,
    })),
  };
}

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: HostedBillingStatus.not_started,
    createdAt: NOW,
    id: "member_123",
    identity: null,
    linqChatId: null,
    maskedPhoneNumberHint: "*** 0000",
    phoneLookupKey: "hbidx:phone:v1:legacy",
    phoneNumberVerifiedAt: null,
    privyUserId: null,
    routing: null,
    suspendedAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    telegramUserLookupKey: null,
    telegramUsername: null,
    updatedAt: NOW,
    walletAddress: null,
    walletChainType: null,
    walletCreatedAt: null,
    walletProvider: null,
    ...overrides,
  };
}

function createAuthenticatedMember() {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: NOW,
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: NOW,
  };
}
