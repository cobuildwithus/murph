import { randomUUID } from "node:crypto";

import {
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  grantHostedUsageCreditForPurchaseTx,
  lockHostedUsageCreditBeneficiaryTx,
  readHostedUsageCreditProjection,
  settleHostedUsageCreditForUsageTx,
} from "@/src/lib/hosted-execution/usage-credits";
import {
  handleHostedUsageReferralGroupTool,
  HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS,
  HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
  reconcileHostedUsageReferralRewardAfterCommit,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedUsageCreditPurchasesReadyForAccountDeletionTx } from "@/src/lib/hosted-onboarding/usage-credit-purchase-account-deletion";
import { bindHostedUsageCreditStripeReferencesTx } from "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation-context";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof &&
  (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The usage-credit PostgreSQL concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type UsageCreditFixture = {
  beneficiaryMemberId: string;
  firstClient: PrismaClient;
  observer: PrismaClient;
  payerMemberId: string;
  purchaseId: string;
  secondClient: PrismaClient;
  thirdClient: PrismaClient;
};

const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createUsageCreditFixture(input: {
  terminalCrossOwner?: boolean;
} = {}): Promise<UsageCreditFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const beneficiaryMemberId = `member_usage_credit_lock_${fixtureId}`;
  const payerMemberId = input.terminalCrossOwner
    ? `member_usage_credit_payer_${fixtureId}`
    : beneficiaryMemberId;
  const purchaseId = `hucp_usage_credit_lock_${fixtureId}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const thirdClient = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.create({
    data: {
      billingStatus: "active",
      id: beneficiaryMemberId,
    },
  });
  if (payerMemberId !== beneficiaryMemberId) {
    await observer.hostedMember.create({
      data: {
        billingStatus: "active",
        id: payerMemberId,
      },
    });
  }
  await observer.hostedUsageCreditPurchase.create({
    data: {
      beneficiaryMemberId,
      cashAmountMinor: 500,
      cashCurrency: "usd",
      checkoutCancelUrl: "https://example.test/settings?usage=cancelled",
      checkoutExpiresAt: new Date("2026-07-16T12:30:00.000Z"),
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v1",
      checkoutSuccessUrl: "https://example.test/settings?usage=return",
      clientRequestKey: `request:${fixtureId}`,
      grantUsdMicros: 5_000_000n,
      id: purchaseId,
      offerCode: "usage_5_usd",
      payerMemberId,
      ...(input.terminalCrossOwner
        ? {
            lastReconciledAt: new Date("2026-07-16T12:05:00.000Z"),
            paidAt: new Date("2026-07-16T12:05:00.000Z"),
            remainingCreditUsdMicros: 5_000_000n,
            status: HostedUsageCreditPurchaseStatus.fulfilled,
            stripeChargeIdEncrypted: `encrypted-charge:${fixtureId}`,
            stripeChargeLookupKey: `charge-lookup:${fixtureId}`,
            stripeCheckoutSessionIdEncrypted: `encrypted-session:${fixtureId}`,
            stripeCheckoutSessionLookupKey: `session-lookup:${fixtureId}`,
            stripeCheckoutUrlEncrypted: `encrypted-url:${fixtureId}`,
            stripePaymentIntentIdEncrypted: `encrypted-payment-intent:${fixtureId}`,
            stripePaymentIntentLookupKey: `payment-intent-lookup:${fixtureId}`,
            terminalAt: new Date("2026-07-16T12:05:00.000Z"),
          }
        : {}),
      stripeCustomerIdEncrypted: `encrypted-customer:${fixtureId}`,
      stripeCustomerLookupKey: `customer-lookup:${fixtureId}`,
      stripeLiveMode: false,
      stripePriceIdEncrypted: `encrypted-price:${fixtureId}`,
      stripePriceLookupKey: `price-lookup:${fixtureId}`,
    },
  });

  return {
    beneficiaryMemberId,
    firstClient,
    observer,
    payerMemberId,
    purchaseId,
    secondClient,
    thirdClient,
  };
}

async function cleanupUsageCreditFixture(
  fixture: UsageCreditFixture,
): Promise<void> {
  try {
    await fixture.observer.hostedUsageCreditGrant.deleteMany({
      where: {
        entry: { beneficiaryMemberId: fixture.beneficiaryMemberId },
      },
    });
    await fixture.observer.hostedUsageCreditEntry.deleteMany({
      where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
    });
    await fixture.observer.hostedUsageCreditPurchase.deleteMany({
      where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
    });
    await fixture.observer.hostedMember.deleteMany({
      where: {
        id: {
          in: [...new Set([
            fixture.beneficiaryMemberId,
            fixture.payerMemberId,
          ])],
        },
      },
    });
  } finally {
    await Promise.all([
      fixture.firstClient.$disconnect(),
      fixture.secondClient.$disconnect(),
      fixture.thirdClient.$disconnect(),
      fixture.observer.$disconnect(),
    ]);
  }
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the PostgreSQL transaction to wait on a held lock.");
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

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted usage-credit PostgreSQL serialization",
  () => {
    it("grants one ledger entry when two grant replays race", async () => {
      const fixture = await createUsageCreditFixture();
      const paidAt = new Date("2026-07-16T12:01:00.000Z");
      const firstGranted = createDeferred();
      const releaseFirstGrant = createDeferred();
      const replayPid = createDeferred<number>();
      let replayTransaction: Promise<Awaited<ReturnType<
        typeof grantHostedUsageCreditForPurchaseTx
      >>> | null = null;
      const firstTransaction = fixture.firstClient.$transaction(async (tx) => {
        const grant = await grantHostedUsageCreditForPurchaseTx({
          paidAt,
          purchaseId: fixture.purchaseId,
          tx,
        });
        firstGranted.resolve();
        await releaseFirstGrant.promise;
        return grant;
      }, transactionOptions);

      try {
        await Promise.race([firstGranted.promise, firstTransaction]);
        replayTransaction = fixture.secondClient.$transaction(async (tx) => {
          replayPid.resolve(await readBackendPid(tx));
          return grantHostedUsageCreditForPurchaseTx({
            paidAt,
            purchaseId: fixture.purchaseId,
            tx,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await replayPid.promise,
        });
        releaseFirstGrant.resolve();

        const firstGrant = await firstTransaction;
        await expect(replayTransaction).resolves.toEqual({
          balanceUsdMicros: 5_000_000n,
          entryId: firstGrant.entryId,
          granted: false,
          ledgerVersion: 1n,
        });
        expect(firstGrant).toMatchObject({
          balanceUsdMicros: 5_000_000n,
          granted: true,
          ledgerVersion: 1n,
        });
        await expect(fixture.observer.hostedUsageCreditEntry.findMany({
          select: {
            amountUsdMicros: true,
            beneficiarySequence: true,
            kind: true,
          },
          where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
        })).resolves.toEqual([{
          amountUsdMicros: 5_000_000n,
          beneficiarySequence: 1n,
          kind: "purchase_grant",
        }]);
      } finally {
        releaseFirstGrant.resolve();
        await Promise.allSettled([
          firstTransaction,
          ...(replayTransaction ? [replayTransaction] : []),
        ]);
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("rolls back a grant and permits member-row deletion after fulfillment", async () => {
      const fixture = await createUsageCreditFixture();
      const paidAt = new Date("2026-07-16T12:08:00.000Z");

      try {
        await expect(fixture.firstClient.$transaction(async (tx) => {
          await grantHostedUsageCreditForPurchaseTx({
            paidAt,
            purchaseId: fixture.purchaseId,
            tx,
          });
          throw new Error("force growth aggregate rollback");
        }, transactionOptions)).rejects.toThrow(
          "force growth aggregate rollback",
        );
        await expect(
          fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
            select: {
              status: true,
            },
            where: {
              id: fixture.purchaseId,
            },
          }),
        ).resolves.toEqual({
          status: HostedUsageCreditPurchaseStatus.created,
        });

        await expect(fixture.firstClient.$transaction((tx) =>
          grantHostedUsageCreditForPurchaseTx({
            paidAt,
            purchaseId: fixture.purchaseId,
            tx,
          }), transactionOptions)
        ).resolves.toMatchObject({
          granted: true,
        });
        await expect(fixture.secondClient.$transaction((tx) =>
          grantHostedUsageCreditForPurchaseTx({
            paidAt,
            purchaseId: fixture.purchaseId,
            tx,
          }), transactionOptions)
        ).resolves.toMatchObject({
          granted: false,
        });
        await fixture.thirdClient.$transaction(async (tx) => {
          await tx.hostedUsageCreditGrant.deleteMany({
            where: {
              entry: {
                beneficiaryMemberId: fixture.beneficiaryMemberId,
              },
            },
          });
          await tx.hostedUsageCreditEntry.deleteMany({
            where: {
              beneficiaryMemberId: fixture.beneficiaryMemberId,
            },
          });
          await tx.hostedUsageCreditPurchase.deleteMany({
            where: {
              beneficiaryMemberId: fixture.beneficiaryMemberId,
            },
          });
          await tx.hostedMember.deleteMany({
            where: {
              id: fixture.beneficiaryMemberId,
            },
          });
        }, transactionOptions);

        await expect(Promise.all([
          fixture.observer.hostedMember.count({
            where: {
              id: fixture.beneficiaryMemberId,
            },
          }),
          fixture.observer.hostedUsageCreditPurchase.count({
            where: {
              beneficiaryMemberId: fixture.beneficiaryMemberId,
            },
          }),
          fixture.observer.hostedUsageCreditGrant.count({
            where: {
              entry: {
                beneficiaryMemberId: fixture.beneficiaryMemberId,
              },
            },
          }),
          fixture.observer.hostedUsageCreditEntry.count({
            where: {
              beneficiaryMemberId: fixture.beneficiaryMemberId,
            },
          }),
        ])).resolves.toEqual([0, 0, 0, 0]);
      } finally {
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("holds the beneficiary lock while a grant waits on its purchase row", async () => {
      const fixture = await createUsageCreditFixture();
      const purchaseLocked = createDeferred();
      const releasePurchase = createDeferred();
      const grantPid = createDeferred<number>();
      const beneficiaryPid = createDeferred<number>();
      let grantTransaction: Promise<Awaited<ReturnType<
        typeof grantHostedUsageCreditForPurchaseTx
      >>> | null = null;
      let beneficiaryTransaction: Promise<Awaited<ReturnType<
        typeof lockHostedUsageCreditBeneficiaryTx
      >>> | null = null;
      const purchaseTransaction = fixture.firstClient.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "hosted_usage_credit_purchase"
          WHERE "id" = ${fixture.purchaseId}
          FOR UPDATE
        `;
        purchaseLocked.resolve();
        await releasePurchase.promise;
      }, transactionOptions);

      try {
        await Promise.race([purchaseLocked.promise, purchaseTransaction]);
        grantTransaction = fixture.secondClient.$transaction(async (tx) => {
          grantPid.resolve(await readBackendPid(tx));
          return grantHostedUsageCreditForPurchaseTx({
            paidAt: new Date("2026-07-16T12:01:00.000Z"),
            purchaseId: fixture.purchaseId,
            tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await grantPid.promise,
        });

        beneficiaryTransaction = fixture.thirdClient.$transaction(async (tx) => {
          beneficiaryPid.resolve(await readBackendPid(tx));
          return lockHostedUsageCreditBeneficiaryTx({
            beneficiaryMemberId: fixture.beneficiaryMemberId,
            tx,
          });
        }, transactionOptions);
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await beneficiaryPid.promise,
        });

        releasePurchase.resolve();
        await purchaseTransaction;
        await expect(grantTransaction).resolves.toMatchObject({
          balanceUsdMicros: 5_000_000n,
          granted: true,
          ledgerVersion: 1n,
        });
        await expect(beneficiaryTransaction).resolves.toMatchObject({
          balanceUsdMicros: 5_000_000n,
          beneficiaryMemberId: fixture.beneficiaryMemberId,
          ledgerVersion: 1n,
        });
      } finally {
        releasePurchase.resolve();
        await Promise.allSettled([
          purchaseTransaction,
          ...(grantTransaction ? [grantTransaction] : []),
          ...(beneficiaryTransaction ? [beneficiaryTransaction] : []),
        ]);
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("makes usage settlement wait for a concurrent grant before debiting it", async () => {
      const fixture = await createUsageCreditFixture();
      const paidAt = new Date("2026-07-16T12:02:00.000Z");
      const grantWritten = createDeferred();
      const releaseGrant = createDeferred();
      const settlementPid = createDeferred<number>();
      let settlementTransaction: Promise<Awaited<ReturnType<
        typeof settleHostedUsageCreditForUsageTx
      >>> | null = null;
      const grantTransaction = fixture.firstClient.$transaction(async (tx) => {
        const grant = await grantHostedUsageCreditForPurchaseTx({
          paidAt,
          purchaseId: fixture.purchaseId,
          tx,
        });
        grantWritten.resolve();
        await releaseGrant.promise;
        return grant;
      }, transactionOptions);

      try {
        await Promise.race([grantWritten.promise, grantTransaction]);
        settlementTransaction = fixture.secondClient.$transaction(async (tx) => {
          settlementPid.resolve(await readBackendPid(tx));
          return settleHostedUsageCreditForUsageTx({
            beneficiaryMemberId: fixture.beneficiaryMemberId,
            debitUsdMicros: 3_000_000n,
            effectiveAt: new Date("2026-07-16T12:03:00.000Z"),
            sourceUsageId: `usage:${fixture.purchaseId}`,
            tx,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await settlementPid.promise,
        });
        releaseGrant.resolve();

        await expect(grantTransaction).resolves.toMatchObject({
          balanceUsdMicros: 5_000_000n,
          granted: true,
          ledgerVersion: 1n,
        });
        await expect(settlementTransaction).resolves.toEqual({
          absorbedUsdMicros: 0n,
          balanceUsdMicros: 2_000_000n,
          debitedUsdMicros: 3_000_000n,
          ledgerVersion: 2n,
        });
        await expect(readHostedUsageCreditProjection({
          beneficiaryMemberId: fixture.beneficiaryMemberId,
          prisma: fixture.observer,
        })).resolves.toEqual({
          balanceUsdMicros: 2_000_000n,
          ledgerVersion: 2n,
        });
        await expect(fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
          select: { remainingCreditUsdMicros: true },
          where: { id: fixture.purchaseId },
        })).resolves.toEqual({ remainingCreditUsdMicros: 2_000_000n });
      } finally {
        releaseGrant.resolve();
        await Promise.allSettled([
          grantTransaction,
          ...(settlementTransaction ? [settlementTransaction] : []),
        ]);
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("lets account deletion remove ownership before a waiting grant can append", async () => {
      const fixture = await createUsageCreditFixture();
      const memberLocked = createDeferred();
      const releaseDeletion = createDeferred();
      const grantPid = createDeferred<number>();
      let grantTransaction: Promise<Awaited<ReturnType<
        typeof grantHostedUsageCreditForPurchaseTx
      >>> | null = null;
      const deletionTransaction = fixture.firstClient.$transaction(async (tx) => {
        await lockHostedUsageCreditBeneficiaryTx({
          beneficiaryMemberId: fixture.beneficiaryMemberId,
          tx,
        });
        memberLocked.resolve();
        await releaseDeletion.promise;
        await tx.hostedUsageCreditGrant.deleteMany({
          where: {
            entry: { beneficiaryMemberId: fixture.beneficiaryMemberId },
          },
        });
        await tx.hostedUsageCreditEntry.deleteMany({
          where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
        });
        await tx.hostedUsageCreditPurchase.deleteMany({
          where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
        });
        await tx.hostedMember.deleteMany({
          where: { id: fixture.beneficiaryMemberId },
        });
      }, transactionOptions);

      try {
        await Promise.race([memberLocked.promise, deletionTransaction]);
        grantTransaction = fixture.secondClient.$transaction(async (tx) => {
          grantPid.resolve(await readBackendPid(tx));
          return grantHostedUsageCreditForPurchaseTx({
            paidAt: new Date("2026-07-16T12:04:00.000Z"),
            purchaseId: fixture.purchaseId,
            tx,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await grantPid.promise,
        });
        releaseDeletion.resolve();

        await deletionTransaction;
        await expect(grantTransaction).rejects.toThrow(
          "Hosted usage-credit beneficiary does not exist.",
        );
        await expect(Promise.all([
          fixture.observer.hostedMember.count({
            where: { id: fixture.beneficiaryMemberId },
          }),
          fixture.observer.hostedUsageCreditPurchase.count({
            where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
          }),
          fixture.observer.hostedUsageCreditGrant.count({
            where: {
              entry: { beneficiaryMemberId: fixture.beneficiaryMemberId },
            },
          }),
          fixture.observer.hostedUsageCreditEntry.count({
            where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
          }),
        ])).resolves.toEqual([0, 0, 0, 0]);
      } finally {
        releaseDeletion.resolve();
        await Promise.allSettled([
          deletionTransaction,
          ...(grantTransaction ? [grantTransaction] : []),
        ]);
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("rejects payer-era Stripe references after cross-owner detachment", async () => {
      const fixture = await createUsageCreditFixture({ terminalCrossOwner: true });
      const preparedAt = new Date("2026-07-16T12:06:00.000Z");
      const preparedVersion = 0n;
      const payerEraReferences = {
        stripeChargeIdEncrypted: "encrypted:prepared-charge",
        stripeChargeLookupKey: "charge-lookup:prepared",
        stripeCheckoutSessionIdEncrypted: "encrypted:prepared-session",
        stripeCheckoutSessionLookupKey: "session-lookup:prepared",
        stripePaymentIntentIdEncrypted: "encrypted:prepared-payment-intent",
        stripePaymentIntentLookupKey: "payment-intent-lookup:prepared",
      };

      try {
        await fixture.firstClient.$transaction(async (tx) => {
          await assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
            memberIds: [fixture.payerMemberId],
            now: preparedAt,
            prisma: tx,
          });
          await tx.hostedMember.delete({
            where: { id: fixture.payerMemberId },
          });
        }, transactionOptions);

        await expect(fixture.secondClient.$transaction(async (tx) =>
          bindHostedUsageCreditStripeReferencesTx({
            expectedReconciliationVersion: preparedVersion,
            lastReconciledAt: preparedAt,
            privateReferences: payerEraReferences,
            purchaseId: fixture.purchaseId,
            tx,
          }), transactionOptions)
        ).rejects.toThrow(
          "Usage-credit purchase changed before Stripe references were bound.",
        );

        await expect(fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
          select: {
            payerMemberId: true,
            reconciliationVersion: true,
            stripeChargeIdEncrypted: true,
            stripeChargeLookupKey: true,
            stripeCheckoutSessionIdEncrypted: true,
            stripePaymentIntentIdEncrypted: true,
          },
          where: { id: fixture.purchaseId },
        })).resolves.toMatchObject({
          payerMemberId: null,
          reconciliationVersion: 1n,
          stripeChargeIdEncrypted: null,
          stripeCheckoutSessionIdEncrypted: null,
          stripePaymentIntentIdEncrypted: null,
        });

        await fixture.thirdClient.$transaction((tx) =>
          bindHostedUsageCreditStripeReferencesTx({
            expectedReconciliationVersion: 1n,
            lastReconciledAt: new Date("2026-07-16T12:07:00.000Z"),
            privateReferences: {
              ...payerEraReferences,
              stripeChargeIdEncrypted: null,
              stripeCheckoutSessionIdEncrypted: null,
              stripePaymentIntentIdEncrypted: null,
            },
            purchaseId: fixture.purchaseId,
            tx,
          }), transactionOptions);

        await expect(fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
          select: {
            payerMemberId: true,
            reconciliationVersion: true,
            stripeChargeIdEncrypted: true,
            stripeChargeLookupKey: true,
            stripeCheckoutSessionIdEncrypted: true,
            stripePaymentIntentIdEncrypted: true,
          },
          where: { id: fixture.purchaseId },
        })).resolves.toEqual({
          payerMemberId: null,
          reconciliationVersion: 2n,
          stripeChargeIdEncrypted: null,
          stripeChargeLookupKey: "charge-lookup:prepared",
          stripeCheckoutSessionIdEncrypted: null,
          stripePaymentIntentIdEncrypted: null,
        });
        await expect(fixture.observer.hostedUsageCreditEntry.count({
          where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
        })).resolves.toBe(0);
      } finally {
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it("issues an idempotent consumable referral grant without a purchase", async () => {
      const fixtureId = randomUUID();
      const referrerMemberId = `member_usage_referral_${fixtureId}`;
      const targetContainerMemberId = `member_usage_referral_target_${fixtureId}`;
      const referralId = `hur_usage_referral_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const now = new Date();

      try {
        await observer.hostedMember.createMany({
          data: [
            {
              billingStatus: "active",
              id: referrerMemberId,
            },
            {
              billingStatus: "not_started",
              id: targetContainerMemberId,
            },
          ],
        });
        await observer.hostedThreadContainer.create({
          data: {
            memberId: targetContainerMemberId,
            ownerMemberId: referrerMemberId,
          },
        });
        await observer.hostedUsageReferral.create({
          data: {
            armedAt: new Date(now.getTime() - 30 * 60_000),
            beneficiaryMemberId: referrerMemberId,
            expiresAt: new Date(now.getTime() - 60_000),
            firstHumanMessageAt: new Date(now.getTime() - 15 * 60_000),
            humanMessageCount: 15,
            id: referralId,
            lastHumanMessageAt: new Date(now.getTime() - 5 * 60_000),
            nonReferrerMessageCount: 8,
            observedEventKeysJson: ["event_1"],
            observedSpeakerKeysJson: ["speaker_1", "speaker_2"],
            policyCode: "active_group_v1",
            policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
            qualifiedAt: new Date(now.getTime() - 5 * 60_000),
            referrerMemberId,
            referrerSubjectKey: "authenticated-member",
            rewardUsdMicros: HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
            status: "target_bound",
            targetBoundAt: new Date(now.getTime() - 20 * 60_000),
            targetContainerMemberId,
          },
        });

        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        })).resolves.toBeNull();
        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        })).resolves.toBeNull();
        await expect(observer.$transaction((tx) =>
          settleHostedUsageCreditForUsageTx({
            beneficiaryMemberId: referrerMemberId,
            debitUsdMicros: 1_500_000n,
            effectiveAt: now,
            sourceUsageId: `usage:${referralId}`,
            tx,
          }), transactionOptions)
        ).resolves.toEqual({
          absorbedUsdMicros: 0n,
          balanceUsdMicros: 2_000_000n,
          debitedUsdMicros: 1_500_000n,
          ledgerVersion: 2n,
        });

        await expect(Promise.all([
          observer.hostedMember.findUniqueOrThrow({
            select: {
              usageCreditBalanceUsdMicros: true,
              usageCreditLedgerVersion: true,
            },
            where: { id: referrerMemberId },
          }),
          observer.hostedUsageCreditGrant.findMany({
            select: {
              entry: {
                select: {
                  amountUsdMicros: true,
                  kind: true,
                  parentGrantEntryId: true,
                  purchaseId: true,
                  referralId: true,
                },
              },
              remainingUsdMicros: true,
            },
            where: {
              entry: { beneficiaryMemberId: referrerMemberId },
            },
          }),
          observer.hostedUsageCreditEntry.findMany({
            orderBy: { beneficiarySequence: "asc" },
            select: {
              amountUsdMicros: true,
              beneficiarySequence: true,
              kind: true,
              parentGrantEntryId: true,
              purchaseId: true,
              referralId: true,
            },
            where: { beneficiaryMemberId: referrerMemberId },
          }),
          observer.hostedUsageReferral.findUniqueOrThrow({
            select: {
              observedEventKeysJson: true,
              observedSpeakerKeysJson: true,
              rewardedAt: true,
              status: true,
            },
            where: { id: referralId },
          }),
        ])).resolves.toEqual([
          {
            usageCreditBalanceUsdMicros:
              2_000_000n,
            usageCreditLedgerVersion: 2n,
          },
          [{
            entry: {
              amountUsdMicros:
                HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
              kind: "referral_grant",
              parentGrantEntryId: null,
              purchaseId: null,
              referralId,
            },
            remainingUsdMicros: 2_000_000n,
          }],
          [
            {
              amountUsdMicros:
                HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
              beneficiarySequence: 1n,
              kind: "referral_grant",
              parentGrantEntryId: null,
              purchaseId: null,
              referralId,
            },
            {
              amountUsdMicros: -1_500_000n,
              beneficiarySequence: 2n,
              kind: "usage_debit",
              parentGrantEntryId: expect.any(String),
              purchaseId: null,
              referralId,
            },
          ],
          {
            observedEventKeysJson: null,
            observedSpeakerKeysJson: null,
            rewardedAt: expect.any(Date),
            status: "rewarded",
          },
        ]);
      } finally {
        await observer.hostedUsageCreditGrant.deleteMany({
          where: {
            entry: { beneficiaryMemberId: referrerMemberId },
          },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { beneficiaryMemberId: referrerMemberId },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: referralId },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: targetContainerMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [referrerMemberId, targetContainerMemberId] } },
        });
        await observer.$disconnect();
      }
    });

    it("serializes different group referrers against one destination cap", async () => {
      const fixtureId = randomUUID();
      const sourceContainerMemberId = `member_usage_referral_source_${fixtureId}`;
      const qualifiedTargetContainerMemberId =
        `member_usage_referral_qualified_target_${fixtureId}`;
      const qualifiedReferralId =
        `hur_usage_referral_filler_0_${fixtureId}`;
      const referrerMemberIds = [
        `member_usage_referral_actor_a_${fixtureId}`,
        `member_usage_referral_actor_b_${fixtureId}`,
      ] as const;
      const fillerMemberIds = Array.from(
        { length: 5 },
        (_, index) => `member_usage_referral_filler_${index}_${fixtureId}`,
      );
      const phoneNumbers = [
        `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
        `+1666${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      ] as const;
      const phoneLookupKeys = phoneNumbers.map((phoneNumber) =>
        createHostedPhoneLookupKey(phoneNumber)
      );
      if (phoneLookupKeys.some((lookupKey) => !lookupKey)) {
        throw new Error("Expected blind phone lookup keys for referral actors.");
      }
      const observer = createPrismaClient({ databaseUrl, poolMax: 5 });
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 5 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 5 });
      const now = new Date();

      try {
        await observer.hostedMember.createMany({
          data: [
            {
              billingStatus: "not_started",
              id: sourceContainerMemberId,
            },
            {
              billingStatus: "not_started",
              id: qualifiedTargetContainerMemberId,
            },
            ...referrerMemberIds.map((id) => ({
              billingStatus: "active" as const,
              id,
            })),
            ...fillerMemberIds.map((id) => ({
              billingStatus: "active" as const,
              id,
            })),
          ],
        });
        await observer.hostedThreadContainer.createMany({
          data: [
            {
              memberId: sourceContainerMemberId,
              ownerMemberId: referrerMemberIds[0],
            },
            {
              memberId: qualifiedTargetContainerMemberId,
              ownerMemberId: fillerMemberIds[0]!,
            },
          ],
        });
        await observer.hostedMemberIdentity.createMany({
          data: referrerMemberIds.map((memberId, index) => ({
            memberId,
            phoneLookupKey: phoneLookupKeys[index]!,
          })),
        });
        await observer.hostedUsageReferral.createMany({
          data: fillerMemberIds.map((referrerMemberId, index) =>
            index === 0
              ? {
                  armedAt: new Date(now.getTime() - 20 * 60_000),
                  beneficiaryMemberId: sourceContainerMemberId,
                  expiresAt: new Date(now.getTime() - 60_000),
                  firstHumanMessageAt:
                    new Date(now.getTime() - 15 * 60_000),
                  humanMessageCount: 15,
                  id: `hur_usage_referral_filler_${index}_${fixtureId}`,
                  lastHumanMessageAt:
                    new Date(now.getTime() - 2 * 60_000),
                  nonReferrerMessageCount: 8,
                  observedSpeakerKeysJson: ["speaker-a", "speaker-b"],
                  policyCode: "active_group_v1" as const,
                  policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
                  qualifiedAt: new Date(now.getTime() - 2 * 60_000),
                  referrerMemberId,
                  referrerSubjectKey: `filler-subject-${index}`,
                  rewardUsdMicros:
                    HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
                  status: "target_bound" as const,
                  targetBoundAt: new Date(now.getTime() - 15 * 60_000),
                  targetContainerMemberId: qualifiedTargetContainerMemberId,
                }
              : {
                  armedAt: new Date(now.getTime() - 60_000 - index),
                  beneficiaryMemberId: sourceContainerMemberId,
                  expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
                  id: `hur_usage_referral_filler_${index}_${fixtureId}`,
                  policyCode: "active_group_v1" as const,
                  policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
                  referrerMemberId,
                  referrerSubjectKey: `filler-subject-${index}`,
                  rewardUsdMicros:
                    HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
                  status: "armed" as const,
                }
          ),
        });

        for (const [index, referrerMemberId] of referrerMemberIds.entries()) {
          const read = await handleHostedUsageReferralGroupTool({
            enabled: true,
            memberId: sourceContainerMemberId,
            prisma: observer,
            request: {
              action: "read_usage_referral",
              linqSenderHandles: [phoneNumbers[index]!],
            },
          });
          expect(read).toMatchObject({
            result: {
              referral: {
                availablePolicies: [{
                  code: "new_person_activation_v1",
                }],
              },
              status: "ok",
            },
          });
          expect(referrerMemberId).toBeTruthy();
        }

        const results = await Promise.all(
          referrerMemberIds.map((_, index) =>
            handleHostedUsageReferralGroupTool({
              enabled: true,
              memberId: sourceContainerMemberId,
              prisma: index === 0 ? firstClient : secondClient,
              request: {
                action: "arm_usage_referral",
                linqSenderHandles: [phoneNumbers[index]!],
                policyCode: "new_person_activation_v1",
              },
            })
          ),
        );

        expect(results.map((result) => result.result.status).sort()).toEqual([
          "ok",
          "unavailable",
        ]);
        expect(await observer.hostedUsageReferral.aggregate({
          where: {
            beneficiaryMemberId: sourceContainerMemberId,
            OR: [
              {
                expiresAt: { gt: now },
                status: { in: ["armed", "target_bound"] },
              },
              {
                qualifiedAt: { not: null },
                status: "target_bound",
              },
            ],
          },
          _sum: { rewardUsdMicros: true },
        })).toEqual({
          _sum: {
            rewardUsdMicros:
              HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS
              - 500_000n,
          },
        });
        expect(await observer.hostedUsageReferral.count({
          where: {
            beneficiaryMemberId: sourceContainerMemberId,
            referrerMemberId: { in: [...referrerMemberIds] },
            rewardUsdMicros:
              HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
            status: "armed",
          },
        })).toBe(1);
        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId: qualifiedReferralId,
        })).rejects.toMatchObject({
          code: "HOSTED_THREAD_NOTIFICATION_ROUTE_REQUIRED",
        });
        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId: qualifiedReferralId,
        })).rejects.toMatchObject({
          code: "HOSTED_THREAD_NOTIFICATION_ROUTE_REQUIRED",
        });
        await expect(Promise.all([
          observer.hostedUsageReferral.findUniqueOrThrow({
            select: { rewardedAt: true, status: true },
            where: { id: qualifiedReferralId },
          }),
          observer.hostedUsageCreditEntry.count({
            where: {
              kind: "referral_grant",
              referralId: qualifiedReferralId,
            },
          }),
        ])).resolves.toEqual([
          {
            rewardedAt: expect.any(Date),
            status: "rewarded",
          },
          1,
        ]);
      } finally {
        await observer.hostedUsageCreditGrant.deleteMany({
          where: { entry: { referralId: qualifiedReferralId } },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId: qualifiedReferralId },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { beneficiaryMemberId: sourceContainerMemberId },
        });
        await observer.hostedMemberIdentity.deleteMany({
          where: { memberId: { in: [...referrerMemberIds] } },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: {
            memberId: {
              in: [
                sourceContainerMemberId,
                qualifiedTargetContainerMemberId,
              ],
            },
          },
        });
        await observer.hostedAiUsagePeriod.deleteMany({
          where: { memberId: sourceContainerMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [
                sourceContainerMemberId,
                qualifiedTargetContainerMemberId,
                ...referrerMemberIds,
                ...fillerMemberIds,
              ],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          firstClient.$disconnect(),
          secondClient.$disconnect(),
        ]);
      }
    });
  },
);
