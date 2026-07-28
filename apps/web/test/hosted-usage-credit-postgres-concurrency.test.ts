import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import pg from "pg";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  grantHostedUsageCreditForPurchaseTx,
  lockHostedUsageCreditBeneficiaryTx,
  readHostedUsageCreditProjection,
  settleHostedUsageCreditForUsageTx,
} from "@/src/lib/hosted-execution/usage-credits";
import {
  decodeHostedMailboxStoredPayload,
} from "@/src/lib/hosted-mailbox/store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  handleHostedUsageReferralGroupTool,
  HOSTED_USAGE_REFERRAL_BENEFICIARY_30D_CAP_USD_MICROS,
  HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
  HOSTED_USAGE_REFERRAL_POLICY_VERSION,
  reconcileHostedUsageReferralRewardAfterCommit,
} from "@/src/lib/hosted-growth/usage-referral";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  getHostedAiUsageMonthlyAllowanceUsdMicros,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  upsertHostedMemberHomeLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { assertHostedUsageCreditPurchasesReadyForAccountDeletionTx } from "@/src/lib/hosted-onboarding/usage-credit-purchase-account-deletion";
import { bindHostedUsageCreditStripeReferencesTx } from "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation-context";
import {
  buildHostedThreadDeliveryRoute,
  sealHostedThreadDeliveryRoute,
} from "@/src/lib/hosted-routing/thread-delivery-route";
import {
  resolveHostedAssistantNotificationDestination,
} from "@/src/lib/hosted-routing/assistant-notification-destination";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const detachedDirectProofMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260727040000_relax_hosted_usage_credit_detached_direct_proof/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const referralCreditEntryConstraintMigrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260728030000_hosted_usage_referral_credit_entry_constraints/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const purchaseGrantResynchronizationContractMigrationSql = readFileSync(
  new URL(
    "../prisma/contract-migrations/20260728031000_resynchronize_hosted_usage_credit_purchase_grants/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

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

function stringifyWarningValue(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function createUsageCreditFixture(input: {
  directTerminalCrossOwner?: boolean;
  terminalCrossOwner?: boolean;
} = {}): Promise<UsageCreditFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const beneficiaryMemberId = `member_usage_credit_lock_${fixtureId}`;
  const terminalCrossOwner =
    input.terminalCrossOwner || input.directTerminalCrossOwner;
  const payerMemberId = terminalCrossOwner
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
      ...(terminalCrossOwner
        ? {
            lastReconciledAt: new Date("2026-07-16T12:05:00.000Z"),
            paidAt: new Date("2026-07-16T12:05:00.000Z"),
            remainingCreditUsdMicros: 5_000_000n,
            status: HostedUsageCreditPurchaseStatus.fulfilled,
            stripeChargeIdEncrypted: `encrypted-charge:${fixtureId}`,
            stripeChargeLookupKey: `charge-lookup:${fixtureId}`,
            ...(input.directTerminalCrossOwner
              ? {}
              : {
                  stripeCheckoutSessionIdEncrypted:
                    `encrypted-session:${fixtureId}`,
                  stripeCheckoutSessionLookupKey: `session-lookup:${fixtureId}`,
                  stripeCheckoutUrlEncrypted: `encrypted-url:${fixtureId}`,
                }),
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

async function applyPurchaseGrantResynchronizationContractMigration(
  client: pg.Client,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      purchaseGrantResynchronizationContractMigrationSql,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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
    beforeAll(async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(detachedDirectProofMigrationSql);
        await client.query(referralCreditEntryConstraintMigrationSql);
      } finally {
        await client.end();
      }
    });

    it("installs validated amount and source checks for every database enum kind", async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const enumResult = await client.query<{ enumLabel: string }>(`
          SELECT enum_value.enumlabel AS "enumLabel"
          FROM pg_type AS enum_type
          INNER JOIN pg_enum AS enum_value
            ON enum_value.enumtypid = enum_type.oid
          WHERE enum_type.typname = 'HostedUsageCreditEntryKind'
          ORDER BY enum_value.enumsortorder
        `);
        const constraintResult = await client.query<{
          convalidated: boolean;
          definition: string;
          name: string;
        }>(`
          SELECT
            constraint_row.conname AS "name",
            constraint_row.convalidated AS "convalidated",
            pg_get_constraintdef(constraint_row.oid, true) AS "definition"
          FROM pg_constraint AS constraint_row
          WHERE constraint_row.conrelid = 'hosted_usage_credit_entry'::regclass
            AND constraint_row.conname IN (
              'hosted_usage_credit_entry_amount_direction_valid',
              'hosted_usage_credit_entry_source_shape_valid'
            )
          ORDER BY constraint_row.conname
        `);
        const constraintsByName = new Map(
          constraintResult.rows.map((row) => [row.name, row]),
        );
        const enumLabels = enumResult.rows.map(({ enumLabel }) => enumLabel);

        expect(new Set(enumLabels)).toEqual(new Set([
          "purchase_grant",
          "referral_grant",
          "usage_debit",
          "refund_adjustment",
          "dispute_adjustment",
        ]));
        expect([...constraintsByName.keys()]).toEqual([
          "hosted_usage_credit_entry_amount_direction_valid",
          "hosted_usage_credit_entry_source_shape_valid",
        ]);
        for (const constraint of constraintsByName.values()) {
          expect(constraint.convalidated).toBe(true);
          for (const enumLabel of enumLabels) {
            expect(constraint.definition).toContain(`'${enumLabel}'`);
          }
        }
      } finally {
        await client.end();
      }
    });

    it("resynchronizes purchase grant projections without touching referral grants and is replay-safe", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_credit_resync_${fixtureId}`;
      const missingPurchaseId = `hucp_resync_missing_${fixtureId}`;
      const stalePurchaseId = `hucp_resync_stale_${fixtureId}`;
      const missingEntryId = `huce_resync_missing_${fixtureId}`;
      const staleEntryId = `huce_resync_stale_${fixtureId}`;
      const referralId = `hur_resync_${fixtureId}`;
      const referralEntryId = `huce_resync_referral_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const now = new Date();
      const targetBoundAt = new Date(now.getTime() - 3 * 60_000);
      const qualifiedAt = new Date(now.getTime() - 2 * 60_000);
      const rewardedAt = new Date(now.getTime() - 60_000);
      let referralGrantBefore: {
        createdAt: Date;
        remainingUsdMicros: bigint;
        updatedAt: Date;
      } | null = null;

      try {
        await observer.hostedMember.create({
          data: { billingStatus: "active", id: memberId },
        });
        await observer.hostedUsageCreditPurchase.createMany({
          data: [
            {
              beneficiaryMemberId: memberId,
              cashAmountMinor: 500,
              cashCurrency: "usd",
              checkoutCancelUrl: "https://example.test/settings?usage=cancelled",
              checkoutExpiresAt: new Date(now.getTime() + 60 * 60_000),
              checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v1",
              checkoutSuccessUrl: "https://example.test/settings?usage=return",
              clientRequestKey: `resync-missing:${fixtureId}`,
              grantUsdMicros: 5_000_000n,
              id: missingPurchaseId,
              offerCode: "usage_5_usd",
              payerMemberId: memberId,
              remainingCreditUsdMicros: 4_000_000n,
              status: HostedUsageCreditPurchaseStatus.fulfilled,
              stripeCustomerIdEncrypted:
                `encrypted-customer-missing:${fixtureId}`,
              stripeCustomerLookupKey: `customer-missing:${fixtureId}`,
              stripeLiveMode: false,
              stripePriceIdEncrypted: `encrypted-price-missing:${fixtureId}`,
              stripePriceLookupKey: `price-missing:${fixtureId}`,
            },
            {
              beneficiaryMemberId: memberId,
              cashAmountMinor: 500,
              cashCurrency: "usd",
              checkoutCancelUrl: "https://example.test/settings?usage=cancelled",
              checkoutExpiresAt: new Date(now.getTime() + 60 * 60_000),
              checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v1",
              checkoutSuccessUrl: "https://example.test/settings?usage=return",
              clientRequestKey: `resync-stale:${fixtureId}`,
              grantUsdMicros: 5_000_000n,
              id: stalePurchaseId,
              offerCode: "usage_5_usd",
              payerMemberId: memberId,
              remainingCreditUsdMicros: 3_000_000n,
              status: HostedUsageCreditPurchaseStatus.fulfilled,
              stripeCustomerIdEncrypted:
                `encrypted-customer-stale:${fixtureId}`,
              stripeCustomerLookupKey: `customer-stale:${fixtureId}`,
              stripeLiveMode: false,
              stripePriceIdEncrypted: `encrypted-price-stale:${fixtureId}`,
              stripePriceLookupKey: `price-stale:${fixtureId}`,
            },
          ],
        });
        await observer.hostedUsageReferral.create({
          data: {
            armedAt: new Date(now.getTime() - 4 * 60_000),
            beneficiaryMemberId: memberId,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            id: referralId,
            policyCode: "new_person_activation_v1",
            policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
            qualifiedAt,
            referrerMemberId: memberId,
            referrerSubjectKey: "authenticated-member",
            rewardedAt,
            rewardUsdMicros:
              HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
            status: "rewarded",
            targetBoundAt,
          },
        });
        await observer.hostedUsageCreditEntry.createMany({
          data: [
            {
              amountUsdMicros: 5_000_000n,
              beneficiaryMemberId: memberId,
              beneficiarySequence: 1n,
              effectiveAt: now,
              id: missingEntryId,
              kind: "purchase_grant",
              purchaseId: missingPurchaseId,
              semanticSourceKey: `purchase:${missingPurchaseId}`,
            },
            {
              amountUsdMicros: 5_000_000n,
              beneficiaryMemberId: memberId,
              beneficiarySequence: 2n,
              effectiveAt: now,
              id: staleEntryId,
              kind: "purchase_grant",
              purchaseId: stalePurchaseId,
              semanticSourceKey: `purchase:${stalePurchaseId}`,
            },
            {
              amountUsdMicros:
                HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
              beneficiaryMemberId: memberId,
              beneficiarySequence: 3n,
              effectiveAt: now,
              id: referralEntryId,
              kind: "referral_grant",
              referralId,
              semanticSourceKey: `referral:${referralId}`,
            },
          ],
        });
        await observer.hostedUsageCreditGrant.createMany({
          data: [
            {
              entryId: staleEntryId,
              remainingUsdMicros: 1_000_000n,
            },
            {
              entryId: referralEntryId,
              remainingUsdMicros:
                HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
            },
          ],
        });
        referralGrantBefore =
          await observer.hostedUsageCreditGrant.findUniqueOrThrow({
            select: {
              createdAt: true,
              remainingUsdMicros: true,
              updatedAt: true,
            },
            where: { entryId: referralEntryId },
          });

        const client = new pg.Client({ connectionString: databaseUrl });
        await client.connect();
        try {
          await applyPurchaseGrantResynchronizationContractMigration(client);
          await applyPurchaseGrantResynchronizationContractMigration(client);
        } finally {
          await client.end();
        }

        await expect(observer.hostedUsageCreditGrant.findMany({
          orderBy: { entryId: "asc" },
          select: {
            entryId: true,
            remainingUsdMicros: true,
          },
          where: {
            entryId: {
              in: [missingEntryId, staleEntryId, referralEntryId],
            },
          },
        })).resolves.toEqual([
          {
            entryId: missingEntryId,
            remainingUsdMicros: 4_000_000n,
          },
          {
            entryId: referralEntryId,
            remainingUsdMicros:
              HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
          },
          {
            entryId: staleEntryId,
            remainingUsdMicros: 3_000_000n,
          },
        ]);
        await expect(
          observer.hostedUsageCreditGrant.findUniqueOrThrow({
            select: {
              createdAt: true,
              remainingUsdMicros: true,
              updatedAt: true,
            },
            where: { entryId: referralEntryId },
          }),
        ).resolves.toEqual(referralGrantBefore);
      } finally {
        await observer.hostedUsageCreditGrant.deleteMany({
          where: {
            entryId: { in: [missingEntryId, staleEntryId, referralEntryId] },
          },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: {
            id: { in: [missingEntryId, staleEntryId, referralEntryId] },
          },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: referralId },
        });
        await observer.hostedUsageCreditPurchase.deleteMany({
          where: { id: { in: [missingPurchaseId, stalePurchaseId] } },
        });
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await observer.$disconnect();
      }
    });

    it("waits for an in-flight debit before resynchronizing purchase grant projections", async () => {
      const fixture = await createUsageCreditFixture();
      const paidAt = new Date("2026-07-16T12:12:00.000Z");
      const debitApplied = createDeferred();
      const releaseDebit = createDeferred();
      const resyncClient = new pg.Client({ connectionString: databaseUrl });
      let debitTransaction: Promise<Awaited<ReturnType<
        typeof settleHostedUsageCreditForUsageTx
      >>> | null = null;
      let resync: Promise<void> | null = null;

      try {
        await fixture.firstClient.$transaction((tx) =>
          grantHostedUsageCreditForPurchaseTx({
            paidAt,
            purchaseId: fixture.purchaseId,
            tx,
          }), transactionOptions
        );
        debitTransaction = fixture.secondClient.$transaction(async (tx) => {
          const result = await settleHostedUsageCreditForUsageTx({
            beneficiaryMemberId: fixture.beneficiaryMemberId,
            debitUsdMicros: 1_000_000n,
            effectiveAt: new Date("2026-07-16T12:13:00.000Z"),
            sourceUsageId: `usage_resync_race_${randomUUID()}`,
            tx,
          });
          debitApplied.resolve();
          await releaseDebit.promise;
          return result;
        }, transactionOptions);
        await Promise.race([debitApplied.promise, debitTransaction]);

        await resyncClient.connect();
        const pidResult = await resyncClient.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        const resyncPid = pidResult.rows[0]?.pid;
        if (typeof resyncPid !== "number") {
          throw new Error("Expected a contract-migration PostgreSQL backend pid.");
        }
        resync =
          applyPurchaseGrantResynchronizationContractMigration(resyncClient);
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: resyncPid,
        });

        releaseDebit.resolve();
        await expect(debitTransaction).resolves.toMatchObject({
          debitedUsdMicros: 1_000_000n,
        });
        await expect(resync).resolves.toBeUndefined();

        await expect(Promise.all([
          fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
            select: { remainingCreditUsdMicros: true },
            where: { id: fixture.purchaseId },
          }),
          fixture.observer.hostedUsageCreditGrant.findFirstOrThrow({
            select: { remainingUsdMicros: true },
            where: {
              entry: {
                kind: "purchase_grant",
                purchaseId: fixture.purchaseId,
              },
            },
          }),
          fixture.observer.hostedUsageCreditEntry.count({
            where: {
              kind: "usage_debit",
              purchaseId: fixture.purchaseId,
            },
          }),
        ])).resolves.toEqual([
          { remainingCreditUsdMicros: 4_000_000n },
          { remainingUsdMicros: 4_000_000n },
          1,
        ]);
      } finally {
        releaseDebit.resolve();
        await Promise.allSettled([
          ...(debitTransaction ? [debitTransaction] : []),
          ...(resync ? [resync] : []),
        ]);
        await resyncClient.end().catch(() => undefined);
        await cleanupUsageCreditFixture(fixture);
      }
    });

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

    it("completes the direct-personal referral read-arm-read-cancel flow on one PostgreSQL pool connection", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_referral_direct_${fixtureId}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const now = new Date();
      const periodStart = new Date(now.getTime() - 24 * 60 * 60_000);
      const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60_000);
      const sourceConversation = {
        channel: "telegram" as const,
        threadId: `hid_${fixtureId.replaceAll("-", "")}`,
        threadIsDirect: true,
      };
      const processWarningSpy = vi.spyOn(process, "emitWarning");
      const consoleWarningSpy = vi.spyOn(console, "warn");

      try {
        await prisma.hostedMember.create({
          data: {
            billingRef: {
              create: {
                currentBillingPhase: "paid",
                currentBillingPlanCode: "launch_monthly",
                currentPeriodEnd: periodEnd,
                currentPeriodStart: periodStart,
              },
            },
            billingStatus: "active",
            hostedAiUsagePeriods: {
              create: {
                billingPlanCode: "launch_monthly",
                limitUsdMicros:
                  getHostedAiUsageMonthlyAllowanceUsdMicros("launch_monthly"),
                periodEnd,
                periodStart,
                spentUsdMicros: 0n,
              },
            },
            id: memberId,
          },
        });

        await expect(handleHostedUsageReferralGroupTool({
          enabled: true,
          memberId,
          prisma,
          request: { action: "read_usage_referral" },
        })).resolves.toMatchObject({
          result: {
            outcome: "read",
            referral: {
              active: null,
              availablePolicies: expect.arrayContaining([
                expect.objectContaining({
                  code: "new_person_activation_v1",
                }),
              ]),
            },
            status: "ok",
          },
        });
        await expect(handleHostedUsageReferralGroupTool({
          enabled: true,
          memberId,
          prisma,
          request: {
            action: "arm_usage_referral",
            policyCode: "new_person_activation_v1",
            sourceConversation,
          },
        })).resolves.toMatchObject({
          result: {
            outcome: "armed",
            referral: {
              active: {
                destinationKind: "personal",
                policyCode: "new_person_activation_v1",
                state: "armed",
              },
            },
            status: "ok",
          },
        });
        await expect(handleHostedUsageReferralGroupTool({
          enabled: true,
          memberId,
          prisma,
          request: { action: "read_usage_referral" },
        })).resolves.toMatchObject({
          result: {
            outcome: "read",
            referral: {
              active: {
                destinationKind: "personal",
                policyCode: "new_person_activation_v1",
                state: "armed",
              },
            },
            status: "ok",
          },
        });
        await expect(handleHostedUsageReferralGroupTool({
          enabled: true,
          memberId,
          prisma,
          request: { action: "cancel_usage_referral" },
        })).resolves.toMatchObject({
          result: {
            outcome: "canceled",
            referral: { active: null },
            status: "ok",
          },
        });

        await expect(prisma.hostedUsageReferral.findMany({
          select: {
            beneficiaryMemberId: true,
            referrerMemberId: true,
            sourceConversationJson: true,
            status: true,
            terminalAt: true,
            terminalReason: true,
          },
          where: { beneficiaryMemberId: memberId },
        })).resolves.toEqual([{
          beneficiaryMemberId: memberId,
          referrerMemberId: memberId,
          sourceConversationJson: null,
          status: "canceled",
          terminalAt: expect.any(Date),
          terminalReason: "referrer_canceled",
        }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const concurrentQueryWarnings = [
          ...processWarningSpy.mock.calls.map((call) =>
            stringifyWarningValue(call[0])
          ),
          ...consoleWarningSpy.mock.calls.map((call) =>
            call.map(stringifyWarningValue).join(" ")
          ),
        ].filter((message) =>
          message.includes(
            "client.query() when the client is already executing a query",
          )
        );
        const databasePoolPressureWarnings =
          consoleWarningSpy.mock.calls.filter((call) =>
            call[0] === "Hosted web database pool pressure."
          );
        expect(concurrentQueryWarnings).toEqual([]);
        for (const warning of databasePoolPressureWarnings) {
          expect(warning[1]).toEqual(expect.objectContaining({
            waitingRequests: 0,
          }));
        }
      } finally {
        consoleWarningSpy.mockRestore();
        processWarningSpy.mockRestore();
        await prisma.hostedUsageReferral.deleteMany({
          where: { beneficiaryMemberId: memberId },
        });
        await prisma.hostedAiUsagePeriod.deleteMany({ where: { memberId } });
        await prisma.hostedMemberBillingRef.deleteMany({ where: { memberId } });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it("completes and celebrates a new-person referral exactly once", async () => {
      const fixtureId = randomUUID();
      const referrerMemberId = `member_usage_referral_new_referrer_${fixtureId}`;
      const sourceContainerMemberId =
        `member_usage_referral_new_source_${fixtureId}`;
      const targetContainerMemberId =
        `member_usage_referral_new_target_${fixtureId}`;
      const introducedMemberId =
        `member_usage_referral_new_introduced_${fixtureId}`;
      const referralId = `hur_usage_referral_new_${fixtureId}`;
      const sourceThreadId = `linq-thread-${fixtureId}`;
      const sourceAccountLookupKey = `linq-account-${fixtureId}`;
      const sourceThreadIdentityLookupKey =
        createHostedExternalThreadIdentityLookupKey({
          channel: "linq",
          threadId: sourceThreadId,
        });
      const sourceThreadLookupKey = createHostedExternalThreadLookupKey({
        accountLookupKey: sourceAccountLookupKey,
        channel: "linq",
        threadId: sourceThreadId,
      });
      if (!sourceThreadIdentityLookupKey || !sourceThreadLookupKey) {
        throw new Error("Expected blinded source-thread lookup keys.");
      }
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const now = new Date();
      const armedAt = new Date(now.getTime() - 20 * 60_000);
      const targetBoundAt = new Date(now.getTime() - 15 * 60_000);
      const activatedAt = new Date(now.getTime() - 10 * 60_000);
      const qualifiedAt = new Date(now.getTime() - 5 * 60_000);
      const celebrationDedupeKey =
        `assistant.notification.requested:usage-referral-reward:${referralId}`;

      try {
        await observer.hostedMember.createMany({
          data: [
            { billingStatus: "active", id: referrerMemberId },
            { billingStatus: "active", id: sourceContainerMemberId },
            { billingStatus: "not_started", id: targetContainerMemberId },
            { billingStatus: "active", id: introducedMemberId },
          ],
        });
        await observer.hostedThreadContainer.createMany({
          data: [
            {
              memberId: sourceContainerMemberId,
              ownerMemberId: referrerMemberId,
            },
            {
              memberId: targetContainerMemberId,
              ownerMemberId: referrerMemberId,
            },
          ],
        });
        const sourceDeliveryRoute = buildHostedThreadDeliveryRoute({
          accountLookupKey: sourceAccountLookupKey,
          channel: "linq",
          threadId: sourceThreadId,
        });
        await observer.hostedThreadRoute.create({
          data: {
            channel: "linq",
            containerMemberId: sourceContainerMemberId,
            deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
              containerMemberId: sourceContainerMemberId,
              prisma: observer,
              route: sourceDeliveryRoute,
            }),
            threadIdentityLookupKey: sourceThreadIdentityLookupKey,
            threadLookupKey: sourceThreadLookupKey,
          },
        });
        await observer.hostedMailboxItem.create({
          data: {
            dedupeKey: `member.activated:${introducedMemberId}`,
            id: `hmi_usage_referral_activation_${fixtureId}`,
            kind: "member.activated",
            lane: "system",
            laneSeq: 1n,
            occurredAt: activatedAt,
            payloadSchema: "murph.hosted-execution.member-activated.v1",
            userId: introducedMemberId,
          },
        });
        await observer.hostedUsageReferral.create({
          data: {
            armedAt,
            beneficiaryMemberId: sourceContainerMemberId,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
            firstHumanMessageAt: qualifiedAt,
            humanMessageCount: 1,
            id: referralId,
            introducedMemberId,
            lastHumanMessageAt: qualifiedAt,
            nonReferrerMessageCount: 1,
            observedEventKeysJson: ["introduced-member-first-message"],
            observedSpeakerKeysJson: ["introduced-member"],
            policyCode: "new_person_activation_v1",
            policyVersion: HOSTED_USAGE_REFERRAL_POLICY_VERSION,
            qualifiedAt,
            referrerMemberId,
            referrerSubjectKey: "authenticated-member",
            rewardUsdMicros:
              HOSTED_USAGE_REFERRAL_PERSON_REWARD_USD_MICROS,
            status: "target_bound",
            targetBoundAt,
            targetContainerMemberId,
          },
        });

        const first = await reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        });
        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        })).resolves.toBeNull();

        expect(first).toMatchObject({
          eventId: celebrationDedupeKey,
          linqChatId: sourceThreadId,
          mailboxItemId: expect.any(String),
          source: "linq",
          userId: sourceContainerMemberId,
          wakeMailboxCheckpoint: {
            lane: "system",
            laneSeq: expect.any(String),
          },
        });
        await expect(Promise.all([
          observer.hostedUsageReferral.findUniqueOrThrow({
            select: {
              celebrationQueuedAt: true,
              rewardedAt: true,
              status: true,
            },
            where: { id: referralId },
          }),
          observer.hostedUsageCreditEntry.count({
            where: { kind: "referral_grant", referralId },
          }),
          observer.hostedUsageCreditGrant.count({
            where: { entry: { referralId } },
          }),
          observer.hostedMailboxItem.findMany({
            select: { dedupeKey: true, kind: true, userId: true },
            where: {
              dedupeKey: celebrationDedupeKey,
              userId: sourceContainerMemberId,
            },
          }),
        ])).resolves.toEqual([
          {
            celebrationQueuedAt: expect.any(Date),
            rewardedAt: expect.any(Date),
            status: "rewarded",
          },
          1,
          1,
          [{
            dedupeKey: celebrationDedupeKey,
            kind: "assistant.notification.requested",
            userId: sourceContainerMemberId,
          }],
        ]);
      } finally {
        await observer.hostedMailboxPayload.deleteMany({
          where: {
            userId: { in: [sourceContainerMemberId, introducedMemberId] },
          },
        });
        await observer.hostedMailboxItem.deleteMany({
          where: {
            userId: { in: [sourceContainerMemberId, introducedMemberId] },
          },
        });
        await observer.hostedMailboxLaneCounter.deleteMany({
          where: {
            userId: { in: [sourceContainerMemberId, introducedMemberId] },
          },
        });
        await observer.hostedWorkspace.deleteMany({
          where: { userId: sourceContainerMemberId },
        });
        await observer.hostedUsageCreditGrant.deleteMany({
          where: { entry: { referralId } },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: referralId },
        });
        await observer.hostedThreadRoute.deleteMany({
          where: {
            containerMemberId: {
              in: [sourceContainerMemberId, targetContainerMemberId],
            },
          },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: {
            memberId: {
              in: [sourceContainerMemberId, targetContainerMemberId],
            },
          },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [
                referrerMemberId,
                sourceContainerMemberId,
                targetContainerMemberId,
                introducedMemberId,
              ],
            },
          },
        });
        await observer.$disconnect();
      }
    });

    it("composes a personal referral celebration from the frozen source exactly once", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_usage_referral_personal_${fixtureId}`;
      const targetContainerMemberId =
        `member_usage_referral_personal_target_${fixtureId}`;
      const referralId = `hur_usage_referral_personal_${fixtureId}`;
      const sourceThreadId = `linq-personal-thread-${fixtureId}`;
      const sourceContactLookupKey = createHostedPhoneLookupKey(
        "+15550100001",
      );
      if (!sourceContactLookupKey) {
        throw new Error("Expected a blinded source contact lookup key.");
      }
      const celebrationDedupeKey =
        `assistant.notification.requested:usage-referral-reward:${referralId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const now = new Date();

      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          return input.value;
        },
        encrypt(input) {
          return input.value;
        },
      });
      try {
        await observer.hostedMember.createMany({
          data: [
            {
              assistantHumor: 8,
              assistantTone: "formal",
              assistantUnhinged: 4,
              billingStatus: "active",
              id: memberId,
            },
            {
              billingStatus: "not_started",
              id: targetContainerMemberId,
            },
          ],
        });
        await observer.hostedMemberIdentity.create({
          data: {
            memberId,
            phoneLookupKey: sourceContactLookupKey,
          },
        });
        await observer.hostedThreadContainer.create({
          data: {
            memberId: targetContainerMemberId,
            ownerMemberId: memberId,
          },
        });
        await observer.$transaction((tx) =>
          upsertHostedMemberHomeLinqBindingTx({
            homeLineAssignedAt: now,
            linqChatId: sourceThreadId,
            memberId,
            participantContact: {
              kind: "phone",
              lookupKey: sourceContactLookupKey,
            },
            prisma: tx,
            recipientPhone: null,
          }), transactionOptions);
        const sourceDestination =
          await resolveHostedAssistantNotificationDestination({
            directChannel: "linq",
            memberId,
            prisma: observer,
          });
        expect(sourceDestination).toMatchObject({
          conversationShape: "direct-member",
          route: {
            channel: "linq",
            delivery: {
              kind: "thread",
              target: sourceThreadId,
            },
            threadIsDirect: true,
          },
        });
        if (
          sourceDestination?.conversationShape !== "direct-member"
          || sourceDestination.route.channel !== "linq"
          || sourceDestination.route.delivery.kind !== "thread"
          || !sourceDestination.route.threadId
        ) {
          throw new Error(
            "Expected the personal member's direct Linq notification route.",
          );
        }
        const sourceThreadLookupKey = sourceDestination.route.threadId;
        await observer.hostedUsageReferral.create({
          data: {
            armedAt: new Date(now.getTime() - 30 * 60_000),
            beneficiaryMemberId: memberId,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
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
            referrerMemberId: memberId,
            referrerSubjectKey: "authenticated-member",
            rewardUsdMicros: HOSTED_USAGE_REFERRAL_GROUP_REWARD_USD_MICROS,
            sourceConversationJson: {
              channel: "linq",
              threadId: sourceThreadLookupKey,
              threadIsDirect: true,
            },
            status: "target_bound",
            targetBoundAt: new Date(now.getTime() - 20 * 60_000),
            targetContainerMemberId,
          },
        });

        const first = await reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        });
        await expect(reconcileHostedUsageReferralRewardAfterCommit({
          prisma: observer,
          referralId,
        })).resolves.toBeNull();
        expect(first).toMatchObject({
          eventId: celebrationDedupeKey,
          linqChatId: sourceThreadId,
          mailboxItemId: expect.any(String),
          source: "linq",
          userId: memberId,
        });

        const mailboxItem = await observer.hostedMailboxItem.findUniqueOrThrow({
          include: { payload: true },
          where: {
            userId_dedupeKey: {
              dedupeKey: celebrationDedupeKey,
              userId: memberId,
            },
          },
        });
        const persistedPayload = await decodeHostedMailboxStoredPayload({
          dedupeKey: mailboxItem.dedupeKey,
          kind: mailboxItem.kind,
          lane: mailboxItem.lane,
          laneSeq: mailboxItem.laneSeq,
          mailboxItemId: mailboxItem.id,
          occurredAt: mailboxItem.occurredAt.toISOString(),
          payloadCiphertext: mailboxItem.payload?.payloadCiphertext,
          payloadInlineCiphertext: mailboxItem.payloadInlineCiphertext,
          payloadSchema: mailboxItem.payloadSchema,
          prisma: observer,
          userId: memberId,
        });
        expect(persistedPayload).toMatchObject({
          eventId: celebrationDedupeKey,
          kind: "assistant.notification.requested",
          notification: {
            deliveryDedupeToken:
              `usage-referral-reward:${referralId}`,
            deliveryDispatchMode: "queue-only",
            instructions: expect.stringContaining(
              "about 140 more messages on the model your Murph is using now",
            ),
            responsePolicy: { kind: "require_send" },
            route: {
              channel: "linq",
              delivery: {
                kind: "explicit",
                target: sourceThreadId,
              },
              threadId: sourceThreadLookupKey,
              threadIsDirect: true,
            },
          },
          userId: memberId,
        });
        expect(persistedPayload).toMatchObject({
          notification: {
            instructions: expect.stringContaining(
              "tone=formal; Humor=8/10; Unhinged=4/10",
            ),
          },
        });
        expect(persistedPayload).toMatchObject({
          notification: {
            instructions: expect.stringContaining(
              "This isolated completion has no transcript or room callback",
            ),
          },
        });
        const serializedPayload = JSON.stringify(persistedPayload);
        expect(serializedPayload).not.toContain(
          '"externalThreadRouteAuthority"',
        );
        expect(serializedPayload).not.toContain('"conversationHistory"');
        expect(serializedPayload).not.toContain('"messages"');
        expect(serializedPayload).not.toContain('"referrer"');

        await expect(Promise.all([
          observer.hostedUsageReferral.findUniqueOrThrow({
            select: {
              celebrationQueuedAt: true,
              sourceConversationJson: true,
              status: true,
            },
            where: { id: referralId },
          }),
          observer.hostedUsageCreditEntry.count({
            where: { kind: "referral_grant", referralId },
          }),
          observer.hostedUsageCreditGrant.count({
            where: { entry: { referralId } },
          }),
          observer.hostedMailboxItem.count({
            where: {
              dedupeKey: celebrationDedupeKey,
              userId: memberId,
            },
          }),
        ])).resolves.toEqual([
          {
            celebrationQueuedAt: expect.any(Date),
            sourceConversationJson: null,
            status: "rewarded",
          },
          1,
          1,
          1,
        ]);
      } finally {
        setHostedSecureBoxStringTestCodecForTests(null);
        await observer.hostedMailboxPayload.deleteMany({
          where: { userId: memberId },
        });
        await observer.hostedMailboxItem.deleteMany({
          where: { userId: memberId },
        });
        await observer.hostedMailboxLaneCounter.deleteMany({
          where: { userId: memberId },
        });
        await observer.hostedWorkspace.deleteMany({
          where: { userId: memberId },
        });
        await observer.hostedUsageCreditGrant.deleteMany({
          where: { entry: { referralId } },
        });
        await observer.hostedUsageCreditEntry.deleteMany({
          where: { referralId },
        });
        await observer.hostedUsageReferral.deleteMany({
          where: { id: referralId },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: targetContainerMemberId },
        });
        await observer.hostedMemberRouting.deleteMany({
          where: { memberId },
        });
        await observer.hostedMemberIdentity.deleteMany({
          where: { memberId },
        });
        await observer.hostedMember.deleteMany({
          where: { id: { in: [memberId, targetContainerMemberId] } },
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

    it("detaches a fulfilled sessionless direct purchase under the migrated constraint", async () => {
      const fixture = await createUsageCreditFixture({
        directTerminalCrossOwner: true,
      });
      const detachedAt = new Date("2026-07-16T12:06:00.000Z");

      try {
        await fixture.observer.hostedMember.update({
          data: { suspendedAt: detachedAt },
          where: { id: fixture.payerMemberId },
        });
        await fixture.firstClient.$transaction(async (tx) => {
          await assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
            memberIds: [fixture.payerMemberId],
            now: detachedAt,
            prisma: tx,
          });
          await tx.hostedMember.delete({
            where: { id: fixture.payerMemberId },
          });
        }, transactionOptions);

        await expect(
          fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
            select: {
              payerMemberId: true,
              reconciliationVersion: true,
              status: true,
              stripeChargeIdEncrypted: true,
              stripeChargeLookupKey: true,
              stripeCheckoutSessionIdEncrypted: true,
              stripeCheckoutSessionLookupKey: true,
              stripeCustomerIdEncrypted: true,
              stripePaymentIntentIdEncrypted: true,
              stripePaymentIntentLookupKey: true,
              stripePriceIdEncrypted: true,
            },
            where: { id: fixture.purchaseId },
          }),
        ).resolves.toEqual({
          payerMemberId: null,
          reconciliationVersion: 1n,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
          stripeChargeIdEncrypted: null,
          stripeChargeLookupKey: expect.any(String),
          stripeCheckoutSessionIdEncrypted: null,
          stripeCheckoutSessionLookupKey: null,
          stripeCustomerIdEncrypted: null,
          stripePaymentIntentIdEncrypted: null,
          stripePaymentIntentLookupKey: expect.any(String),
          stripePriceIdEncrypted: null,
        });
      } finally {
        await cleanupUsageCreditFixture(fixture);
      }
    });

    it.each(["payment_intent", "charge"] as const)(
      "rejects detached direct proof without its %s lookup",
      async (missingLookup) => {
        const fixture = await createUsageCreditFixture({
          directTerminalCrossOwner: true,
        });

        try {
          const detachWithoutProof = missingLookup === "payment_intent"
            ? fixture.observer.$executeRaw`
                UPDATE "hosted_usage_credit_purchase"
                SET
                  "payer_member_id" = NULL,
                  "stripe_price_id_encrypted" = NULL,
                  "stripe_customer_id_encrypted" = NULL,
                  "stripe_checkout_session_id_encrypted" = NULL,
                  "stripe_checkout_url_encrypted" = NULL,
                  "stripe_payment_intent_id_encrypted" = NULL,
                  "stripe_payment_intent_lookup_key" = NULL,
                  "stripe_charge_id_encrypted" = NULL
                WHERE "id" = ${fixture.purchaseId}
              `
            : fixture.observer.$executeRaw`
                UPDATE "hosted_usage_credit_purchase"
                SET
                  "payer_member_id" = NULL,
                  "stripe_price_id_encrypted" = NULL,
                  "stripe_customer_id_encrypted" = NULL,
                  "stripe_checkout_session_id_encrypted" = NULL,
                  "stripe_checkout_url_encrypted" = NULL,
                  "stripe_payment_intent_id_encrypted" = NULL,
                  "stripe_charge_id_encrypted" = NULL,
                  "stripe_charge_lookup_key" = NULL
                WHERE "id" = ${fixture.purchaseId}
              `;

          await expect(detachWithoutProof).rejects.toThrow();
          await expect(
            fixture.observer.hostedUsageCreditPurchase.findUniqueOrThrow({
              select: { payerMemberId: true },
              where: { id: fixture.purchaseId },
            }),
          ).resolves.toEqual({ payerMemberId: fixture.payerMemberId });
        } finally {
          await cleanupUsageCreditFixture(fixture);
        }
      },
    );
  },
);
