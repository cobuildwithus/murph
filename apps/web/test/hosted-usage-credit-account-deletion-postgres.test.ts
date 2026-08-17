import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-account-deletion";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

describe.skipIf(!runPostgresProof)(
  "usage-credit PostgreSQL account-deletion bound",
  () => {
    it("detaches historical payer rows with one real set update", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL proof.");
      }
      const fixtureId = randomUUID();
      const payerMemberId = `member_usage_payer_${fixtureId}`;
      const beneficiaryMemberId = `member_usage_beneficiary_${fixtureId}`;
      const foreignMemberId = `member_usage_foreign_${fixtureId}`;
      const now = new Date("2026-08-11T12:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const purchaseIds = Array.from(
        { length: 512 },
        (_unused, index) => `hucp_delete_bound_${fixtureId}_${index}`,
      );
      const targetBeneficiaryPurchaseId = `hucp_target_beneficiary_${fixtureId}`;
      const foreignPurchaseId = `hucp_foreign_${fixtureId}`;

      const terminalPurchase = (input: {
        beneficiaryMemberId: string;
        id: string;
        index: number;
        payerMemberId: string;
      }) => ({
        beneficiaryMemberId: input.beneficiaryMemberId,
        cashAmountMinor: 100,
        cashCurrency: "usd",
        checkoutCancelUrl: "https://join.example.test/cancel",
        checkoutExpiresAt: now,
        checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v3",
        checkoutSuccessUrl: "https://join.example.test/success",
        clientRequestKey: `delete-bound-${input.index}`,
        grantSlotReleasedAt: now,
        grantUsdMicros: 1_000_000n,
        id: input.id,
        lastReconciledAt: now,
        offerCode: "usage_1_usd",
        paidAt: now,
        payerMemberId: input.payerMemberId,
        status: "fulfilled" as const,
        stripeChargeIdEncrypted: "encrypted:charge",
        stripeChargeLookupKey: `charge:${fixtureId}:${input.index}`,
        stripeCustomerIdEncrypted: "encrypted:customer",
        stripeCustomerLookupKey: `customer:${fixtureId}:${input.index}`,
        stripeLiveMode: false,
        stripePaymentIntentIdEncrypted: "encrypted:intent",
        stripePaymentIntentLookupKey: `intent:${fixtureId}:${input.index}`,
        stripePriceIdEncrypted: "encrypted:price",
        stripePriceLookupKey: `price:${fixtureId}:${input.index}`,
        terminalAt: now,
      });

      try {
        await prisma.hostedMember.createMany({
          data: [
            { id: payerMemberId },
            { id: beneficiaryMemberId },
            { id: foreignMemberId },
          ],
        });
        await prisma.hostedUsageCreditPurchase.createMany({
          data: [
            ...purchaseIds.map((id, index) => terminalPurchase({
              beneficiaryMemberId,
              id,
              index,
              payerMemberId,
            })),
            terminalPurchase({
              beneficiaryMemberId: payerMemberId,
              id: targetBeneficiaryPurchaseId,
              index: 513,
              payerMemberId: beneficiaryMemberId,
            }),
            terminalPurchase({
              beneficiaryMemberId,
              id: foreignPurchaseId,
              index: 514,
              payerMemberId: foreignMemberId,
            }),
          ],
        });

        let preflightFindManyCalls = 0;
        let preflightTransactionCalls = 0;
        const preflightPurchases = new Proxy(
          prisma.hostedUsageCreditPurchase,
          {
            get(target, property) {
              if (property === "findMany") {
                return (...args: Parameters<typeof target.findMany>) => {
                  preflightFindManyCalls += 1;
                  return target.findMany(...args);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          },
        );
        const preflightPrisma = new Proxy(prisma, {
          get(target, property) {
            if (property === "hostedUsageCreditPurchase") {
              return preflightPurchases;
            }
            if (property === "$transaction") {
              return (...args: Parameters<typeof target.$transaction>) => {
                preflightTransactionCalls += 1;
                return target.$transaction(...args);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await closeHostedUsageCreditPurchasesForAccountDeletion({
          memberIds: [payerMemberId],
          now: new Date(now.getTime() + 500),
          prisma: preflightPrisma,
        });
        expect(preflightFindManyCalls).toBe(1);
        expect(preflightTransactionCalls).toBe(0);

        let findManyCalls = 0;
        let updateManyCalls = 0;
        await prisma.$transaction(async (tx) => {
          const hostedUsageCreditPurchase = new Proxy(
            tx.hostedUsageCreditPurchase,
            {
              get(target, property) {
                if (property === "findMany") {
                  return (...args: Parameters<typeof target.findMany>) => {
                    findManyCalls += 1;
                    return target.findMany(...args);
                  };
                }
                if (property === "updateMany") {
                  return (...args: Parameters<typeof target.updateMany>) => {
                    updateManyCalls += 1;
                    return target.updateMany(...args);
                  };
                }
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            },
          );
          const instrumentedTx = new Proxy<Prisma.TransactionClient>(tx, {
            get(target, property) {
              if (property === "hostedUsageCreditPurchase") {
                return hostedUsageCreditPurchase;
              }
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          await assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
            memberIds: [payerMemberId],
            now: new Date(now.getTime() + 1_000),
            prisma: instrumentedTx,
          });
        });

        expect(findManyCalls).toBe(1);
        expect(updateManyCalls).toBe(1);
        await expect(prisma.hostedUsageCreditPurchase.count({
          where: {
            id: { in: purchaseIds },
            payerMemberId: null,
            reconciliationVersion: 1n,
          },
        })).resolves.toBe(512);
        await expect(prisma.hostedUsageCreditPurchase.findMany({
          select: { id: true, payerMemberId: true, reconciliationVersion: true },
          where: { id: { in: [targetBeneficiaryPurchaseId, foreignPurchaseId] } },
          orderBy: { id: "asc" },
        })).resolves.toEqual([
          {
            id: foreignPurchaseId,
            payerMemberId: foreignMemberId,
            reconciliationVersion: 0n,
          },
          {
            id: targetBeneficiaryPurchaseId,
            payerMemberId: beneficiaryMemberId,
            reconciliationVersion: 0n,
          },
        ].sort((left, right) => left.id.localeCompare(right.id)));
      } finally {
        await prisma.hostedUsageCreditPurchase.deleteMany({
          where: {
            id: {
              in: [
                ...purchaseIds,
                targetBeneficiaryPurchaseId,
                foreignPurchaseId,
              ],
            },
          },
        });
        await prisma.hostedMember.deleteMany({
          where: {
            id: { in: [payerMemberId, beneficiaryMemberId, foreignMemberId] },
          },
        });
        await prisma.$disconnect();
      }
    });
  },
);
