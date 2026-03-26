import { HostedBillingStatus, HostedInviteStatus, HostedMemberStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createHostedAuthenticationOptions,
  createHostedRegistrationOptions,
  verifyHostedAuthentication,
  verifyHostedRegistration,
  createHostedSession,
} = vi.hoisted(() => ({
  createHostedAuthenticationOptions: vi.fn(),
  createHostedRegistrationOptions: vi.fn(),
  verifyHostedAuthentication: vi.fn(),
  verifyHostedRegistration: vi.fn(),
  createHostedSession: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/passkeys", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/passkeys")>(
    "@/src/lib/hosted-onboarding/passkeys",
  );

  return {
    ...actual,
    createHostedAuthenticationOptions,
    createHostedRegistrationOptions,
    verifyHostedAuthentication,
    verifyHostedRegistration,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    passkeyOrigin: "https://join.example.test",
    passkeyRpId: "join.example.test",
    passkeyRpName: "Healthy Bob",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPasskeyConfig: () => ({
    expectedOrigin: "https://join.example.test",
    rpId: "join.example.test",
    rpName: "Healthy Bob",
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  requireHostedOnboardingStripeConfig: () => ({
    priceId: "price_123",
    secretKey: "sk_test_123",
    webhookSecret: "whsec_123",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  applyHostedSessionCookie: vi.fn(),
  createHostedSession,
}));

import {
  beginHostedPasskeyRegistration,
  finishHostedPasskeyAuthentication,
  finishHostedPasskeyRegistration,
} from "@/src/lib/hosted-onboarding/service";

const NOW = new Date("2026-03-26T12:00:00.000Z");

describe("hosted onboarding passkey service flow", () => {
  beforeEach(() => {
    createHostedAuthenticationOptions.mockReset();
    createHostedRegistrationOptions.mockReset();
    verifyHostedAuthentication.mockReset();
    verifyHostedRegistration.mockReset();
    createHostedSession.mockReset();
    createHostedSession.mockResolvedValue({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      token: "session-token",
    });
  });

  it("stores a hex challenge and returns wrapper-generated registration options", async () => {
    createHostedRegistrationOptions.mockReturnValue({
      publicKey: {
        challenge: "0xplaceholder",
      },
    });
    const prisma = createPrismaStub({
      invite: makeInvite(),
    });

    const result = await beginHostedPasskeyRegistration({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
    });

    const challengeCreate = prisma.hostedPasskeyChallenge.create.mock.calls[0]?.[0];
    expect(challengeCreate?.data.challenge).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result).toEqual({
      options: {
        publicKey: {
          challenge: "0xplaceholder",
        },
      },
    });
    expect(createHostedRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: challengeCreate?.data.challenge,
        rpId: "join.example.test",
        rpName: "Healthy Bob",
        userId: "member-webauthn-id",
      }),
    );
  });

  it("stores the verified webauthx public key bytes on registration", async () => {
    verifyHostedRegistration.mockReturnValue({
      credential: {
        id: "cred-registered",
        publicKey: "0x010203",
      },
    });
    const prisma = createPrismaStub({
      challenge: {
        challenge: "0xabcdef",
      },
      invite: makeInvite(),
    });

    const result = await finishHostedPasskeyRegistration({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      response: {
        id: "cred-registered",
      },
      userAgent: "test-agent",
    });

    expect(result).toMatchObject({
      stage: "checkout",
      token: "session-token",
    });
    const createArgs = prisma.hostedPasskey.create.mock.calls[0]?.[0].data;
    expect(createArgs.credentialId).toBe("cred-registered");
    expect(Array.from(createArgs.publicKey)).toEqual([1, 2, 3]);
    expect(createArgs).not.toHaveProperty("counter");
    expect(createArgs).not.toHaveProperty("transports");
    expect(createHostedSession).toHaveBeenCalled();
  });

  it("updates lastUsedAt without expecting a sign counter on authentication", async () => {
    verifyHostedAuthentication.mockReturnValue(true);
    const prisma = createPrismaStub({
      challenge: {
        challenge: "0xabcdef",
      },
      invite: makeInvite({
        passkeys: [
          {
            credentialId: "cred-existing",
            publicKey: Uint8Array.from([1, 2, 3]),
          },
        ],
      }),
      passkey: {
        credentialId: "cred-existing",
        id: "passkey-1",
        memberId: "member-1",
        publicKey: Uint8Array.from([1, 2, 3]),
      },
    });

    const result = await finishHostedPasskeyAuthentication({
      inviteCode: "invite-code",
      now: NOW,
      prisma,
      response: {
        id: "cred-existing",
      },
      userAgent: "test-agent",
    });

    expect(result).toMatchObject({
      stage: "checkout",
      token: "session-token",
    });
    expect(verifyHostedAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        passkey: expect.objectContaining({
          credentialId: "cred-existing",
        }),
      }),
    );
    expect(prisma.hostedPasskey.update).toHaveBeenCalledWith({
      where: {
        id: "passkey-1",
      },
      data: {
        lastUsedAt: NOW,
      },
    });
  });

  it("consumes the stored challenge before authentication verification so failures require a fresh ceremony", async () => {
    verifyHostedAuthentication.mockReturnValue(false);
    const prisma = createPrismaStub({
      challenge: {
        challenge: "0xabcdef",
        type: "authentication",
      },
      invite: makeInvite({
        passkeys: [
          {
            credentialId: "cred-existing",
            publicKey: Uint8Array.from([1, 2, 3]),
          },
        ],
      }),
      passkey: {
        credentialId: "cred-existing",
        id: "passkey-1",
        memberId: "member-1",
        publicKey: Uint8Array.from([1, 2, 3]),
      },
    });

    await expect(
      finishHostedPasskeyAuthentication({
        inviteCode: "invite-code",
        now: NOW,
        prisma,
        response: {
          id: "cred-existing",
        },
        userAgent: "test-agent",
      }),
    ).rejects.toMatchObject({
      code: "PASSKEY_AUTH_FAILED",
    });

    expect(prisma.hostedPasskeyChallenge.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "challenge-1",
      },
    });
  });
});

function createPrismaStub(input: {
  challenge?: { challenge: string; type?: string };
  invite: any;
  passkey?: any;
}) {
  return {
    hostedInvite: {
      findUnique: vi.fn().mockResolvedValue(input.invite),
      update: vi.fn().mockResolvedValue({}),
    },
    hostedMember: {
      update: vi.fn().mockResolvedValue({}),
    },
    hostedPasskey: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(input.passkey ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
    hostedPasskeyChallenge: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(
        input.challenge
          ? {
              createdAt: NOW,
              expiresAt: new Date("2026-03-26T12:05:00.000Z"),
              id: "challenge-1",
              inviteId: "invite-1",
              memberId: "member-1",
              type: input.challenge.type ?? "registration",
              ...input.challenge,
            }
          : null,
      ),
    },
  } as any;
}

function makeInvite(input?: {
  passkeys?: Array<{
    credentialId: string;
    publicKey: Uint8Array;
  }>;
}) {
  return {
    authenticatedAt: null,
    channel: "linq",
    checkouts: [],
    createdAt: NOW,
    expiresAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "invite-1",
    inviteCode: "invite-code",
    member: {
      billingStatus: HostedBillingStatus.not_started,
      id: "member-1",
      normalizedPhoneNumber: "+61400111222",
      passkeys: input?.passkeys ?? [],
      phoneNumber: "+61400111222",
      status: HostedMemberStatus.invited,
      webauthnUserId: "member-webauthn-id",
    },
    memberId: "member-1",
    openedAt: null,
    paidAt: null,
    sentAt: NOW,
    status: HostedInviteStatus.pending,
    triggerText: null,
    updatedAt: NOW,
  };
}
