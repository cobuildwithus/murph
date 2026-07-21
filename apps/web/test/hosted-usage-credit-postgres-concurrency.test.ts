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
          fixture.observer.hostedUsageCreditEntry.count({
            where: { beneficiaryMemberId: fixture.beneficiaryMemberId },
          }),
        ])).resolves.toEqual([0, 0, 0]);
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
  },
);
