import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  createHostedPhoneLookupKey,
  createHostedPrivyUserLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  commitPreparedHostedMemberIdentityWriteTx,
  lookupHostedMemberIdentityByPhoneNumber,
  prepareHostedMemberIdentityWrite,
  readHostedMemberIdentity,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  readHostedMemberCoreState,
  readHostedMemberSnapshot,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedPersistedPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import {
  ensureHostedMemberForPhoneResolutionTx,
  reconcileHostedPrivyIdentityOnMemberTx,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import {
  acquireHostedPrivyPhoneTransferPhoneLocksTx,
  assertHostedPrivyPhoneTransferSourceRetirementFenceTx,
} from "@/src/lib/hosted-onboarding/privy-phone-transfer-retirement";
import {
  commitPreparedHostedMemberChannelsUpdatedTx,
  enqueueHostedMemberChannelsUpdatedTx,
  prepareHostedMemberChannelsUpdatedForSnapshot,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

const domainRootMocks = vi.hoisted(() => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly:
    vi.fn(async (input: { userId: string }) => {
      void input;
      return undefined;
    }),
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    provisionActiveHostedDomainRootEnvelopeForUserOnly:
      domainRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly,
  };
});

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;
const targetPhoneNumberBeforeTransfer = "+15550100001";
const transferPhoneNumber = "+15550100002";
const transferAt = new Date("2026-07-30T22:00:00.000Z");

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Privy phone-transfer concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type PhoneTransferFixture = {
  sourceMemberId: string;
  sourcePrivyUserId: string;
  targetMemberId: string;
  targetPrivyUserId: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "Privy phone-transfer PostgreSQL concurrency",
  () => {
    it("lets an admitted old-phone writer finish before the transfer wins both phone locks", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const oldPhoneWriter = createPrismaClient({ databaseUrl, poolMax: 1 });
      const transferWriter = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await createFixture(observer);
      const oldWriterReachedPostLookupUpsert = createDeferred();
      const releaseOldWriter = createDeferred();
      const transferPid = createDeferred<number>();
      let oldWriterTransaction: Promise<void> | null = null;
      let transferTransaction: Promise<void> | null = null;
      let sourceDeleteCount = 0;

      configureIdentityPrivateFieldCodec();
      domainRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly
        .mockReset()
        .mockImplementationOnce(async (input): Promise<undefined> => {
          expect(input.userId).toBe(fixture.targetMemberId);
          oldWriterReachedPostLookupUpsert.resolve();
          await releaseOldWriter.promise;
          return undefined;
        })
        .mockResolvedValue(undefined);

      try {
        oldWriterTransaction = oldPhoneWriter.$transaction(async (tx) => {
          const resolution = await ensureHostedMemberForPhoneResolutionTx({
            phoneNumber: targetPhoneNumberBeforeTransfer,
            prisma: tx,
          });
          expect(resolution).toMatchObject({
            created: false,
            member: {
              id: fixture.targetMemberId,
            },
          });
        }, transactionOptions);
        await Promise.race([
          oldWriterReachedPostLookupUpsert.promise,
          oldWriterTransaction.then(() => {
            throw new Error(
              "The old-phone writer completed before its post-lookup pause.",
            );
          }),
        ]);

        transferTransaction = transferWriter.$transaction(async (tx) => {
          transferPid.resolve(await readBackendPid(tx));
          await commitTransferredPhone({
            fixture,
            onSourceDeleted: () => {
              sourceDeleteCount += 1;
            },
            tx,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer,
          pid: await transferPid.promise,
        });
        releaseOldWriter.resolve();
        await expect(oldWriterTransaction).resolves.toBeUndefined();
        await expect(transferTransaction).resolves.toBeUndefined();

        await expectPhoneOwnership({
          expectedTargetPhoneNumber: transferPhoneNumber,
          fixture,
          observer,
        });
        expect(sourceDeleteCount).toBe(1);
      } finally {
        releaseOldWriter.resolve();
        await Promise.allSettled([
          ...(oldWriterTransaction ? [oldWriterTransaction] : []),
          ...(transferTransaction ? [transferTransaction] : []),
        ]);
        resetTestSeams();
        await deleteFixtureMembers({
          fixture,
          observer,
        });
        await disconnectClients([observer, oldPhoneWriter, transferWriter]);
      }
    });

    it("makes later old-phone work wait until the transfer commits without rebinding the target", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const oldPhoneWriter = createPrismaClient({ databaseUrl, poolMax: 1 });
      const transferWriter = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await createFixture(observer);
      const transferOwnsPhoneLocks = createDeferred();
      const releaseTransfer = createDeferred();
      const oldWriterPid = createDeferred<number>();
      let oldPhoneResolution:
        Awaited<ReturnType<typeof ensureHostedMemberForPhoneResolutionTx>>
        | null = null;
      let oldWriterTransaction:
        Promise<Awaited<ReturnType<typeof ensureHostedMemberForPhoneResolutionTx>>>
        | null = null;
      let transferTransaction: Promise<void> | null = null;
      let sourceDeleteCount = 0;

      configureIdentityPrivateFieldCodec();
      domainRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly
        .mockReset()
        .mockResolvedValue(undefined);

      try {
        transferTransaction = transferWriter.$transaction(async (tx) => {
          await acquireHostedPrivyPhoneTransferPhoneLocksTx({
            prisma: tx,
            targetPhoneNumberBeforeTransfer,
            transferPhoneNumber,
          });
          transferOwnsPhoneLocks.resolve();
          await releaseTransfer.promise;
          await commitTransferredPhoneAfterPhoneLocks({
            fixture,
            onSourceDeleted: () => {
              sourceDeleteCount += 1;
            },
            tx,
          });
        }, transactionOptions);
        await Promise.race([
          transferOwnsPhoneLocks.promise,
          transferTransaction.then(() => {
            throw new Error(
              "The transfer completed before holding its phone locks.",
            );
          }),
        ]);

        oldWriterTransaction = oldPhoneWriter.$transaction(async (tx) => {
          oldWriterPid.resolve(await readBackendPid(tx));
          return ensureHostedMemberForPhoneResolutionTx({
            phoneNumber: targetPhoneNumberBeforeTransfer,
            prisma: tx,
          });
        }, transactionOptions);

        await waitForBlockedBackend({
          observer,
          pid: await oldWriterPid.promise,
        });
        releaseTransfer.resolve();
        await expect(transferTransaction).resolves.toBeUndefined();
        oldPhoneResolution = await oldWriterTransaction;

        expect(oldPhoneResolution).toMatchObject({
          created: true,
        });
        expect(oldPhoneResolution?.member.id).not.toBe(fixture.targetMemberId);
        await expectPhoneOwnership({
          expectedTargetPhoneNumber: transferPhoneNumber,
          fixture,
          observer,
        });
        const oldPhoneOwner = await lookupHostedMemberIdentityByPhoneNumber({
          phoneNumber: targetPhoneNumberBeforeTransfer,
          prisma: observer,
        });
        expect(oldPhoneOwner?.core.id).toBe(oldPhoneResolution?.member.id);
        expect(oldPhoneOwner?.core.id).not.toBe(fixture.targetMemberId);
        expect(sourceDeleteCount).toBe(1);
      } finally {
        releaseTransfer.resolve();
        await Promise.allSettled([
          ...(oldWriterTransaction ? [oldWriterTransaction] : []),
          ...(transferTransaction ? [transferTransaction] : []),
        ]);
        resetTestSeams();
        await deleteFixtureMembers({
          additionalMemberIds: oldPhoneResolution
            ? [oldPhoneResolution.member.id]
            : [],
          fixture,
          observer,
        });
        await disconnectClients([observer, oldPhoneWriter, transferWriter]);
      }
    });

    it.each([
      {
        label: "a missing prior target phone",
        targetPhoneNumber: null,
        transferredPhoneNumber: transferPhoneNumber,
      },
      {
        label: "equivalent prior and transferred phones",
        targetPhoneNumber: "1 (555) 010-0002",
        transferredPhoneNumber: transferPhoneNumber,
      },
    ])(
      "takes one PostgreSQL advisory lock for $label",
      async ({ targetPhoneNumber, transferredPhoneNumber }) => {
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });

        try {
          await observer.$transaction(async (tx) => {
            await acquireHostedPrivyPhoneTransferPhoneLocksTx({
              prisma: tx,
              targetPhoneNumberBeforeTransfer: targetPhoneNumber,
              transferPhoneNumber: transferredPhoneNumber,
            });
            await expect(readCurrentBackendAdvisoryLockCount(tx)).resolves.toBe(1);
          }, transactionOptions);
        } finally {
          await observer.$disconnect();
        }
      },
    );

    it("prepares encrypted target identity fields before the terminal source-delete transaction", async () => {
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const fixture = await createFixture(observer);
      const transferLookupKey = createHostedPhoneLookupKey(transferPhoneNumber);
      let terminalTransactionActive = false;
      let encryptionCalls = 0;
      let encryptionCallsDuringTerminalTransaction = 0;
      let forcePreparedEncryptionFailure = false;
      let rootPreparationCallsDuringTerminalTransaction = 0;
      const terminalPrivateCodecError =
        "private identity codec invoked inside terminal transaction";
      domainRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly
        .mockReset()
        .mockImplementation(async () => {
          if (terminalTransactionActive) {
            rootPreparationCallsDuringTerminalTransaction += 1;
          }
          return undefined;
        });
      setHostedSecureBoxStringTestCodecForTests({
        decrypt(input) {
          if (terminalTransactionActive) {
            throw new Error(terminalPrivateCodecError);
          }
          return input.value;
        },
        encrypt(input) {
          encryptionCalls += 1;
          if (forcePreparedEncryptionFailure) {
            throw new Error("forced prepared channel encryption failure");
          }
          if (terminalTransactionActive) {
            encryptionCallsDuringTerminalTransaction += 1;
            throw new Error(terminalPrivateCodecError);
          }
          return input.value;
        },
      });

      try {
        if (!transferLookupKey) {
          throw new Error("Expected a transfer phone lookup key.");
        }
        await observer.hostedMember.update({
          data: { suspendedAt: transferAt },
          where: { id: fixture.sourceMemberId },
        });
        const [currentIdentity, currentSnapshot, targetMember] = await Promise.all([
          readHostedMemberIdentity({
            memberId: fixture.targetMemberId,
            prisma: observer,
          }),
          readHostedMemberSnapshot({
            memberId: fixture.targetMemberId,
            prisma: observer,
          }),
          readHostedMemberCoreState({
            memberId: fixture.targetMemberId,
            prisma: observer,
          }),
        ]);
        if (!currentIdentity || !currentSnapshot || !targetMember) {
          throw new Error("Expected the phone-transfer target snapshot.");
        }
        const transferredPrivyIdentity = {
          phone: {
            number: transferPhoneNumber,
            verifiedAt: transferAt.getTime(),
          },
          telegram: null,
          userId: fixture.targetPrivyUserId,
        };
        await assertHostedPrivyPhoneTransferSourceRetirementFenceTx({
          identity: transferredPrivyIdentity,
          member: targetMember,
          prisma: observer,
          targetPhoneNumberBeforeTransfer,
          transfer: {
            phoneNumber: transferPhoneNumber,
            sourceMemberId: fixture.sourceMemberId,
            sourcePrivyUserId: fixture.sourcePrivyUserId,
          },
        });
        const nextPhoneIdentity = buildHostedPersistedPhoneIdentityFields({
          currentIdentity,
          now: transferAt,
          phone: transferredPrivyIdentity.phone,
        });
        const prepared = await prepareHostedMemberIdentityWrite({
          ...nextPhoneIdentity,
          memberId: fixture.targetMemberId,
          prisma: observer,
          privyUserId: fixture.targetPrivyUserId,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: null,
        });
        forcePreparedEncryptionFailure = true;
        await expect(prepareHostedMemberChannelsUpdatedForSnapshot({
          emailLinked: false,
          member: currentSnapshot,
          memberId: fixture.targetMemberId,
          occurredAt: new Date(transferAt.getTime() - 2_000).toISOString(),
          prisma: observer,
          sourceType: "settings.phone.failed-preparation",
        })).rejects.toThrow("forced prepared channel encryption failure");
        forcePreparedEncryptionFailure = false;
        await expect(observer.hostedMailboxLaneCounter.count({
          where: { userId: fixture.targetMemberId },
        })).resolves.toBe(0);
        const preparedChannelAppend =
          await prepareHostedMemberChannelsUpdatedForSnapshot({
            emailLinked: false,
            member: {
              ...currentSnapshot,
              identity: {
                ...currentIdentity,
                ...nextPhoneIdentity,
                privyUserId: fixture.targetPrivyUserId,
                signupPhoneCodeSendAttemptId: null,
                signupPhoneCodeSendAttemptStartedAt: null,
                signupPhoneCodeSentAt: null,
                signupPhoneNumber: null,
              },
            },
            memberId: fixture.targetMemberId,
            occurredAt: transferAt.toISOString(),
            prisma: observer,
            sourceType: "settings.phone.sync",
          });
        expect(encryptionCalls).toBeGreaterThan(0);
        await expect(observer.hostedMailboxLaneCounter.count({
          where: { userId: fixture.targetMemberId },
        })).resolves.toBe(0);

        await expect(observer.$transaction(async (tx) => {
          terminalTransactionActive = true;
          await commitPreparedHostedMemberChannelsUpdatedTx({
            prepared: preparedChannelAppend,
            prisma: tx,
          });
          terminalTransactionActive = false;
          throw new Error("forced terminal fingerprint rejection");
        }, transactionOptions)).rejects.toThrow(
          "forced terminal fingerprint rejection",
        );
        terminalTransactionActive = false;
        await expect(observer.hostedMailboxLaneCounter.count({
          where: { userId: fixture.targetMemberId },
        })).resolves.toBe(0);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: fixture.targetMemberId },
        })).resolves.toBe(0);

        await observer.$transaction((tx) =>
          enqueueHostedMemberChannelsUpdatedTx({
            emailLinked: false,
            memberId: fixture.targetMemberId,
            occurredAt: new Date(transferAt.getTime() - 1_000).toISOString(),
            prisma: tx,
            sourceType: "settings.phone.concurrent-update",
          })
        );

        await observer.$transaction(async (tx) => {
          await acquireHostedPrivyPhoneTransferPhoneLocksTx({
            prisma: tx,
            targetPhoneNumberBeforeTransfer,
            transferPhoneNumber,
          });
          for (const memberId of [
            fixture.sourceMemberId,
            fixture.targetMemberId,
          ].sort()) {
            await lockHostedMemberRow(tx, memberId);
          }
          terminalTransactionActive = true;
          await tx.hostedMember.delete({
            where: { id: fixture.sourceMemberId },
          });
          await commitPreparedHostedMemberIdentityWriteTx({
            memberId: fixture.targetMemberId,
            prepared,
            prisma: tx,
          });
          await commitPreparedHostedMemberChannelsUpdatedTx({
            prepared: preparedChannelAppend,
            prisma: tx,
          });
          terminalTransactionActive = false;
        }, transactionOptions);

        expect(encryptionCallsDuringTerminalTransaction).toBe(0);
        expect(rootPreparationCallsDuringTerminalTransaction).toBe(0);
        await expectPhoneOwnership({
          expectedTargetPhoneNumber: transferPhoneNumber,
          fixture,
          observer,
        });
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "member.channels.updated",
            userId: fixture.targetMemberId,
          },
        })).resolves.toBe(2);
        await expect(observer.hostedMailboxItem.findMany({
          orderBy: { laneSeq: "asc" },
          select: { causalSeq: true, laneSeq: true },
          where: {
            kind: "member.channels.updated",
            userId: fixture.targetMemberId,
          },
        })).resolves.toEqual([
          { causalSeq: 1n, laneSeq: 1n },
          { causalSeq: 2n, laneSeq: 2n },
        ]);
        await expect(observer.hostedMailboxLaneCounter.findMany({
          orderBy: { lane: "asc" },
          select: { lane: true, nextSeq: true },
          where: { userId: fixture.targetMemberId },
        })).resolves.toEqual([
          { lane: "causal", nextSeq: 3n },
          { lane: "system", nextSeq: 3n },
        ]);

        await observer.$transaction(async (tx) => {
          terminalTransactionActive = true;
          await expect(prepareHostedMemberIdentityWrite({
            maskedPhoneNumberHint: "•••0002",
            memberId: fixture.targetMemberId,
            phoneLookupKey: transferLookupKey,
            phoneNumber: transferPhoneNumber,
            phoneNumberVerifiedAt: transferAt,
            prisma: tx as never,
            privyUserId: fixture.targetPrivyUserId,
            signupPhoneCodeSendAttemptId: null,
            signupPhoneCodeSendAttemptStartedAt: null,
            signupPhoneCodeSentAt: null,
            signupPhoneNumber: null,
          })).rejects.toThrow(terminalPrivateCodecError);
          terminalTransactionActive = false;
        });
        expect(rootPreparationCallsDuringTerminalTransaction).toBe(1);
      } finally {
        terminalTransactionActive = false;
        forcePreparedEncryptionFailure = false;
        resetTestSeams();
        await deleteFixtureMembers({ fixture, observer });
        await observer.$disconnect();
      }
    });
  },
);

async function createFixture(
  prisma: PrismaClient,
): Promise<PhoneTransferFixture> {
  const fixtureId = randomUUID();
  const fixture = {
    sourceMemberId: `member_phone_transfer_source_${fixtureId}`,
    sourcePrivyUserId: `did:privy:phone-transfer-source-${fixtureId}`,
    targetMemberId: `member_phone_transfer_target_${fixtureId}`,
    targetPrivyUserId: `did:privy:phone-transfer-target-${fixtureId}`,
  };
  const sourcePhoneLookupKey = createHostedPhoneLookupKey(transferPhoneNumber);
  const sourcePrivyUserLookupKey = createHostedPrivyUserLookupKey(
    fixture.sourcePrivyUserId,
  );
  const targetPhoneLookupKey = createHostedPhoneLookupKey(
    targetPhoneNumberBeforeTransfer,
  );
  const targetPrivyUserLookupKey = createHostedPrivyUserLookupKey(
    fixture.targetPrivyUserId,
  );

  if (
    !sourcePhoneLookupKey
    || !sourcePrivyUserLookupKey
    || !targetPhoneLookupKey
    || !targetPrivyUserLookupKey
  ) {
    throw new Error("Expected lookup keys for the phone-transfer fixture.");
  }

  await prisma.hostedMember.createMany({
    data: [
      {
        billingStatus: HostedBillingStatus.not_started,
        id: fixture.sourceMemberId,
      },
      {
        billingStatus: HostedBillingStatus.active,
        id: fixture.targetMemberId,
      },
    ],
  });
  await prisma.hostedMemberIdentity.createMany({
    data: [
      {
        memberId: fixture.sourceMemberId,
        phoneLookupKey: sourcePhoneLookupKey,
        phoneNumberEncrypted: transferPhoneNumber,
        privyUserIdEncrypted: fixture.sourcePrivyUserId,
        privyUserLookupKey: sourcePrivyUserLookupKey,
      },
      {
        memberId: fixture.targetMemberId,
        phoneLookupKey: targetPhoneLookupKey,
        phoneNumberEncrypted: targetPhoneNumberBeforeTransfer,
        privyUserIdEncrypted: fixture.targetPrivyUserId,
        privyUserLookupKey: targetPrivyUserLookupKey,
      },
    ],
  });

  return fixture;
}

async function commitTransferredPhone(input: {
  fixture: PhoneTransferFixture;
  onSourceDeleted: () => void;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await acquireHostedPrivyPhoneTransferPhoneLocksTx({
    prisma: input.tx,
    targetPhoneNumberBeforeTransfer,
    transferPhoneNumber,
  });
  await commitTransferredPhoneAfterPhoneLocks(input);
}

async function commitTransferredPhoneAfterPhoneLocks(input: {
  fixture: PhoneTransferFixture;
  onSourceDeleted: () => void;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  for (const memberId of [
    input.fixture.sourceMemberId,
    input.fixture.targetMemberId,
  ].sort()) {
    await lockHostedMemberRow(input.tx, memberId);
  }

  const targetMember = await readHostedMemberCoreState({
    memberId: input.fixture.targetMemberId,
    prisma: input.tx,
  });
  if (!targetMember) {
    throw new Error("Expected the phone-transfer target member.");
  }

  await input.tx.hostedMember.delete({
    where: {
      id: input.fixture.sourceMemberId,
    },
  });
  input.onSourceDeleted();
  await reconcileHostedPrivyIdentityOnMemberTx({
    authMethod: "phone",
    identity: {
      phone: {
        number: transferPhoneNumber,
        verifiedAt: transferAt.getTime(),
      },
      telegram: null,
      userId: input.fixture.targetPrivyUserId,
    },
    member: targetMember,
    now: transferAt,
    prisma: input.tx,
  });
}

async function expectPhoneOwnership(input: {
  expectedTargetPhoneNumber: string;
  fixture: PhoneTransferFixture;
  observer: PrismaClient;
}): Promise<void> {
  const targetOwner = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.expectedTargetPhoneNumber,
    prisma: input.observer,
  });
  expect(targetOwner?.core.id).toBe(input.fixture.targetMemberId);
  await expect(input.observer.hostedMember.count({
    where: {
      id: input.fixture.sourceMemberId,
    },
  })).resolves.toBe(0);
}

function configureIdentityPrivateFieldCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      return input.value;
    },
    encrypt(input) {
      return input.value;
    },
  });
}

function resetTestSeams(): void {
  domainRootMocks.provisionActiveHostedDomainRootEnvelopeForUserOnly
    .mockReset()
    .mockResolvedValue(undefined);
  setHostedSecureBoxStringTestCodecForTests(null);
}

async function deleteFixtureMembers(input: {
  additionalMemberIds?: string[];
  fixture: PhoneTransferFixture;
  observer: PrismaClient;
}): Promise<void> {
  await input.observer.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          input.fixture.sourceMemberId,
          input.fixture.targetMemberId,
          ...(input.additionalMemberIds ?? []),
        ],
      },
    },
  });
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

async function readCurrentBackendAdvisoryLockCount(
  tx: Prisma.TransactionClient,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lockCount: bigint }>>`
    SELECT COUNT(*) AS "lockCount"
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_backend_pid()
      AND granted = TRUE
  `;
  return Number(rows[0]?.lockCount ?? -1);
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
  throw new Error(
    "Expected the concurrent phone identity writer to wait on its current owner.",
  );
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
