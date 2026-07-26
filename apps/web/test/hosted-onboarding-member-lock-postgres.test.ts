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
import {
  suspendHostedMemberForBillingReversalTx,
  writeHostedMemberStripeBillingTx,
} from "@/src/lib/hosted-onboarding/stripe-billing-policy";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { runHostedAccountDeletionCleanup } from "@/src/lib/hosted-privacy/account-deletion-cleanup";
import { deleteHostedAccountData } from "@/src/lib/hosted-privacy/account-data-service";
import { createPrismaClient } from "@/src/lib/prisma";

const privyProvider = vi.hoisted(() => ({
  deleteUser: vi.fn(async () => {
    privyProvider.exists = false;
    return true;
  }),
  exists: true,
  readUser: vi.fn(async (userId: string) => {
    if (!privyProvider.exists) {
      throw new Error("Privy user no longer exists.");
    }
    return { id: userId };
  }),
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

    it("carries billing-owned suspension through ordinary progress until a fresh restore", async () => {
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
            lastStripeEventCreatedAt: invoicePaidAt,
          },
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: invoicePaidAt,
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
        ).toEqual([]);
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
