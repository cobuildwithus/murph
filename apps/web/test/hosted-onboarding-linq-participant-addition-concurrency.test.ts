import { generateKeyPairSync, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  deleteHostedAddressBookProjection,
  parseHostedAddressBookDeleteRequest,
  parseHostedAddressBookReplaceRequest,
  replaceHostedAddressBookProjection,
} from "@/src/lib/hosted-address-book/projection";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  markHostedAiUsageLimitNoticeDeliveryRetryableTx,
  startHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  startAuthorizedHostedAiUsageLimitNoticeDispatchTx,
} from "@/src/lib/hosted-execution/usage-limit-notice-claim";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import {
  ensureHostedThreadContainerRouteTx,
  type PreparedHostedThreadContainerCreation,
} from "@/src/lib/hosted-routing/thread-container-service";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  sealHostedThreadDeliveryRoute,
  type HostedThreadDeliveryRouteChannel,
} from "@/src/lib/hosted-routing/thread-delivery-route";
import {
  consumeHostedLinqThreadRouteParticipantAdditionPendingTx,
  lockHostedThreadRouteByThreadIdentityTx,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
} from "@/src/lib/hosted-routing/thread-route-store";
import type {
  HostedLinqParticipantChangedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  applyHostedLinqParticipantChangeToRouteTx,
} from "@/src/lib/hosted-onboarding/webhook-service";
import {
  HOSTED_CRYPTO_DOMAINS,
  HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
} from "@murphai/runtime-state";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type RouteFixture = {
  containerMemberId: string;
  messageClient: PrismaClient;
  observer: PrismaClient;
  ownerMemberId: string;
  participantClient: PrismaClient;
  threadId: string;
  threadIdentityLookupKey: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function buildPreparedThreadContainerCreation(input: {
  accountLookupKey: string;
  channel?: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  prisma: PrismaClient;
  threadId: string;
}): Promise<PreparedHostedThreadContainerCreation> {
  const channel = input.channel ?? "linq";
  const deliveryRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: input.accountLookupKey,
    channel,
    threadId: input.threadId,
  });
  const preparedAt = "2026-08-09T11:59:00.000Z";
  return {
    containerMemberId: input.containerMemberId,
    cryptoDomainRoots: new Map(HOSTED_CRYPTO_DOMAINS.map((domain) => [
      domain,
      {
        authoritySignature: {
          alg: "GCP-KMS-EC-P256-SHA256",
          keyVersionName: "test-authority-key-version",
          signature: "test-authority-signature",
          signedAt: preparedAt,
        },
        createdAt: preparedAt,
        domain,
        generation: 1,
        rootKeyId: `test-root:${domain}:${input.containerMemberId}`,
        schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
        updatedAt: preparedAt,
        userId: input.containerMemberId,
        wraps: [{
          recipient: HOSTED_CRYPTO_DOMAIN_RECIPIENT_KINDS[domain][0],
        }],
      } as never,
    ])),
    deliveryRoute,
    deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
      containerMemberId: input.containerMemberId,
      prisma: input.prisma,
      route: deliveryRoute,
    }),
  };
}

async function createRouteFixture(): Promise<RouteFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const ownerMemberId = `member_linq_lock_owner_${fixtureId}`;
  const containerMemberId = `member_linq_lock_container_${fixtureId}`;
  const threadId = `chat_linq_lock_${fixtureId}`;
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId,
  });
  if (!threadIdentityLookupKey) {
    throw new Error("Expected a Linq thread identity lookup key.");
  }

  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const participantClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const messageClient = createPrismaClient({ databaseUrl, poolMax: 1 });

  await observer.hostedMember.createMany({
    data: [
      { id: ownerMemberId },
      { id: containerMemberId },
    ],
  });
  // The hosted secure-box test codec in test/setup-env.ts short-circuits seal
  // and open before any domain-root lookup, so this fixture must not provision
  // real crypto roots: doing so would require the GCP authority key that the
  // PostgreSQL-ordering CI lane deliberately does not configure.
  await observer.hostedThreadContainer.create({
    data: {
      memberId: containerMemberId,
      ownerMemberId,
    },
  });
  await observer.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId,
      pendingParticipantAddition: false,
      threadIdentityLookupKey,
      threadLookupKey: `linq-lock-proof:${fixtureId}`,
    },
  });

  return {
    containerMemberId,
    messageClient,
    observer,
    ownerMemberId,
    participantClient,
    threadId,
    threadIdentityLookupKey,
  };
}

async function cleanupRouteFixture(fixture: RouteFixture): Promise<void> {
  await fixture.observer.hostedThreadRoute.deleteMany({
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  const container = await fixture.observer.hostedThreadContainer.findUnique({
    select: { ownerMemberId: true },
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.containerMemberId },
  });
  await fixture.observer.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.containerMemberId,
          ...(container ? [container.ownerMemberId] : []),
        ],
      },
    },
  });
  await Promise.all([
    fixture.messageClient.$disconnect(),
    fixture.participantClient.$disconnect(),
    fixture.observer.$disconnect(),
  ]);
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
  for (let attempt = 0; attempt < 200; attempt += 1) {
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

async function readPendingParticipantAddition(
  fixture: RouteFixture,
): Promise<boolean | null> {
  const route = await fixture.observer.hostedThreadRoute.findFirst({
    select: { pendingParticipantAddition: true },
    where: {
      channel: "linq",
      threadIdentityLookupKey: fixture.threadIdentityLookupKey,
    },
  });
  return route?.pendingParticipantAddition ?? null;
}

const ADDRESS_BOOK_ENV_KEYS = [
  "HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED",
  "HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_ADDRESS_BOOK_MAC_KEYRING_JSON",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
] as const;

function configureHostedAddressBookLocalCryptoForTest(): () => void {
  const previous = new Map(
    ADDRESS_BOOK_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  const authorityKeyVersion =
    "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1";
  const addressBookKeyVersion =
    "projects/test/locations/global/keyRings/test/cryptoKeys/address-book/cryptoKeyVersions/1";
  Object.assign(process.env, {
    HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED: "1",
    HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED: "1",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "test-automation-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_ADDRESS_BOOK_MAC_KEYRING_JSON: JSON.stringify({
      currentVersion: 1,
      keyVersionNames: { 1: addressBookKeyVersion },
      readVersions: [1],
    }),
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: authorityKeyVersion,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  return () => {
    for (const [key, value] of previous) {
      restoreEnvValue(key, value);
    }
  };
}

async function prepareAddressBookLabelFixture(
  fixture: RouteFixture,
  participantHandle: string,
): Promise<void> {
  await fixture.observer.hostedMember.updateMany({
    data: { billingStatus: "active" },
    where: {
      id: {
        in: [fixture.containerMemberId, fixture.ownerMemberId],
      },
    },
  });
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({
      memberId: fixture.ownerMemberId,
      prisma: fixture.observer,
      scope,
      source: "participant-context-concurrency-test",
    });
  }
  await replaceHostedAddressBookProjection({
    memberId: fixture.ownerMemberId,
    prisma: fixture.observer,
    request: parseHostedAddressBookReplaceRequest({
      baseRevision: 0,
      contacts: [{
        advisoryName: "Taylor R.",
        phoneNumber: participantHandle,
      }],
      mutationId: randomUUID(),
      schemaVersion: 1,
    }),
  });
}

function buildParticipantChangeEvent(input: {
  eventType: HostedLinqParticipantChangedEvent["event_type"];
  handle: string;
  threadId: string;
}): HostedLinqParticipantChangedEvent {
  const base = {
    api_version: "v3",
    created_at: "2026-07-29T01:00:00.000Z",
    data: {
      chat_id: input.threadId,
      participant: {
        handle: input.handle,
        service: "iMessage",
      },
    },
    event_id: `evt_${randomUUID()}`,
  };
  return input.eventType === "participant.added"
    ? { ...base, event_type: "participant.added" }
    : { ...base, event_type: "participant.removed" };
}

function readHostedSecureBoxTestValue(ciphertext: string): string {
  const encoded = ciphertext.replace(/^hsb-test:/u, "");
  const decoded = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as { value?: unknown };
  if (typeof decoded.value !== "string") {
    throw new Error("Expected a hosted secure-box test value.");
  }
  return decoded.value;
}

function observeParticipantContextRouteWrite(input: {
  ciphertext: Deferred<string>;
  release?: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedThreadRoute = new Proxy(input.tx.hostedThreadRoute, {
    get(target, property) {
      if (property === "updateMany") {
        return async (args: Prisma.HostedThreadRouteUpdateManyArgs) => {
          const result = await target.updateMany(args);
          const encrypted = args.data.pendingGroupReactionContextEncrypted;
          if (typeof encrypted === "string") {
            input.ciphertext.resolve(encrypted);
            await input.release?.promise;
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedThreadRoute") {
        return hostedThreadRoute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseAddressBookClearBeforeCommit(input: {
  cleared: Deferred<void>;
  client: PrismaClient;
  release: Deferred<void>;
}): PrismaClient {
  return new Proxy(input.client, {
    get(target, property) {
      if (property === "$transaction") {
        return (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            maxWait?: number;
            timeout?: number;
          },
        ) => target.$transaction(async (tx) => callback(
          new Proxy<Prisma.TransactionClient>(tx, {
            get(transaction, transactionProperty) {
              if (transactionProperty === "hostedThreadRoute") {
                return new Proxy(transaction.hostedThreadRoute, {
                  get(delegate, delegateProperty) {
                    if (delegateProperty === "updateMany") {
                      return async (
                        args: Prisma.HostedThreadRouteUpdateManyArgs,
                      ) => {
                        const result = await delegate.updateMany(args);
                        if (
                          args.data.pendingGroupReactionContextEncrypted === null
                        ) {
                          input.cleared.resolve();
                          await input.release.promise;
                        }
                        return result;
                      };
                    }
                    const value = Reflect.get(
                      delegate,
                      delegateProperty,
                      delegate,
                    );
                    return typeof value === "function"
                      ? value.bind(delegate)
                      : value;
                  },
                });
              }
              const value = Reflect.get(
                transaction,
                transactionProperty,
                transaction,
              );
              return typeof value === "function"
                ? value.bind(transaction)
                : value;
            },
          }),
        ), options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function configureHostedContactPrivacyKeyringForTest(currentVersion: string): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = [
    `v1:${Buffer.alloc(32, 3).toString("base64url")}`,
    `v2:${Buffer.alloc(32, 4).toString("base64url")}`,
  ].join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = currentVersion;
  clearHostedOnboardingEnvCache();
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function pauseHostedThreadRouteUpdateAfterWrite(input: {
  release: Deferred<void>;
  tx: Prisma.TransactionClient;
  updated: Deferred<void>;
}): Prisma.TransactionClient {
  const hostedThreadRoute = new Proxy(input.tx.hostedThreadRoute, {
    get(target, property) {
      if (property === "update") {
        return async (args: Prisma.HostedThreadRouteUpdateArgs) => {
          const route = await target.update(args);
          input.updated.resolve();
          await input.release.promise;
          return route;
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "hostedThreadRoute") {
        return hostedThreadRoute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function observeHostedThreadRouteLockAttempt(input: {
  attempted: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "$executeRaw") {
        input.attempted.resolve();
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "Linq participant-addition PostgreSQL ordering",
  () => {
    it("serializes mixed-version Telegram creators on the raw external thread", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
      const previousPrivacyCurrentVersion =
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      const fixtureId = randomUUID();
      const threadId = `chat_thread_create_race_${fixtureId}`;
      const accountLookupKey = HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY;
      const ownerMemberIds = [
        `member_thread_create_owner_a_${fixtureId}`,
        `member_thread_create_owner_b_${fixtureId}`,
      ] as const;
      const containerMemberIds = [
        `member_thread_create_container_a_${fixtureId}`,
        `member_thread_create_container_b_${fixtureId}`,
      ] as const;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const loserClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerCommittedState = createDeferred();
      const releaseWinner = createDeferred();
      const loserAttemptedRouteLock = createDeferred();
      const loserPid = createDeferred<number>();
      let winnerTransaction: Promise<unknown> | null = null;
      let loserTransaction: Promise<unknown> | null = null;

      configureHostedContactPrivacyKeyringForTest("v1");
      try {
        await observer.hostedMember.createMany({
          data: ownerMemberIds.map((id) => ({
            billingStatus: "active" as const,
            id,
          })),
        });
        const [winnerPreparation, loserPreparation] = await Promise.all([
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            channel: "telegram",
            containerMemberId: containerMemberIds[0],
            prisma: winnerClient,
            threadId,
          }),
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            channel: "telegram",
            containerMemberId: containerMemberIds[1],
            prisma: loserClient,
            threadId,
          }),
        ]);
        const v1ThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "telegram",
          threadId,
        });
        if (!v1ThreadIdentityLookupKey) {
          throw new Error("Expected a v1 Telegram thread identity lookup key.");
        }

        winnerTransaction = winnerClient.$transaction(async (tx) => {
          const result = await ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "telegram",
            mailboxDedupeKey: `thread-create-race:winner:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:00.000Z"),
            ownerMemberId: ownerMemberIds[0],
            preparedCreation: winnerPreparation,
            prisma: tx,
            threadId,
          });
          winnerCommittedState.resolve();
          await releaseWinner.promise;
          return result;
        });
        await winnerCommittedState.promise;

        configureHostedContactPrivacyKeyringForTest("v2");
        const v2ThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
          channel: "telegram",
          threadId,
        });
        if (!v2ThreadIdentityLookupKey) {
          throw new Error("Expected a v2 Telegram thread identity lookup key.");
        }
        expect(v2ThreadIdentityLookupKey).not.toBe(v1ThreadIdentityLookupKey);

        loserTransaction = loserClient.$transaction(async (tx) => {
          loserPid.resolve(await readBackendPid(tx));
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "telegram",
            mailboxDedupeKey: `thread-create-race:loser:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:01.000Z"),
            ownerMemberId: ownerMemberIds[1],
            preparedCreation: loserPreparation,
            prisma: observeHostedThreadRouteLockAttempt({
              attempted: loserAttemptedRouteLock,
              tx,
            }),
            threadId,
          });
        });
        await loserAttemptedRouteLock.promise;
        await waitForBlockedBackend({
          observer,
          pid: await loserPid.promise,
        });

        releaseWinner.resolve();
        await expect(winnerTransaction).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
          created: true,
        });
        await expect(loserTransaction).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
          retryable: false,
        });

        await expect(observer.hostedThreadRoute.count({
          where: {
            channel: "telegram",
            containerMemberId: { in: [...containerMemberIds] },
          },
        })).resolves.toBe(1);
        await expect(readHostedThreadRouteByThreadIdentity({
          channel: "telegram",
          prisma: observer,
          threadId,
        })).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
        });
        await expect(observer.hostedThreadRoute.findUnique({
          where: {
            channel_threadIdentityLookupKey: {
              channel: "telegram",
              threadIdentityLookupKey: v1ThreadIdentityLookupKey,
            },
          },
        })).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
        });
        await expect(observer.hostedThreadRoute.findUnique({
          where: {
            channel_threadIdentityLookupKey: {
              channel: "telegram",
              threadIdentityLookupKey: v2ThreadIdentityLookupKey,
            },
          },
        })).resolves.toBeNull();
        await expect(observer.hostedThreadContainer.count({
          where: { memberId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedMember.count({
          where: { id: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedUserCryptoEnvelope.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(HOSTED_CRYPTO_DOMAINS.length);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
      } finally {
        releaseWinner.resolve();
        await Promise.allSettled([
          ...(winnerTransaction ? [winnerTransaction] : []),
          ...(loserTransaction ? [loserTransaction] : []),
        ]);
        restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
        restoreEnvValue(
          "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
          previousPrivacyCurrentVersion,
        );
        clearHostedOnboardingEnvCache();
        await observer.hostedThreadRoute.deleteMany({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [...ownerMemberIds, ...containerMemberIds],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          winnerClient.$disconnect(),
          loserClient.$disconnect(),
        ]);
      }
    });

    it("rolls back stale same-owner preparation after the owner lock winner commits", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const threadId = `chat_thread_owner_race_${fixtureId}`;
      const accountLookupKey = `account_thread_owner_race_${fixtureId}`;
      const ownerMemberId = `member_thread_owner_race_${fixtureId}`;
      const containerMemberIds = [
        `member_thread_owner_winner_${fixtureId}`,
        `member_thread_owner_loser_${fixtureId}`,
      ] as const;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const loserClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const winnerPreparedState = createDeferred();
      const releaseWinner = createDeferred();
      const loserAttemptedRouteLock = createDeferred();
      const loserPid = createDeferred<number>();
      let winnerTransaction: Promise<unknown> | null = null;
      let loserTransaction: Promise<unknown> | null = null;

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: "active",
            id: ownerMemberId,
          },
        });
        const [winnerPreparation, loserPreparation] = await Promise.all([
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            containerMemberId: containerMemberIds[0],
            prisma: winnerClient,
            threadId,
          }),
          buildPreparedThreadContainerCreation({
            accountLookupKey,
            containerMemberId: containerMemberIds[1],
            prisma: loserClient,
            threadId,
          }),
        ]);

        winnerTransaction = winnerClient.$transaction(async (tx) => {
          const result = await ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "linq",
            mailboxDedupeKey: `thread-owner-race:winner:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:00.000Z"),
            ownerMemberId,
            preparedCreation: winnerPreparation,
            prisma: tx,
            threadId,
          });
          winnerPreparedState.resolve();
          await releaseWinner.promise;
          return result;
        });
        await winnerPreparedState.promise;

        loserTransaction = loserClient.$transaction(async (tx) => {
          loserPid.resolve(await readBackendPid(tx));
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey,
            channel: "linq",
            mailboxDedupeKey: `thread-owner-race:loser:${fixtureId}`,
            occurredAt: new Date("2026-08-09T12:00:01.000Z"),
            ownerMemberId,
            preparedCreation: loserPreparation,
            prisma: observeHostedThreadRouteLockAttempt({
              attempted: loserAttemptedRouteLock,
              tx,
            }),
            threadId,
          });
        });
        await waitForBlockedBackend({
          observer,
          pid: await loserPid.promise,
        });

        releaseWinner.resolve();
        await expect(winnerTransaction).resolves.toMatchObject({
          containerMemberId: containerMemberIds[0],
          created: true,
        });
        await expect(loserTransaction).rejects.toMatchObject({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          retryable: true,
        });
        await loserAttemptedRouteLock.promise;

        await expect(observer.hostedThreadRoute.count({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedThreadContainer.findMany({
          select: { memberId: true, ownerMemberId: true },
          where: { memberId: { in: [...containerMemberIds] } },
        })).resolves.toEqual([{
          memberId: containerMemberIds[0],
          ownerMemberId,
        }]);
        await expect(observer.hostedMember.count({
          where: { id: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
        await expect(observer.hostedUserCryptoEnvelope.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(HOSTED_CRYPTO_DOMAINS.length);
        await expect(observer.hostedMailboxItem.count({
          where: { userId: { in: [...containerMemberIds] } },
        })).resolves.toBe(1);
      } finally {
        releaseWinner.resolve();
        await Promise.allSettled([
          ...(winnerTransaction ? [winnerTransaction] : []),
          ...(loserTransaction ? [loserTransaction] : []),
        ]);
        await observer.hostedThreadRoute.deleteMany({
          where: { containerMemberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedThreadContainer.deleteMany({
          where: { memberId: { in: [...containerMemberIds] } },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [ownerMemberId, ...containerMemberIds],
            },
          },
        });
        await Promise.all([
          observer.$disconnect(),
          winnerClient.$disconnect(),
          loserClient.$disconnect(),
        ]);
      }
    });

    it("consumes an addition that commits before the waiting group message", async () => {
      const fixture = await createRouteFixture();
      const markerWritten = createDeferred();
      const releaseMarker = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;

      const markerTransaction = fixture.participantClient.$transaction(async (tx) => {
        await markHostedLinqThreadRouteParticipantAdditionPendingTx({
          containerMemberId: fixture.containerMemberId,
          prisma: tx,
          threadId: fixture.threadId,
        });
        markerWritten.resolve();
        await releaseMarker.promise;
      });

      try {
        await markerWritten.promise;
        consumerTransaction = fixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseMarker.resolve();
        await markerTransaction;
        await expect(consumerTransaction).resolves.toBe(true);
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseMarker.resolve();
        await Promise.allSettled([
          markerTransaction,
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });

    it("leaves a later addition pending when the group message locks first", async () => {
      const fixture = await createRouteFixture();
      const messageLocked = createDeferred();
      const releaseMessage = createDeferred();
      const markerPid = createDeferred<number>();
      let markerTransaction: Promise<void> | null = null;

      const messageTransaction = fixture.messageClient.$transaction(async (tx) => {
        const consumed =
          await consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        messageLocked.resolve();
        await releaseMessage.promise;
        return consumed;
      });

      try {
        await messageLocked.promise;
        markerTransaction = fixture.participantClient.$transaction(async (tx) => {
          markerPid.resolve(await readBackendPid(tx));
          await markHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await markerPid.promise,
        });

        releaseMessage.resolve();
        await expect(messageTransaction).resolves.toBe(false);
        await markerTransaction;
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(true);
      } finally {
        releaseMessage.resolve();
        await Promise.allSettled([
          messageTransaction,
          ...(markerTransaction ? [markerTransaction] : []),
        ]);
        await cleanupRouteFixture(fixture);
      }
    });

    it("lets a waiting address-book deletion clear context staged under the owner lock", async () => {
      const restoreAddressBookEnv =
        configureHostedAddressBookLocalCryptoForTest();
      const fixture = await createRouteFixture();
      const participantHandle = "+15559870001";
      const contextCiphertext = createDeferred<string>();
      const participantContextWritten = createDeferred();
      const releaseParticipant = createDeferred();
      let deletion: ReturnType<typeof deleteHostedAddressBookProjection> | null =
        null;
      let participantTransaction: Promise<void> | null = null;

      try {
        await prepareAddressBookLabelFixture(fixture, participantHandle);
        const route = await readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: fixture.observer,
          threadId: fixture.threadId,
        });
        if (!route) {
          throw new Error("Expected a routed Linq group.");
        }

        participantTransaction = fixture.participantClient.$transaction(
          async (tx) => {
            await applyHostedLinqParticipantChangeToRouteTx({
              event: buildParticipantChangeEvent({
                eventType: "participant.added",
                handle: participantHandle,
                threadId: fixture.threadId,
              }),
              prisma: observeParticipantContextRouteWrite({
                ciphertext: contextCiphertext,
                release: releaseParticipant,
                tx,
              }),
              route,
            });
            participantContextWritten.resolve();
          },
        );

        const stagedValue = readHostedSecureBoxTestValue(
          await contextCiphertext.promise,
        );
        expect(stagedValue).toContain(
          "Participant +15559870001 (address-book name: Taylor R.) was added to the group.",
        );

        const deletionPid = await readBackendPid(fixture.messageClient);
        deletion = deleteHostedAddressBookProjection({
          memberId: fixture.ownerMemberId,
          prisma: fixture.messageClient,
          request: parseHostedAddressBookDeleteRequest({
            baseRevision: 1,
            mutationId: randomUUID(),
            schemaVersion: 1,
          }),
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: deletionPid,
        });

        releaseParticipant.resolve();
        await participantContextWritten.promise;
        await participantTransaction;
        await expect(deletion).resolves.toMatchObject({
          enabled: false,
          revision: 2,
        });
        await expect(fixture.observer.hostedThreadRoute.findFirst({
          select: { pendingGroupReactionContextEncrypted: true },
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toEqual({
          pendingGroupReactionContextEncrypted: null,
        });
      } finally {
        releaseParticipant.resolve();
        await Promise.allSettled([
          ...(participantTransaction ? [participantTransaction] : []),
          ...(deletion ? [deletion] : []),
        ]);
        restoreAddressBookEnv();
        await cleanupRouteFixture(fixture);
      }
    });

    it("stages only handle context after a deletion that already holds the owner lock", async () => {
      const restoreAddressBookEnv =
        configureHostedAddressBookLocalCryptoForTest();
      const fixture = await createRouteFixture();
      const participantHandle = "+15559870001";
      const addressBookCleared = createDeferred();
      const releaseDeletion = createDeferred();
      const contextCiphertext = createDeferred<string>();
      const participantPid = createDeferred<number>();
      let deletion: ReturnType<typeof deleteHostedAddressBookProjection> | null =
        null;
      let participantTransaction: Promise<void> | null = null;

      try {
        await prepareAddressBookLabelFixture(fixture, participantHandle);
        const route = await readHostedThreadRouteByThreadIdentity({
          channel: "linq",
          prisma: fixture.observer,
          threadId: fixture.threadId,
        });
        if (!route) {
          throw new Error("Expected a routed Linq group.");
        }

        deletion = deleteHostedAddressBookProjection({
          memberId: fixture.ownerMemberId,
          prisma: pauseAddressBookClearBeforeCommit({
            cleared: addressBookCleared,
            client: fixture.messageClient,
            release: releaseDeletion,
          }),
          request: parseHostedAddressBookDeleteRequest({
            baseRevision: 1,
            mutationId: randomUUID(),
            schemaVersion: 1,
          }),
        });
        await addressBookCleared.promise;

        participantTransaction = fixture.participantClient.$transaction(
          async (tx) => {
            participantPid.resolve(await readBackendPid(tx));
            await applyHostedLinqParticipantChangeToRouteTx({
              event: buildParticipantChangeEvent({
                eventType: "participant.removed",
                handle: participantHandle,
                threadId: fixture.threadId,
              }),
              prisma: observeParticipantContextRouteWrite({
                ciphertext: contextCiphertext,
                tx,
              }),
              route,
            });
          },
        );
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await participantPid.promise,
        });

        releaseDeletion.resolve();
        await expect(deletion).resolves.toMatchObject({
          enabled: false,
          revision: 2,
        });
        await participantTransaction;

        const stagedValue = readHostedSecureBoxTestValue(
          await contextCiphertext.promise,
        );
        expect(stagedValue).toContain(
          "Participant +15559870001 was removed from the group.",
        );
        expect(stagedValue).not.toContain("Taylor R.");
        await expect(fixture.observer.hostedThreadRoute.findFirst({
          select: { pendingGroupReactionContextEncrypted: true },
          where: {
            channel: "linq",
            threadIdentityLookupKey: fixture.threadIdentityLookupKey,
          },
        })).resolves.toMatchObject({
          pendingGroupReactionContextEncrypted: expect.stringMatching(
            /^hsb-test:/u,
          ),
        });
      } finally {
        releaseDeletion.resolve();
        await Promise.allSettled([
          ...(deletion ? [deletion] : []),
          ...(participantTransaction ? [participantTransaction] : []),
        ]);
        restoreAddressBookEnv();
        await cleanupRouteFixture(fixture);
      }
    });

    it("serializes a routed message behind routed usage-limit dispatch without deadlock", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const usageSourceRef = `usage-lock-proof:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }

      await fixture.observer.hostedThreadRoute.updateMany({
        data: { pendingParticipantAddition: true },
        where: {
          channel: "linq",
          containerMemberId: fixture.containerMemberId,
          threadIdentityLookupKey: fixture.threadIdentityLookupKey,
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "test",
          blockedAt: attemptedAt,
          limitUsdMicros: 1n,
          memberId: fixture.containerMemberId,
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart,
        },
      });

      const usageOwnerLocked = createDeferred();
      const releaseUsageAuthorityCheck = createDeferred();
      const consumerPid = createDeferred<number>();
      let consumerTransaction: Promise<boolean> | null = null;
      let usageTransaction: Promise<Awaited<ReturnType<
        typeof startHostedAiUsageLimitNoticeDispatchTx
      >>> | null = null;

      try {
        usageTransaction = fixture.participantClient.$transaction(async (tx) => {
          return startHostedAiUsageLimitNoticeDispatchTx({
            assertDispatchAuthority: async (claimTx) => {
              usageOwnerLocked.resolve();
              await releaseUsageAuthorityCheck.promise;
              await lockHostedThreadRouteByThreadIdentityTx({
                authority: {
                  channel: "linq",
                  containerMemberId: fixture.containerMemberId,
                  threadId: fixture.threadId,
                },
                prisma: claimTx,
              });
            },
            attemptedAt,
            linqChatId: fixture.threadId,
            memberId: fixture.containerMemberId,
            periodStart,
            prisma: tx,
            source: "hosted_webhook_side_effect",
            sourceRef: usageSourceRef,
            targetKind: "thread",
            usageCreditLedgerVersion: 0n,
          });
        });

        await usageOwnerLocked.promise;
        consumerTransaction = fixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: fixture.containerMemberId,
            prisma: tx,
            threadId: fixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseUsageAuthorityCheck.resolve();
        await expect(usageTransaction).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(consumerTransaction).resolves.toBe(true);

        const delivery = await fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            source: true,
            status: true,
            template: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        expect(delivery).toEqual({
          source: "hosted_webhook_side_effect",
          status: "provider_dispatch_started",
          template: "ai_usage_quota",
        });
        await expect(readPendingParticipantAddition(fixture)).resolves.toBe(false);
      } finally {
        releaseUsageAuthorityCheck.resolve();
        await Promise.allSettled([
          ...(usageTransaction ? [usageTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: usageDeliveryLookupKey },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("rejects stale candidates and gives a re-exhaustion crossing a fresh delivery identity", async () => {
      const fixture = await createRouteFixture();
      const attemptedAt = new Date("2026-07-13T12:00:00.000Z");
      const retryableAttemptedAt = new Date("2026-07-13T12:05:00.000Z");
      const retryAfterAt = new Date("2026-07-13T12:10:00.000Z");
      const staleRetryAttemptedAt = new Date("2026-07-13T12:15:00.000Z");
      const currentAttemptedAt = new Date("2026-07-13T12:20:00.000Z");
      const periodStart = new Date("2026-07-01T00:00:00.000Z");
      const periodEnd = new Date("2026-08-01T00:00:00.000Z");
      const retryableSourceRef = `retryable-usage:${fixture.containerMemberId}`;
      const usageIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 0n,
      });
      const reexhaustionSourceRef = `usage-after-plan-change:${fixture.containerMemberId}`;
      const reexhaustionIdempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
        memberId: fixture.containerMemberId,
        periodStart,
        usageCreditLedgerVersion: 2n,
      });
      const usageDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(usageIdempotencyKey);
      if (!usageDeliveryLookupKey) {
        throw new Error("Expected a usage-limit delivery lookup key.");
      }
      const claimUsageNotice = (input: {
        attemptedAt: Date;
        prisma?: PrismaClient;
        sourceRef: string;
        usageCreditLedgerVersion?: bigint;
      }) => startAuthorizedHostedAiUsageLimitNoticeDispatchTx({
        attemptedAt: input.attemptedAt,
        memberId: fixture.containerMemberId,
        noticeDeliveryTarget: {
          channel: "linq",
          replyToMessageId: input.sourceRef,
          routeAuthority: {
            channel: "linq",
            containerMemberId: fixture.containerMemberId,
            threadId: fixture.threadId,
          },
          target: fixture.threadId,
        },
        periodStart,
        prisma: input.prisma ?? fixture.participantClient,
        source: "hosted_webhook_side_effect",
        sourceRef: input.sourceRef,
        targetKind: "thread",
        usageCreditLedgerVersion: input.usageCreditLedgerVersion ?? 0n,
      });
      const setBlockedAt = (blockedAt: Date | null) =>
        fixture.observer.hostedAiUsagePeriod.update({
          data: { blockedAt },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });

      await fixture.observer.hostedMember.updateMany({
        data: { billingStatus: "active" },
        where: {
          id: {
            in: [fixture.containerMemberId, fixture.ownerMemberId],
          },
        },
      });
      await fixture.observer.hostedAiUsagePeriod.create({
        data: {
          billingPlanCode: "launch_monthly",
          blockedAt: attemptedAt,
          limitUsdMicros: 10_000_000n,
          memberId: fixture.containerMemberId,
          periodEnd,
          periodStart,
          spentUsdMicros: 10_000_000n,
        },
      });

      const candidateReady = createDeferred();
      const releaseClaim = createDeferred();
      let staleClaim: ReturnType<
        typeof startAuthorizedHostedAiUsageLimitNoticeDispatchTx
      > | null = null;

      try {
        await expect(claimUsageNotice({
          attemptedAt: new Date(periodStart.getTime() - 1),
          sourceRef: "usage-before-period",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(claimUsageNotice({
          attemptedAt: periodEnd,
          sourceRef: "usage-at-period-end",
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        staleClaim = (async () => {
          candidateReady.resolve();
          await releaseClaim.promise;
          return claimUsageNotice({
            attemptedAt,
            sourceRef: `usage-before-plan-change:${fixture.containerMemberId}`,
          });
        })();

        await candidateReady.promise;
        await fixture.observer.hostedAiUsagePeriod.update({
          data: {
            billingPlanCode: "launch_edge_monthly",
            blockedAt: null,
            limitUsdMicros: 25_000_000n,
          },
          where: {
            memberId_periodStart: {
              memberId: fixture.containerMemberId,
              periodStart,
            },
          },
        });
        releaseClaim.resolve();

        await expect(staleClaim).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toBeNull();

        await setBlockedAt(retryableAttemptedAt);

        await expect(startHostedAiUsageLimitNoticeDispatchTx({
          attemptedAt: retryableAttemptedAt,
          memberId: fixture.containerMemberId,
          periodStart,
          prisma: fixture.messageClient,
          source: "hosted_runtime_ai_usage_limit_notice",
          sourceRef: retryableSourceRef,
          targetKind: "telegram_thread",
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({
          idempotencyKey: usageIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        await expect(markHostedAiUsageLimitNoticeDeliveryRetryableTx({
          expectedAttemptedAt: retryableAttemptedAt,
          failedAt: retryableAttemptedAt,
          idempotencyKey: usageIdempotencyKey,
          prisma: fixture.messageClient,
          retryAfterAt,
        })).resolves.toBe(true);
        await setBlockedAt(null);

        await expect(claimUsageNotice({
          attemptedAt: staleRetryAttemptedAt,
          sourceRef: retryableSourceRef,
        })).resolves.toEqual({ status: "already_notified" });
        await expect(fixture.observer.hostedLinqDelivery.findUnique({
          select: {
            attemptedAt: true,
            retryAfterAt: true,
            status: true,
          },
          where: { idempotencyKey: usageDeliveryLookupKey },
        })).resolves.toEqual({
          attemptedAt: retryableAttemptedAt,
          retryAfterAt,
          status: "failed",
        });
        await setBlockedAt(currentAttemptedAt);
        await fixture.observer.hostedMember.update({
          data: {
            usageCreditBalanceUsdMicros: 0n,
            usageCreditLedgerVersion: 2n,
          },
          where: { id: fixture.containerMemberId },
        });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: retryableSourceRef,
          usageCreditLedgerVersion: 0n,
        })).resolves.toEqual({ status: "already_notified" });

        await expect(claimUsageNotice({
          attemptedAt: currentAttemptedAt,
          prisma: fixture.messageClient,
          sourceRef: reexhaustionSourceRef,
          usageCreditLedgerVersion: 2n,
        })).resolves.toEqual({
          idempotencyKey: reexhaustionIdempotencyKey,
          providerIdempotencyKey: expect.stringMatching(
            /^ai-usage-attempt:hld_[A-Za-z0-9_-]{16}$/u,
          ),
          status: "claimed",
        });
        expect(reexhaustionIdempotencyKey).not.toBe(usageIdempotencyKey);
      } finally {
        releaseClaim.resolve();
        await Promise.allSettled(staleClaim ? [staleClaim] : []);
        await fixture.observer.hostedLinqDelivery.deleteMany({
          where: {
            idempotencyKey: {
              in: [
                usageDeliveryLookupKey,
                createHostedLinqDeliveryIdempotencyLookupKey(
                  reexhaustionIdempotencyKey,
                ),
              ].filter((value): value is string => value !== null),
            },
          },
        });
        await fixture.observer.hostedAiUsagePeriod.deleteMany({
          where: {
            memberId: fixture.containerMemberId,
            periodStart,
          },
        });
        await cleanupRouteFixture(fixture);
      }
    });

    it("serializes participant-context consumption behind a route authority rekey", async () => {
      const previousPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
      const previousPrivacyCurrentVersion =
        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
      const routeRekeyed = createDeferred();
      const releaseRouteRekey = createDeferred();
      const consumerPid = createDeferred<number>();
      let fixture: RouteFixture | null = null;
      let consumerTransaction: Promise<boolean> | null = null;
      let rekeyTransaction: ReturnType<
        typeof ensureHostedThreadContainerRouteTx
      > | null = null;

      configureHostedContactPrivacyKeyringForTest("v1");
      try {
        fixture = await createRouteFixture();
        const activeFixture = fixture;
        const priorAccountLookupKey = "account_lookup_prior";
        const priorThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: priorAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!priorThreadLookupKey) {
          throw new Error("Expected a prior Linq thread lookup key.");
        }
        await activeFixture.observer.hostedMember.update({
          data: { billingStatus: "active" },
          where: { id: activeFixture.ownerMemberId },
        });
        await activeFixture.observer.hostedThreadRoute.update({
          data: {
            pendingParticipantAddition: true,
            threadLookupKey: priorThreadLookupKey,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: activeFixture.threadIdentityLookupKey,
            },
          },
        });

        configureHostedContactPrivacyKeyringForTest("v2");
        const currentAccountLookupKey = "account_lookup_current";
        const currentThreadIdentityLookupKey =
          createHostedExternalThreadIdentityLookupKey({
            channel: "linq",
            threadId: activeFixture.threadId,
          });
        const currentThreadLookupKey = createHostedExternalThreadLookupKey({
          accountLookupKey: currentAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        if (!currentThreadIdentityLookupKey || !currentThreadLookupKey) {
          throw new Error("Expected current Linq thread lookup keys.");
        }
        const preparedRoute = buildHostedThreadDeliveryRoute({
          accountLookupKey: currentAccountLookupKey,
          channel: "linq",
          threadId: activeFixture.threadId,
        });
        const preparedDeliveryRoute = {
          containerMemberId: activeFixture.containerMemberId,
          deliveryRoute: preparedRoute,
          deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
            containerMemberId: activeFixture.containerMemberId,
            prisma: activeFixture.participantClient,
            route: preparedRoute,
          }),
        };

        rekeyTransaction = activeFixture.participantClient.$transaction(async (tx) => {
          return ensureHostedThreadContainerRouteTx({
            accountLookupKey: currentAccountLookupKey,
            accountLookupKeys: [
              currentAccountLookupKey,
              priorAccountLookupKey,
            ],
            channel: "linq",
            containerMemberId: activeFixture.containerMemberId,
            occurredAt: new Date("2026-07-13T12:00:00.000Z"),
            ownerMemberId: activeFixture.ownerMemberId,
            preparedDeliveryRoute,
            prisma: pauseHostedThreadRouteUpdateAfterWrite({
              release: releaseRouteRekey,
              tx,
              updated: routeRekeyed,
            }),
            threadId: activeFixture.threadId,
          });
        });

        await routeRekeyed.promise;
        consumerTransaction = activeFixture.messageClient.$transaction(async (tx) => {
          consumerPid.resolve(await readBackendPid(tx));
          return consumeHostedLinqThreadRouteParticipantAdditionPendingTx({
            containerMemberId: activeFixture.containerMemberId,
            prisma: tx,
            threadId: activeFixture.threadId,
          });
        });

        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await consumerPid.promise,
        });

        releaseRouteRekey.resolve();
        await expect(rekeyTransaction).resolves.toMatchObject({
          containerMemberId: activeFixture.containerMemberId,
          created: false,
        });
        await expect(consumerTransaction).resolves.toBe(true);

        await expect(activeFixture.observer.hostedThreadRoute.findUnique({
          select: {
            containerMemberId: true,
            pendingParticipantAddition: true,
            threadLookupKey: true,
          },
          where: {
            channel_threadIdentityLookupKey: {
              channel: "linq",
              threadIdentityLookupKey: currentThreadIdentityLookupKey,
            },
          },
        })).resolves.toEqual({
          containerMemberId: activeFixture.containerMemberId,
          pendingParticipantAddition: false,
          threadLookupKey: currentThreadLookupKey,
        });
      } finally {
        releaseRouteRekey.resolve();
        await Promise.allSettled([
          ...(rekeyTransaction ? [rekeyTransaction] : []),
          ...(consumerTransaction ? [consumerTransaction] : []),
        ]);
        restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousPrivacyKeys);
        restoreEnvValue(
          "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
          previousPrivacyCurrentVersion,
        );
        clearHostedOnboardingEnvCache();
        if (fixture) {
          await fixture.observer.hostedThreadRoute.deleteMany({
            where: { containerMemberId: fixture.containerMemberId },
          });
          await cleanupRouteFixture(fixture);
        }
      }
    });
  },
);
