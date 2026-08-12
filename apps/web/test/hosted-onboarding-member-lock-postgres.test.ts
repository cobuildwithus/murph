import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  HostedStripeEventStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  createHostedEmailLookupKey,
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedTelegramUserLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/authentication-service";
import { ensureHostedCompanionMemberId } from "@/src/lib/hosted-onboarding/companion-member-access";
import {
  issueHostedFamilyInvite,
  updateHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { ensureHostedMemberStripeCustomer } from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";
import {
  lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberBillingSnapshot,
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  ensureHostedMemberForPrivyIdentityResolutionTx,
  reconcileHostedPrivyIdentityOnMemberTx,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import {
  suspendHostedMemberForBillingReversalTx,
  writeHostedMemberStripeBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { runHostedAccountDeletionCleanup } from "@/src/lib/hosted-privacy/account-deletion-cleanup";
import { deleteHostedAccountData } from "@/src/lib/hosted-privacy/account-data-service";
import { createPrismaClient } from "@/src/lib/prisma";

const privyProvider = vi.hoisted(() => ({
  deleteUser: vi.fn(async () => {
    privyProvider.exists = false;
    return true;
  }),
  emailByUserId: new Map<string, string>(),
  exists: true,
  readUser: vi.fn(async (userId: string) => {
    if (!privyProvider.exists || privyProvider.missingUserIds.has(userId)) {
      throw new Error("Privy user no longer exists.");
    }
    const emailAddress = privyProvider.emailByUserId.get(userId);
    const phoneNumber = privyProvider.phoneByUserId.get(userId);
    const telegramUserId = privyProvider.telegramByUserId.get(userId);
    return {
      id: userId,
      linked_accounts: [
        ...(emailAddress
          ? [{
            address: emailAddress,
            type: "email",
            verified_at: 1_775_203_200,
          }]
          : []),
        ...(phoneNumber
          ? [{
              phone_number: phoneNumber,
              type: "phone",
              verified_at: 1_775_203_200,
            }]
          : []),
        ...(telegramUserId
          ? [{
              telegram_user_id: telegramUserId,
              type: "telegram",
            }]
          : []),
      ],
    };
  }),
  missingUserIds: new Set<string>(),
  phoneByUserId: new Map<string, string>(),
  telegramByUserId: new Map<string, string>(),
}));

const accountDeletionBoundaries = vi.hoisted(() => ({
  connectedAppsClient: {
    deleteAccount: vi.fn(async () => undefined),
    disconnectAccount: vi.fn(async () => undefined),
    listAccounts: vi.fn(async () => [{
      alias: "work",
      id: "ca_deletion_fence",
      isDisabled: false,
      status: "ACTIVE",
      toolkit: { name: "Mail", slug: "mail" },
      wordId: "deletion-fence",
    }]),
  },
  connectedAppsRevocationFails: true,
}));

const stripeProvider = vi.hoisted(() => ({
  chargesRetrieve: vi.fn(),
  eventsRetrieve: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
}));

const companionBoundaries = vi.hoisted(() => ({
  consentedMemberIds: new Set<string>(),
  ensureStarterUsage: vi.fn(async () => ({
    redirectPath: "/home?initialVisit=true",
    status: "enrolled" as const,
  })),
}));

vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/legal/consent")>()),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(async ({
    memberId,
  }: {
    memberId: string;
  }) => {
    if (!companionBoundaries.consentedMemberIds.has(memberId)) {
      throw Object.assign(new Error("Launch consent is required."), {
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
      });
    }
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/starter-usage-enrollment-service", () => ({
  ensureHostedStarterUsageEnrollment: companionBoundaries.ensureStarterUsage,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/member-access")>()),
  assertActiveHostedMemberAccessAllowed: vi.fn(async () => undefined),
  readActiveHostedMemberAccess: vi.fn(async () => false),
}));

vi.mock("@/src/lib/connected-apps/composio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/connected-apps/composio")>()),
  createComposioConnectedAppsClient: vi.fn(() =>
    accountDeletionBoundaries.connectedAppsClient
  ),
}));

vi.mock("@/src/lib/connected-apps/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/connected-apps/config")>()),
  readHostedConnectedAppsConfig: vi.fn(() => ({
    apiKey: "test-key",
    baseUrl: "https://connected-apps.example.test",
    maxAccountsPerToolkit: 1,
    toolkits: ["mail"],
  })),
}));

vi.mock("@/src/lib/computer-use/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/computer-use/service")>()),
  ComputerUseService: class {
    async deleteMemberExternalStateForAccountDeletion() {
      return {
        browserSessionsDeleted: 0,
        profilesDeleted: 0,
      };
    }
  },
}));

vi.mock("@/src/lib/hosted-execution/user-data-delete", () => ({
  deleteHostedRunnerUserDataBestEffort: vi.fn(async () => ({
    alarmCleared: true,
    configured: true,
    deleteAllCompleted: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  })),
}));

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx:
    vi.fn(async () => undefined),
  closeHostedUsageCreditPurchasesForAccountDeletion:
    vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-orchestration/workflow-termination", () => ({
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn(async () => ({
    configured: false,
    errorCode: null,
    notFound: false,
    terminated: false,
  })),
}));

vi.mock("@/src/lib/phone-calls/account-deletion", () => ({
  assertHostedPhoneCallsReadyForAccountDeletionTx: vi.fn(async () => undefined),
  deleteHostedPhoneCallsForAccountDeletion: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");

  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn(async () => undefined),
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-onboarding/privy")>();
  return {
    ...actual,
    deleteHostedPrivyUser: privyProvider.deleteUser,
    readHostedPrivyUserById: privyProvider.readUser,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");
  const stripe = {
    charges: {
      retrieve: stripeProvider.chargesRetrieve,
    },
    events: {
      retrieve: stripeProvider.eventsRetrieve,
    },
    subscriptions: {
      retrieve: stripeProvider.subscriptionsRetrieve,
    },
  };

  return {
    ...actual,
    requireHostedStripeApi: () => stripe,
    requireHostedStripeApiMode: () => ({
      stripe,
      stripeLiveMode: false,
    }),
    requireHostedStripeBillingPlanConfig: () => ({
      billingPlanCode: "launch_monthly",
      priceId: "price_restore_reconciliation",
      stripe,
    }),
  };
});

vi.mock("@/src/lib/hosted-crypto/env", () => ({
  getHostedWebCryptoConfig: () => ({
    env: "test",
    gcpKms: {
      decrypt: async ({ ciphertext }: { ciphertext: string }) => ({
        plaintext: new Uint8Array(Buffer.from(ciphertext, "base64")),
      }),
      encrypt: async ({
        keyName,
        plaintext,
      }: {
        keyName: string;
        plaintext: Uint8Array;
      }) => ({
        ciphertext: Buffer.from(plaintext).toString("base64"),
        keyName,
      }),
    },
    webWrapKmsKeyName:
      "projects/test/locations/global/keyRings/test/cryptoKeys/delete-race",
  }),
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted member-lock concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const memberLockAcquisitionTimeoutMs = 2_000;
const transactionTimeoutMs = 10_000;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted member Stripe mutation lock PostgreSQL concurrency",
  () => {
    it("fails a same-member contender within the acquisition budget and allows a later retry", async () => {
      const owner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contender = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_lock_${randomUUID()}`;
      const ownerAcquired = createDeferred();
      const releaseOwner = createDeferred();
      let contenderRunCount = 0;

      await owner.hostedMember.create({
        data: {
          id: memberId,
        },
      });

      const ownerTransaction = withHostedMemberStripeMutationLockForOps({
        acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
        memberId,
        prisma: owner,
        run: async () => {
          ownerAcquired.resolve();
          await releaseOwner.promise;
          return "owner";
        },
        transactionTimeoutMs,
      });

      try {
        await expect(
          Promise.race([
            ownerAcquired.promise,
            ownerTransaction.then(() => {
              throw new Error(
                "The owner transaction completed before holding the member row.",
              );
            }),
          ]),
        ).resolves.toBeUndefined();

        const startedAt = Date.now();
        await expect(
          withHostedMemberStripeMutationLockForOps({
            acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
            memberId,
            prisma: contender,
            run: async () => {
              contenderRunCount += 1;
              return "contender";
            },
            transactionTimeoutMs,
          }),
        ).rejects.toBeInstanceOf(HostedMemberStripeMutationLockBusyError);
        expect(Date.now() - startedAt).toBeLessThan(5_000);
        expect(contenderRunCount).toBe(0);

        releaseOwner.resolve();
        await expect(ownerTransaction).resolves.toBe("owner");

        await expect(
          withHostedMemberStripeMutationLockForOps({
            acquisitionTimeoutMs: memberLockAcquisitionTimeoutMs,
            memberId,
            prisma: contender,
            run: async () => {
              contenderRunCount += 1;
              return "contender";
            },
            transactionTimeoutMs,
          }),
        ).resolves.toBe("contender");
        expect(contenderRunCount).toBe(1);
      } finally {
        releaseOwner.resolve();
        await Promise.allSettled([ownerTransaction]);
        await owner.hostedMember.deleteMany({
          where: {
            id: memberId,
          },
        });
        await disconnectClients([owner, contender]);
      }
    });

    it.each([
      { kind: "direct-customer" as const },
      { kind: "family-capacity" as const },
      { kind: "account-deletion" as const },
      { kind: "account-deletion-beneficiary" as const },
      { kind: "account-deletion-claim-beneficiary" as const },
      { kind: "family-authority" as const },
    ])("makes a waiting legacy $kind writer observe a committed future claim", async ({
      kind,
    }) => {
      const claimOwner = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_compatibility_${fixtureId}`;
      const beneficiaryMemberId = `hbm_compatibility_beneficiary_${fixtureId}`;
      const groupId = `hbag_compatibility_${fixtureId}`;
      const deletionMemberId = kind === "account-deletion-beneficiary"
        || kind === "account-deletion-claim-beneficiary"
        ? beneficiaryMemberId
        : memberId;
      const claimPrepared = createDeferred();
      const releaseClaim = createDeferred();
      let writerPromise: Promise<unknown> | null = null;
      stripeProvider.subscriptionsRetrieve.mockClear();

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: beneficiaryMemberId,
        },
      });
      await observer.hostedAccountGroup.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: groupId,
          ownerMemberId: memberId,
        },
      });
      await observer.hostedAccountGroupMembership.create({
        data: {
          groupId,
          id: `hbagm_compatibility_${fixtureId}`,
          memberId: beneficiaryMemberId,
          planCode: "pulse",
          role: "member",
          status: kind === "account-deletion-claim-beneficiary" ? "removed" : "active",
        },
      });
      const [writerBackend] = await writer.$queryRaw<Array<{ pid: number }>>(
        Prisma.sql`SELECT pg_backend_pid()::int AS pid`,
      );
      if (!writerBackend) {
        throw new Error("Expected the compatibility writer PostgreSQL backend id.");
      }

      const claimTransaction = claimOwner.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "hosted_member"
          WHERE "id" = ${deletionMemberId}
          FOR UPDATE
        `;
        if (kind === "direct-customer") {
          await tx.hostedMemberBillingRef.create({
            data: {
              memberId,
              stripeEffectClaimedAt: new Date("2026-08-12T12:00:00.000Z"),
              stripeEffectClaimId: `member-customer:${fixtureId}`,
              stripeEffectKind: "member.customer-create",
            },
          });
        } else {
          await tx.hostedAccountGroupBillingRef.create({
            data: {
              groupId,
              stripeEffectClaimedAt: new Date("2026-08-12T12:00:00.000Z"),
              stripeEffectClaimId: `family-capacity:${fixtureId}`,
              stripeEffectBeneficiaryMemberId: kind === "account-deletion-claim-beneficiary"
                ? beneficiaryMemberId
                : null,
              stripeEffectKind: "family.capacity",
            },
          });
        }
        claimPrepared.resolve();
        await releaseClaim.promise;
      }, { timeout: transactionTimeoutMs });

      try {
        await claimPrepared.promise;
        writerPromise = kind === "direct-customer"
          ? ensureHostedMemberStripeCustomer({ memberId, prisma: writer })
          : kind === "family-capacity"
            ? updateHostedFamilyPlanCapacities({
                groupId,
                ownerMemberId: memberId,
                prisma: writer,
                targetCapacities: { edge: 0, max: 0, pulse: 2 },
              })
            : kind === "account-deletion"
                || kind === "account-deletion-beneficiary"
                || kind === "account-deletion-claim-beneficiary"
              ? deleteHostedAccountData({
                  memberId: deletionMemberId,
                  prisma: writer,
                  request: new Request("https://app.example.test/settings"),
                })
              : issueHostedFamilyInvite({
                  groupId,
                  invitedByMemberId: memberId,
                  prisma: writer,
                  targetEmail: "invitee@example.test",
                });

        await waitForPostgresLock({
          observer,
          pid: writerBackend.pid,
        });
        releaseClaim.resolve();
        await claimTransaction;
        await expect(writerPromise).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        await expect(observer.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: deletionMemberId },
        })).resolves.toEqual({ suspendedAt: null });
        expect(stripeProvider.subscriptionsRetrieve).not.toHaveBeenCalled();
      } finally {
        releaseClaim.resolve();
        await Promise.allSettled([
          claimTransaction,
          ...(writerPromise ? [writerPromise] : []),
        ]);
        await observer.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [beneficiaryMemberId, memberId] } },
        });
        await disconnectClients([claimOwner, observer, writer]);
      }
    });

    it.each([
      {
        label: "full refund",
        sourceEventId: "evt_refund_full",
        sourceType: "stripe.refund.created",
      },
      {
        label: "withdrawn dispute funds",
        sourceEventId: "evt_dispute_funds_withdrawn",
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
    ])("commits and idempotently replays $label suspension", async ({
      sourceEventId,
      sourceType,
    }) => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_billing_reversal_${randomUUID()}`;
      const eventCreatedAt = new Date("2026-07-26T18:00:00.000Z");

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:billing-reversal";
        },
      });

      try {
        const member = await readHostedMemberBillingSnapshot({
          memberId,
          prisma: observer,
        });
        if (!member) {
          throw new Error("Expected the billing-reversal fixture member.");
        }

        await writer.$transaction((tx) =>
          suspendHostedMemberForBillingReversalTx({
            canonicalBillingStatus: HostedBillingStatus.active,
            dispatchContext: {
              eventCreatedAt,
              sourceEventId,
              sourceType,
            },
            member,
            tx,
          }), { timeout: transactionTimeoutMs });

        const persisted = await observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        });
        expect(persisted).toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: eventCreatedAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: eventCreatedAt,
        });

        const replayMember = await readHostedMemberBillingSnapshot({
          memberId,
          prisma: observer,
        });
        if (!replayMember) {
          throw new Error("Expected the suspended billing-reversal fixture member.");
        }
        await writer.$transaction((tx) =>
          suspendHostedMemberForBillingReversalTx({
            canonicalBillingStatus: HostedBillingStatus.active,
            dispatchContext: {
              eventCreatedAt,
              sourceEventId,
              sourceType,
            },
            member: replayMember,
            tx,
          }), { timeout: transactionTimeoutMs });

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: eventCreatedAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: eventCreatedAt,
        });
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, writer]);
      }
    });

    it("keeps the newest distinct reversal ahead of an older restore", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_billing_reversal_order_${randomUUID()}`;
      const firstReversalAt = new Date("2026-07-26T18:00:01.000Z");
      const olderRestoreAt = new Date("2026-07-26T18:00:02.000Z");
      const newestReversalAt = new Date("2026-07-26T18:00:03.000Z");

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:billing-reversal-order";
        },
      });

      try {
        await applyBillingReversal({
          client: writer,
          eventCreatedAt: firstReversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_a_withdrawn",
        });
        await applyBillingReversal({
          client: writer,
          eventCreatedAt: newestReversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_b_withdrawn",
        });
        await applyBillingRestore({
          client: writer,
          eventCreatedAt: olderRestoreAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_a_reinstated",
        });

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: newestReversalAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: newestReversalAt,
        });
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, writer]);
      }
    });

    it("keeps ordinary progress from superseding a pending billing restoration", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_billing_progress_${randomUUID()}`;
      const reversalAt = new Date("2026-07-26T18:00:01.000Z");
      const invoicePaidAt = new Date("2026-07-26T18:00:02.000Z");
      const restoreAt = new Date("2026-07-26T18:00:03.000Z");

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:billing-progress";
        },
      });

      try {
        await applyBillingReversal({
          client: writer,
          eventCreatedAt: reversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_progress_withdrawn",
        });
        await applyOrdinaryBillingProgress({
          client: writer,
          eventCreatedAt: invoicePaidAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_invoice_paid_while_reversed",
        });

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: reversalAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: reversalAt,
        });

        await applyBillingRestore({
          client: writer,
          eventCreatedAt: restoreAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_progress_reinstated",
        });

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: restoreAt,
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        });
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, writer]);
      }
    });

    it.each([
      {
        billingIdentity: "fully bound",
        label: "restoration completes before ordinary progress",
        prebindSubscription: true,
        restoreCompletesLast: false,
      },
      {
        billingIdentity: "fully bound",
        label: "ordinary progress completes before a delayed restoration",
        prebindSubscription: true,
        restoreCompletesLast: true,
      },
      {
        billingIdentity: "customer-only",
        label: "restoration retries before ordinary progress",
        prebindSubscription: false,
        restoreCompletesLast: false,
      },
      {
        billingIdentity: "customer-only",
        label: "ordinary progress completes before a delayed restoration",
        ordinaryCreatedBeforeReversal: false,
        prebindSubscription: false,
        restoreCompletesLast: true,
      },
      {
        billingIdentity: "customer-only",
        label: "restoration retries before stale ordinary progress",
        ordinaryCreatedBeforeReversal: true,
        prebindSubscription: false,
        restoreCompletesLast: false,
      },
      {
        billingIdentity: "customer-only",
        label: "stale ordinary progress completes before a delayed restoration",
        ordinaryCreatedBeforeReversal: true,
        prebindSubscription: false,
        restoreCompletesLast: true,
      },
    ])("reconciles $label for a $billingIdentity member without stranding access", async ({
      ordinaryCreatedBeforeReversal = false,
      prebindSubscription,
      restoreCompletesLast,
    }) => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const restoreClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const ordinaryClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_restore_reconciliation_${randomUUID()}`;
      const customerId = `cus_${randomUUID()}`;
      const subscriptionId = `sub_${randomUUID()}`;
      const chargeId = `ch_${randomUUID()}`;
      const initialBillingAt = new Date("2026-07-26T18:00:00.000Z");
      const reversalAt = new Date("2026-07-26T18:00:01.000Z");
      const restoreAt = new Date("2026-07-26T18:00:02.000Z");
      const ordinaryAt = ordinaryCreatedBeforeReversal
        ? new Date("2026-07-26T18:00:00.500Z")
        : new Date("2026-07-26T18:00:03.000Z");
      const subscription = makeActiveStripeSubscription({
        customerId,
        memberId,
        subscriptionId,
      });
      const restoreEvent = makeStripeEvent({
        createdAt: restoreAt,
        eventId: `evt_restore_${randomUUID()}`,
        object: {
          charge: chargeId,
          payment_intent: null,
          status: "won",
        } as Stripe.Dispute,
        type: "charge.dispute.funds_reinstated",
      });
      const ordinaryEvent = makeStripeEvent({
        createdAt: ordinaryAt,
        eventId: `evt_subscription_${randomUUID()}`,
        object: subscription,
        type: "customer.subscription.updated",
      });
      const eventsById = new Map([
        [restoreEvent.id, restoreEvent],
        [ordinaryEvent.id, ordinaryEvent],
      ]);
      const restoreChargeReadStarted = createDeferred();
      const releaseRestoreChargeRead = createDeferred<Stripe.Charge>();

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt(input) {
          return input.value;
        },
      });
      stripeProvider.eventsRetrieve.mockImplementation(async (eventId: string) => {
        const event = eventsById.get(eventId);
        if (!event) {
          throw new Error("Unexpected Stripe event receipt.");
        }
        return event;
      });
      stripeProvider.subscriptionsRetrieve.mockResolvedValue(subscription);
      stripeProvider.chargesRetrieve.mockImplementation(async () => {
        if (restoreCompletesLast) {
          restoreChargeReadStarted.resolve();
          return releaseRestoreChargeRead.promise;
        }
        return makeStripeCharge({ chargeId, customerId });
      });

      try {
        const initialMember = await requireBillingSnapshot(observer, memberId);
        await ordinaryClient.$transaction((tx) =>
          writeHostedMemberStripeBillingTx({
            billingStatus: HostedBillingStatus.active,
            canonicalBillingStatus: HostedBillingStatus.active,
            dispatchContext: {
              eventCreatedAt: initialBillingAt,
              occurredAt: initialBillingAt.toISOString(),
              sourceEventId: `evt_binding_${memberId}`,
              sourceType: "stripe.customer.subscription.updated",
            },
            member: initialMember,
            stripeCustomerId: customerId,
            ...(prebindSubscription
              ? {
                  stripeSubscriptionId: subscriptionId,
                }
              : {}),
            tx,
          }), { timeout: transactionTimeoutMs });
        await applyBillingReversal({
          client: ordinaryClient,
          eventCreatedAt: reversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: `evt_reversal_${memberId}`,
        });
        await recordHostedStripeEvent({
          event: restoreEvent,
          prisma: observer,
        });
        await recordHostedStripeEvent({
          event: ordinaryEvent,
          prisma: observer,
        });

        if (restoreCompletesLast) {
          const restoreReconciliation = reconcileHostedStripeEventById({
            eventId: restoreEvent.id,
            prisma: restoreClient,
          });
          await expect(Promise.race([
            restoreChargeReadStarted.promise,
            restoreReconciliation.then(() => {
              throw new Error(
                "Restoration reconciliation completed before its provider read was held.",
              );
            }),
          ])).resolves.toBeUndefined();
          await expect(reconcileHostedStripeEventById({
            eventId: ordinaryEvent.id,
            prisma: ordinaryClient,
          })).resolves.toMatchObject({
            eventId: ordinaryEvent.id,
            status: "completed",
          });
          if (!prebindSubscription) {
            await expect(requireBillingSnapshot(observer, memberId)).resolves.toMatchObject({
              billingRef: {
                lastStripeEventCreatedAt: reversalAt,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
              },
              core: {
                billingStatus: HostedBillingStatus.unpaid,
                suspendedAt: reversalAt,
              },
            });
          }
          releaseRestoreChargeRead.resolve(
            makeStripeCharge({ chargeId, customerId }),
          );
          await expect(restoreReconciliation).resolves.toMatchObject({
            eventId: restoreEvent.id,
            status: "completed",
          });
        } else {
          await expect(reconcileHostedStripeEventById({
            eventId: restoreEvent.id,
            prisma: restoreClient,
          })).resolves.toMatchObject({
            eventId: restoreEvent.id,
            status: prebindSubscription ? "completed" : "failed",
          });
          await expect(reconcileHostedStripeEventById({
            eventId: ordinaryEvent.id,
            prisma: ordinaryClient,
          })).resolves.toMatchObject({
            eventId: ordinaryEvent.id,
            status: "completed",
          });
          if (!prebindSubscription) {
            await expect(requireBillingSnapshot(observer, memberId)).resolves.toMatchObject({
              billingRef: {
                lastStripeEventCreatedAt: reversalAt,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
              },
              core: {
                billingStatus: HostedBillingStatus.unpaid,
                suspendedAt: reversalAt,
              },
            });
            await expect(observer.hostedStripeEvent.findUnique({
              where: {
                eventId: restoreEvent.id,
              },
            })).resolves.toMatchObject({
              lastErrorCode: "HOSTED_STRIPE_SUBSCRIPTION_IDENTITY_PENDING",
              status: HostedStripeEventStatus.failed,
            });
            await observer.hostedStripeEvent.update({
              data: {
                nextAttemptAt: new Date(0),
              },
              where: {
                eventId: restoreEvent.id,
              },
            });
            await expect(reconcileHostedStripeEventById({
              eventId: restoreEvent.id,
              prisma: restoreClient,
            })).resolves.toMatchObject({
              eventId: restoreEvent.id,
              status: "completed",
            });
          }
        }

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt:
              prebindSubscription && !restoreCompletesLast
                ? ordinaryAt
                : restoreAt,
            stripeCustomerLookupKey: expect.any(String),
            stripeSubscriptionLookupKey: expect.any(String),
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        });
        await expect(observer.hostedStripeEvent.findMany({
          where: {
            eventId: {
              in: [restoreEvent.id, ordinaryEvent.id],
            },
          },
        })).resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({
            eventId: restoreEvent.id,
            status: HostedStripeEventStatus.completed,
          }),
          expect.objectContaining({
            eventId: ordinaryEvent.id,
            status: HostedStripeEventStatus.completed,
          }),
        ]));
      } finally {
        releaseRestoreChargeRead.resolve(
          makeStripeCharge({ chargeId, customerId }),
        );
        setHostedSecureBoxStringTestCodecForTests(null);
        stripeProvider.chargesRetrieve.mockReset();
        stripeProvider.eventsRetrieve.mockReset();
        stripeProvider.subscriptionsRetrieve.mockReset();
        await observer.hostedStripeEvent.deleteMany({
          where: {
            eventId: {
              in: [restoreEvent.id, ordinaryEvent.id],
            },
          },
        });
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, restoreClient, ordinaryClient]);
      }
    });

    it("serializes a newer reversal against an older concurrent restore", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const reversalClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const restoreClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_billing_reversal_concurrent_${randomUUID()}`;
      const firstReversalAt = new Date("2026-07-26T18:00:01.000Z");
      const olderRestoreAt = new Date("2026-07-26T18:00:02.000Z");
      const newestReversalAt = new Date("2026-07-26T18:00:03.000Z");
      const bothTransactionsReady = createDeferred();
      let readyCount = 0;
      const waitForConcurrentStart = async () => {
        readyCount += 1;
        if (readyCount === 2) {
          bothTransactionsReady.resolve();
        }
        await bothTransactionsReady.promise;
      };

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:billing-reversal-concurrent";
        },
      });

      try {
        await applyBillingReversal({
          client: reversalClient,
          eventCreatedAt: firstReversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_dispute_a_withdrawn",
        });
        const sharedSnapshot = await requireBillingSnapshot(observer, memberId);

        await Promise.all([
          reversalClient.$transaction(async (tx) => {
            await waitForConcurrentStart();
            await suspendHostedMemberForBillingReversalTx({
              canonicalBillingStatus: HostedBillingStatus.active,
              dispatchContext: {
                eventCreatedAt: newestReversalAt,
                sourceEventId: "evt_dispute_b_withdrawn",
                sourceType: "stripe.charge.dispute.funds_withdrawn",
              },
              member: sharedSnapshot,
              tx,
            });
          }, { timeout: transactionTimeoutMs }),
          restoreClient.$transaction(async (tx) => {
            await waitForConcurrentStart();
            await writeHostedMemberStripeBillingTx({
              billingStatus: HostedBillingStatus.active,
              canonicalBillingStatus: HostedBillingStatus.active,
              dispatchContext: {
                eventCreatedAt: olderRestoreAt,
                occurredAt: olderRestoreAt.toISOString(),
                sourceEventId: "evt_dispute_a_reinstated",
                sourceType: "stripe.charge.dispute.funds_reinstated",
              },
              member: sharedSnapshot,
              suspendedAtOverride: null,
              tx,
            });
          }, { timeout: transactionTimeoutMs }),
        ]);

        await expect(observer.hostedMember.findUnique({
          include: { billingRef: true },
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: newestReversalAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: newestReversalAt,
        });
      } finally {
        bothTransactionsReady.resolve();
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, reversalClient, restoreClient]);
      }
    });
  },
);

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Privy re-creation and account-deletion PostgreSQL concurrency",
  () => {
    it("keeps deletion authoritative over an existing Stripe suspension and terminalizes on retry", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const memberId = `hbm_deletion_billing_fence_${randomUUID()}`;
      const reversalAt = new Date("2026-07-26T18:00:01.000Z");
      const cleanupIdsBefore = new Set(
        (await observer.hostedAccountDeletionCleanup.findMany({
          select: { id: true },
        })).map((cleanup) => cleanup.id),
      );

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      await observer.hostedConnectedAppsSession.create({
        data: {
          memberId,
          policyRevision: 1,
          remoteSessionId: `remote_${randomUUID()}`,
        },
      });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:deletion-billing-fence";
        },
      });
      accountDeletionBoundaries.connectedAppsRevocationFails = true;
      accountDeletionBoundaries.connectedAppsClient.disconnectAccount.mockImplementation(
        async () => {
          if (accountDeletionBoundaries.connectedAppsRevocationFails) {
            throw Object.assign(new Error("provider unavailable"), {
              name: "ProviderUnavailableError",
            });
          }
        },
      );
      accountDeletionBoundaries.connectedAppsClient.deleteAccount.mockResolvedValue(undefined);

      try {
        await applyBillingReversal({
          client: writer,
          eventCreatedAt: reversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_deletion_fence_withdrawn",
        });

        await expect(deleteHostedAccountData({
          memberId,
          prisma: writer,
          request: new Request("https://app.example.test/settings"),
        })).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_PROVIDER_REVOKE_FAILED",
          retryable: true,
        });

        const deletionFencedMember = await requireBillingSnapshot(observer, memberId);
        const deletionStartedAt = deletionFencedMember.core.suspendedAt;
        if (!deletionStartedAt) {
          throw new Error("Expected account deletion to leave a durable suspension fence.");
        }
        expect(deletionStartedAt.getTime()).not.toBe(reversalAt.getTime());
        expect(deletionFencedMember.billingRef?.lastStripeEventCreatedAt).toEqual(
          reversalAt,
        );

        const ordinaryBillingAt = new Date(deletionStartedAt.getTime() + 60_000);
        const nextReversalAt = new Date(deletionStartedAt.getTime() + 120_000);
        const restoreAt = new Date(deletionStartedAt.getTime() + 180_000);
        await expect(applyOrdinaryBillingProgress({
          client: writer,
          eventCreatedAt: ordinaryBillingAt,
          member: deletionFencedMember,
          sourceEventId: "evt_deletion_fence_invoice_paid",
        })).rejects.toMatchObject({
          code: "HOSTED_MEMBER_SUSPENDED",
        });
        await expect(applyBillingReversal({
          client: writer,
          eventCreatedAt: nextReversalAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_deletion_fence_new_withdrawal",
        })).rejects.toMatchObject({
          code: "HOSTED_MEMBER_SUSPENDED",
        });
        await expect(applyBillingRestore({
          client: writer,
          eventCreatedAt: restoreAt,
          member: await requireBillingSnapshot(observer, memberId),
          sourceEventId: "evt_deletion_fence_reinstated",
        })).rejects.toMatchObject({
          code: "HOSTED_MEMBER_SUSPENDED",
        });

        const stillDeletionFenced = await requireBillingSnapshot(observer, memberId);
        expect(stillDeletionFenced).toMatchObject({
          billingRef: {
            lastStripeEventCreatedAt: reversalAt,
          },
          core: {
            billingStatus: HostedBillingStatus.unpaid,
            suspendedAt: deletionStartedAt,
          },
        });
        let accessError: unknown;
        try {
          assertHostedMemberNotSuspended(stillDeletionFenced.core);
        } catch (error) {
          accessError = error;
        }
        expect(accessError).toMatchObject({
          code: "HOSTED_MEMBER_SUSPENDED",
          httpStatus: 403,
        });

        accountDeletionBoundaries.connectedAppsRevocationFails = false;
        await expect(deleteHostedAccountData({
          memberId,
          prisma: writer,
          request: new Request("https://app.example.test/settings"),
        })).resolves.toMatchObject({
          cleanupPending: false,
          memberId,
        });
        await expect(observer.hostedMember.findUnique({
          where: { id: memberId },
        })).resolves.toBeNull();
        const cleanupIdsAfter = await observer.hostedAccountDeletionCleanup.findMany({
          select: { id: true },
        });
        expect(
          cleanupIdsAfter.filter((cleanup) => !cleanupIdsBefore.has(cleanup.id)),
        ).toHaveLength(0);
      } finally {
        accountDeletionBoundaries.connectedAppsRevocationFails = true;
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        const cleanupIdsAfter = await observer.hostedAccountDeletionCleanup.findMany({
          select: { id: true },
        });
        const unexpectedCleanupIds = cleanupIdsAfter
          .map((cleanup) => cleanup.id)
          .filter((id) => !cleanupIdsBefore.has(id));
        if (unexpectedCleanupIds.length > 0) {
          await observer.hostedAccountDeletionCleanup.deleteMany({
            where: { id: { in: unexpectedCleanupIds } },
          });
        }
        await disconnectClients([observer, writer]);
      }
    });

    it("rejects stale authentication after Privy deletion terminalizes and removes the receipt", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const authenticationClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const oldMemberId = `hbm_privy_delete_${fixtureId}`;
      const cleanupId = `hbadc_privy_delete_${fixtureId}`;
      const privyUserId = `did:privy:delete-race-${fixtureId}`;
      const privyUserLookupKey = createHostedPrivyUserLookupKey(privyUserId);
      const authenticationReachedReceiptRead = createDeferred();
      const allowAuthenticationReceiptRead = createDeferred();
      const cleanupStartedAt = new Date("2026-07-26T18:00:00.000Z");
      let authentication: Promise<unknown> | null = null;

      if (!privyUserLookupKey) {
        throw new Error("Expected a Privy user lookup key for the concurrency fixture.");
      }

      privyProvider.exists = true;
      privyProvider.deleteUser.mockClear();
      privyProvider.readUser.mockClear();
      await observer.hostedMember.create({
        data: { id: oldMemberId },
      });
      await observer.hostedMemberIdentity.create({
        data: {
          memberId: oldMemberId,
          privyUserLookupKey,
        },
      });
      await deletionClient.$transaction(async (tx) => {
        await tx.hostedAccountDeletionCleanup.create({
          data: {
            cloudflareCompletedAt: cleanupStartedAt,
            environment: "test",
            id: cleanupId,
            kmsKeyName:
              "projects/test/locations/global/keyRings/test/cryptoKeys/delete-race",
            nextAttemptAt: cleanupStartedAt,
            payloadCiphertext: encodeCleanupPayload({
              privyUserId,
              runtimeMemberIds: [oldMemberId],
              schema: "murph.hosted-account-deletion-cleanup.v1",
              stripeCustomerIds: [],
            }),
            privyUserLookupKey,
            stripeCompletedAt: cleanupStartedAt,
          },
        });
        await tx.hostedMember.delete({
          where: { id: oldMemberId },
        });
      }, { timeout: transactionTimeoutMs });
      const memberCountAfterDeletion = await observer.hostedMember.count();
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt() {
          return "hsb-test:privy-account-deletion-race";
        },
      });

      try {
        authentication = authenticationClient.$transaction(async (tx) =>
          ensureHostedMemberForPrivyIdentityResolutionTx({
            authMethod: "telegram",
            identity: {
              email: null,
              phone: null,
              telegram: {
                firstName: "Deletion",
                lastName: "Race",
                photoUrl: null,
                telegramUserId: `telegram_${fixtureId}`,
                username: null,
              },
              userId: privyUserId,
            },
            now: new Date("2026-07-26T18:00:00.000Z"),
            prisma: pauseBeforeAccountDeletionReceiptRead({
              allowAuthenticationReceiptRead,
              authenticationReachedReceiptRead,
              tx,
            }),
          }), { timeout: transactionTimeoutMs });

        await authenticationReachedReceiptRead.promise;
        await expect(runHostedAccountDeletionCleanup({
          cleanupId,
          now: cleanupStartedAt,
          prisma: deletionClient,
        })).resolves.toMatchObject({
          cleanupPending: false,
          vendorAccounts: {
            privyUser: {
              status: "completed",
            },
          },
        });
        await expect(observer.hostedAccountDeletionCleanup.findUnique({
          where: { id: cleanupId },
        })).resolves.toBeNull();
        expect(privyProvider.deleteUser).toHaveBeenCalledOnce();

        allowAuthenticationReceiptRead.resolve();
        await expect(authentication).rejects.toThrow(
          "Privy user no longer exists.",
        );
        expect(privyProvider.readUser).toHaveBeenCalledOnce();
        await expect(observer.hostedMemberIdentity.count({
          where: { privyUserLookupKey },
        })).resolves.toBe(0);
        await expect(observer.hostedMember.count()).resolves.toBe(
          memberCountAfterDeletion,
        );
        await expect(observer.hostedWebSession.count({
          where: { privyUserId },
        })).resolves.toBe(0);
      } finally {
        allowAuthenticationReceiptRead.resolve();
        await Promise.allSettled(authentication ? [authentication] : []);
        const replacementIdentities = await observer.hostedMemberIdentity.findMany({
          select: { memberId: true },
          where: { privyUserLookupKey },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [
                oldMemberId,
                ...replacementIdentities.map((identity) => identity.memberId),
              ],
            },
          },
        });
        await observer.hostedAccountDeletionCleanup.deleteMany({
          where: { id: cleanupId },
        });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer, deletionClient, authenticationClient]);
      }
    });
  },
);

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted verified-email Privy rebinding PostgreSQL concurrency",
  () => {
    it("rebinds the existing member without creating another member", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_${fixtureId}`;
      const emailAddress = `rebind-${fixtureId}@example.test`;
      const oldPrivyUserId = `did:privy:old-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-${fixtureId}`;

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      const member = await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        prisma: observer,
      });
      const memberCountBefore = await observer.hostedMember.count();
      const emailAuthorizationBefore =
        await observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        });

      try {
        await expect(writer.$transaction((tx) =>
          reconcileHostedPrivyIdentityOnMemberTx({
            allowVerifiedEmailRebinding: true,
            authMethod: "email",
            identity: makeVerifiedEmailRebindingIdentity({
              emailAddress,
              privyUserId: replacementPrivyUserId,
            }),
            member,
            now: new Date("2026-08-03T12:00:00.000Z"),
            prisma: tx,
          }), { timeout: transactionTimeoutMs })).resolves.toMatchObject({
          id: memberId,
        });

        await expect(observer.hostedMember.count()).resolves.toBe(memberCountBefore);
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          memberId,
          privyUserIdEncrypted: replacementPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
        await expect(observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toEqual(emailAuthorizationBefore);
      } finally {
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer, writer]);
      }
    });

    it("holds verified-email authority through the identity replacement commit", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const rebindingClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const emailWriter = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_lock_${fixtureId}`;
      const emailAddress = `rebind-lock-${fixtureId}@example.test`;
      const oldPrivyUserId = `did:privy:old-lock-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-lock-${fixtureId}`;
      const rebindingReachedIdentityWrite = createDeferred();
      const allowRebindingIdentityWrite = createDeferred();
      let rebinding: Promise<unknown> | null = null;
      let emailMove: Promise<unknown> | null = null;

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      const member = await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        prisma: observer,
      });

      try {
        rebinding = rebindingClient.$transaction((tx) =>
          reconcileHostedPrivyIdentityOnMemberTx({
            allowVerifiedEmailRebinding: true,
            authMethod: "email",
            identity: makeVerifiedEmailRebindingIdentity({
              emailAddress,
              privyUserId: replacementPrivyUserId,
            }),
            member,
            now: new Date("2026-08-03T12:00:00.000Z"),
            prisma: pauseBeforeHostedIdentityUpsert({
              allowIdentityWrite: allowRebindingIdentityWrite,
              identityWriteReached: rebindingReachedIdentityWrite,
              tx,
            }),
          }), { timeout: transactionTimeoutMs });

        await rebindingReachedIdentityWrite.promise;
        const [emailWriterBackend] = await emailWriter.$queryRaw<Array<{ pid: number }>>(
          Prisma.sql`SELECT pg_backend_pid()::int AS pid`,
        );
        if (!emailWriterBackend) {
          throw new Error("Expected the email-writer PostgreSQL backend id.");
        }
        emailMove = emailWriter.$transaction(async (tx) => {
          await tx.hostedMemberEmailAuthorization.update({
            data: {
              verifiedEmailLookupKey: null,
              verifiedEmailVerifiedAt: null,
            },
            where: { memberId },
          });
        }, { timeout: transactionTimeoutMs });

        await waitForPostgresLock({
          observer,
          pid: emailWriterBackend.pid,
        });
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserLookupKey: requirePrivyUserLookupKey(oldPrivyUserId),
        });

        allowRebindingIdentityWrite.resolve();
        await expect(rebinding).resolves.toMatchObject({ id: memberId });
        await expect(emailMove).resolves.toBeUndefined();
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
        await expect(observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          verifiedEmailLookupKey: null,
          verifiedEmailVerifiedAt: null,
        });
      } finally {
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        allowRebindingIdentityWrite.resolve();
        await Promise.allSettled([
          ...(rebinding ? [rebinding] : []),
          ...(emailMove ? [emailMove] : []),
        ]);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer, rebindingClient, emailWriter]);
      }
    });

    it("rolls back the old binding when the replacement principal belongs to another member", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_conflict_${fixtureId}`;
      const conflictingMemberId = `hbm_email_rebind_owner_${fixtureId}`;
      const emailAddress = `rebind-conflict-${fixtureId}@example.test`;
      const oldPrivyUserId = `did:privy:old-conflict-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:owned-${fixtureId}`;

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      const member = await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        prisma: observer,
      });
      await observer.hostedMember.create({ data: { id: conflictingMemberId } });
      await observer.hostedMemberIdentity.create({
        data: {
          memberId: conflictingMemberId,
          privyUserIdEncrypted: replacementPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        },
      });

      try {
        await expect(writer.$transaction((tx) =>
          reconcileHostedPrivyIdentityOnMemberTx({
            allowVerifiedEmailRebinding: true,
            authMethod: "email",
            identity: makeVerifiedEmailRebindingIdentity({
              emailAddress,
              privyUserId: replacementPrivyUserId,
            }),
            member,
            now: new Date("2026-08-03T12:00:00.000Z"),
            prisma: tx,
          }), { timeout: transactionTimeoutMs })).rejects.toMatchObject({
          code: "PRIVY_IDENTITY_CONFLICT",
          httpStatus: 409,
        });

        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserIdEncrypted: oldPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(oldPrivyUserId),
        });
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId: conflictingMemberId },
        })).resolves.toMatchObject({
          privyUserIdEncrypted: replacementPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
      } finally {
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({
          where: { id: { in: [memberId, conflictingMemberId] } },
        });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer, writer]);
      }
    });

    it("rejects a stale missing principal without displacing the current email owner", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const authenticationClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_stale_${fixtureId}`;
      const emailAddress = `rebind-stale-${fixtureId}@example.test`;
      const currentPrivyUserId = `did:privy:current-${fixtureId}`;
      const stalePrivyUserId = `did:privy:stale-${fixtureId}`;

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId: currentPrivyUserId,
        prisma: observer,
      });
      const memberCountBefore = await observer.hostedMember.count();
      const webSessionCountBefore = await observer.hostedWebSession.count();
      privyProvider.missingUserIds.add(stalePrivyUserId);

      try {
        await expect(authenticationClient.$transaction((tx) =>
          ensureHostedMemberForPrivyIdentityResolutionTx({
            allowVerifiedEmailRebinding: true,
            authMethod: "email",
            identity: makeVerifiedEmailRebindingIdentity({
              emailAddress,
              privyUserId: stalePrivyUserId,
            }),
            now: new Date("2026-08-03T12:00:00.000Z"),
            prisma: tx,
          }), { timeout: transactionTimeoutMs })).rejects.toThrow(
          "Privy user no longer exists.",
        );

        await expect(observer.hostedMember.count()).resolves.toBe(memberCountBefore);
        await expect(observer.hostedWebSession.count()).resolves.toBe(webSessionCountBefore);
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserIdEncrypted: currentPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(currentPrivyUserId),
        });
        await expect(observer.hostedMemberIdentity.count({
          where: {
            privyUserLookupKey: requirePrivyUserLookupKey(stalePrivyUserId),
          },
        })).resolves.toBe(0);
      } finally {
        privyProvider.missingUserIds.delete(stalePrivyUserId);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer, authenticationClient]);
      }
    });

    it("rolls back principal recovery when a live-only Telegram account belongs to another member", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_telegram_conflict_${fixtureId}`;
      const telegramOwnerMemberId = `hbm_telegram_owner_${fixtureId}`;
      const emailAddress = `rebind-telegram-conflict-${fixtureId}@example.test`;
      const oldPrivyUserId = `did:privy:old-telegram-conflict-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-telegram-conflict-${fixtureId}`;
      const telegramUserId = `telegram-conflict-${fixtureId}`;
      const telegramUserLookupKey = createHostedTelegramUserLookupKey(telegramUserId);

      if (!telegramUserLookupKey) {
        throw new Error("Expected a Telegram lookup key for the conflict fixture.");
      }

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      privyProvider.telegramByUserId.set(replacementPrivyUserId, telegramUserId);
      await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        prisma: observer,
      });
      await observer.hostedMember.create({ data: { id: telegramOwnerMemberId } });
      await observer.hostedMemberRouting.create({
        data: {
          memberId: telegramOwnerMemberId,
          telegramUserIdEncrypted: telegramUserId,
          telegramUserLookupKey,
        },
      });
      const emailAuthorizationBefore =
        await observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        });

      try {
        await expect(completeHostedPrivyVerification({
          authMethod: "email",
          identity: makeVerifiedEmailRebindingIdentity({
            emailAddress,
            privyUserId: replacementPrivyUserId,
          }),
          now: new Date("2026-08-03T12:00:00.000Z"),
          prisma: observer,
          timeZone: "America/New_York",
        })).rejects.toMatchObject({
          code: "TELEGRAM_IDENTITY_CONFLICT",
          httpStatus: 409,
        });

        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserIdEncrypted: oldPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(oldPrivyUserId),
        });
        await expect(observer.hostedMemberIdentity.count({
          where: {
            privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
          },
        })).resolves.toBe(0);
        await expect(observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toEqual(emailAuthorizationBefore);
        await expect(observer.hostedMemberRouting.findUnique({
          where: { memberId },
        })).resolves.toBeNull();
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(0);
        await expect(observer.hostedMember.findUniqueOrThrow({
          select: { pendingActivationTimeZone: true },
          where: { id: memberId },
        })).resolves.toEqual({ pendingActivationTimeZone: null });
      } finally {
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        privyProvider.telegramByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({
          where: { id: { in: [memberId, telegramOwnerMemberId] } },
        });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer]);
      }
    });

    it("commits an unowned live-only Telegram account with principal recovery", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_telegram_${fixtureId}`;
      const emailAddress = `rebind-telegram-${fixtureId}@example.test`;
      const oldPrivyUserId = `did:privy:old-telegram-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-telegram-${fixtureId}`;
      const telegramUserId = `telegram-${fixtureId}`;
      const telegramUserLookupKey = createHostedTelegramUserLookupKey(telegramUserId);

      if (!telegramUserLookupKey) {
        throw new Error("Expected a Telegram lookup key for the success fixture.");
      }

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      privyProvider.telegramByUserId.set(replacementPrivyUserId, telegramUserId);
      await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        prisma: observer,
      });
      const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
      clearHostedOnboardingEnvCache();

      try {
        await expect(completeHostedPrivyVerification({
          authMethod: "email",
          identity: makeVerifiedEmailRebindingIdentity({
            emailAddress,
            privyUserId: replacementPrivyUserId,
          }),
          now: new Date("2026-08-03T12:00:00.000Z"),
          prisma: observer,
        })).resolves.toMatchObject({
          memberId,
        });

        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserIdEncrypted: replacementPrivyUserId,
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
        const telegramRouting = await observer.hostedMemberRouting.findUniqueOrThrow({
          where: { memberId },
        });
        expect(telegramRouting).toMatchObject({
          telegramUserLookupKey,
        });
        expect(telegramRouting.telegramUserIdEncrypted).toContain(
          `"telegramUserId":"${telegramUserId}"`,
        );
        await expect(observer.hostedMemberRouting.count({
          where: { telegramUserLookupKey },
        })).resolves.toBe(1);
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(1);
      } finally {
        if (previousPublicBaseUrl === undefined) {
          delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
        } else {
          process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
        }
        clearHostedOnboardingEnvCache();
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        privyProvider.telegramByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer]);
      }
    });

    it("retains one live authority snapshot across the companion consent retry", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_retry_${fixtureId}`;
      const canonicalEmailAddress = `rebind-retry-live-${fixtureId}@example.test`;
      const staleTokenEmailAddress = `rebind-retry-stale-${fixtureId}@example.test`;
      const storedPhoneNumber = "+15551234567";
      const unownedLivePhoneNumber = "+15557654321";
      const oldPrivyUserId = `did:privy:old-retry-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-retry-${fixtureId}`;
      const laterEmailOwnerPrivyUserId = `did:privy:later-email-owner-${fixtureId}`;
      const liveTelegramUserId = `telegram-live-retry-${fixtureId}`;
      const staleTelegramUserId = `telegram-stale-retry-${fixtureId}`;
      const liveTelegramLookupKey = createHostedTelegramUserLookupKey(liveTelegramUserId);
      const staleTelegramLookupKey = createHostedTelegramUserLookupKey(staleTelegramUserId);

      if (!liveTelegramLookupKey || !staleTelegramLookupKey) {
        throw new Error("Expected Telegram lookup keys for the retry fixture.");
      }

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, canonicalEmailAddress);
      privyProvider.phoneByUserId.set(replacementPrivyUserId, unownedLivePhoneNumber);
      privyProvider.telegramByUserId.set(replacementPrivyUserId, liveTelegramUserId);
      await seedVerifiedEmailRebindingMember({
        emailAddress: canonicalEmailAddress,
        memberId,
        oldPrivyUserId,
        phoneNumber: storedPhoneNumber,
        prisma: observer,
      });
      const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
      clearHostedOnboardingEnvCache();
      let laterEmailOwnerMemberId: string | null = null;
      const staleBearerIdentity = {
        email: {
          address: staleTokenEmailAddress,
          verifiedAt: 1_754_218_800,
        },
        phone: {
          number: storedPhoneNumber,
          verifiedAt: 1_754_218_800,
        },
        telegram: {
          firstName: null,
          lastName: null,
          photoUrl: null,
          telegramUserId: staleTelegramUserId,
          username: null,
        },
        userId: replacementPrivyUserId,
      };
      const freshBearerIdentity = {
        ...staleBearerIdentity,
        phone: {
          number: unownedLivePhoneNumber,
          verifiedAt: 1_754_218_860,
        },
      };

      try {
        await expect(ensureHostedCompanionMemberId({
          identity: staleBearerIdentity,
          now: new Date("2026-08-03T12:00:00.000Z"),
          prisma: observer,
        })).rejects.toMatchObject({
          code: "HOSTED_CONSENT_REQUIRED",
          httpStatus: 403,
        });

        companionBoundaries.consentedMemberIds.add(memberId);
        await expect(ensureHostedCompanionMemberId({
          identity: freshBearerIdentity,
          now: new Date("2026-08-03T12:01:00.000Z"),
          prisma: observer,
        })).resolves.toBe(memberId);

        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          phoneLookupKey: createHostedPhoneLookupKey(storedPhoneNumber),
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
        await expect(observer.hostedMemberIdentity.count({
          where: {
            phoneLookupKey: createHostedPhoneLookupKey(unownedLivePhoneNumber),
          },
        })).resolves.toBe(0);
        await expect(observer.hostedMemberEmailAuthorization.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          directPublicSenderLookupKey: createHostedEmailLookupKey(canonicalEmailAddress),
          verifiedEmailLookupKey: createHostedEmailLookupKey(canonicalEmailAddress),
        });
        await expect(lookupHostedMemberByVerifiedEmailAddress({
          address: staleTokenEmailAddress,
          prisma: observer,
        })).resolves.toBeNull();
        await expect(readHostedMemberIdByAuthorizedDirectPublicSenderAddress({
          address: staleTokenEmailAddress,
          prisma: observer,
        })).resolves.toBeNull();
        await expect(observer.hostedMemberRouting.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          telegramUserLookupKey: liveTelegramLookupKey,
        });
        await expect(observer.hostedMemberRouting.count({
          where: { telegramUserLookupKey: staleTelegramLookupKey },
        })).resolves.toBe(0);
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(1);

        privyProvider.emailByUserId.set(
          laterEmailOwnerPrivyUserId,
          staleTokenEmailAddress,
        );
        const laterEmailOwner = await completeHostedPrivyVerification({
          authMethod: "email",
          identity: makeVerifiedEmailRebindingIdentity({
            emailAddress: staleTokenEmailAddress,
            privyUserId: laterEmailOwnerPrivyUserId,
          }),
          now: new Date("2026-08-03T12:02:00.000Z"),
          prisma: observer,
        });
        laterEmailOwnerMemberId = laterEmailOwner.memberId;
        expect(laterEmailOwner.memberId).not.toBe(memberId);
        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
      } finally {
        if (previousPublicBaseUrl === undefined) {
          delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
        } else {
          process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
        }
        clearHostedOnboardingEnvCache();
        companionBoundaries.consentedMemberIds.delete(memberId);
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        privyProvider.emailByUserId.delete(laterEmailOwnerPrivyUserId);
        privyProvider.phoneByUserId.delete(replacementPrivyUserId);
        privyProvider.telegramByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [memberId, ...(laterEmailOwnerMemberId ? [laterEmailOwnerMemberId] : [])],
            },
          },
        });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer]);
      }
    });

    it.each([
      {
        canonicalPhone: "stored",
        livePhoneOwner: "another member",
        phoneOwnedByAnother: true,
        storedPhoneNumber: "+15551234567",
      },
      {
        canonicalPhone: "absent",
        livePhoneOwner: "another member",
        phoneOwnedByAnother: true,
        storedPhoneNumber: undefined,
      },
      {
        canonicalPhone: "absent",
        livePhoneOwner: "unowned",
        phoneOwnedByAnother: false,
        storedPhoneNumber: undefined,
      },
    ])("handles a $livePhoneOwner live phone with a $canonicalPhone canonical phone", async ({
      phoneOwnedByAnother,
      storedPhoneNumber,
    }) => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_email_rebind_retry_phone_${fixtureId}`;
      const phoneOwnerMemberId = `hbm_retry_phone_owner_${fixtureId}`;
      const emailAddress = `rebind-retry-phone-${fixtureId}@example.test`;
      const ownedLivePhoneNumber = "+15557654321";
      const oldPrivyUserId = `did:privy:old-retry-phone-${fixtureId}`;
      const replacementPrivyUserId = `did:privy:replacement-retry-phone-${fixtureId}`;
      const liveTelegramUserId = `telegram-live-retry-phone-${fixtureId}`;
      const ownedLivePhoneLookupKey = createHostedPhoneLookupKey(ownedLivePhoneNumber);
      const liveTelegramLookupKey = createHostedTelegramUserLookupKey(liveTelegramUserId);

      if (!ownedLivePhoneLookupKey || !liveTelegramLookupKey) {
        throw new Error("Expected phone and Telegram lookup keys for the retry fixture.");
      }

      installPassthroughHostedSecureBoxTestCodec();
      privyProvider.exists = true;
      privyProvider.emailByUserId.set(replacementPrivyUserId, emailAddress);
      privyProvider.phoneByUserId.set(replacementPrivyUserId, ownedLivePhoneNumber);
      privyProvider.telegramByUserId.set(replacementPrivyUserId, liveTelegramUserId);
      await seedVerifiedEmailRebindingMember({
        emailAddress,
        memberId,
        oldPrivyUserId,
        ...(storedPhoneNumber ? { phoneNumber: storedPhoneNumber } : {}),
        prisma: observer,
      });
      if (phoneOwnedByAnother) {
        await observer.hostedMember.create({ data: { id: phoneOwnerMemberId } });
        await observer.hostedMemberIdentity.create({
          data: {
            memberId: phoneOwnerMemberId,
            phoneLookupKey: ownedLivePhoneLookupKey,
            phoneNumberEncrypted: ownedLivePhoneNumber,
            phoneNumberVerifiedAt: new Date("2026-08-03T11:00:00.000Z"),
          },
        });
      }
      const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://join.example.test";
      clearHostedOnboardingEnvCache();
      const staleBearerIdentity = {
        email: {
          address: emailAddress,
          verifiedAt: 1_754_218_800,
        },
        phone: storedPhoneNumber
          ? {
              number: storedPhoneNumber,
              verifiedAt: 1_754_218_800,
            }
          : null,
        telegram: null,
        userId: replacementPrivyUserId,
      };
      const freshBearerIdentity = {
        ...staleBearerIdentity,
        phone: {
          number: ownedLivePhoneNumber,
          verifiedAt: 1_754_218_860,
        },
      };

      try {
        await expect(ensureHostedCompanionMemberId({
          identity: staleBearerIdentity,
          now: new Date("2026-08-03T12:00:00.000Z"),
          prisma: observer,
        })).rejects.toMatchObject({
          code: "HOSTED_CONSENT_REQUIRED",
          httpStatus: 403,
        });

        companionBoundaries.consentedMemberIds.add(memberId);
        await expect(ensureHostedCompanionMemberId({
          identity: freshBearerIdentity,
          now: new Date("2026-08-03T12:01:00.000Z"),
          prisma: observer,
        })).resolves.toBe(memberId);

        await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          phoneLookupKey: storedPhoneNumber
            ? createHostedPhoneLookupKey(storedPhoneNumber)
            : phoneOwnedByAnother
              ? null
              : ownedLivePhoneLookupKey,
          privyUserLookupKey: requirePrivyUserLookupKey(replacementPrivyUserId),
        });
        if (phoneOwnedByAnother) {
          await expect(observer.hostedMemberIdentity.findUniqueOrThrow({
            where: { memberId: phoneOwnerMemberId },
          })).resolves.toMatchObject({
            phoneLookupKey: ownedLivePhoneLookupKey,
          });
        }
        await expect(observer.hostedMemberRouting.findUniqueOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          telegramUserLookupKey: liveTelegramLookupKey,
        });
        await expect(observer.hostedInvite.count({
          where: { memberId },
        })).resolves.toBe(1);
      } finally {
        if (previousPublicBaseUrl === undefined) {
          delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
        } else {
          process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
        }
        clearHostedOnboardingEnvCache();
        companionBoundaries.consentedMemberIds.delete(memberId);
        privyProvider.emailByUserId.delete(replacementPrivyUserId);
        privyProvider.phoneByUserId.delete(replacementPrivyUserId);
        privyProvider.telegramByUserId.delete(replacementPrivyUserId);
        await observer.hostedMember.deleteMany({
          where: { id: { in: [memberId, phoneOwnerMemberId] } },
        });
        setHostedSecureBoxStringTestCodecForTests(null);
        await disconnectClients([observer]);
      }
    });
  },
);

function pauseBeforeAccountDeletionReceiptRead(input: {
  allowAuthenticationReceiptRead: Deferred<void>;
  authenticationReachedReceiptRead: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedAccountDeletionCleanup = new Proxy(
    input.tx.hostedAccountDeletionCleanup,
    {
      get(target, property) {
        if (property === "findFirst") {
          return async (
            args: Prisma.HostedAccountDeletionCleanupFindFirstArgs,
          ) => {
            input.authenticationReachedReceiptRead.resolve();
            await input.allowAuthenticationReceiptRead.promise;
            return target.findFirst(args);
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    },
  );

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedAccountDeletionCleanup") {
        return hostedAccountDeletionCleanup;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseBeforeHostedIdentityUpsert(input: {
  allowIdentityWrite: Deferred<void>;
  identityWriteReached: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedMemberIdentity = new Proxy(input.tx.hostedMemberIdentity, {
    get(target, property) {
      if (property === "upsert") {
        return async (args: Prisma.HostedMemberIdentityUpsertArgs) => {
          input.identityWriteReached.resolve();
          await input.allowIdentityWrite.promise;
          return target.upsert(args);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedMemberIdentity") {
        return hostedMemberIdentity;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seedVerifiedEmailRebindingMember(input: {
  emailAddress: string;
  memberId: string;
  oldPrivyUserId: string;
  phoneNumber?: string;
  prisma: PrismaClient;
}) {
  const verifiedEmailLookupKey = createHostedEmailLookupKey(input.emailAddress);
  if (!verifiedEmailLookupKey) {
    throw new Error("Expected a verified-email lookup key for the rebinding fixture.");
  }

  const member = await input.prisma.hostedMember.create({
    data: { id: input.memberId },
  });
  const phoneLookupKey = input.phoneNumber
    ? createHostedPhoneLookupKey(input.phoneNumber)
    : null;
  if (input.phoneNumber && !phoneLookupKey) {
    throw new Error("Expected a phone lookup key for the rebinding fixture.");
  }
  await input.prisma.hostedMemberIdentity.create({
    data: {
      memberId: input.memberId,
      ...(input.phoneNumber
        ? {
            phoneLookupKey,
            phoneNumberEncrypted: input.phoneNumber,
            phoneNumberVerifiedAt: new Date("2026-08-03T11:00:00.000Z"),
          }
        : {}),
      privyUserIdEncrypted: input.oldPrivyUserId,
      privyUserLookupKey: requirePrivyUserLookupKey(input.oldPrivyUserId),
    },
  });
  await input.prisma.hostedMemberEmailAuthorization.create({
    data: {
      memberId: input.memberId,
      verifiedEmailLookupKey,
      verifiedEmailVerifiedAt: new Date("2026-08-03T11:00:00.000Z"),
    },
  });
  return member;
}

function makeVerifiedEmailRebindingIdentity(input: {
  emailAddress: string;
  privyUserId: string;
}) {
  return {
    email: {
      address: input.emailAddress,
      verifiedAt: 1_754_218_800,
    },
    phone: null,
    telegram: null,
    userId: input.privyUserId,
  };
}

function requirePrivyUserLookupKey(privyUserId: string): string {
  const lookupKey = createHostedPrivyUserLookupKey(privyUserId);
  if (!lookupKey) {
    throw new Error("Expected a Privy-user lookup key for the rebinding fixture.");
  }
  return lookupKey;
}

function installPassthroughHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt: ({ value }) => value,
    encrypt: ({ value }) => value,
  });
}

function clearHostedOnboardingEnvCache(): void {
  Reflect.deleteProperty(globalThis, "__murphHostedOnboardingEnv");
}

async function waitForPostgresLock(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  const deadline = Date.now() + memberLockAcquisitionTimeoutMs;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >(Prisma.sql`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${input.pid}
    `);
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Expected the concurrent email writer to wait on the row lock.");
}

async function requireBillingSnapshot(
  prisma: PrismaClient,
  memberId: string,
) {
  const member = await readHostedMemberBillingSnapshot({
    memberId,
    prisma,
  });
  if (!member) {
    throw new Error("Expected the hosted billing fixture member.");
  }
  return member;
}

async function applyBillingReversal(input: {
  client: PrismaClient;
  eventCreatedAt: Date;
  member: Awaited<ReturnType<typeof requireBillingSnapshot>>;
  sourceEventId: string;
}): Promise<void> {
  await input.client.$transaction((tx) =>
    suspendHostedMemberForBillingReversalTx({
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: input.eventCreatedAt,
        sourceEventId: input.sourceEventId,
        sourceType: "stripe.charge.dispute.funds_withdrawn",
      },
      member: input.member,
      tx,
    }), { timeout: transactionTimeoutMs });
}

async function applyBillingRestore(input: {
  client: PrismaClient;
  eventCreatedAt: Date;
  member: Awaited<ReturnType<typeof requireBillingSnapshot>>;
  sourceEventId: string;
}): Promise<void> {
  await input.client.$transaction((tx) =>
    writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: input.eventCreatedAt,
        occurredAt: input.eventCreatedAt.toISOString(),
        sourceEventId: input.sourceEventId,
        sourceType: "stripe.charge.dispute.funds_reinstated",
      },
      member: input.member,
      suspendedAtOverride: null,
      tx,
  }), { timeout: transactionTimeoutMs });
}

async function applyOrdinaryBillingProgress(input: {
  client: PrismaClient;
  eventCreatedAt: Date;
  member: Awaited<ReturnType<typeof requireBillingSnapshot>>;
  sourceEventId: string;
}): Promise<void> {
  await input.client.$transaction((tx) =>
    writeHostedMemberStripeBillingTx({
      billingStatus: HostedBillingStatus.active,
      canonicalBillingStatus: HostedBillingStatus.active,
      dispatchContext: {
        eventCreatedAt: input.eventCreatedAt,
        occurredAt: input.eventCreatedAt.toISOString(),
        sourceEventId: input.sourceEventId,
        sourceType: "stripe.invoice.paid",
      },
      member: input.member,
      tx,
    }), { timeout: transactionTimeoutMs });
}

function encodeCleanupPayload(value: {
  privyUserId: string;
  runtimeMemberIds: string[];
  schema: "murph.hosted-account-deletion-cleanup.v1";
  stripeCustomerIds: string[];
}): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function makeActiveStripeSubscription(input: {
  customerId: string;
  memberId: string;
  subscriptionId: string;
}): Stripe.Subscription {
  // @ts-expect-error - the reconciliation fixture uses only the Stripe fields
  // read by production billing lookup and status policy.
  return {
    customer: input.customerId,
    id: input.subscriptionId,
    metadata: {
      memberId: input.memberId,
    },
    object: "subscription",
    status: "active",
  } as Stripe.Subscription;
}

function makeStripeCharge(input: {
  chargeId: string;
  customerId: string;
}): Stripe.Charge {
  return {
    customer: input.customerId,
    id: input.chargeId,
    object: "charge",
  } as Stripe.Charge;
}

function makeStripeEvent(input: {
  createdAt: Date;
  eventId: string;
  object: Stripe.Event.Data.Object;
  type: Stripe.Event.Type;
}): Stripe.Event {
  return {
    api_version: "2025-02-24.acacia",
    created: Math.floor(input.createdAt.getTime() / 1_000),
    data: {
      object: input.object,
    },
    id: input.eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: input.type,
  } as Stripe.Event;
}

async function disconnectClients(clients: PrismaClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.$disconnect()));
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
