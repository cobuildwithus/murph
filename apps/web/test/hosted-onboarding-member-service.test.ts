import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  ensureHostedMemberForPhone,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import { upsertHostedMemberHomeLinqBindingTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        },
        readVersions: ["v1"],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment",
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();

  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
  };
});

const NOW = new Date("2026-04-07T01:00:00.000Z");

describe("ensureHostedMemberForPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites phone lookup storage while preserving verified identity fields on existing members", async () => {
    const existingMember = makeMember({
      id: "member_123",
      suspendedAt: null,
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_123",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),


      signupPhoneNumber: "+15550001111",


    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const identityFindFirst = vi.fn().mockImplementation(async ({
      where,
    }: {
      where: {
        phoneLookupKey?: {
          in?: string[];
        };
      };
    }) => {
      const phoneLookupKeys = where.phoneLookupKey?.in ?? [];

      if (phoneLookupKeys.length === 0) {
        return null;
      }

      return {
        ...currentIdentity,
        member: existingMember,
        phoneLookupKey: phoneLookupKeys[0] ?? currentIdentity.phoneLookupKey,
      };
    });
    const identityFindUnique = vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.memberId === "member_123") {
        return currentIdentity;
      }

      if (typeof where.phoneLookupKey === "string") {
        return {
          ...currentIdentity,
          member: existingMember,
          phoneLookupKey: where.phoneLookupKey,
        };
      }

      return null;
    });
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(existingMember),
      },
      hostedMemberIdentity: {
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),


        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),


        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
    }));
    const identityUpsertInput = identityUpsert.mock.calls[0]?.[0];
    expect(identityUpsertInput?.create).not.toHaveProperty("walletAddressEncrypted");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletAddressLookupKey");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletChainType");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletCreatedAt");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletProvider");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletAddressEncrypted");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletAddressLookupKey");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletChainType");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletCreatedAt");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletProvider");
  });

  it("creates new members with blind phone lookup storage plus encrypted signup phone state", async () => {
    const identityCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn(async ({
      data,
    }: {
      data: { id: string };
    }) => makeMember({
      id: data.id,
      suspendedAt: null,
    }));
    const prisma = asRootPrisma({
      hostedMember: {
        create,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        createMany: identityCreateMany,
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingStatus: "not_started",
      }),
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
    expect(identityCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
      skipDuplicates: true,
    }));
  });

  it("recovers from a concurrent create conflict by refreshing the winning member row", async () => {
    const concurrentMember = makeMember({
      id: "member_123",
      suspendedAt: null,
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:existing",
      signupPhoneNumber: "+15550001111",
    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const identityFindFirst = vi.fn().mockResolvedValue(null);
    const identityFindUnique = vi.fn().mockImplementation(async ({
      where,
    }: {
      where: Record<string, unknown>;
    }) => {
      if (where.memberId === "member_123") {
        return currentIdentity;
      }

      if (typeof where.phoneLookupKey === "string") {
        return {
          ...currentIdentity,
          member: concurrentMember,
          phoneLookupKey: where.phoneLookupKey,
        };
      }

      return null;
    });
    const create = vi.fn(async ({ data }: { data: { id: string } }) => makeMember({
      id: data.id,
      suspendedAt: null,
    }));
    const identityCreateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = asRootPrisma({
      hostedMember: {
        create,
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(concurrentMember),
      },
      hostedMemberIdentity: {
        createMany: identityCreateMany,
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      update: expect.objectContaining({
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
    }));
  });

  it("does not provision control roots or rewrite identity for suspended existing phone members", async () => {
    const suspendedMember = makeMember({
      id: "member_suspended",
      suspendedAt: new Date("2026-04-07T02:00:00.000Z"),
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_suspended",
      phoneLookupKey: "hbidx:phone:v1:suspended",
      signupPhoneNumber: "+15550001111",
    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(suspendedMember),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn().mockResolvedValue({
          ...currentIdentity,
          member: suspendedMember,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: identityUpsert,
      },
    });

    const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );

    await expect(ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(provisionActiveHostedDomainRootEnvelopeForUserOnly).not.toHaveBeenCalled();
    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("rejects invalid phone numbers", async () => {
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn(),
      },
    });

    await expect(
      ensureHostedMemberForPhone({
        phoneNumber: "not-a-phone",
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_NUMBER_INVALID",
    });
  });
});

describe("upsertHostedMemberHomeLinqBinding", () => {
  it("stores the latest Linq home chat id in the routing table for future activation welcomes", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
        updateMany,
        upsert,
      },
    });

    await upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(findFirst).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        NOT: {
          memberId: "member_123",
        },
        linqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqParticipantContactKind: null,
        linqParticipantContactLookupKey: null,
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      },
      where: {
        memberId: "member_123",
      },
    });
  });

  it("fails closed instead of clearing another member's home route for the same chat", async () => {
    const findFirst = vi.fn().mockResolvedValue({ memberId: "member_other" });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = asRootPrisma({
      $executeRaw: vi.fn().mockResolvedValue(0),
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findFirst,
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
        upsert,
      },
    });

    await expect(
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: "chat_new",
        memberId: "member_123",
        prisma: prisma as never,
        recipientPhone: "+15550100001",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_LINQ_CHAT_HOME_ROUTE_CONFLICT",
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects empty chat ids", async () => {
    const upsert = vi.fn();
    const updateMany = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: vi.fn(),
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    });

    await expect(
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: null as never,
        memberId: "member_123",
        prisma: prisma as never,
        recipientPhone: null,
      }),
    ).rejects.toThrow("Hosted Linq routing requires a non-empty chat id.");
  });
});

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: "not_started",
    createdAt: NOW,
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeInviteRecord() {
  return {
    expiresAt: new Date("2026-04-08T00:00:00.000Z"),
    inviteCode: "invite-code",
    member: {
      id: "member_123",
      identity: {
        maskedPhoneNumberHint: "*** 4567",
      },
    },
    memberId: "member_123",
  };
}

interface HostedMemberIdentityFindInput {
  include?: Record<string, unknown>;
  where: Record<string, unknown>;
}

interface HostedMemberIdentityTestDelegate {
  createMany?: ReturnType<typeof vi.fn>;
  findFirst?: (input: HostedMemberIdentityFindInput) => Promise<unknown> | unknown;
  findMany?: (input: HostedMemberIdentityFindInput) => Promise<unknown[]> | unknown[];
}

function asRootPrisma<T extends object>(tx: T): T & {
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
} {
  const prisma = tx as T & {
    $executeRaw?: ReturnType<typeof vi.fn>;
    $queryRaw?: ReturnType<typeof vi.fn>;
    hostedMember?: {
      delete?: ReturnType<typeof vi.fn>;
    };
    hostedMemberIdentity?: HostedMemberIdentityTestDelegate;
    hostedMemberRouting?: {
      createMany?: ReturnType<typeof vi.fn>;
    };
  };

  const executeRaw = prisma.$executeRaw ?? vi.fn().mockResolvedValue(0);
  const queryRaw = prisma.$queryRaw ?? vi.fn().mockImplementation((
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise.resolve(query.join("").includes("hosted_runtime_cutover")
    ? [{ phase: "legacy" }]
    : [{ id: values.at(-1) }]));
  prisma.$executeRaw = executeRaw;
  prisma.$queryRaw = queryRaw;
  prisma.hostedMember ??= {};
  prisma.hostedMember.delete ??= vi.fn().mockResolvedValue({});
  if (prisma.hostedMemberIdentity) {
    prisma.hostedMemberIdentity.createMany ??= vi.fn().mockResolvedValue({ count: 1 });
    prisma.hostedMemberIdentity.findMany ??= vi.fn(async (input: HostedMemberIdentityFindInput) => {
      const identity = await prisma.hostedMemberIdentity?.findFirst?.(input);
      return identity ? [identity] : [];
    });
  }
  if (prisma.hostedMemberRouting) {
    prisma.hostedMemberRouting.createMany ??= vi.fn().mockResolvedValue({ count: 1 });
  }

  return {
    ...prisma,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (callback: (innerTx: T) => Promise<unknown>) => callback(prisma)),
  };
}

async function makeIdentityRecord(input: {
  memberId: string;
  phoneLookupKey?: string;
  phoneNumber?: string | null;
  phoneNumberVerifiedAt?: Date | null;
  signupPhoneNumber?: string | null;
  walletAddress?: string | null;
  walletAddressLookupKey?: string | null;
  walletChainType?: string | null;
  walletCreatedAt?: Date | null;
  walletProvider?: string | null;
}) {
  return {
    maskedPhoneNumberHint: "*** 4567",
    memberId: input.memberId,
    phoneLookupKey: input.phoneLookupKey ?? "hbidx:phone:v1:existing",
    phoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: input.memberId,
      value: input.phoneNumber ?? null,
    }),
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,


    signupPhoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.signup-phone-number",
      memberId: input.memberId,
      value: input.signupPhoneNumber ?? null,
    }),


  };
}
