import { randomUUID } from "node:crypto";

import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedPrivyUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  HostedMemberStripeMutationLockBusyError,
  withHostedMemberStripeMutationLockForOps,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { readHostedMemberBillingSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { ensureHostedMemberForPrivyIdentityResolutionTx } from "@/src/lib/hosted-onboarding/member-identity-service";
import { suspendHostedMemberForBillingReversalTx } from "@/src/lib/hosted-onboarding/stripe-billing-policy";
import { createPrismaClient } from "@/src/lib/prisma";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");

  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn(async () => undefined),
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
  },
);

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Privy re-creation and account-deletion PostgreSQL concurrency",
  () => {
    it("rolls back a replacement identity when deletion commits after the initial receipt check", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const authenticationClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixtureId = randomUUID();
      const oldMemberId = `hbm_privy_delete_${fixtureId}`;
      const cleanupId = `hbadc_privy_delete_${fixtureId}`;
      const privyUserId = `did:privy:delete-race-${fixtureId}`;
      const privyUserLookupKey = createHostedPrivyUserLookupKey(privyUserId);
      const initialReceiptCheckCompleted = createDeferred();
      const allowAuthenticationToContinue = createDeferred();
      let authentication: Promise<unknown> | null = null;

      if (!privyUserLookupKey) {
        throw new Error("Expected a Privy user lookup key for the concurrency fixture.");
      }

      await observer.hostedMember.create({
        data: { id: oldMemberId },
      });
      await observer.hostedMemberIdentity.create({
        data: {
          memberId: oldMemberId,
          privyUserLookupKey,
        },
      });
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
            prisma: pauseAfterInitialAccountDeletionReceiptCheck({
              allowAuthenticationToContinue,
              initialReceiptCheckCompleted,
              tx,
            }),
          }), { timeout: transactionTimeoutMs });

        await initialReceiptCheckCompleted.promise;
        await deletionClient.$transaction(async (tx) => {
          await tx.hostedAccountDeletionCleanup.create({
            data: {
              environment: "test",
              id: cleanupId,
              kmsKeyName: "projects/test/locations/global/keyRings/test/cryptoKeys/delete-race",
              nextAttemptAt: new Date("2026-07-26T18:00:00.000Z"),
              payloadCiphertext: "test-ciphertext",
              privyUserLookupKey,
            },
          });
          await tx.hostedMember.delete({
            where: { id: oldMemberId },
          });
        }, { timeout: transactionTimeoutMs });
        allowAuthenticationToContinue.resolve();

        await expect(authentication).rejects.toMatchObject({
          code: "PRIVY_ACCOUNT_DELETION_IN_PROGRESS",
          retryable: true,
        });
        await expect(observer.hostedAccountDeletionCleanup.findUnique({
          where: { id: cleanupId },
        })).resolves.not.toBeNull();
        await expect(observer.hostedMemberIdentity.count({
          where: { privyUserLookupKey },
        })).resolves.toBe(0);
      } finally {
        allowAuthenticationToContinue.resolve();
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

function pauseAfterInitialAccountDeletionReceiptCheck(input: {
  allowAuthenticationToContinue: Deferred<void>;
  initialReceiptCheckCompleted: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  let receiptReadCount = 0;
  const hostedAccountDeletionCleanup = new Proxy(
    input.tx.hostedAccountDeletionCleanup,
    {
      get(target, property) {
        if (property === "findFirst") {
          return async (
            args: Prisma.HostedAccountDeletionCleanupFindFirstArgs,
          ) => {
            const result = await target.findFirst(args);
            receiptReadCount += 1;
            if (receiptReadCount === 1) {
              input.initialReceiptCheckCompleted.resolve();
              await input.allowAuthenticationToContinue.promise;
            }
            return result;
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
