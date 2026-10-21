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


  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,

} from "@/src/lib/hosted-onboarding/contact-privacy";
import { upgradeHostedBillingPlan } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
import { scheduleHostedBillingPlanSwitch } from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";


import {
  createHostedFamilyBillingCheckout,
  HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY,
  issueHostedFamilyInvite,
  updateHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  acceptHostedMemberStripeCheckoutCompletionTx,
  assertNoHostedDirectSubscriptionStripeEffectTx,
  HostedMemberStripeMutationLockBusyError,
  prepareHostedMemberStripeCheckoutSession,
  prepareHostedMemberStripeCheckoutCompletion,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { ensureHostedMemberStripeCustomer } from "@/src/lib/hosted-onboarding/hosted-member-stripe-customer";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {

  readHostedMemberBillingSnapshot,

} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  ensureHostedMemberForPendingLinqParticipantContactTx,


} from "@/src/lib/hosted-onboarding/member-identity-service";

import {
  acquireHostedLinqParticipantEmailLockTx,
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { removeHostedMemberLinkedAccountProjectionTx } from "@/src/lib/hosted-onboarding/linked-account-removal";
import {
  suspendHostedMemberForBillingReversalTx,
  writeHostedMemberStripeBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  reconcileHostedStripeEventById,
  recordHostedStripeEvent,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";

import { deleteHostedAccountData } from "@/src/lib/hosted-privacy/account-data-service";
import { createPrismaClient } from "@/src/lib/prisma";


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
  checkoutSessionsCreate: vi.fn(),
  customersCreate: vi.fn(),
  customersDelete: vi.fn(),
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
    configured: true,
    errorCode: null,
    notFound: true,
    terminated: true,
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


vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/runtime")
  >("@/src/lib/hosted-onboarding/runtime");
  const stripe = {
    charges: {
      retrieve: stripeProvider.chargesRetrieve,
    },
    checkout: {
      sessions: {
        create: stripeProvider.checkoutSessionsCreate,
      },
    },
    customers: {
      create: stripeProvider.customersCreate,
      del: stripeProvider.customersDelete,
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
    getHostedOnboardingStripe: () => stripe,
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
    requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
    requireHostedStripeCheckoutConfig: () => ({
      billingPlanCode: "launch_monthly",
      priceId: "price_launch_monthly",
      stripe,
      stripeLiveMode: false,
    }),
  };
});

vi.mock("@/src/lib/hosted-crypto/env", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { createHostedAuthorityVerifyKeyring } = await vi.importActual<
    typeof import("@murphai/runtime-state")
  >("@murphai/runtime-state");
  const { createHostedGcpKmsClientFromEnv } = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >("@/src/lib/hosted-crypto/gcp-kms");
  const authoritySignKeyVersionName =
    "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1";
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const gcpKms = createHostedGcpKmsClientFromEnv({
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    NODE_ENV: "test",
  });

  return {
    getHostedWebCryptoConfig: () => ({
      authoritySignKeyVersionName,
      authoritySignPublicKeyPem: authorityKey.publicKey,
      authorityVerifyKeyring: createHostedAuthorityVerifyKeyring({
        activeKeyVersionName: authoritySignKeyVersionName,
        activePublicKeyPem: authorityKey.publicKey,
      }),
      env: "test",
      gcpKms,
      webWrapKmsKeyName:
        "projects/example/locations/global/keyRings/hosted/cryptoKeys/delete-race",
    }),
  };
});

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

function pauseAfterNextInteractiveTransaction(input: {
  committed: Deferred<void>;
  prisma: PrismaClient;
  release: Deferred<void>;
}): PrismaClient {
  let paused = false;
  return new Proxy(input.prisma, {
    get(target, property) {
      if (property !== "$transaction") {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: {
          isolationLevel?: Prisma.TransactionIsolationLevel;
          maxWait?: number;
          timeout?: number;
        },
      ) => {
        const result = await target.$transaction(run, options);
        if (!paused) {
          paused = true;
          input.committed.resolve();
          await input.release.promise;
        }
        return result;
      };
    },
  });
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

    it("lets account deletion reconcile an abandoned Customer claim before cleanup", async () => {
      const deletion = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_customer_deletion_${fixtureId}`;
      const customerId = `cus_customer_deletion_${fixtureId}`;
      installPassthroughHostedSecureBoxTestCodec();
      stripeProvider.customersCreate.mockClear();
      stripeProvider.customersDelete.mockClear();
      stripeProvider.customersDelete.mockResolvedValue({ deleted: true, id: customerId });

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });

        stripeProvider.customersCreate.mockRejectedValueOnce(
          Object.assign(new Error("connection closed after provider commit"), {
            code: "ECONNRESET",
          }),
        );
        await expect(ensureHostedMemberStripeCustomer({
          memberId,
          prisma: writer,
        })).rejects.toMatchObject({ code: "ECONNRESET" });
        await expect(observer.hostedMemberBillingRef.findUnique({
          select: {
            stripeCustomerLookupKey: true,
            stripeEffectClaimId: true,
            stripeEffectKind: true,
          },
          where: { memberId },
        })).resolves.toMatchObject({
          stripeCustomerLookupKey: null,
          stripeEffectClaimId: expect.any(String),
          stripeEffectKind: "member.customer-create",
        });

        stripeProvider.customersCreate.mockRejectedValueOnce(
          Object.assign(new Error("stripe unavailable"), { code: "ETIMEDOUT" }),
        );
        await expect(deleteHostedAccountData({
          memberId,
          prisma: deletion,
          request: new Request("https://app.example.test/settings"),
        })).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        await expect(observer.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: memberId },
        })).resolves.toEqual({ suspendedAt: null });
        await expect(observer.hostedMemberBillingRef.findUnique({
          select: {
            stripeCustomerLookupKey: true,
            stripeEffectClaimId: true,
            stripeEffectKind: true,
          },
          where: { memberId },
        })).resolves.toMatchObject({
          stripeCustomerLookupKey: null,
          stripeEffectClaimId: expect.any(String),
          stripeEffectKind: "member.customer-create",
        });

        stripeProvider.customersCreate.mockResolvedValueOnce({ id: customerId });
        await expect(deleteHostedAccountData({
          memberId,
          prisma: deletion,
          request: new Request("https://app.example.test/settings"),
        })).resolves.toMatchObject({
          cleanupPending: false,
          memberId,
        });
        await expect(observer.hostedMember.findUnique({
          where: { id: memberId },
        })).resolves.toBeNull();
        expect(stripeProvider.customersDelete).toHaveBeenCalledWith(
          customerId,
          {},
          expect.objectContaining({
            maxNetworkRetries: 0,
          }),
        );

        expect(stripeProvider.customersCreate).toHaveBeenCalledTimes(3);
        expect(stripeProvider.customersCreate.mock.calls.map(
          (call: readonly unknown[]) => call[1],
        )).toEqual(Array.from({ length: 3 }, () => ({
          idempotencyKey: `hosted-auto-pulse-trial-customer:${memberId}`,
          maxNetworkRetries: 0,
          timeout: 5_000,
        })));
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        stripeProvider.customersCreate.mockReset();
        stripeProvider.customersDelete.mockReset();
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await disconnectClients([deletion, observer, writer]);
      }
    });

    it.each(["completion-first", "customer-first"] as const)(
      "serializes a bound Checkout Session with Customer creation ($order)",
      async (order) => {
        const checkout = createPrismaClient({ databaseUrl, poolMax: 1 });
        const customer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const fixtureId = randomUUID();
        const memberId = `hbm_customer_checkout_${order}_${fixtureId}`;
        const checkoutCustomerId = `cus_checkout_${fixtureId}`;
        const checkoutSubscriptionId = `sub_checkout_${fixtureId}`;
        const checkoutAttemptId = `attempt_checkout_${fixtureId}`;
        const checkoutIntentHash = `intent_checkout_${fixtureId}`;
        const checkoutSessionId = `cs_checkout_${fixtureId}`;
        const checkoutLocked = createDeferred();
        const releaseCheckout = createDeferred();
        let checkoutPromise: Promise<unknown> | null = null;
        let customerPromise: Promise<string> | null = null;
        installPassthroughHostedSecureBoxTestCodec();
        stripeProvider.customersCreate.mockClear();

        try {
          await observer.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.active,
              id: memberId,
            },
          });
          const preparedSession =
            await prepareHostedMemberStripeCheckoutSession({
              memberId,
              prisma: observer,
              sessionId: checkoutSessionId,
            });
          await observer.hostedMemberBillingRef.create({
            data: {
              checkoutAttemptId,
              checkoutCreatedAt: new Date("2026-08-27T12:00:00.000Z"),
              checkoutIntentHash,
              memberId,
              ...preparedSession,
            },
          });
          const preparedCompletion =
            await prepareHostedMemberStripeCheckoutCompletion({
              memberId,
              prisma: observer,
              stripeCustomerId: checkoutCustomerId,
              stripeSubscriptionId: checkoutSubscriptionId,
            });
          const acceptCheckout = (prisma: PrismaClient) =>
            prisma.$transaction(
              (tx) => acceptHostedMemberStripeCheckoutCompletionTx({
                billingIdentityDisposition: "bind",
                checkoutAttemptId,
                checkoutIntentHash,
                checkoutSessionId,
                currentCheckoutOffer: "standard",
                eventCreatedAt: new Date("2026-08-27T12:01:00.000Z"),
                memberId,
                preparedCompletion,
                tx,
              }),
              { timeout: transactionTimeoutMs },
            );

          if (order === "completion-first") {
            const [customerBackend] = await customer.$queryRaw<
              Array<{ pid: number }>
            >(Prisma.sql`SELECT pg_backend_pid()::int AS pid`);
            if (!customerBackend) {
              throw new Error("Expected the Customer writer PostgreSQL backend id.");
            }
            checkoutPromise = checkout.$transaction(async (tx) => {
              await lockHostedMemberRow(tx, memberId);
              checkoutLocked.resolve();
              await releaseCheckout.promise;
              return acceptHostedMemberStripeCheckoutCompletionTx({
                billingIdentityDisposition: "bind",
                checkoutAttemptId,
                checkoutIntentHash,
                checkoutSessionId,
                currentCheckoutOffer: "standard",
                eventCreatedAt: new Date("2026-08-27T12:01:00.000Z"),
                memberId,
                preparedCompletion,
                tx,
              });
            }, { timeout: transactionTimeoutMs });
            await checkoutLocked.promise;
            customerPromise = ensureHostedMemberStripeCustomer({
              memberId,
              prisma: customer,
            });
            await waitForPostgresLock({
              observer,
              pid: customerBackend.pid,
            });
            releaseCheckout.resolve();

            await expect(checkoutPromise).resolves.toEqual({ kind: "accepted" });
            await expect(customerPromise).resolves.toBe(checkoutCustomerId);
            expect(stripeProvider.customersCreate).not.toHaveBeenCalled();
          } else {
            await expect(ensureHostedMemberStripeCustomer({
              memberId,
              prisma: customer,
            })).rejects.toMatchObject({
              code: "HOSTED_STRIPE_EFFECT_PENDING",
              retryable: true,
            });
            await expect(acceptCheckout(checkout)).resolves.toEqual({
              kind: "accepted",
            });
            expect(stripeProvider.customersCreate).not.toHaveBeenCalled();
          }

          await expect(observer.hostedMemberBillingRef.findUnique({
            select: {
              stripeCustomerLookupKey: true,
              stripeEffectClaimId: true,
              stripeEffectKind: true,
            },
            where: { memberId },
          })).resolves.toEqual({
            stripeCustomerLookupKey: createHostedStripeCustomerLookupKey(
              checkoutCustomerId,
            ),
            stripeEffectClaimId: null,
            stripeEffectKind: null,
          });
        } finally {
          releaseCheckout.resolve();
          await Promise.allSettled([
            ...(checkoutPromise ? [checkoutPromise] : []),
            ...(customerPromise ? [customerPromise] : []),
          ]);
          setHostedSecureBoxStringTestCodecForTests(null);
          stripeProvider.customersCreate.mockReset();
          await observer.hostedMember.deleteMany({ where: { id: memberId } });
          await disconnectClients([checkout, customer, observer]);
        }
      },
    );

    it("blocks direct Checkout when a compatibility claim commits after reservation", async () => {
      const claimant = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_checkout_late_claim_${fixtureId}`;
      const inviteCode = `invite-checkout-late-claim-${fixtureId}`;
      const reservationCommitted = createDeferred();
      const releaseCheckout = createDeferred();
      const controlledWriter = pauseAfterNextInteractiveTransaction({
        committed: reservationCommitted,
        prisma: writer,
        release: releaseCheckout,
      });
      const now = new Date("2026-08-12T12:00:00.000Z");
      let checkoutPromise: Promise<unknown> | null = null;
      installPassthroughHostedSecureBoxTestCodec();
      stripeProvider.checkoutSessionsCreate.mockClear();
      stripeProvider.checkoutSessionsCreate.mockImplementation(async (
        params: Stripe.Checkout.SessionCreateParams,
      ) => ({
        client_reference_id: params.client_reference_id,
        customer: params.customer ?? null,
        id: "cs_test_directLateClaim123",
        metadata: params.metadata ?? {},
        mode: "subscription",
        status: "open",
        subscription: null,
        url: "https://checkout.stripe.com/c/pay/cs_test_directLateClaim123",
      }));

      try {
        await claimant.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.not_started,
            id: memberId,
          },
        });
        await claimant.hostedMemberIdentity.create({
          data: {
            memberId,
            phoneLookupKey: `phone:${fixtureId}`,
          },
        });
        await claimant.hostedInvite.create({
          data: {
            expiresAt: new Date("2026-08-13T12:00:00.000Z"),
            id: `hi_checkout_late_claim_${fixtureId}`,
            inviteCode,
            memberId,
          },
        });

        checkoutPromise = createHostedBillingCheckout({
          inviteCode,
          member: { id: memberId, suspendedAt: null },
          now,
          prisma: controlledWriter,
        });
        await reservationCommitted.promise;
        await expect(claimant.hostedMemberBillingRef.findUnique({
          select: { checkoutAttemptId: true },
          where: { memberId },
        })).resolves.toEqual({
          checkoutAttemptId: expect.any(String),
        });

        await claimant.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "hosted_member"
            WHERE "id" = ${memberId}
            FOR UPDATE
          `;
          await tx.hostedMemberBillingRef.update({
            data: {
              stripeEffectClaimedAt: now,
              stripeEffectClaimId: `member-checkout:${fixtureId}`,
              stripeEffectKind: "member.subscription-create",
            },
            where: { memberId },
          });
        });
        releaseCheckout.resolve();

        await expect(checkoutPromise).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        expect(stripeProvider.checkoutSessionsCreate).not.toHaveBeenCalled();
        await expect(claimant.hostedMemberBillingRef.findUnique({
          select: { checkoutAttemptId: true },
          where: { memberId },
        })).resolves.toEqual({ checkoutAttemptId: null });

        await claimant.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "hosted_member"
            WHERE "id" = ${memberId}
            FOR UPDATE
          `;
          await tx.hostedMemberBillingRef.update({
            data: {
              stripeEffectClaimedAt: null,
              stripeEffectClaimId: null,
              stripeEffectKind: null,
            },
            where: { memberId },
          });
        });
        await expect(createHostedBillingCheckout({
          inviteCode,
          member: { id: memberId, suspendedAt: null },
          now,
          prisma: writer,
        })).resolves.toEqual({
          alreadyActive: false,
          url: "https://checkout.stripe.com/c/pay/cs_test_directLateClaim123",
        });
        expect(stripeProvider.checkoutSessionsCreate).toHaveBeenCalledOnce();
      } finally {
        releaseCheckout.resolve();
        await Promise.allSettled(checkoutPromise ? [checkoutPromise] : []);
        setHostedSecureBoxStringTestCodecForTests(null);
        await claimant.hostedMember.deleteMany({ where: { id: memberId } });
        await disconnectClients([claimant, writer]);
      }
    });

    it.each([
      { claimOwner: "Family group" as const },
      { claimOwner: "owner member" as const },
    ])("blocks Family Checkout when a $claimOwner claim commits after reservation", async ({
      claimOwner,
    }) => {
      const claimant = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_family_checkout_late_claim_${fixtureId}`;
      const groupId = `hbag_family_checkout_late_claim_${fixtureId}`;
      const reservationCommitted = createDeferred();
      const releaseCheckout = createDeferred();
      const controlledWriter = pauseAfterNextInteractiveTransaction({
        committed: reservationCommitted,
        prisma: writer,
        release: releaseCheckout,
      });
      const now = new Date("2026-08-12T12:00:00.000Z");
      const previousFamilyPriceId =
        process.env[HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY];
      let checkoutPromise: Promise<unknown> | null = null;
      process.env[HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY] =
        "price_family_late_claim";
      installPassthroughHostedSecureBoxTestCodec();
      stripeProvider.checkoutSessionsCreate.mockClear();
      stripeProvider.checkoutSessionsCreate.mockImplementation(async (
        params: Stripe.Checkout.SessionCreateParams,
      ) => ({
        client_reference_id: params.client_reference_id,
        customer: params.customer ?? null,
        id: "cs_test_familyLateClaim123",
        metadata: params.metadata ?? {},
        mode: "subscription",
        status: "open",
        subscription: null,
        url: "https://checkout.stripe.com/c/pay/cs_test_familyLateClaim123",
      }));

      try {
        await claimant.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.not_started,
            id: memberId,
          },
        });
        await claimant.hostedAccountGroup.create({
          data: {
            billingStatus: HostedBillingStatus.not_started,
            id: groupId,
            ownerMemberId: memberId,
          },
        });
        await claimant.hostedAccountGroupMembership.create({
          data: {
            groupId,
            id: `hbagm_family_checkout_late_claim_${fixtureId}`,
            memberId,
            planCode: "pulse",
            role: "owner",
            status: "active",
          },
        });

        checkoutPromise = createHostedFamilyBillingCheckout({
          groupId,
          now,
          ownerMemberId: memberId,
          prisma: controlledWriter,
          seatCount: 2,
        });
        await reservationCommitted.promise;
        await expect(claimant.hostedAccountGroupBillingRef.findUnique({
          select: { checkoutAttemptId: true },
          where: { groupId },
        })).resolves.toEqual({
          checkoutAttemptId: expect.any(String),
        });

        await claimant.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "hosted_member"
            WHERE "id" = ${memberId}
            FOR UPDATE
          `;
          if (claimOwner === "Family group") {
            await tx.hostedAccountGroupBillingRef.update({
              data: {
                stripeEffectClaimedAt: now,
                stripeEffectClaimId: `family-checkout:${fixtureId}`,
                stripeEffectKind: "family.subscription-create",
              },
              where: { groupId },
            });
          } else {
            await tx.hostedMemberBillingRef.upsert({
              create: {
                memberId,
                stripeEffectClaimedAt: now,
                stripeEffectClaimId: `member-family-checkout:${fixtureId}`,
                stripeEffectKind: "member.subscription-create",
              },
              update: {
                stripeEffectClaimedAt: now,
                stripeEffectClaimId: `member-family-checkout:${fixtureId}`,
                stripeEffectKind: "member.subscription-create",
              },
              where: { memberId },
            });
          }
        });
        releaseCheckout.resolve();

        await expect(checkoutPromise).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        expect(stripeProvider.checkoutSessionsCreate).not.toHaveBeenCalled();

        await claimant.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "hosted_member"
            WHERE "id" = ${memberId}
            FOR UPDATE
          `;
          if (claimOwner === "Family group") {
            await tx.hostedAccountGroupBillingRef.update({
              data: {
                stripeEffectClaimedAt: null,
                stripeEffectClaimId: null,
                stripeEffectKind: null,
              },
              where: { groupId },
            });
          } else {
            await tx.hostedMemberBillingRef.update({
              data: {
                stripeEffectClaimedAt: null,
                stripeEffectClaimId: null,
                stripeEffectKind: null,
              },
              where: { memberId },
            });
          }
        });
        await expect(createHostedFamilyBillingCheckout({
          groupId,
          now,
          ownerMemberId: memberId,
          prisma: writer,
          seatCount: 2,
        })).resolves.toMatchObject({
          alreadyActive: false,
          url: expect.any(String),
        });
        expect(stripeProvider.checkoutSessionsCreate).toHaveBeenCalledOnce();
      } finally {
        releaseCheckout.resolve();
        await Promise.allSettled(checkoutPromise ? [checkoutPromise] : []);
        if (previousFamilyPriceId === undefined) {
          delete process.env[HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY];
        } else {
          process.env[HOSTED_FAMILY_STRIPE_PRICE_ID_ENV_KEY] =
            previousFamilyPriceId;
        }
        setHostedSecureBoxStringTestCodecForTests(null);
        await claimant.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await claimant.hostedMember.deleteMany({ where: { id: memberId } });
        await disconnectClients([claimant, writer]);
      }
    });

    it.each([
      { kind: "direct-customer" as const },
      { kind: "direct-checkout" as const },
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
      stripeProvider.checkoutSessionsCreate.mockClear();
      stripeProvider.subscriptionsRetrieve.mockClear();

      await observer.hostedMember.create({
        data: {
          billingStatus: kind === "direct-checkout"
            ? HostedBillingStatus.not_started
            : HostedBillingStatus.active,
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
          billingStatus: kind === "direct-checkout"
            ? HostedBillingStatus.not_started
            : HostedBillingStatus.active,
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
          status: kind === "account-deletion-claim-beneficiary"
              || kind === "direct-checkout"
            ? "removed"
            : "active",
        },
      });
      if (kind === "direct-checkout") {
        await observer.hostedAccountGroupMembership.create({
          data: {
            groupId,
            id: `hbagm_compatibility_owner_${fixtureId}`,
            memberId,
            planCode: "pulse",
            role: "owner",
            status: "active",
          },
        });
        await observer.hostedMemberIdentity.create({
          data: {
            memberId,
            phoneLookupKey: `phone:${fixtureId}`,
          },
        });
        await observer.hostedInvite.create({
          data: {
            expiresAt: new Date("2026-08-13T12:00:00.000Z"),
            id: `hi_compatibility_${fixtureId}`,
            inviteCode: `invite-compatibility-${fixtureId}`,
            memberId,
          },
        });
      }
      if (kind === "account-deletion-claim-beneficiary") {
        await observer.hostedAccountGroupBillingRef.create({
          data: {
            groupId,
            stripeEffectBeneficiaryMemberId: beneficiaryMemberId,
          },
        });
      }
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
          WHERE "id" = ${memberId}
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
        } else if (kind === "account-deletion-claim-beneficiary") {
          await tx.hostedAccountGroupBillingRef.update({
            data: {
              stripeEffectClaimedAt: new Date("2026-08-12T12:00:00.000Z"),
              stripeEffectClaimId: `family-capacity:${fixtureId}`,
              stripeEffectKind: "family.capacity",
            },
            where: { groupId },
          });
        } else {
          await tx.hostedAccountGroupBillingRef.create({
            data: {
              groupId,
              stripeEffectClaimedAt: new Date("2026-08-12T12:00:00.000Z"),
              stripeEffectClaimId: `family-capacity:${fixtureId}`,
              stripeEffectBeneficiaryMemberId: null,
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
          : kind === "direct-checkout"
            ? createHostedBillingCheckout({
                inviteCode: `invite-compatibility-${fixtureId}`,
                member: { id: memberId, suspendedAt: null },
                now: new Date("2026-08-12T12:01:00.000Z"),
                prisma: writer,
              })
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
        expect(stripeProvider.checkoutSessionsCreate).not.toHaveBeenCalled();
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

    it("blocks direct upgrade and scheduling on an exact owner-group claim until terminal removal", async () => {
      const client = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_direct_effect_${fixtureId}`;
      const groupId = `hbag_direct_effect_${fixtureId}`;
      const stripeCustomerId = `cus_direct_effect_${fixtureId}`;
      const stripeSubscriptionId = `sub_direct_effect_${fixtureId}`;
      stripeProvider.subscriptionsRetrieve.mockClear();
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt(input) {
          return input.value;
        },
      });

      try {
        await client.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        await client.hostedMemberBillingRef.create({
          data: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_edge_monthly",
            currentCheckoutOffer: "standard",
            memberId,
            stripeCustomerIdEncrypted: stripeCustomerId,
            stripeCustomerLookupKey:
              createHostedStripeCustomerLookupKey(stripeCustomerId),
            stripeSubscriptionIdEncrypted: stripeSubscriptionId,
            stripeSubscriptionLookupKey:
              createHostedStripeSubscriptionLookupKey(stripeSubscriptionId),
          },
        });
        await client.hostedAccountGroup.create({
          data: {
            billingStatus: HostedBillingStatus.not_started,
            id: groupId,
            ownerMemberId: memberId,
          },
        });
        await client.hostedAccountGroupBillingRef.create({
          data: {
            groupId,
            stripeEffectClaimedAt: new Date("2026-08-12T12:00:00.000Z"),
            stripeEffectClaimId: `direct-to-family:${fixtureId}`,
            stripeEffectDirectSubscriptionLookupKey:
              createHostedStripeSubscriptionLookupKey(stripeSubscriptionId),
            stripeEffectKind: "family.direct-conversion",
          },
        });

        await expect(upgradeHostedBillingPlan({
          memberId,
          prisma: client,
          targetPlanCode: "launch_max_monthly",
        })).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        await expect(scheduleHostedBillingPlanSwitch({
          memberId,
          now: new Date("2026-08-12T12:05:00.000Z"),
          prisma: client,
          targetPlanCode: "launch_monthly",
        })).rejects.toMatchObject({
          code: "HOSTED_STRIPE_EFFECT_PENDING",
          retryable: true,
        });
        expect(stripeProvider.subscriptionsRetrieve).not.toHaveBeenCalled();

        await client.hostedAccountGroupBillingRef.update({
          data: {
            stripeEffectClaimId: null,
          },
          where: { groupId },
        });
        await expect(client.$transaction((tx) =>
          assertNoHostedDirectSubscriptionStripeEffectTx({
            memberId,
            stripeSubscriptionId,
            tx,
          })
        )).resolves.toBeUndefined();
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await client.hostedAccountGroup.deleteMany({ where: { id: groupId } });
        await client.hostedMember.deleteMany({ where: { id: memberId } });
        await disconnectClients([client]);
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

    it("retries the same payment-failure receipt after a Family effect claim clears", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const reconciliationClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const memberId = `hbm_claimed_invoice_failure_${fixtureId}`;
      const groupId = `hbag_claimed_invoice_failure_${fixtureId}`;
      const customerId = `cus_${fixtureId}`;
      const subscriptionId = `sub_${fixtureId}`;
      const event = makeStripeEvent({
        createdAt: new Date("2026-08-15T08:00:00.000Z"),
        eventId: `evt_invoice_failure_${fixtureId}`,
        object: makeStripeInvoicePaymentFailed({
          customerId,
          invoiceId: `in_${fixtureId}`,
          subscriptionId,
        }),
        type: "invoice.payment_failed",
      });
      const subscription = {
        ...makeActiveStripeSubscription({
          customerId,
          memberId,
          subscriptionId,
        }),
        status: "past_due",
      } as Stripe.Subscription;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      await observer.hostedAccountGroup.create({
        data: {
          billingStatus: HostedBillingStatus.not_started,
          id: groupId,
          ownerMemberId: memberId,
        },
      });
      await observer.hostedAccountGroupMembership.create({
        data: {
          groupId,
          id: `hbagm_claimed_invoice_failure_${fixtureId}`,
          memberId,
          planCode: "pulse",
          role: "owner",
          status: "active",
        },
      });
      await observer.hostedAccountGroupBillingRef.create({
        data: {
          groupId,
          stripeEffectClaimId: `effect_${fixtureId}`,
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
      stripeProvider.eventsRetrieve.mockResolvedValue(event);
      stripeProvider.subscriptionsRetrieve.mockResolvedValue(subscription);

      try {
        const initialMember = await requireBillingSnapshot(observer, memberId);
        await observer.$transaction((tx) =>
          writeHostedMemberStripeBillingTx({
            billingStatus: HostedBillingStatus.active,
            canonicalBillingStatus: HostedBillingStatus.active,
            dispatchContext: {
              eventCreatedAt: new Date("2026-08-15T07:59:00.000Z"),
              occurredAt: "2026-08-15T07:59:00.000Z",
              sourceEventId: `evt_binding_${fixtureId}`,
              sourceType: "stripe.customer.subscription.updated",
            },
            member: initialMember,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            tx,
          }),
          { timeout: transactionTimeoutMs },
        );
        await recordHostedStripeEvent({ event, prisma: observer });
        await observer.hostedStripeEvent.update({
          data: { attemptCount: 5 },
          where: { eventId: event.id },
        });

        await expect(reconcileHostedStripeEventById({
          eventId: event.id,
          prisma: reconciliationClient,
        })).resolves.toMatchObject({ status: "failed" });
        await expect(observer.hostedStripeEvent.findUnique({
          where: { eventId: event.id },
        })).resolves.toMatchObject({
          attemptCount: 6,
          lastErrorCode: "HOSTED_STRIPE_EFFECT_PENDING",
          processedAt: null,
          status: HostedStripeEventStatus.failed,
        });
        await expect(observer.hostedMember.findUnique({
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingStatus: HostedBillingStatus.active,
        });

        await observer.hostedAccountGroupBillingRef.update({
          data: { stripeEffectClaimId: null },
          where: { groupId },
        });
        await observer.hostedStripeEvent.update({
          data: { nextAttemptAt: new Date(0) },
          where: { eventId: event.id },
        });

        await expect(reconcileHostedStripeEventById({
          eventId: event.id,
          prisma: reconciliationClient,
        })).resolves.toMatchObject({ status: "completed" });
        await expect(observer.hostedStripeEvent.findUnique({
          where: { eventId: event.id },
        })).resolves.toMatchObject({
          attemptCount: 7,
          processedAt: expect.any(Date),
          status: HostedStripeEventStatus.completed,
        });
        await expect(observer.hostedMember.findUnique({
          where: { id: memberId },
        })).resolves.toMatchObject({
          billingStatus: HostedBillingStatus.past_due,
        });
      } finally {
        errorSpy.mockRestore();
        setHostedSecureBoxStringTestCodecForTests(null);
        stripeProvider.eventsRetrieve.mockReset();
        stripeProvider.subscriptionsRetrieve.mockReset();
        await observer.hostedStripeEvent.deleteMany({
          where: { eventId: event.id },
        });
        await observer.hostedAccountGroup.deleteMany({
          where: { id: groupId },
        });
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, reconciliationClient]);
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
  "hosted Linq email-handle identity PostgreSQL concurrency",
  () => {
    it("serializes a new inbound behind unlink without restoring the revoked member", async () => {
      const first = createPrismaClient({ databaseUrl, poolMax: 1 });
      const second = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contact = createHostedLinqParticipantContact({
        kind: "email", value: `unlink-${randomUUID()}@example.test`,
      });
      if (!contact) throw new Error("Expected synthetic email contact.");
      const memberIds: string[] = [];
      setHostedSecureBoxStringTestCodecForTests({
        decrypt: ({ value }) => value, encrypt: ({ value }) => value,
      });
      try {
        const original = await first.$transaction((tx) => ensureHostedMemberForPendingLinqParticipantContactTx({
          contact, observedAt: new Date(), prisma: tx,
        }), { timeout: transactionTimeoutMs });
        memberIds.push(original.member.id);
        const locked = createDeferred<void>();
        const inboundStarted = createDeferred<void>();
        const [removed, incoming] = await Promise.all([
          first.$transaction(async (tx) => {
            await acquireHostedLinqParticipantEmailLockTx({ emailAddress: contact.value, tx });
            locked.resolve();
            await inboundStarted.promise;
            return removeHostedMemberLinkedAccountProjectionTx({
              expectedIdentity: contact.value, memberId: original.member.id, method: "email", prisma: tx,
            });
          }, { timeout: transactionTimeoutMs }),
          (async () => {
            await locked.promise;
            return second.$transaction((tx) => {
              inboundStarted.resolve();
              return ensureHostedMemberForPendingLinqParticipantContactTx({
                contact, observedAt: new Date(), prisma: tx,
              });
            }, { timeout: transactionTimeoutMs });
          })(),
        ]);
        memberIds.push(incoming.member.id);
        expect(removed).toBe(true);
        expect(incoming.created).toBe(true);
        expect(incoming.member.id).not.toBe(original.member.id);
        await expect(first.hostedMemberIdentity.findUnique({ where: { memberId: original.member.id } }))
          .resolves.toMatchObject({ linqEmailHandleLookupKey: null, linqEmailHandleEncrypted: null });
        await expect(first.hostedMemberIdentity.count({ where: { linqEmailHandleLookupKey: contact.lookupKey } }))
          .resolves.toBe(1);
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await first.hostedMember.deleteMany({ where: { id: { in: memberIds } } });
        await disconnectClients([first, second]);
      }
    });

    it("selects one member and one instant-start creation winner", async () => {
      const first = createPrismaClient({ databaseUrl, poolMax: 1 });
      const second = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const contact = createHostedLinqParticipantContact({
        kind: "email",
        value: `instant-${randomUUID()}@example.com`,
      });
      if (!contact) {
        throw new Error("Expected a valid Linq email contact.");
      }
      setHostedSecureBoxStringTestCodecForTests({
        decrypt: ({ value }) => value,
        encrypt: ({ value }) => value,
      });

      try {
        const [firstResolution, secondResolution] = await Promise.all([
          first.$transaction((tx) =>
            ensureHostedMemberForPendingLinqParticipantContactTx({
              contact,
              observedAt: new Date("2026-09-04T20:46:00.000Z"),
              prisma: tx,
            }), { timeout: transactionTimeoutMs }),
          second.$transaction((tx) =>
            ensureHostedMemberForPendingLinqParticipantContactTx({
              contact,
              observedAt: new Date("2026-09-04T20:46:00.000Z"),
              prisma: tx,
            }), { timeout: transactionTimeoutMs }),
        ]);

        expect(firstResolution.member.id).toBe(secondResolution.member.id);
        expect([
          firstResolution.created,
          secondResolution.created,
        ].sort()).toEqual([false, true]);
        await expect(observer.hostedMemberIdentity.count({
          where: { linqEmailHandleLookupKey: contact.lookupKey },
        })).resolves.toBe(1);
        await expect(observer.hostedMemberRouting.count({
          where: { pendingLinqParticipantContactLookupKey: contact.lookupKey },
        })).resolves.toBe(1);
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMember.deleteMany({
          where: {
            identity: {
              linqEmailHandleLookupKey: contact.lookupKey,
            },
          },
        });
        await disconnectClients([first, second, observer]);
      }
    });
  },
);

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted canonical account-deletion PostgreSQL concurrency",
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


  },
);


function installPassthroughHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt: ({ value }) => value,
    encrypt: ({ value }) => value,
  });
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

function makeStripeInvoicePaymentFailed(input: {
  customerId: string;
  invoiceId: string;
  subscriptionId: string;
}): Stripe.Invoice {
  // @ts-expect-error - the reconciliation fixture uses only the Stripe fields
  // read by production invoice lookup and billing policy.
  return {
    customer: input.customerId,
    id: input.invoiceId,
    object: "invoice",
    subscription: input.subscriptionId,
  } as Stripe.Invoice;
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
