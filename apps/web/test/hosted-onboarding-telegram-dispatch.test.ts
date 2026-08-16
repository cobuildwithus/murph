import { HostedBillingStatus } from "@prisma/client";
import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  areHostedDomainRootProviderCallsDisabled,
  getHostedDomainRootUnwrapCache,
  type CachedUnwrappedHostedDomainRoot,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  HostedDomainRootPreparationMismatchError,
  readPreparedHostedDomainRootForWebLocal,
  type PreparedHostedDomainRootForWeb,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingTelegramPrivateState,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedTelegramMessageLookupKey,
  createHostedTelegramUsernameLookupKey,
  createHostedTelegramUserLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  openHostedThreadDeliveryRoute,
  sealHostedThreadDeliveryRoute,
} from "@/src/lib/hosted-routing/thread-delivery-route";
import { renderUserFacingMessage } from "@/src/lib/hosted-messages/user-facing-messages";

type HostedThreadDeliveryRouteRefresher =
  typeof import("@/src/lib/hosted-routing/thread-container-service")[
    "refreshHostedThreadContainerDeliveryRouteTx"
  ];

type TelegramRootResult = CachedUnwrappedHostedDomainRoot;
type TelegramRootReference = {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
};
type TelegramActiveRootUnwrapper = (input: {
  domain: HostedCryptoDomain;
  prisma?: unknown;
  retainFailureInScopedCache?: boolean;
  userId: string;
}) => Promise<TelegramRootResult>;
type TelegramExactRootUnwrapper = (input: TelegramRootReference & {
  prisma?: unknown;
}) => Promise<TelegramRootResult>;

const mocks = vi.hoisted(() => {
  const state = {
    acceptHostedFamilyInviteFromTelegramTx: vi.fn(),
    activeRootKeyIdsByDomain: new Map<string, string[]>(),
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    familyFallbackResolutionOverrides: [] as Array<string | null>,
    familyInboundResolutionOverrides: [] as Array<string | null>,
    lockAndReadActiveHostedDomainRootKeyIdTx: vi.fn(),
    memberRowLockOutcomes: [] as boolean[],
    preparedRootKeyIdsByDomain: new Map<string, string[]>(),
    providerKmsWork: vi.fn(),
    providerCallsDisabledDuringTransactionRootReads: [] as boolean[],
    revalidatePreparedHostedDomainRootForWebTx: vi.fn(),
    rootApiCalls: [] as Array<{
      domain: HostedCryptoDomain;
      mode: "active" | "exact";
      rootKeyId?: string;
      transactionOpen: boolean;
      userId: string;
    }>,
    transactionDepth: 0,
    unwrapHostedDomainRootForWeb: vi.fn<TelegramActiveRootUnwrapper>(),
    unwrapHostedDomainRootForWebByRootKeyId:
      vi.fn<TelegramExactRootUnwrapper>(),
    bindArmedHostedUsageReferralToNewContainerTx: vi.fn(async () => ({
      referralIds: [],
    })),
    ensureHostedThreadContainerRouteTx: vi.fn(async () => ({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: "member_telegram_group_container",
      created: false,
      demotedMailboxConsumedAt: null,
    })),
    prepareHostedThreadContainerCreation: vi.fn(async (input: {
      accountLookupKey: string;
      channel: "telegram";
      threadId: string;
    }) => ({
      containerMemberId: "member_telegram_group_container",
      cryptoDomainRoots: new Map(),
      deliveryRoute: {
        channel: "telegram" as const,
        schema: "murph.hosted-thread-delivery-route.v1" as const,
        threadId: input.threadId,
      },
      deliveryRouteEncrypted: "prepared-telegram-delivery-route",
    })),
    prepareHostedThreadContainerDeliveryRoute: vi.fn(async (input: {
      accountLookupKey: string;
      channel: "telegram";
      containerMemberId: string;
      observedDeliveryRouteEncrypted: string | null;
      threadId: string;
    }) => ({
      containerMemberId: input.containerMemberId,
      deliveryRoute: {
        channel: "telegram" as const,
        schema: "murph.hosted-thread-delivery-route.v1" as const,
        threadId: input.threadId,
      },
      deliveryRouteEncrypted: "prepared-telegram-delivery-route",
      observedDeliveryRouteEncrypted: input.observedDeliveryRouteEncrypted,
    })),
    refreshHostedThreadContainerDeliveryRouteTx:
      vi.fn<HostedThreadDeliveryRouteRefresher>(async () => ({
        deliveryRoute: {
          channel: "telegram" as const,
          schema: "murph.hosted-thread-delivery-route.v1" as const,
          threadId: "-100123",
        },
        demotedMailboxConsumedAt: null,
      })),
    signalHostedMailboxAppendRuntime: vi.fn(async () => ({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    })),
    materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(async () => {}),
    provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn(async () => ({})),
    observeHostedUsageReferralInboundTx: vi.fn(async (): Promise<{
      isBoundReferralTarget: boolean;
      qualificationCandidateReferralIds: string[];
    }> => ({
      isBoundReferralTarget: false,
      qualificationCandidateReferralIds: [],
    })),
    reconcileHostedUsageReferralRewardAfterCommit: vi.fn(async () => null),
    rearmHostedPhoneCallResultNotificationRecovery: vi.fn(async () => true),
    readHostedThreadRouteByThreadIdentity: vi.fn(async (): Promise<{
      channel: "telegram";
      containerMemberId: string;
      deliveryRouteState?: {
        deliveryRouteEncrypted: string | null;
        deliveryRouteEncryptedPresent: boolean;
        threadIdentityLookupKey: string;
        threadLookupKey: string;
      };
      owner: { id: string };
    } | null> => null),
    readHostedMailboxItemByDedupeKey: vi.fn(async () => null),
    readHostedMailboxItemOwnerById: vi.fn(async (input: {
      mailboxItemId: string;
    }) => ({
      id: input.mailboxItemId,
      userId: "member_telegram_123",
    })),
    runtimeEnv: {
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        } as Record<string, Buffer>,
        readVersions: ["v1"] as string[],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: null as string | null,
      privyAppId: "privy-app-id",
      privyVerificationKey: "privy-key",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment" as const,
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: "murph_bot",
      telegramWebhookSecret: null as string | null,
    },
    appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
      dispatch?: { eventId: string };
      envelope?: {
        eventId: string;
        message?: {
          telegramMessage?: {
            threadIsDirect?: boolean;
          };
        };
        userId?: string;
      };
      eventId?: string;
      prepared?: PreparedHostedDomainRootForWeb;
      tx?: unknown;
      wake?: { eventId: string };
    }) => {
      if (
        input.envelope?.message?.telegramMessage?.threadIsDirect === true
        && input.envelope.userId
      ) {
        if (input.prepared) {
          await state.revalidatePreparedHostedDomainRootForWebTx({
            prepared: input.prepared,
            tx: input.tx,
          });
        } else {
          const root = await state.unwrapHostedDomainRootForWeb({
            domain: "ingress",
            prisma: input.tx,
            userId: input.envelope.userId,
          });
          root.rootKey.fill(0);
        }
      }
      await state.enqueueHostedExecutionOutbox(input);
      const eventId = typeof input.eventId === "string"
        ? input.eventId
        : input.dispatch?.eventId ?? input.envelope?.eventId ?? input.wake?.eventId;
      if (!eventId) {
        throw new Error("Expected a hosted mailbox append eventId.");
      }
      return {
        item: {
          dedupeKey: eventId,
          id: `mailbox_${eventId}`,
        },
      };
    }),
  };

  return state;
});

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>(
    "@/src/lib/hosted-mailbox/store",
  );

  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
    appendHostedMailboxEnvelopeWithPreparedCryptoTx:
      mocks.appendHostedMailboxEnvelopeTx,
    readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
  };
});

vi.mock("@/src/lib/hosted-routing/thread-container-service", () => ({
  ensureHostedThreadContainerRouteTx: mocks.ensureHostedThreadContainerRouteTx,
  prepareHostedThreadContainerCreation:
    mocks.prepareHostedThreadContainerCreation,
  prepareHostedThreadContainerDeliveryRoute:
    mocks.prepareHostedThreadContainerDeliveryRoute,
  refreshHostedThreadContainerDeliveryRouteTx:
    mocks.refreshHostedThreadContainerDeliveryRouteTx,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-routing/thread-route-store")
  >("@/src/lib/hosted-routing/thread-route-store");
  return {
    ...actual,
    readHostedThreadRouteByThreadIdentity:
      mocks.readHostedThreadRouteByThreadIdentity,
  };
});

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  bindArmedHostedUsageReferralToNewContainerTx:
    mocks.bindArmedHostedUsageReferralToNewContainerTx,
  observeHostedUsageReferralInboundTx:
    mocks.observeHostedUsageReferralInboundTx,
  reconcileHostedUsageReferralRewardAfterCommit:
    mocks.reconcileHostedUsageReferralRewardAfterCommit,
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  hasHostedPrivyPhoneAuthConfig: vi.fn(() => false),
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/family-plan")
  >("@/src/lib/hosted-onboarding/family-plan");
  mocks.acceptHostedFamilyInviteFromTelegramTx.mockImplementation(
    actual.acceptHostedFamilyInviteFromTelegramTx,
  );

  return {
    ...actual,
    acceptHostedFamilyInviteFromTelegramTx:
      mocks.acceptHostedFamilyInviteFromTelegramTx,
    resolveHostedFamilyInviteCodeFromTelegramStartFallback: (
      ...args: Parameters<
        typeof actual.resolveHostedFamilyInviteCodeFromTelegramStartFallback
      >
    ) => mocks.familyFallbackResolutionOverrides.length > 0
      ? Promise.resolve(mocks.familyFallbackResolutionOverrides.shift() ?? null)
      : actual.resolveHostedFamilyInviteCodeFromTelegramStartFallback(...args),
    resolveHostedFamilyInviteTokenForInbound: (
      ...args: Parameters<typeof actual.resolveHostedFamilyInviteTokenForInbound>
    ) => mocks.familyInboundResolutionOverrides.length > 0
      ? Promise.resolve(mocks.familyInboundResolutionOverrides.shift() ?? null)
      : actual.resolveHostedFamilyInviteTokenForInbound(...args),
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service-stripe", () => ({
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-telegram-dispatch.test.ts");
  }),
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/phone-calls/reconciliation-workflow-start", () => ({
  rearmHostedPhoneCallResultNotificationRecovery:
    mocks.rearmHostedPhoneCallResultNotificationRecovery,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(
    "@/src/lib/hosted-crypto/domain-root-store",
  );

  return {
    ...actual,
    lockAndReadActiveHostedDomainRootKeyIdTx:
      mocks.lockAndReadActiveHostedDomainRootKeyIdTx,
    provisionActiveHostedDomainRootEnvelopeForUserOnly:
      mocks.provisionActiveHostedDomainRootEnvelopeForUserOnly,
    prepareHostedDomainRootForWeb: async (
      input: Parameters<typeof actual.prepareHostedDomainRootForWeb>[0],
    ) => {
      const root = await mocks.unwrapHostedDomainRootForWeb(input);
      root.rootKey.fill(0);
      return actual.prepareHostedDomainRootForWeb(input);
    },
    revalidatePreparedHostedDomainRootForWebTx:
      mocks.revalidatePreparedHostedDomainRootForWebTx,
    unwrapHostedDomainRootForWeb: mocks.unwrapHostedDomainRootForWeb,
    unwrapHostedDomainRootForWebByRootKeyId:
      mocks.unwrapHostedDomainRootForWebByRootKeyId,
  };
});

import { handleHostedOnboardingTelegramWebhook as handleHostedOnboardingTelegramWebhookImpl } from "@/src/lib/hosted-onboarding/webhook-service";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { parseHostedTelegramWebhookUpdate } from "@/src/lib/hosted-onboarding/telegram";
import { planHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-telegram";

const actualThreadContainerService = await vi.importActual<
  typeof import("@/src/lib/hosted-routing/thread-container-service")
>("@/src/lib/hosted-routing/thread-container-service");

type HostedOnboardingTelegramWebhookInput = Parameters<typeof handleHostedOnboardingTelegramWebhookImpl>[0];
type TelegramWebhookPrismaHarness = {
  $executeRaw: () => Promise<unknown>;
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $transaction: (callback: (tx: TelegramWebhookPrismaHarness) => Promise<unknown>) => Promise<unknown>;
  hostedMember?: {
    findUnique?: ReturnType<typeof vi.fn>;
  };
  hostedThreadContainerParticipant?: {
    findMany?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  };
  hostedMemberRouting?: {
    findMany?: (...args: unknown[]) => Promise<unknown>;
    findFirst?: (...args: unknown[]) => Promise<unknown>;
    findUnique?: (...args: unknown[]) => Promise<unknown>;
    upsert?: ReturnType<typeof vi.fn>;
  };
  hostedWebhookReceipt?: {
    create?: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
  };
  hostedWebhookReceiptSideEffect?: {
    deleteMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  };
};

describe("handleHostedOnboardingTelegramWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeRootKeyIdsByDomain.clear();
    mocks.familyFallbackResolutionOverrides.length = 0;
    mocks.familyInboundResolutionOverrides.length = 0;
    mocks.memberRowLockOutcomes.length = 0;
    mocks.preparedRootKeyIdsByDomain.clear();
    mocks.providerCallsDisabledDuringTransactionRootReads.length = 0;
    installDefaultHostedSecureBoxStringTestCodec();
    mocks.rootApiCalls.length = 0;
    mocks.transactionDepth = 0;
    mocks.providerKmsWork.mockResolvedValue(undefined);
    mocks.revalidatePreparedHostedDomainRootForWebTx.mockImplementation(
      async (input: {
        prepared: PreparedHostedDomainRootForWeb;
        tx: unknown;
      }) => {
        const local = readPreparedHostedDomainRootForWebLocal(input.prepared);
        const activeRootKeyId = await mocks
          .lockAndReadActiveHostedDomainRootKeyIdTx({
            domain: input.prepared.domain,
            tx: input.tx,
            userId: input.prepared.userId,
          });
        if (activeRootKeyId !== input.prepared.rootKeyId) {
          throw new HostedDomainRootPreparationMismatchError();
        }
        return local;
      },
    );
    mocks.unwrapHostedDomainRootForWeb.mockImplementation(async (input: {
      domain: HostedCryptoDomain;
      userId: string;
    }) => {
      if (mocks.transactionDepth > 0) {
        mocks.providerCallsDisabledDuringTransactionRootReads.push(
          areHostedDomainRootProviderCallsDisabled(),
        );
      }
      mocks.rootApiCalls.push({
        domain: input.domain,
        mode: "active",
        transactionOpen: mocks.transactionDepth > 0,
        userId: input.userId,
      });
      const cache = getHostedDomainRootUnwrapCache();
      const activeCacheKey = `${input.userId}|${input.domain}|@active`;
      let pending = cache?.get(activeCacheKey);
      if (!pending) {
        pending = createTelegramProviderRootResult(input);
        cache?.set(activeCacheKey, pending);
      }
      const result = await pending;
      const concreteCacheKey =
        `${input.userId}|${input.domain}|${result.envelope.rootKeyId}`;
      if (cache && !cache.has(concreteCacheKey)) {
        cache.set(concreteCacheKey, pending);
      }
      return copyTelegramRootResult(result);
    });
    mocks.unwrapHostedDomainRootForWebByRootKeyId.mockImplementation(
      async (input: {
        domain: HostedCryptoDomain;
        rootKeyId: string;
        userId: string;
      }) => {
        if (mocks.transactionDepth > 0) {
          mocks.providerCallsDisabledDuringTransactionRootReads.push(
            areHostedDomainRootProviderCallsDisabled(),
          );
        }
        mocks.rootApiCalls.push({
          domain: input.domain,
          mode: "exact",
          rootKeyId: input.rootKeyId,
          transactionOpen: mocks.transactionDepth > 0,
          userId: input.userId,
        });
        const cache = getHostedDomainRootUnwrapCache();
        const cacheKey =
          `${input.userId}|${input.domain}|${input.rootKeyId}`;
        let pending = cache?.get(cacheKey);
        if (!pending) {
          pending = createTelegramProviderRootResult(input);
          cache?.set(cacheKey, pending);
        }
        return copyTelegramRootResult(await pending);
      },
    );
    mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockImplementation(
      async (input: { domain: HostedCryptoDomain; userId: string }) =>
        mocks.activeRootKeyIdsByDomain.get(input.domain)?.shift()
        ?? defaultTelegramRootKeyId(input),
    );
    mocks.ensureHostedThreadContainerRouteTx.mockResolvedValue({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: "member_telegram_group_container",
      created: false,
      demotedMailboxConsumedAt: null,
    });
    mocks.bindArmedHostedUsageReferralToNewContainerTx.mockResolvedValue({
      referralIds: [],
    });
    mocks.observeHostedUsageReferralInboundTx.mockResolvedValue({
      isBoundReferralTarget: false,
      qualificationCandidateReferralIds: [],
    });
    mocks.reconcileHostedUsageReferralRewardAfterCommit.mockResolvedValue(null);
    mocks.rearmHostedPhoneCallResultNotificationRecovery.mockResolvedValue(true);
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.readHostedMailboxItemOwnerById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => ({
      id: input.mailboxItemId,
      userId: "member_telegram_123",
    }));
    mocks.runtimeEnv.telegramWebhookSecret = null;
  });

  afterEach(() => {
    installDefaultHostedSecureBoxStringTestCodec();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("classifies an accepted-member Stripe effect as visible Family recovery", async () => {
    mocks.acceptHostedFamilyInviteFromTelegramTx.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_STRIPE_EFFECT_PENDING",
        httpStatus: 409,
        message: "Billing is already changing. Try again shortly.",
        retryable: true,
      }),
    );
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: { id: 123, type: "private" },
        date: 1_774_522_600,
        from: {
          first_name: "Invitee",
          id: 456,
          username: "invitee_user",
        },
        message_id: 4,
        text: "/start family_pending_effect",
      },
      update_id: 333,
    }));
    const hostedAccountGroupInviteFindUnique = vi.fn().mockResolvedValue({
      id: "invite_pending_effect",
    });
    const prisma = withPrismaTransaction({
      hostedAccountGroupInvite: {
        findUnique: hostedAccountGroupInviteFindUnique,
      },
    });

    await expect(planHostedOnboardingTelegramWebhook({
      prisma: prisma as never,
      update,
    })).resolves.toEqual({
      desiredSideEffects: [],
      response: {
        ignored: true,
        ok: true,
        reason: "stripe-effect-pending",
      },
    });
    expect(mocks.acceptHostedFamilyInviteFromTelegramTx).toHaveBeenCalledOnce();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("reuses an existing transaction when dispatching linked active-member Telegram messages", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    let telegramUserIdEncrypted: string | null = null;
    const hostedMemberRoutingUpsert = vi.fn(async (input: {
      update: { telegramUserIdEncrypted: string };
    }) => {
      telegramUserIdEncrypted = input.update.telegramUserIdEncrypted;
      return {};
    });
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMemberRouting: {
        findUnique: vi.fn(async () => ({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
          telegramUserIdEncrypted,
        })),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    const rawBody = JSON.stringify({
      message: {
        chat: {
          id: 123,
          type: "private",
        },
        date: 1_774_522_600,
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 1,
        quote: {
          text: "quoted",
        },
        reply_to_message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_599,
          from: {
            first_name: "Casey",
            id: 457,
            username: "casey",
          },
          message_id: 0,
          text: "Earlier message",
        },
        text: "hello",
      },
      update_id: 321,
    });
    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody,
      secretToken: "telegram-secret",
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:321",
          kind: "conversation.message",
          message: expect.objectContaining({
            channel: "telegram",
            telegramMessage: expect.objectContaining({
              messageId: "1",
              replyContextPreview: "Replying to: Earlier message\nQuoted text: quoted",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello",
              threadId: "123",
            }),
          }),
          userId: "member_telegram_123",
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:321",
    });
    expect(response).not.toHaveProperty("wakeUserId");
    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_telegram_123",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId: "member_telegram_123",
      prisma,
    });
    expect(hostedMemberRoutingUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0],
    );
    expect(
      mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);

    const rearmError = Object.assign(
      new Error("phone-call result recovery unavailable"),
      { retryable: true },
    );
    mocks.rearmHostedPhoneCallResultNotificationRecovery.mockRejectedValueOnce(
      rearmError,
    );
    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-restored",
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          text: "restored route",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    })).rejects.toBe(rearmError);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(2);
    expect(
      mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[1],
    ).toBeLessThan(
      mocks.rearmHostedPhoneCallResultNotificationRecovery.mock.invocationCallOrder[1]
      ?? Number.POSITIVE_INFINITY,
    );
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledTimes(2);
  });

  it("does not add recovery for 100 unchanged messages when one call workflow is already armed", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let reconciliationWorkflowStarts = 1;
    mocks.rearmHostedPhoneCallResultNotificationRecovery.mockImplementation(
      async () => {
        reconciliationWorkflowStarts += 1;
        return true;
      },
    );
    const memberId = "member_telegram_route_recovery";
    const existingTelegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "123",
      telegramUserId: "456",
    });
    let telegramUserIdEncrypted =
      existingTelegramPrivateColumns.telegramUserIdEncrypted;
    const hostedMemberRoutingUpsert = vi.fn(async (input: {
      update: { telegramUserIdEncrypted: string };
    }) => {
      telegramUserIdEncrypted = input.update.telegramUserIdEncrypted;
      return {};
    });
    const hostedMemberRoutingFindUnique = vi.fn(async () => ({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: memberId,
        suspendedAt: null,
      },
      memberId,
      telegramUserIdEncrypted,
    }));
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
        upsert: hostedMemberRoutingUpsert,
      },
    });

    for (let index = 0; index < 100; index += 1) {
      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: buildDirectTelegramWebhookRawBody({
          updateId: 800_000 + index,
        }),
        secretToken: "telegram-secret",
      })).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
    }

    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(100);
    expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(700);
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).not.toHaveBeenCalled();
    expect(reconciliationWorkflowStarts).toBe(1);

    const buildRestoredRouteWebhook = (updateId: number) => JSON.stringify({
      message: {
        business_connection_id: "biz-restored",
        chat: {
          id: 123,
          type: "private",
        },
        date: 1_776_000_000,
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: updateId,
        text: "hello",
      },
      update_id: updateId,
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildRestoredRouteWebhook(800_100),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildRestoredRouteWebhook(800_101),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(102);
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledOnce();
    expect(reconciliationWorkflowStarts).toBe(2);
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId,
      prisma,
    });
  });

  it("opens zero transactions when direct Telegram root preparation fails", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_prepare_failure");
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });
    const preparationError = new Error("direct Telegram KMS unavailable");
    mocks.providerKmsWork.mockImplementation(async (input: {
      domain: string;
    }) => {
      if (input.domain === "control") {
        throw preparationError;
      }
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_001 }),
      secretToken: "telegram-secret",
    })).rejects.toBe(preparationError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.providerKmsWork).toHaveBeenCalledTimes(2);
    expect(
      mocks.providerKmsWork.mock.calls.every(
        ([call]) => call.transactionOpen === false,
      ),
    ).toBe(true);
  });

  it("preserves the first direct root failure while draining a slower sibling", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_parallel_failure");
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
      },
    });
    const ingressError = new Error("direct Telegram ingress preparation failed first");
    const controlError = new Error("direct Telegram control preparation failed later");
    let releaseControlPreparation: (() => void) | undefined;
    const controlPreparationGate = new Promise<void>((resolve) => {
      releaseControlPreparation = resolve;
    });
    let controlPreparationSettled = false;
    mocks.providerKmsWork.mockImplementation(async (input: {
      domain: HostedCryptoDomain;
    }) => {
      if (input.domain === "ingress") {
        throw ingressError;
      }
      await controlPreparationGate;
      controlPreparationSettled = true;
      throw controlError;
    });

    const outcome = handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_005 }),
      secretToken: "telegram-secret",
    }).then(
      (value) => ({ error: null, value }),
      (error: unknown) => ({ error, value: null }),
    );

    await vi.waitFor(() => expect(mocks.providerKmsWork).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(controlPreparationSettled).toBe(false);
    if (!releaseControlPreparation) {
      throw new Error("Expected the direct control preparation gate.");
    }
    releaseControlPreparation();

    await expect(outcome).resolves.toEqual({
      error: ingressError,
      value: null,
    });
    expect(controlPreparationSettled).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("re-prepares as an ordinary member when Family preflight loses precedence", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.familyFallbackResolutionOverrides.push("invite_preflight", null);
    mocks.familyInboundResolutionOverrides.push(null, null);
    const member = buildTelegramRoutingCore("member_telegram_family_reclassified");
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_006 }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Family preflight loses precedence twice", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.familyFallbackResolutionOverrides.push(
      "invite_preflight_attempt_1",
      "invite_preflight_attempt_2",
    );
    mocks.familyInboundResolutionOverrides.push(null, null);
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_007 }),
      secretToken: "telegram-secret",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      details: {
        preparationTarget: "direct_telegram_sender_route",
      },
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.providerKmsWork).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("prewarms the exact direct Telegram roots before BEGIN and keeps transaction crypto cache-only", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_cache_only");
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_existing",
      ]);
      const existingRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      if (!existingRouting.telegramUserIdEncrypted) {
        throw new Error("Expected an encrypted direct Telegram route fixture.");
      }

      mocks.providerKmsWork.mockClear();
      mocks.rootApiCalls.length = 0;
      mocks.unwrapHostedDomainRootForWeb.mockClear();
      mocks.unwrapHostedDomainRootForWebByRootKeyId.mockClear();
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_active",
      ]);
      mocks.activeRootKeyIdsByDomain.set("control", [
        "root_control_active",
      ]);
      const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
      const prisma = withPrismaTransaction({
        hostedMemberRouting: {
          findMany: vi.fn().mockResolvedValue([{
            member,
            memberId: member.id,
          }]),
          findUnique: vi.fn().mockResolvedValue({
            member,
            memberId: member.id,
            telegramUserIdEncrypted:
              existingRouting.telegramUserIdEncrypted,
          }),
          upsert: hostedMemberRoutingUpsert,
        },
      });

      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_002 }),
        secretToken: "telegram-secret",
      })).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mocks.providerKmsWork.mock.calls.map(([call]) => call)).toEqual([
        {
          domain: "control",
          rootKeyId: "root_control_active",
          transactionOpen: false,
          userId: member.id,
        },
        {
          domain: "ingress",
          rootKeyId: `root_ingress_${member.id}`,
          transactionOpen: false,
          userId: member.id,
        },
        {
          domain: "control",
          rootKeyId: "root_control_existing",
          transactionOpen: false,
          userId: member.id,
        },
      ]);
      expect(
        mocks.rootApiCalls.filter((call) => call.transactionOpen),
      ).toEqual([
        {
          domain: "control",
          mode: "exact",
          rootKeyId: "root_control_existing",
          transactionOpen: true,
          userId: member.id,
        },
        {
          domain: "control",
          mode: "active",
          transactionOpen: true,
          userId: member.id,
        },
      ]);
      expect(
        mocks.providerKmsWork.mock.calls.every(
          ([call]) => call.transactionOpen === false,
        ),
      ).toBe(true);
      expect(
        mocks.providerCallsDisabledDuringTransactionRootReads.every(Boolean),
      ).toBe(true);
      expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
      expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
      expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith(
        expect.objectContaining({
          prepared: expect.objectContaining({
            domain: "ingress",
            userId: member.id,
          }),
        }),
      );
    } finally {
      installDefaultHostedSecureBoxStringTestCodec();
    }
  });

  it("re-prepares once when a direct Telegram sender binding changes before BEGIN", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const losingMember = buildTelegramRoutingCore("member_telegram_losing_sender");
    const winningMember = buildTelegramRoutingCore("member_telegram_winning_sender");
    const hostedMemberRoutingFindMany = vi.fn()
      .mockResolvedValueOnce([{
        member: losingMember,
        memberId: losingMember.id,
      }])
      .mockResolvedValue([{
        member: winningMember,
        memberId: winningMember.id,
      }]);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: hostedMemberRoutingFindMany,
        findUnique: vi.fn().mockResolvedValue({
          member: winningMember,
          memberId: winningMember.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_003 }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ memberId: winningMember.id }),
      }),
    );
    expect(mocks.providerKmsWork.mock.calls.map(([call]) => call.userId)).toEqual([
      losingMember.id,
      losingMember.id,
      winningMember.id,
      winningMember.id,
    ]);
    expect(
      mocks.providerKmsWork.mock.calls.every(
        ([call]) => call.transactionOpen === false,
      ),
    ).toBe(true);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
  });

  it("re-prepares once when the direct Telegram control root changes under lock", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_control_retry");
    mocks.preparedRootKeyIdsByDomain.set("control", [
      "root_control_attempt_1",
      "root_control_attempt_2",
    ]);
    mocks.activeRootKeyIdsByDomain.set("control", [
      "root_control_winner_1",
      "root_control_attempt_2",
    ]);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_008 }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.providerKmsWork).toHaveBeenCalledTimes(4);
  });

  it("fails closed after repeated direct Telegram control-root drift", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_control_drift");
    mocks.preparedRootKeyIdsByDomain.set("control", [
      "root_control_attempt_1",
      "root_control_attempt_2",
    ]);
    mocks.activeRootKeyIdsByDomain.set("control", [
      "root_control_winner_1",
      "root_control_winner_2",
    ]);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_009 }),
      secretToken: "telegram-secret",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      details: {
        preparationTarget: "direct_telegram_control_root",
      },
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.providerKmsWork).toHaveBeenCalledTimes(4);
  });

  it("retries without waiting when activation already owns the direct Telegram member row", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.memberRowLockOutcomes.push(false, true);
    const member = buildTelegramRoutingCore("member_telegram_activation_race");
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_012 }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
  });

  it("fails closed when activation owns the direct Telegram member row twice", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.memberRowLockOutcomes.push(false, false);
    const member = buildTelegramRoutingCore("member_telegram_activation_contention");
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_013 }),
      secretToken: "telegram-secret",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      details: {
        preparationTarget: "direct_telegram_sender_route",
      },
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("accepts randomized direct Telegram route ciphertext on the same prepared root", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_randomized_route");
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_historical",
      ]);
      const firstRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_historical",
      ]);
      const secondRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      expect(secondRouting.telegramUserIdEncrypted).not.toBe(
        firstRouting.telegramUserIdEncrypted,
      );

      mocks.providerKmsWork.mockClear();
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_active",
      ]);
      mocks.activeRootKeyIdsByDomain.set("control", [
        "root_control_active",
      ]);
      const firstRecord = {
        member,
        memberId: member.id,
        telegramUserIdEncrypted: firstRouting.telegramUserIdEncrypted,
      };
      const secondRecord = {
        member,
        memberId: member.id,
        telegramUserIdEncrypted: secondRouting.telegramUserIdEncrypted,
      };
      const hostedMemberRoutingFindUnique = vi.fn()
        .mockResolvedValueOnce(firstRecord)
        .mockResolvedValue(secondRecord);
      const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
      const prisma = withPrismaTransaction({
        hostedMemberRouting: {
          findMany: vi.fn().mockResolvedValue([{
            member,
            memberId: member.id,
          }]),
          findUnique: hostedMemberRoutingFindUnique,
          upsert: hostedMemberRoutingUpsert,
        },
      });

      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_014 }),
        secretToken: "telegram-secret",
      })).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(3);
      expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
      expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
      expect(mocks.providerKmsWork).toHaveBeenCalledTimes(3);
      expect(mocks.providerKmsWork.mock.calls.every(
        ([call]) => call.transactionOpen === false,
      )).toBe(true);
    } finally {
      installDefaultHostedSecureBoxStringTestCodec();
    }
  });

  it("re-prepares once when the direct Telegram route moves to an unprepared root under lock", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_route_retry");
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_historical_1",
      ]);
      const firstRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_historical_2",
      ]);
      const secondRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      mocks.providerKmsWork.mockClear();
      mocks.rootApiCalls.length = 0;
      let activeKmsCalls = 0;
      let maxActiveKmsCalls = 0;
      mocks.providerKmsWork.mockImplementation(async () => {
        activeKmsCalls += 1;
        maxActiveKmsCalls = Math.max(maxActiveKmsCalls, activeKmsCalls);
        await Promise.resolve();
        activeKmsCalls -= 1;
      });
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_active_1",
        "root_control_active_2",
      ]);
      mocks.activeRootKeyIdsByDomain.set("control", [
        "root_control_active_1",
        "root_control_active_2",
      ]);
      const hostedMemberRoutingFindUnique = vi.fn()
        .mockResolvedValueOnce({
          member,
          memberId: member.id,
          telegramUserIdEncrypted: firstRouting.telegramUserIdEncrypted,
        })
        .mockResolvedValue({
          member,
          memberId: member.id,
          telegramUserIdEncrypted: secondRouting.telegramUserIdEncrypted,
        });
      const hostedMemberRoutingFindMany = vi.fn().mockResolvedValue([{
        member,
        memberId: member.id,
      }]);
      const hostedMemberFindUnique = vi.fn().mockResolvedValue({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      });
      const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
      const prisma = withPrismaTransaction({
        hostedMember: {
          findUnique: hostedMemberFindUnique,
        },
        hostedMemberRouting: {
          findMany: hostedMemberRoutingFindMany,
          findUnique: hostedMemberRoutingFindUnique,
          upsert: hostedMemberRoutingUpsert,
        },
      });
      const executionOrder: string[] = [];
      mocks.lockAndReadActiveHostedDomainRootKeyIdTx.mockImplementation(
        async (input: { domain: HostedCryptoDomain; userId: string }) => {
          executionOrder.push(`${input.domain}-root-lock`);
          return mocks.activeRootKeyIdsByDomain.get(input.domain)?.shift()
            ?? defaultTelegramRootKeyId(input);
        },
      );
      prisma.$queryRaw = vi.fn(async () => {
        executionOrder.push("member-lock");
        return [{ id: member.id }];
      });
      const defaultAppend = mocks.appendHostedMailboxEnvelopeTx
        .getMockImplementation();
      if (!defaultAppend) {
        throw new Error("Expected the Telegram mailbox append mock.");
      }
      mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async (input) => {
        const appended = await defaultAppend(input);
        executionOrder.push("append");
        return appended;
      });
      const defaultTransaction = prisma.$transaction.bind(prisma);
      let activeTransactions = 0;
      let maxActiveTransactions = 0;
      prisma.$transaction = vi.fn(async (callback) => {
        activeTransactions += 1;
        maxActiveTransactions = Math.max(
          maxActiveTransactions,
          activeTransactions,
        );
        try {
          return await defaultTransaction(callback);
        } finally {
          activeTransactions -= 1;
        }
      });

      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_010 }),
        secretToken: "telegram-secret",
      })).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(5);
      expect(hostedMemberRoutingFindMany).toHaveBeenCalledTimes(7);
      expect(hostedMemberFindUnique).toHaveBeenCalledTimes(4);
      expect(hostedMemberRoutingFindUnique.mock.calls.filter(([query]) =>
        Object.keys(query.select ?? {}).length === 1
        && query.select?.telegramUserIdEncrypted === true
      )).toHaveLength(4);
      expect(hostedMemberRoutingFindMany.mock.calls.every(([query]) =>
        query.select
        && query.select.telegramUserIdEncrypted !== true
      )).toBe(true);
      expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
      expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
      expect(mocks.providerKmsWork).toHaveBeenCalledTimes(6);
      expect(maxActiveKmsCalls).toBe(2);
      expect(maxActiveTransactions).toBe(1);
      expect(mocks.providerKmsWork.mock.calls.every(
        ([call]) => call.transactionOpen === false,
      )).toBe(true);
      expect(executionOrder.slice(0, 2)).toEqual([
        "control-root-lock",
        "member-lock",
      ]);
      expect(executionOrder.slice(-2)).toEqual([
        "ingress-root-lock",
        "append",
      ]);
      expect(mocks.rootApiCalls.filter((call) => call.transactionOpen))
        .toHaveLength(2);
    } finally {
      installDefaultHostedSecureBoxStringTestCodec();
    }
  });

  it("fails closed after repeated encrypted direct Telegram route drift", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_route_drift");
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_historical",
      ]);
      const preparedRouting = await buildHostedMemberRoutingPrivateColumns({
        linqChatId: null,
        linqRecipientPhone: null,
        memberId: member.id,
        pendingLinqChatId: null,
        pendingLinqParticipantContact: null,
        pendingLinqRecipientPhone: null,
        telegramThreadId: "123",
        telegramUserId: "456",
      });
      if (!preparedRouting.telegramUserIdEncrypted) {
        throw new Error("Expected an encrypted Telegram routing fixture.");
      }
      mocks.providerKmsWork.mockClear();
      mocks.preparedRootKeyIdsByDomain.set("control", [
        "root_control_active_1",
        "root_control_active_2",
      ]);
      mocks.activeRootKeyIdsByDomain.set("control", [
        "root_control_active_1",
        "root_control_active_2",
      ]);
      const preparedRecord = {
        member,
        memberId: member.id,
        telegramUserIdEncrypted: preparedRouting.telegramUserIdEncrypted,
      };
      const changedRecord = {
        ...preparedRecord,
        telegramUserIdEncrypted: `${preparedRouting.telegramUserIdEncrypted}changed`,
      };
      const hostedMemberRoutingFindUnique = vi.fn()
        .mockResolvedValueOnce(preparedRecord)
        .mockResolvedValueOnce(changedRecord)
        .mockResolvedValueOnce(preparedRecord)
        .mockResolvedValueOnce(changedRecord);
      const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
      const prisma = withPrismaTransaction({
        hostedMemberRouting: {
          findMany: vi.fn().mockResolvedValue([{
            member,
            memberId: member.id,
          }]),
          findUnique: hostedMemberRoutingFindUnique,
          upsert: hostedMemberRoutingUpsert,
        },
      });

      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_011 }),
        secretToken: "telegram-secret",
      })).rejects.toMatchObject({
        code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
        details: {
          preparationTarget: "direct_telegram_sender_route",
        },
        retryable: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(4);
      expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
      expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
      expect(mocks.providerKmsWork).toHaveBeenCalledTimes(6);
    } finally {
      installDefaultHostedSecureBoxStringTestCodec();
    }
  });

  it("fails closed after one fresh preparation when the direct Telegram ingress root keeps drifting", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const member = buildTelegramRoutingCore("member_telegram_root_drift");
    mocks.preparedRootKeyIdsByDomain.set("ingress", [
      "root_ingress_attempt_1",
      "root_ingress_attempt_2",
    ]);
    mocks.activeRootKeyIdsByDomain.set("ingress", [
      "root_ingress_winner_1",
      "root_ingress_winner_2",
    ]);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member,
          memberId: member.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member,
          memberId: member.id,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: buildDirectTelegramWebhookRawBody({ updateId: 900_004 }),
      secretToken: "telegram-secret",
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      details: {
        preparationTarget: "direct_telegram_mailbox_root",
      },
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.lockAndReadActiveHostedDomainRootKeyIdTx).toHaveBeenCalledTimes(4);
    expect(mocks.providerKmsWork).toHaveBeenCalledTimes(4);
    expect(
      mocks.providerKmsWork.mock.calls.every(
        ([call]) => call.transactionOpen === false,
      ),
    ).toBe(true);
  });

  it("routes a linked active member's Telegram group message through the thread container", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const privateRootUnwrap = vi.spyOn(
      await import("@/src/lib/hosted-crypto/domain-root-store"),
      "unwrapHostedDomainRootsForWebByRootKeyIds",
    ).mockRejectedValue(new Error("private routing KMS unavailable"));
    mocks.ensureHostedThreadContainerRouteTx.mockResolvedValue({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: "member_telegram_group_container",
      created: true,
      demotedMailboxConsumedAt: null,
    });
    const hostedMemberRoutingFindMany = vi.fn().mockResolvedValue([{
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_owner",
        suspendedAt: null,
      },
      memberId: "member_telegram_owner",
      telegramUserIdEncrypted: "production-private-routing-ciphertext",
    }]);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: hostedMemberRoutingFindMany,
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100123,
            title: "Family chat",
            type: "group",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
            username: "Alice_Example",
          },
          message_id: 2,
          text: "set up our weekly health newsletter",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).toHaveBeenCalledWith({
      accountLookupKey: "telegram:bot",
      channel: "telegram",
      occurredAt: new Date("2026-03-26T10:56:40.000Z"),
      ownerMemberId: "member_telegram_owner",
      preparedCreation: expect.objectContaining({
        containerMemberId: "member_telegram_group_container",
      }),
      prisma,
      threadId: "-100123",
    });
    expect(mocks.prepareHostedThreadContainerCreation)
      .toHaveBeenCalledExactlyOnceWith({
        accountLookupKey: "telegram:bot",
        channel: "telegram",
        prisma,
        threadId: "-100123",
      });
    expect(hostedMemberRoutingFindMany).toHaveBeenCalledWith({
      select: {
        member: {
          select: {
            billingStatus: true,
            createdAt: true,
            id: true,
            suspendedAt: true,
            updatedAt: true,
          },
        },
        memberId: true,
      },
      where: {
        telegramUserLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:telegram-user:v1:/u),
          ]),
        },
      },
    });
    expect(privateRootUnwrap).not.toHaveBeenCalled();
    expect(mocks.bindArmedHostedUsageReferralToNewContainerTx)
      .toHaveBeenCalledExactlyOnceWith({
        occurredAt: new Date("2026-03-26T10:56:40.000Z"),
        ownerMemberId: "member_telegram_owner",
        targetChannel: "telegram",
        targetLinqService: null,
        targetContainerMemberId: "member_telegram_group_container",
        tx: prisma,
      });
    expect(mocks.observeHostedUsageReferralInboundTx)
      .toHaveBeenCalledExactlyOnceWith({
        containerMemberId: "member_telegram_group_container",
        eventKey: createHostedTelegramMessageLookupKey({
          chatId: "-100123",
          messageId: "2",
        }),
        occurredAt: new Date("2026-03-26T10:56:40.000Z"),
        senderMemberId: "member_telegram_owner",
        senderSubjectKey: createHostedTelegramUserLookupKey("456"),
        tx: prisma,
      });
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:322",
          message: expect.objectContaining({
            channel: "telegram",
            routeAuthority: {
              channel: "telegram",
              containerMemberId: "member_telegram_group_container",
              threadId: "-100123",
            },
            senderMemberId: "member_telegram_owner",
            telegramMessage: expect.objectContaining({
              // Group inbound carries the webhook-authenticated sender so the
              // assistant can tell participants apart. The display-only
              // username keeps the case the room sees; only the separate
              // lookup key is lowercased for identity matching.
              from: "456",
              senderDisplayName: "Alice",
              senderUsername: "Alice_Example",
              text: "set up our weekly health newsletter",
              threadId: "-100123",
              threadIsDirect: false,
            }),
          }),
          userId: "member_telegram_group_container",
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_telegram_group_container",
      mailboxItemId: "mailbox_telegram:update:322",
    });
  });

  it("re-prepares for a Telegram route that wins after the transaction route read", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "telegram",
      threadId: "-100123",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: "telegram:bot",
      channel: "telegram",
      threadId: "-100123",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected Telegram thread route lookup keys.");
    }
    const winnerRoute = {
      channel: "telegram" as const,
      containerMemberId: "member_telegram_group_winner",
      deliveryRouteState: {
        deliveryRouteEncrypted: "winner-delivery-route",
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner: { id: "member_telegram_winner_owner" },
    };
    mocks.readHostedThreadRouteByThreadIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(winnerRoute);
    mocks.ensureHostedThreadContainerRouteTx.mockResolvedValueOnce({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: winnerRoute.containerMemberId,
      created: false,
      demotedMailboxConsumedAt: null,
    });
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_owner",
            suspendedAt: null,
          },
          memberId: "member_telegram_owner",
        }),
      },
    });
    const runTransaction = prisma.$transaction;
    let transactionCount = 0;
    prisma.$transaction = async (callback) => {
      transactionCount += 1;
      return runTransaction(callback);
    };

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Family chat", type: "group" },
          date: 1_774_522_600,
          from: { first_name: "Alice", id: 456 },
          message_id: 2,
          text: "hello from the race loser",
        },
        update_id: 326,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(transactionCount).toBe(2);
    expect(mocks.ensureHostedThreadContainerRouteTx).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedThreadContainerCreation).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedThreadContainerDeliveryRoute)
      .toHaveBeenCalledExactlyOnceWith({
        accountLookupKey: "telegram:bot",
        channel: "telegram",
        containerMemberId: winnerRoute.containerMemberId,
        observedDeliveryRouteEncrypted: "winner-delivery-route",
        prisma,
        threadId: "-100123",
      });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          userId: winnerRoute.containerMemberId,
        }),
      }),
    );
  });

  it("does not retry a failed Telegram crypto preparation as a route race", async () => {
    const { hostedOnboardingError } = await import(
      "@/src/lib/hosted-onboarding/errors"
    );
    const defaultPrepareCreation =
      mocks.prepareHostedThreadContainerCreation.getMockImplementation();
    const defaultEnsureRoute =
      mocks.ensureHostedThreadContainerRouteTx.getMockImplementation();
    if (!defaultPrepareCreation || !defaultEnsureRoute) {
      throw new Error("Expected the default Telegram thread-route mocks.");
    }
    const preparationError = new Error("kms preparation unavailable");
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_owner",
            suspendedAt: null,
          },
          memberId: "member_telegram_owner",
        }),
      },
    });

    try {
      mocks.prepareHostedThreadContainerCreation.mockImplementation(async () => {
        throw preparationError;
      });
      mocks.ensureHostedThreadContainerRouteTx.mockImplementation(async () => {
        throw hostedOnboardingError({
          code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
          httpStatus: 503,
          message: "Prepared container required.",
          retryable: true,
        });
      });

      await expect(handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: -100123,
              title: "Family chat",
              type: "group",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 2,
            text: "hello",
          },
          update_id: 325,
        }),
        secretToken: "telegram-secret",
      })).rejects.toBe(preparationError);

      expect(mocks.prepareHostedThreadContainerCreation).toHaveBeenCalledTimes(1);
      expect(mocks.ensureHostedThreadContainerRouteTx).toHaveBeenCalledTimes(1);
    } finally {
      mocks.prepareHostedThreadContainerCreation
        .mockImplementation(defaultPrepareCreation);
      mocks.ensureHostedThreadContainerRouteTx.mockImplementation(defaultEnsureRoute);
    }
  });

  it("counts an unlinked group sender only as bounded referral evidence", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId: "member_existing_group_container",
      owner: { id: "member_telegram_owner" },
    });
    mocks.observeHostedUsageReferralInboundTx.mockResolvedValue({
      isBoundReferralTarget: true,
      qualificationCandidateReferralIds: [
        "usage_referral_1",
        "usage_referral_2",
      ],
    });
    const participantUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: participantUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Family chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 3,
          text: "hello murph",
        },
        update_id: 323,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "usage-referral-evidence-only",
    });

    expect(mocks.observeHostedUsageReferralInboundTx)
      .toHaveBeenCalledExactlyOnceWith({
        containerMemberId: "member_existing_group_container",
        eventKey: createHostedTelegramMessageLookupKey({
          chatId: "-100123",
          messageId: "3",
        }),
        occurredAt: new Date("2026-03-26T10:56:41.000Z"),
        senderMemberId: null,
        senderSubjectKey: createHostedTelegramUserLookupKey("789"),
        tx: prisma,
      });
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenCalledTimes(2);
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(1, {
      prisma,
      referralId: "usage_referral_1",
    });
    expect(
      mocks.reconcileHostedUsageReferralRewardAfterCommit,
    ).toHaveBeenNthCalledWith(2, {
      prisma,
      referralId: "usage_referral_2",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(participantUpsert).not.toHaveBeenCalled();
  });

  it("reuses an existing Telegram group route for another linked active sender", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "telegram",
      threadId: "-100123",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: "telegram:bot",
      channel: "telegram",
      threadId: "-100123",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected Telegram thread route lookup keys.");
    }
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId: "member_existing_group_container",
      deliveryRouteState: {
        deliveryRouteEncrypted: "existing-delivery-route",
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner: { id: "member_telegram_owner" },
    });
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_second_group_sender",
            suspendedAt: null,
          },
          memberId: "member_second_group_sender",
        }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Family chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 3,
          text: "thanks murph",
        },
        update_id: 323,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          message: expect.objectContaining({
            routeAuthority: expect.objectContaining({
              channel: "telegram",
              containerMemberId: "member_existing_group_container",
              threadId: "-100123",
            }),
            // A second human in the same room is a distinct sender, which is
            // what lets the assistant keep participants apart.
            telegramMessage: expect.objectContaining({ from: "789" }),
          }),
          userId: "member_existing_group_container",
        }),
      }),
    );
  });

  it("preserves the first observed Telegram preparation failure after a slower sibling also fails", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "telegram",
      threadId: "-100123",
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: "telegram:bot",
      channel: "telegram",
      threadId: "-100123",
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected Telegram thread route lookup keys.");
    }
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId: "member_existing_group_container",
      deliveryRouteState: {
        deliveryRouteEncrypted: "existing-delivery-route",
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner: { id: "member_telegram_owner" },
    });
    const senderCore = {
      billingStatus: HostedBillingStatus.active,
      createdAt: new Date("2026-03-20T12:00:00.000Z"),
      id: "member_second_group_sender",
      suspendedAt: null,
      updatedAt: new Date("2026-03-20T12:00:00.000Z"),
    };
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          consentGrants: [],
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([{
          member: senderCore,
          memberId: senderCore.id,
        }]),
        findUnique: vi.fn().mockResolvedValue({
          member: senderCore,
          memberId: senderCore.id,
        }),
      },
    });
    const originalTransaction = prisma.$transaction.bind(prisma);
    const transaction = vi.fn(async (
      callback: (tx: TelegramWebhookPrismaHarness) => Promise<unknown>,
    ) => originalTransaction(callback));
    prisma.$transaction = transaction;
    const routeError = new Error("Telegram route preparation failed later.");
    let releaseRoutePreparation: (() => void) | undefined;
    const routePreparationGate = new Promise<void>((resolve) => {
      releaseRoutePreparation = resolve;
    });
    let routePreparationSettled = false;
    mocks.prepareHostedThreadContainerDeliveryRoute.mockImplementationOnce(async () => {
      await routePreparationGate;
      routePreparationSettled = true;
      throw routeError;
    });
    const { unwrapHostedDomainRootForWeb } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    const mailboxPreparation = vi.mocked(unwrapHostedDomainRootForWeb);
    const mailboxError = new Error("Telegram mailbox preparation failed.");
    mailboxPreparation.mockRejectedValueOnce(mailboxError);

    const outcome = handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Family chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 3,
          text: "thanks murph",
        },
        update_id: 323,
      }),
      secretToken: "telegram-secret",
    }).then(
      (value) => ({ error: null, value }),
      (error: unknown) => ({ error, value: null }),
    );

    await vi.waitFor(() => expect(mailboxPreparation).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transaction).not.toHaveBeenCalled();
    expect(routePreparationSettled).toBe(false);
    if (!releaseRoutePreparation) {
      throw new Error("Expected the Telegram route preparation gate.");
    }
    releaseRoutePreparation();

    const result = await outcome;
    expect(result.error).toBe(mailboxError);
    expect(result.value).toBeNull();
    expect(routePreparationSettled).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("admits an active linked sender to an existing Telegram container whose owner expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:00.000Z"));
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId: "member_existing_group_container",
      owner: { id: "member_expired_owner" },
    });
    const participantUpsert = vi.fn().mockResolvedValue({});
    const participantUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn(async (query: {
          where: { id: string };
        }) => query.where.id === "member_existing_group_container"
          ? {
              accountGroupMemberships: [],
              billingStatus: HostedBillingStatus.not_started,
              suspendedAt: null,
              threadContainer: {
                owner: {
                  accountGroupMemberships: [],
                  billingRef: {
                    currentBillingPhase: "trial",
                    currentBillingPlanCode: "launch_monthly",
                    currentCheckoutOffer: "pulse_trial_7d",
                    currentTrialEndsAt: new Date("2026-03-27T12:00:00.000Z"),
                    currentTrialStartedAt: new Date("2026-03-20T12:00:00.000Z"),
                    pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
                    pulseTrialRedeemedAt: new Date("2026-03-20T12:00:00.000Z"),
                    stripeSubscriptionLookupKey: "subscription_lookup_expired_owner",
                  },
                  billingStatus: HostedBillingStatus.active,
                  suspendedAt: null,
                },
              },
            }
          : {
              accountGroupMemberships: [],
              billingRef: null,
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
              threadContainer: null,
            }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_second_group_sender",
            suspendedAt: null,
          },
          memberId: "member_second_group_sender",
        }),
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([{
          participant: {
            accountGroupMemberships: [],
            billingRef: null,
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
        }]),
        updateMany: participantUpdateMany,
        upsert: participantUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Trial chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 3,
          text: "thanks murph",
        },
        update_id: 324,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(participantUpsert).toHaveBeenCalledWith({
      create: {
        containerMemberId: "member_existing_group_container",
        firstSeenAt: new Date("2026-03-26T10:56:41.000Z"),
        handleLookupKey: createHostedTelegramUserLookupKey("789"),
        lastSeenAt: new Date("2026-03-26T10:56:41.000Z"),
        participantMemberId: "member_second_group_sender",
        removedAt: null,
      },
      update: {
        handleLookupKey: createHostedTelegramUserLookupKey("789"),
      },
      where: {
        containerMemberId_participantMemberId: {
          containerMemberId: "member_existing_group_container",
          participantMemberId: "member_second_group_sender",
        },
      },
    });
    expect(participantUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        containerMemberId: "member_existing_group_container",
        participantMemberId: "member_second_group_sender",
      }),
    }));
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledOnce();
  });

  it("keeps a delayed participant observation active past a retained trial timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId: "member_existing_group_container",
      owner: { id: "member_expired_owner" },
    });
    const participantUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn(async (query: {
          where: { id: string };
        }) => query.where.id === "member_existing_group_container"
          ? {
              accountGroupMemberships: [],
              billingStatus: HostedBillingStatus.not_started,
              suspendedAt: null,
              threadContainer: {
                owner: {
                  accountGroupMemberships: [],
                  billingRef: {
                    currentBillingPhase: "trial",
                    currentBillingPlanCode: "launch_monthly",
                    currentCheckoutOffer: "pulse_trial_7d",
                    currentTrialEndsAt: new Date("2026-03-27T12:00:00.000Z"),
                    currentTrialStartedAt: new Date("2026-03-20T12:00:00.000Z"),
                    pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
                    pulseTrialRedeemedAt: new Date("2026-03-20T12:00:00.000Z"),
                    stripeSubscriptionLookupKey: "subscription_lookup_expired_owner",
                  },
                  billingStatus: HostedBillingStatus.active,
                  suspendedAt: null,
                },
              },
            }
          : {
              accountGroupMemberships: [],
              billingRef: null,
              billingStatus: HostedBillingStatus.active,
              suspendedAt: null,
              threadContainer: null,
            }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_second_group_sender",
            suspendedAt: null,
          },
          memberId: "member_second_group_sender",
        }),
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: participantUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Trial chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 4,
          text: "old delayed message",
        },
        update_id: 325,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(participantUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        lastSeenAt: new Date("2026-03-26T10:56:41.000Z"),
      }),
    }));
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledOnce();
  });

  it("keeps a delayed Telegram group message active past a retained trial timestamp", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const activeOwnerRouting = {
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_owner",
        suspendedAt: null,
      },
      memberId: "member_telegram_owner",
    };
    mocks.ensureHostedThreadContainerRouteTx.mockResolvedValueOnce({
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: "member_telegram_group_container",
      created: true,
      demotedMailboxConsumedAt: null,
    });
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: {
            currentBillingPhase: "trial",
            currentBillingPlanCode: "launch_monthly",
            currentCheckoutOffer: "pulse_trial_7d",
            currentTrialEndsAt: new Date("2026-03-27T12:00:00.000Z"),
            currentTrialStartedAt: new Date("2026-03-20T12:00:00.000Z"),
            pulseTrialPolicyVersion: "pulse-trial-2026-06-30-v2",
            pulseTrialRedeemedAt: new Date("2026-03-20T12:00:00.000Z"),
            stripeSubscriptionLookupKey: "subscription_lookup_expired_trial",
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([activeOwnerRouting]),
        findUnique: vi.fn().mockResolvedValue(activeOwnerRouting),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100124,
            title: "Trial chat",
            type: "group",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 3,
          text: "Murph?",
        },
        update_id: 325,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).toHaveBeenCalledOnce();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledOnce();
  });

  it("repairs non-empty corrupt Telegram delivery material on owner ingress", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const containerMemberId = "member_existing_group_container";
    const threadId = "-100123";
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "telegram",
      threadId,
    });
    const threadLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      threadId,
    });
    if (!threadIdentityLookupKey || !threadLookupKey) {
      throw new Error("Expected current Telegram thread route lookup keys.");
    }
    const routeRow: {
      accountLookupKey: string | null;
      channel: "telegram";
      containerMemberId: string;
      deliveryRouteEncrypted: string | null;
      pendingGroupReactionContextEncrypted: string | null;
      threadIdentityLookupKey: string;
      threadLookupKey: string;
    } = {
      accountLookupKey: null,
      channel: "telegram",
      containerMemberId,
      deliveryRouteEncrypted: "corrupt-delivery-route",
      pendingGroupReactionContextEncrypted:
        "same-authority-reaction-context",
      threadIdentityLookupKey,
      threadLookupKey,
    };
    const hostedThreadRouteUpdate = vi.fn(async ({
      data,
    }: {
      data: {
        accountLookupKey: string;
        deliveryRouteEncrypted: string;
        pendingGroupReactionContextEncrypted?: string | null;
        threadIdentityLookupKey: string;
        threadLookupKey: string;
      };
    }) => {
      routeRow.accountLookupKey = data.accountLookupKey;
      routeRow.deliveryRouteEncrypted = data.deliveryRouteEncrypted;
      routeRow.threadIdentityLookupKey = data.threadIdentityLookupKey;
      routeRow.threadLookupKey = data.threadLookupKey;
      if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
        routeRow.pendingGroupReactionContextEncrypted =
          data.pendingGroupReactionContextEncrypted ?? null;
      }
      return routeRow;
    });
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      channel: "telegram",
      containerMemberId,
      deliveryRouteState: {
        deliveryRouteEncrypted: routeRow.deliveryRouteEncrypted,
        deliveryRouteEncryptedPresent: true,
        threadIdentityLookupKey,
        threadLookupKey,
      },
      owner: { id: "member_telegram_owner" },
    });
    mocks.refreshHostedThreadContainerDeliveryRouteTx.mockImplementationOnce(
      actualThreadContainerService.refreshHostedThreadContainerDeliveryRouteTx,
    );
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_owner",
            suspendedAt: null,
          },
          memberId: "member_telegram_owner",
        }),
      },
      hostedThreadContainer: {
        findUnique: vi.fn(async ({
          where,
        }: {
          where: { memberId: string };
        }) => where.memberId === containerMemberId
          ? { memberId: containerMemberId }
          : null),
      },
      hostedThreadRoute: {
        findMany: vi.fn(async () => [routeRow]),
        update: hostedThreadRouteUpdate,
      },
    });
    const preparedRoute = buildHostedThreadDeliveryRoute({
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      threadId,
    });
    if (preparedRoute.channel !== "telegram") {
      throw new TypeError("Expected a Telegram delivery route fixture.");
    }
    mocks.prepareHostedThreadContainerDeliveryRoute.mockResolvedValueOnce({
      containerMemberId,
      deliveryRoute: preparedRoute,
      deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
        containerMemberId,
        prisma: prisma as never,
        route: preparedRoute,
      }),
      observedDeliveryRouteEncrypted: routeRow.deliveryRouteEncrypted,
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: -100123, title: "Family chat", type: "group" },
          date: 1_774_522_601,
          from: { first_name: "Casey", id: 789 },
          message_id: 3,
          text: "repair this route",
        },
        update_id: 324,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-group",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(hostedThreadRouteUpdate).toHaveBeenCalledTimes(1);
    expect(routeRow.accountLookupKey).toBe(
      HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
    );
    expect(routeRow.deliveryRouteEncrypted).toMatch(/^hsb-test:/u);
    await expect(openHostedThreadDeliveryRoute({
      channel: "telegram",
      containerMemberId,
      encrypted: routeRow.deliveryRouteEncrypted,
      prisma: prisma as never,
    })).resolves.toEqual({
      channel: "telegram",
      schema: "murph.hosted-thread-delivery-route.v1",
      threadId,
    });
    expect(routeRow.pendingGroupReactionContextEncrypted).toBe(
      "same-authority-reaction-context",
    );
  });

  it("keeps a direct Telegram thread free of group sender attribution", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_direct_sender",
            suspendedAt: null,
          },
          memberId: "member_direct_sender",
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: { id: 5150, type: "private" },
          date: 1_774_522_602,
          from: { first_name: "Alice", id: 456, username: "alice_example" },
          message_id: 4,
          text: "hey murph",
        },
        update_id: 324,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({ ok: true });

    const enqueued = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0];
    const telegramMessage = enqueued?.envelope?.message?.telegramMessage;
    expect(telegramMessage).toBeDefined();
    expect(Object.hasOwn(telegramMessage ?? {}, "from")).toBe(false);
    expect(Object.hasOwn(telegramMessage ?? {}, "senderUsername")).toBe(false);
  });

  it("routes Murph Family questions to the assistant", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn(async (args?: { where?: { memberId?: string } }) => {
      if (args?.where?.memberId) {
        return null;
      }

      return {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      };
    });
    const prisma = withPrismaTransaction({
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          text: "wiesz cos o family planie?",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:322",
          kind: "conversation.message",
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              text: "wiesz cos o family planie?",
            }),
          }),
        }),
      }),
    );
  });

  it("sends the accepted family invite reply seeded by the accepted Telegram member id", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const acceptedMemberId = "member_telegram_family";
    const invite = {
      acceptedAt: null,
      acceptedByMemberId: null,
      channel: "telegram",
      createdAt: new Date("2026-06-18T12:00:00.000Z"),
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      group: {
        billingStatus: HostedBillingStatus.not_started,
        id: "hbag_telegram",
        ownerMemberId: "member_owner",
        suspendedAt: null,
      },
      groupId: "hbag_telegram",
      id: "invite_telegram",
      inviteCode: "invite_telegram",
      invitedByMemberId: "member_owner",
      planCode: "pulse",
      status: "pending",
      targetEmailEncrypted: null,
      targetEmailLookupKey: null,
      targetLabel: "Alice",
      targetPhoneLookupKey: null,
      targetPhoneNumberEncrypted: null,
      targetTelegramUsernameEncrypted: null,
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@alice_user"),
      updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    };
    const hostedAccountGroupInviteFindUnique = vi.fn(async () => invite);
    const hostedAccountGroupMembershipFindFirst = vi.fn().mockResolvedValue(null);
    const prisma = withPrismaTransaction({
      hostedAccountGroupBillingRef: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({
          billedSeatCount: 2,
        }),
      },
      hostedAccountGroupInvite: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: hostedAccountGroupInviteFindUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedAccountGroupMembership: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: hostedAccountGroupMembershipFindFirst,
        upsert: vi.fn().mockResolvedValue({
          group: invite.group,
          groupId: invite.groupId,
          memberId: acceptedMemberId,
          planCode: "pulse",
          role: "member",
          status: "active",
        }),
      },
      hostedAccountGroupPlanCapacity: {
        findMany: vi.fn().mockResolvedValue([
          { billedQuantity: 2, planCode: "pulse" },
        ]),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingRef: null,
          billingStatus: HostedBillingStatus.not_started,
        }),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([
          {
            linqChatIdEncrypted: null,
            linqChatLookupKey: null,
            linqHomeLineAssignedAt: null,
            linqRecipientPhoneEncrypted: null,
            linqRecipientPhoneLookupKey: null,
            member: {
              billingStatus: HostedBillingStatus.not_started,
              createdAt: new Date("2026-06-18T12:00:00.000Z"),
              id: acceptedMemberId,
              suspendedAt: null,
              updatedAt: new Date("2026-06-18T12:00:00.000Z"),
            },
            memberId: acceptedMemberId,
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqParticipantContactEncrypted: null,
            pendingLinqParticipantContactKind: null,
            pendingLinqParticipantContactLookupKey: null,
            pendingLinqParticipantContactObservedAt: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
            replyAliasLookupKey: null,
            telegramUserIdEncrypted: null,
            telegramUserLookupKey: createHostedTelegramUserLookupKey("456"),
          },
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 333,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
            username: "alice_user",
          },
          message_id: 4,
          text: "/start family_invite_telegram",
        },
        update_id: 333,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "family-invite-accepted",
    });

    expect(mocks.provisionActiveHostedDomainRootEnvelopeForUserOnly).toHaveBeenCalledWith({
      domain: "control",
      prisma,
      reason: "hosted-family.telegram-routing",
      userId: acceptedMemberId,
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "assistant.notification.requested:family-chat:member_telegram_family:telegram:update:333",
          kind: "assistant.notification.requested",
          notification: expect.objectContaining({
            instructions: "Send the selected Murph Family welcome variant in responsePolicy.",
            responsePolicy: {
              kind: "require_send_exact_text",
              text: renderUserFacingMessage({
                context: {},
                key: "assistant.family_welcome",
                seed: acceptedMemberId,
              }).text,
            },
            route: expect.objectContaining({
              channel: "telegram",
              delivery: {
                kind: "thread",
                target: "123",
              },
            }),
          }),
          userId: acceptedMemberId,
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: acceptedMemberId,
      mailboxItemId: "mailbox_assistant.notification.requested:family-chat:member_telegram_family:telegram:update:333",
    });
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId: acceptedMemberId,
      prisma,
    });
  });

  it("preserves a username-bound invite selected after a stale Telegram token hits a draft conflict", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const acceptedMemberId = "member_telegram_family_draft";
    const invite = {
      acceptedAt: null,
      acceptedByMemberId: null,
      channel: "telegram",
      createdAt: new Date("2026-06-18T12:00:00.000Z"),
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      group: {
        billingStatus: HostedBillingStatus.active,
        id: "hbag_paid_family",
        ownerMemberId: "member_paid_family_owner",
        suspendedAt: null,
      },
      groupId: "hbag_paid_family",
      id: "invite_telegram_draft_recovery",
      inviteCode: "invite_telegram_draft_recovery",
      invitedByMemberId: "member_paid_family_owner",
      planCode: "pulse",
      status: "pending",
      targetEmailEncrypted: null,
      targetEmailLookupKey: null,
      targetLabel: "Invitee",
      targetPhoneLookupKey: null,
      targetPhoneNumberEncrypted: null,
      targetTelegramUsernameEncrypted: null,
      targetTelegramUsernameLookupKey:
        createHostedTelegramUsernameLookupKey("@invitee_user"),
      updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    };
    const hostedAccountGroupInviteUpdateMany = vi.fn();
    const hostedAccountGroupPlanCapacityFindMany = vi.fn();
    const hostedAccountGroupDeleteMany = vi.fn();
    const hostedAccountGroupMembershipFindFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        group: {
          billingStatus: HostedBillingStatus.not_started,
          id: "hbag_unpaid_draft",
          ownerMemberId: acceptedMemberId,
          suspendedAt: null,
        },
        role: "owner",
      });
    const staleInvite = {
      ...invite,
      expiresAt: new Date("2026-06-18T11:00:00.000Z"),
      id: "invite_revoked_telegram_draft_recovery",
      inviteCode: "revoked_telegram_draft_recovery",
      status: "revoked",
    };
    const routingRecord = {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqHomeLineAssignedAt: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
      member: {
        billingStatus: HostedBillingStatus.not_started,
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
        id: acceptedMemberId,
        suspendedAt: null,
        updatedAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      memberId: acceptedMemberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqParticipantContactEncrypted: null,
      pendingLinqParticipantContactKind: null,
      pendingLinqParticipantContactLookupKey: null,
      pendingLinqParticipantContactObservedAt: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
      replyAliasLookupKey: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: createHostedTelegramUserLookupKey("456"),
    };
    const prisma = withPrismaTransaction({
      hostedAccountGroup: {
        deleteMany: hostedAccountGroupDeleteMany,
        findUnique: vi.fn().mockResolvedValue({
          billingRef: {
            billedSeatCount: null,
            checkoutAttemptId: "hbfca_telegram_draft",
            checkoutCreatedAt: new Date("2026-06-18T12:00:00.000Z"),
            checkoutSeatCount: 2,
            currentBillingPhase: null,
            currentPeriodEnd: null,
            currentPeriodStart: null,
            lastStripeEventCreatedAt: null,
            stripeCheckoutSessionIdEncrypted:
              "encrypted:cs_test_telegram_draft",
            stripeCheckoutSessionLookupKey:
              "hbidx:stripe-checkout-session:v1:telegram-draft",
            stripeCustomerIdEncrypted: null,
            stripeCustomerLookupKey: null,
            stripeSubscriptionIdEncrypted: null,
            stripeSubscriptionItemIdEncrypted: null,
            stripeSubscriptionItemLookupKey: null,
            stripeSubscriptionLookupKey: null,
          },
          billingStatus: HostedBillingStatus.not_started,
          id: "hbag_unpaid_draft",
          invites: [],
          memberships: [{
            memberId: acceptedMemberId,
            role: "owner",
            status: "active",
          }],
          ownerMemberId: acceptedMemberId,
          planCapacities: [],
          suspendedAt: null,
        }),
      },
      hostedAccountGroupBillingRef: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedAccountGroupInvite: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([{ inviteCode: invite.inviteCode }]),
        findUnique: vi.fn(async (args?: { where?: { inviteCode?: string } }) => {
          switch (args?.where?.inviteCode) {
            case staleInvite.inviteCode:
              return staleInvite;
            case invite.inviteCode:
              return invite;
            default:
              return null;
          }
        }),
        updateMany: hostedAccountGroupInviteUpdateMany,
      },
      hostedAccountGroupMembership: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: hostedAccountGroupMembershipFindFirst,
        upsert: vi.fn(),
      },
      hostedAccountGroupPlanCapacity: {
        findMany: hostedAccountGroupPlanCapacityFindMany,
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingRef: null,
          billingStatus: HostedBillingStatus.not_started,
        }),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([routingRecord]),
        findUnique: vi.fn().mockResolvedValue(routingRecord),
        upsert: vi.fn().mockResolvedValue({}),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 334,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Invitee",
            id: 456,
            username: "invitee_user",
          },
          message_id: 5,
          text: "/start family_revoked_telegram_draft_recovery",
        },
        update_id: 334,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      familyInviteCode: "invite_telegram_draft_recovery",
      ignored: true,
      ok: true,
      reason: "family-invite-draft-recovery-required",
    });

    expect(hostedAccountGroupInviteUpdateMany).not.toHaveBeenCalled();
    expect(hostedAccountGroupPlanCapacityFindMany).not.toHaveBeenCalled();
    expect(hostedAccountGroupDeleteMany).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId: acceptedMemberId,
      prisma,
    });
  });

  it("routes unknown token-shaped Telegram text to the assistant", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn(async (args?: { where?: { memberId?: string } }) => {
      if (args?.where?.memberId) {
        return null;
      }

      return {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      };
    });
    const hostedAccountGroupInviteFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = withPrismaTransaction({
      hostedAccountGroupInvite: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: hostedAccountGroupInviteFindUnique,
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
            username: "alice_user",
          },
          message_id: 6,
          text: "sending the family_photos album now",
        },
        update_id: 326,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(hostedAccountGroupInviteFindUnique).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        inviteCode: "photos",
      },
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:326",
          kind: "conversation.message",
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              text: "sending the family_photos album now",
            }),
          }),
        }),
      }),
    );
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:326",
    });
  });

  it("ignores Telegram family invite tokens that are not acceptable for the sender", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedAccountGroupInviteFindUnique = vi.fn().mockResolvedValue({
      expiresAt: new Date("2026-07-01T12:00:00.000Z"),
      status: "pending",
      targetTelegramUsernameLookupKey: createHostedTelegramUsernameLookupKey("@Alice_User"),
    });
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedAccountGroupInvite: {
        findUnique: hostedAccountGroupInviteFindUnique,
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Bob",
            id: 456,
            username: "bob_user",
          },
          message_id: 3,
          text: "/start family_invite_telegram",
        },
        update_id: 323,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "family-invite-not-accepted",
    });

    expect(hostedAccountGroupInviteFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        inviteCode: "invite_telegram",
      },
    }));
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("refreshes the persisted Telegram routing target when the inbound direct thread carries business context", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 654,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-42",
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          message: expect.objectContaining({
            telegramMessage: expect.objectContaining({
              threadId: "123:business:biz-42",
            }),
          }),
        }),
      }),
    );
    expect(hostedMemberRoutingUpsert).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale direct webhook after the Telegram identity is relinked", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn()
      .mockResolvedValueOnce({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      })
      .mockResolvedValueOnce(null);
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-stale",
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 657,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "telegram-binding-changed",
    });

    const queryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>;
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("ignores a stale group webhook after the Telegram identity is relinked", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn()
      .mockResolvedValueOnce({
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_123",
          suspendedAt: null,
        },
        memberId: "member_telegram_123",
      })
      .mockResolvedValueOnce(null);
    const participantUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: participantUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100123,
            type: "group",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 658,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "telegram-binding-changed",
    });

    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(participantUpsert).not.toHaveBeenCalled();
  });

  it("preserves a richer persisted Telegram thread target when a later webhook only carries a plain DM thread", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const existingTelegramPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_telegram_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "123:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 655,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
          telegramUserIdEncrypted: existingTelegramPrivateColumns.telegramUserIdEncrypted,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          text: "plain direct reply",
        },
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const upsertCall = hostedMemberRoutingUpsert.mock.calls[0]?.[0] as {
      update: {
        telegramUserIdEncrypted: string;
      };
    };

    expect(
      await readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_telegram_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: "123:business:biz-42:dm-topic:9",
      telegramUserId: "456",
    });
  });

  it("fails closed when Telegram lookup resolves to multiple members across rotated blind-index candidates", async () => {
    const previousContactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    const previousContactPrivacyCurrentVersion =
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    mocks.runtimeEnv.contactPrivacyKeyring = {
      currentVersion: "v2",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
        v2: Buffer.alloc(32, 8),
      },
      readVersions: ["v2", "v1"],
    };
    process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
      `v1:${Buffer.alloc(32, 7).toString("base64url")}`,
      `v2:${Buffer.alloc(32, 8).toString("base64url")}`,
    ].join(",");
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    const hostedMemberRoutingFindMany = vi.fn().mockResolvedValue([
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_telegram_v1",
          suspendedAt: null,
        },
        memberId: "member_telegram_v1",
      },
      {
        member: {
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_telegram_v2",
          suspendedAt: null,
        },
        memberId: "member_telegram_v2",
      },
    ]);
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findMany: hostedMemberRoutingFindMany,
      },
    });

    try {
      const response = await handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "telegram-secret",
      });

      expect(response).toEqual({
        ignored: true,
        ok: true,
        reason: "ambiguous-telegram-binding",
      });
      expect(hostedMemberRoutingFindMany).toHaveBeenCalledWith({
        select: {
          member: {
            select: {
              billingStatus: true,
              createdAt: true,
              id: true,
              suspendedAt: true,
              updatedAt: true,
            },
          },
          memberId: true,
        },
        where: {
          telegramUserLookupKey: {
            in: expect.arrayContaining([
              expect.stringMatching(/^hbidx:telegram-user:v2:/u),
              expect.stringMatching(/^hbidx:telegram-user:v1:/u),
            ]),
          },
        },
      });
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    } finally {
      restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousContactPrivacyKeys);
      restoreEnvValue(
        "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
        previousContactPrivacyCurrentVersion,
      );
    }
  });

  it("bounds hosted Telegram replyContextPreview before writing the hosted wake payload", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 322,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
        }),
      },
    });

    await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 2,
          quote: {
            text: "Q".repeat(220),
          },
          reply_to_message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            message_id: 1,
            text: "R".repeat(220),
          },
          text: "hello",
        },
        update_id: 322,
      }),
      secretToken: "telegram-secret",
    });

    const enqueueCall = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0] as {
      envelope?: {
        message?: {
          telegramMessage?: {
            replyContextPreview?: unknown;
          };
        };
      };
    } | undefined;
    const preview = enqueueCall?.envelope?.message?.telegramMessage?.replyContextPreview;

    expect(typeof preview).toBe("string");
    expect(preview).toHaveLength(240);
    expect(preview).toMatch(/^Replying to: /u);
    expect(preview).toMatch(/\.\.\.$/u);
  });

  it("requires the hosted execution nudge before returning active-member success", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 654,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
        }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:654",
    });
  });

  it("signals Temporal for active-member Telegram messages", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 655,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
        }),
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_telegram_123",
      mailboxItemId: "mailbox_telegram:update:655",
    });
  });

  it("accepts Telegram webhooks whose secret header is missing", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn().mockResolvedValue({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_123",
        invitedAt: "2026-03-01T00:00:00.000Z",
        paymentGraceEndsAt: null,
        stripeCurrentPeriodEndsAt: "2026-04-01T00:00:00.000Z",
        stripeSubscriptionStatus: "active",
        suspendedAt: null,
      },
    });
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: null,
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      httpStatus: 401,
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks when the secret token does not match", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "wrong-secret",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      httpStatus: 401,
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks when the server-side secret is not configured", async () => {
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: 123,
              type: "private",
            },
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_WEBHOOK_SECRET_NOT_CONFIGURED",
      httpStatus: 500,
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores suspended members even when billing remains active", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberRoutingUpsert = vi.fn();
    const participantUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 321,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
          },
        }),
        upsert: hostedMemberRoutingUpsert,
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: participantUpsert,
      },
    });

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100123,
            type: "group",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 321,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "suspended-member",
    });
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(participantUpsert).not.toHaveBeenCalled();
  });

  it("persists an inactive signup's direct thread without waking the runtime", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingStatus: HostedBillingStatus.not_started,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
          telegramUserIdEncrypted: null,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-setup",
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "/start",
        },
        update_id: 656,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });

    const upsertCall = hostedMemberRoutingUpsert.mock.calls[0]?.[0] as {
      update: {
        telegramUserIdEncrypted: string;
      };
    };
    expect(
      await readHostedMemberRoutingTelegramPrivateState({
        memberId: "member_telegram_123",
        telegramUserIdEncrypted: upsertCall.update.telegramUserIdEncrypted,
      }),
    ).toEqual({
      telegramThreadId: "123:business:biz-setup",
      telegramUserId: "456",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(
      mocks.rearmHostedPhoneCallResultNotificationRecovery,
    ).toHaveBeenCalledWith({
      memberId: "member_telegram_123",
      prisma,
    });
  });

  it("does not mutate direct routing after explicit health-data withdrawal", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.active,
          consentGrants: [{ scope: "launch.health-data", status: "revoked" }],
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
          telegramUserIdEncrypted: null,
        }),
        upsert: hostedMemberRoutingUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          business_connection_id: "biz-setup",
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "/start",
        },
        update_id: 658,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });

    expect(hostedMemberRoutingUpsert).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("does not record group participant authority until the linked sender becomes active", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const participantUpsert = vi.fn().mockResolvedValue({});
    const prisma = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          accountGroupMemberships: [],
          billingRef: null,
          billingStatus: HostedBillingStatus.not_started,
          suspendedAt: null,
          threadContainer: null,
        }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_telegram_123",
            suspendedAt: null,
          },
          memberId: "member_telegram_123",
        }),
      },
      hostedThreadContainerParticipant: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: participantUpsert,
      },
    });

    await expect(handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100123,
            type: "group",
          },
          date: 1_774_522_600,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 1,
          text: "hello",
        },
        update_id: 657,
      }),
      secretToken: "telegram-secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "inactive-member",
    });

    expect(participantUpsert).not.toHaveBeenCalled();
    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores business-account self messages flagged through sender_business_bot", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 654,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        business_message: {
          business_connection_id: "bc_123",
          chat: {
            id: 123,
            is_direct_messages: true,
            type: "private",
          },
          date: 1_774_522_601,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 9,
          sender_business_bot: {
            id: 999,
            is_bot: true,
            username: "murph_bot",
          },
          text: "echo",
        },
        update_id: 654,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("ignores plain self messages when Telegram marks the sender as the bot user", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 655,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          date: 1_774_522_602,
          from: {
            first_name: "murph_bot",
            id: 999,
            is_bot: true,
            username: "murph_bot",
          },
          message_id: 10,
          text: "self echo",
        },
        update_id: 655,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("dispatches direct-messages topic chats using the shared local direct-thread model", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 777,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          member: {
            billingStatus: HostedBillingStatus.active,
            id: "member_telegram_456",
            suspendedAt: null,
          },
        }),
      },
    });

    const response = await handleHostedOnboardingTelegramWebhook({
      prisma,
      rawBody: JSON.stringify({
        message: {
          chat: {
            id: -100555,
            is_direct_messages: true,
            title: "Channel inbox",
            type: "supergroup",
          },
          date: 1_774_522_602,
          direct_messages_topic: {
            title: "Priority",
            topic_id: 9,
          },
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 4,
          text: "hello from the DM topic",
        },
        update_id: 777,
      }),
      secretToken: "telegram-secret",
    });

    expect(response).toEqual({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "telegram:update:777",
          kind: "conversation.message",
          message: expect.objectContaining({
            channel: "telegram",
            telegramMessage: expect.objectContaining({
              messageId: "4",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello from the DM topic",
              threadId: "-100555:dm-topic:9",
            }),
          }),
          userId: "member_telegram_456",
        }),
      }),
    );
  });

  it("coarsens non-text Telegram payloads into placeholder text without carrying durable PII fields", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedMemberRoutingFindUnique = vi.fn().mockResolvedValue({
      member: {
        billingStatus: HostedBillingStatus.active,
        id: "member_telegram_789",
        suspendedAt: null,
      },
    });
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventPayload: {
              updateId: 880,
            },
            receiptState: {
              attemptCount: 1,
              status: "processing",
            },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    const cases = [
      {
        expectedText: "[shared contact]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
            username: "alice_private",
          },
          contact: {
            first_name: "Alice",
            last_name: "Example",
            phone_number: "+15555550123",
            user_id: 456,
          },
          date: 1_774_522_604,
          from: {
            first_name: "Alice",
            id: 456,
            username: "alice_sender",
          },
          message_id: 6,
        },
        updateId: 880,
      },
      {
        expectedText: "[shared location]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_605,
          from: {
            first_name: "Alice",
            id: 456,
          },
          location: {
            latitude: 12.34,
            longitude: 56.78,
          },
          message_id: 7,
        },
        updateId: 881,
      },
      {
        expectedText: "[shared venue]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_606,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 8,
          venue: {
            address: "123 Secret Street",
            latitude: 12.34,
            longitude: 56.78,
            title: "Secret Cafe",
          },
        },
        updateId: 882,
      },
      {
        expectedText: "[shared poll]",
        message: {
          chat: {
            first_name: "Alice",
            id: 123,
            type: "private",
          },
          date: 1_774_522_607,
          from: {
            first_name: "Alice",
            id: 456,
          },
          message_id: 9,
          poll: {
            id: "poll_123",
            options: [
              { text: "Yes", voter_count: 1 },
              { text: "No", voter_count: 0 },
            ],
            question: "Where should we meet?",
            total_voter_count: 1,
          },
        },
        updateId: 883,
      },
    ];

    for (const testCase of cases) {
      mocks.enqueueHostedExecutionOutbox.mockClear();

      const response = await handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: testCase.message,
          update_id: testCase.updateId,
        }),
        secretToken: "telegram-secret",
      });

      expect(response).toEqual({
        ok: true,
        reason: "wake-appended-active-member",
      });

      const enqueueCall = mocks.enqueueHostedExecutionOutbox.mock.calls.at(-1)?.[0] as {
        envelope?: {
          kind?: string;
          message?: {
            telegramMessage?: unknown;
          };
        };
      } | undefined;
      expect(enqueueCall?.envelope?.kind).toBe("conversation.message");
      if (!enqueueCall?.envelope?.message || typeof enqueueCall.envelope.message !== "object") {
        throw new Error("Expected a hosted Telegram wake message.");
      }

      expect(enqueueCall.envelope.message.telegramMessage).toEqual({
        messageId: String(testCase.message.message_id),
        schema: "murph.hosted-telegram-message.v1",
        text: testCase.expectedText,
        threadId: "123",
        threadIsDirect: true,
      });
    }

    expect(hostedMemberRoutingFindUnique).toHaveBeenCalledTimes(cases.length * 7);
  });

  it("rejects malformed Telegram message payloads before receipt persistence", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: 123,
            date: 1_774_522_600,
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 1,
            text: "hello",
          },
          update_id: 321,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toThrowError(new TypeError("message.chat must be a JSON object."));

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("rejects malformed direct-message topic payloads even when the secret is valid", async () => {
    mocks.runtimeEnv.telegramWebhookSecret = "telegram-secret";
    const hostedWebhookReceiptCreate = vi.fn();
    const hostedMemberRoutingFindUnique = vi.fn();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: hostedMemberRoutingFindUnique,
      },
    });

    await expect(
      handleHostedOnboardingTelegramWebhook({
        prisma,
        rawBody: JSON.stringify({
          message: {
            chat: {
              id: -100555,
              is_direct_messages: true,
              type: "supergroup",
            },
            date: 1_774_522_603,
            direct_messages_topic: {
              topic_id: "nine",
            },
            from: {
              first_name: "Alice",
              id: 456,
            },
            message_id: 5,
            text: "hello",
          },
          update_id: 778,
        }),
        secretToken: "telegram-secret",
      }),
    ).rejects.toThrowError(new TypeError("message.direct_messages_topic.topic_id must be an integer."));

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedMemberRoutingFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });
});

function withPrismaTransaction<T extends Record<string, unknown>>(
  prisma: T,
): T & TelegramWebhookPrismaHarness {
  const prismaWithTransaction = prisma as T & TelegramWebhookPrismaHarness;
  prismaWithTransaction.$executeRaw = async () => 0;
  prismaWithTransaction.$queryRaw = vi.fn(async (query: unknown) => {
    const sql = Array.isArray(query)
      ? query.join("?")
      : query && typeof query === "object" && "sql" in query
        && typeof query.sql === "string"
        ? query.sql
        : "";
    if (/FOR UPDATE SKIP LOCKED/i.test(sql)) {
      return (mocks.memberRowLockOutcomes.shift() ?? true)
        ? [{ id: "locked-member" }]
        : [];
    }
    return [];
  });
  prismaWithTransaction.$transaction = vi.fn(async (
    callback: (tx: TelegramWebhookPrismaHarness) => Promise<unknown>,
  ) => {
    mocks.transactionDepth += 1;
    try {
      return await callback(prismaWithTransaction);
    } finally {
      mocks.transactionDepth -= 1;
    }
  });
  if (prismaWithTransaction.hostedMemberRouting?.findUnique) {
    const originalFindUnique = prismaWithTransaction.hostedMemberRouting.findUnique;
    prismaWithTransaction.hostedMemberRouting.findUnique = vi.fn(async (...args: unknown[]) => {
      const result = await originalFindUnique(...args);
      return normalizeHostedMemberRoutingHarnessResult(result);
    });
  }
  if (
    prismaWithTransaction.hostedMemberRouting?.findFirst === undefined &&
    prismaWithTransaction.hostedMemberRouting?.findUnique
  ) {
    prismaWithTransaction.hostedMemberRouting.findFirst =
      prismaWithTransaction.hostedMemberRouting.findUnique;
  }
  if (
    prismaWithTransaction.hostedMemberRouting?.findMany === undefined &&
    prismaWithTransaction.hostedMemberRouting?.findFirst
  ) {
    prismaWithTransaction.hostedMemberRouting.findMany = vi.fn(async (...args: unknown[]) => {
      const result = await prismaWithTransaction.hostedMemberRouting?.findFirst?.(...args);
      return result ? [result] : [];
    });
  }
  if (
    prismaWithTransaction.hostedMemberRouting &&
    prismaWithTransaction.hostedMemberRouting.upsert === undefined
  ) {
    prismaWithTransaction.hostedMemberRouting.upsert = vi.fn().mockResolvedValue({});
  }
  if (prismaWithTransaction.hostedMember?.findUnique === undefined) {
    // The unified access gate loads the member access shape directly; every
    // linked member reaching that gate in these tests is a direct-paid active
    // member.
    prismaWithTransaction.hostedMember = {
      findUnique: vi.fn(async () => ({
        accountGroupMemberships: [],
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
        threadContainer: null,
      })),
    };
  }
  if (!prismaWithTransaction.hostedThreadContainerParticipant) {
    prismaWithTransaction.hostedThreadContainerParticipant = {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
  } else {
    prismaWithTransaction.hostedThreadContainerParticipant.findMany ??=
      vi.fn().mockResolvedValue([]);
    prismaWithTransaction.hostedThreadContainerParticipant.updateMany ??=
      vi.fn().mockResolvedValue({ count: 0 });
    prismaWithTransaction.hostedThreadContainerParticipant.upsert ??=
      vi.fn().mockResolvedValue({});
  }
  if (!prismaWithTransaction.hostedWebhookReceiptSideEffect?.deleteMany || !prismaWithTransaction.hostedWebhookReceiptSideEffect?.upsert) {
    prismaWithTransaction.hostedWebhookReceiptSideEffect = {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
  }
  return prismaWithTransaction;
}

async function createTelegramProviderRootResult(input: {
  domain: HostedCryptoDomain;
  rootKeyId?: string;
  userId: string;
}): Promise<TelegramRootResult> {
  const rootKeyId = input.rootKeyId
    ?? mocks.preparedRootKeyIdsByDomain.get(input.domain)?.shift()
    ?? defaultTelegramRootKeyId(input);
  await mocks.providerKmsWork({
    domain: input.domain,
    rootKeyId,
    transactionOpen: mocks.transactionDepth > 0,
    userId: input.userId,
  });
  return {
    envelope: buildTelegramRootEnvelope({
      domain: input.domain,
      rootKeyId,
      userId: input.userId,
    }),
    rootKey: new Uint8Array(32),
  };
}

function buildTelegramRootEnvelope(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): HostedDomainRootKeyEnvelopeV1 {
  const timestamp = "2026-08-11T12:00:00.000Z";
  return {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-authority-key",
      signature: "test-signature",
      signedAt: timestamp,
    },
    createdAt: timestamp,
    domain: input.domain,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: timestamp,
    userId: input.userId,
    wraps: [],
  };
}

function copyTelegramRootResult(
  result: TelegramRootResult,
): TelegramRootResult {
  return {
    envelope: result.envelope,
    rootKey: Uint8Array.from(result.rootKey),
  };
}

function defaultTelegramRootKeyId(input: {
  domain: string;
  userId: string;
}): string {
  return `root_${input.domain}_${input.userId}`;
}

function installDefaultHostedSecureBoxStringTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(
          input.value.replace(/^hsb-test:/u, ""),
          "base64url",
        ).toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

function buildTelegramRoutingCore(memberId: string) {
  return {
    billingStatus: HostedBillingStatus.active,
    createdAt: new Date("2026-08-11T12:00:00.000Z"),
    id: memberId,
    suspendedAt: null,
    updatedAt: new Date("2026-08-11T12:00:00.000Z"),
  };
}

function buildDirectTelegramWebhookRawBody(input: {
  updateId: number;
}): string {
  return JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      date: 1_776_000_000,
      from: {
        first_name: "Alice",
        id: 456,
      },
      message_id: input.updateId,
      text: "hello",
    },
    update_id: input.updateId,
  });
}

function normalizeHostedMemberRoutingHarnessResult(result: unknown) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as {
    member?: {
      id?: unknown;
    } | null;
    memberId?: unknown;
    telegramUserIdEncrypted?: unknown;
  };
  const memberId = typeof record.memberId === "string"
    ? record.memberId
    : typeof record.member?.id === "string"
      ? record.member.id
      : null;

  return {
    ...record,
    ...(memberId ? { memberId } : {}),
    ...(record.telegramUserIdEncrypted === undefined
      ? { telegramUserIdEncrypted: null }
      : {}),
  };
}

type HostedOnboardingTelegramWebhookTestInput = Omit<HostedOnboardingTelegramWebhookInput, "prisma"> & {
  prisma?: TelegramWebhookPrismaHarness;
};

async function handleHostedOnboardingTelegramWebhook(
  input: HostedOnboardingTelegramWebhookTestInput,
) {
  return handleHostedOnboardingTelegramWebhookImpl(input as HostedOnboardingTelegramWebhookInput);
}

function readHostedWebhookSideEffectUpsertCalls(prisma: object | null | undefined): Record<string, unknown>[] {
  const hostedWebhookReceiptSideEffect = (prisma as {
    hostedWebhookReceiptSideEffect?: {
      upsert?: {
        mock?: {
          calls?: unknown[][];
        };
      };
    };
  }).hostedWebhookReceiptSideEffect;

  return (hostedWebhookReceiptSideEffect?.upsert?.mock?.calls ?? []).map((call) =>
    normalizeHostedWebhookSideEffectUpsertCall(
      ((call[0] as Record<string, unknown> | undefined) ?? {}),
    )
  );
}

function normalizeHostedWebhookSideEffectUpsertCall(
  call: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...call,
    create: normalizeHostedWebhookSideEffectRecord(call.create),
    update: normalizeHostedWebhookSideEffectRecord(call.update),
  };
}

function normalizeHostedWebhookSideEffectRecord(value: unknown): Record<string, unknown> | unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...record,
    dispatchPayloadJson: record.kind === "hosted_execution_dispatch" ? record.payloadJson ?? null : null,
  };
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
