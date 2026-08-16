import { randomUUID } from "node:crypto";

import {
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import {
  HostedBillingStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
  prepareHostedDomainRootForWeb,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  prepareHostedMailboxItemAppendCrypto,
} from "@/src/lib/hosted-mailbox/store";
import {
  readHostedMemberRoutingState,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {
  parseHostedTelegramWebhookUpdate,
} from "@/src/lib/hosted-onboarding/telegram";
import {
  planHostedOnboardingTelegramWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-telegram";
import {
  runHostedOnboardingWebhookTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { createPrismaClient } from "@/src/lib/prisma";

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-crypto/domain-root-store")
  >("@/src/lib/hosted-crypto/domain-root-store");
  return {
    ...actual,
    revalidatePreparedHostedDomainRootForWebTx: async (
      input: Parameters<
        typeof actual.revalidatePreparedHostedDomainRootForWebTx
      >[0],
    ) => {
      const local = actual.readPreparedHostedDomainRootForWebLocal(
        input.prepared,
      );
      const activeRootKeyId =
        await actual.lockAndReadActiveHostedDomainRootKeyIdTx({
          domain: input.prepared.domain,
          tx: input.tx,
          userId: input.prepared.userId,
        });
      if (activeRootKeyId !== input.prepared.rootKeyId) {
        throw new actual.HostedDomainRootPreparationMismatchError();
      }
      return local;
    },
  };
});

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const telegramThreadId = "456:business:setup";
const telegramUserId = "456";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Telegram activation concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted Telegram activation PostgreSQL concurrency",
  () => {
    it("releases root authority for member-first activation and appends once after retry", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_telegram_activation_${fixtureId}`;
      const controlRootKeyId = `control_${fixtureId}`;
      const ingressRootKeyId = `ingress_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
      const inbound = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activationOwnsMember = createDeferred();
      const allowActivationRoot = createDeferred();
      const update = buildDirectTelegramUpdate(720_001);
      let firstAttempt: Promise<unknown> | null = null;

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.unpaid,
          id: memberId,
        },
      });
      await observer.$transaction(
        (tx) => upsertHostedMemberTelegramRoutingBindingTx({
          memberId,
          prisma: tx,
          telegramUserId,
        }),
        transactionOptions,
      );
      await Promise.all([
        insertActiveRootEnvelope({
          domain: "control",
          prisma: observer,
          rootKeyId: controlRootKeyId,
          userId: memberId,
        }),
        insertActiveRootEnvelope({
          domain: "ingress",
          prisma: observer,
          rootKeyId: ingressRootKeyId,
          userId: memberId,
        }),
      ]);

      const routingRecord = await observer.hostedMemberRouting.findUnique({
        select: {
          telegramUserIdEncrypted: true,
        },
        where: { memberId },
      });
      if (!routingRecord?.telegramUserIdEncrypted) {
        throw new Error("Expected an encrypted Telegram routing fixture.");
      }
      const activationTransaction = activation.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, memberId);
        activationOwnsMember.resolve();
        await allowActivationRoot.promise;
        await expect(lockAndReadActiveHostedDomainRootKeyIdTx({
          domain: "control",
          tx,
          userId: memberId,
        })).resolves.toBe(controlRootKeyId);
        await tx.hostedMember.update({
          data: {
            billingStatus: HostedBillingStatus.active,
          },
          where: { id: memberId },
        });
      }, transactionOptions);

      try {
        await Promise.race([
          activationOwnsMember.promise,
          activationTransaction,
        ]);
        firstAttempt = runPreparedTelegramPlanTransaction({
          controlRootKeyId,
          existingControlRootKeyId: null,
          ingressRootKeyId,
          memberId,
          prisma: inbound,
          update,
        });
        const firstOutcome = await settleWithin(firstAttempt, 1_000);

        allowActivationRoot.resolve();
        await expect(activationTransaction).resolves.toBeUndefined();

        expect(firstOutcome).toMatchObject({
          reason: {
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            details: {
              preparationTarget: "direct_telegram_sender_route",
            },
            retryable: true,
          },
          status: "rejected",
        });
        await expect(runPreparedTelegramPlanTransaction({
          controlRootKeyId,
          existingControlRootKeyId: null,
          ingressRootKeyId,
          memberId,
          prisma: inbound,
          update,
        })).resolves.toMatchObject({
          response: {
            ok: true,
            reason: "wake-appended-active-member",
          },
        });

        const routing = await readHostedMemberRoutingState({
          memberId,
          prisma: observer,
        });
        expect(routing?.telegramThreadId).toBe(telegramThreadId);
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(1);
      } finally {
        allowActivationRoot.resolve();
        await Promise.allSettled([
          activationTransaction,
          ...(firstAttempt ? [firstAttempt] : []),
        ]);
        await observer.hostedMember.deleteMany({
          where: { id: memberId },
        });
        await disconnectClients([observer, activation, inbound]);
      }
    });

    it("admits three direct events prepared from one randomized same-root route", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_telegram_burst_${fixtureId}`;
      const controlRootKeyId = `control_${fixtureId}`;
      const ingressRootKeyId = `ingress_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const inboundClients = Array.from(
        { length: 3 },
        () => createPrismaClient({ databaseUrl, poolMax: 1 }),
      );
      let memberCreated = false;
      setHostedSecureBoxStringTestCodecForTests(null);

      try {
        await observer.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: memberId,
          },
        });
        memberCreated = true;
        await Promise.all([
          insertActiveRootEnvelope({
            domain: "control",
            prisma: observer,
            rootKeyId: controlRootKeyId,
            userId: memberId,
          }),
          insertActiveRootEnvelope({
            domain: "ingress",
            prisma: observer,
            rootKeyId: ingressRootKeyId,
            userId: memberId,
          }),
        ]);
        await runHostedOnboardingWebhookTransaction(
          observer,
          (transaction) => upsertHostedMemberTelegramRoutingBindingTx({
            memberId,
            prisma: transaction,
            telegramThreadId,
            telegramUserId,
          }),
          async () => {
            seedPreparedRoot({
              domain: "control",
              rootKeyId: controlRootKeyId,
              userId: memberId,
            });
          },
        );
        const initialRouting = await observer.hostedMemberRouting.findUnique({
          select: {
            telegramUserIdEncrypted: true,
          },
          where: { memberId },
        });
        if (!initialRouting?.telegramUserIdEncrypted) {
          throw new Error("Expected an encrypted Telegram burst fixture.");
        }

        const updates = [720_101, 720_102, 720_103].map(
          buildDirectTelegramUpdate,
        );

        await expect(Promise.all(updates.map((update, index) =>
          runPreparedTelegramPlanTransaction({
            controlRootKeyId,
            existingControlRootKeyId: controlRootKeyId,
            ingressRootKeyId,
            memberId,
            prisma: requireValue(
              inboundClients[index],
              "Telegram burst inbound client",
            ),
            update,
          })
        ))).resolves.toEqual([
          expect.objectContaining({
            response: expect.objectContaining({
              ok: true,
              reason: "wake-appended-active-member",
            }),
          }),
          expect.objectContaining({
            response: expect.objectContaining({
              ok: true,
              reason: "wake-appended-active-member",
            }),
          }),
          expect.objectContaining({
            response: expect.objectContaining({
              ok: true,
              reason: "wake-appended-active-member",
            }),
          }),
        ]);

        const finalRouting = await observer.hostedMemberRouting.findUnique({
          select: {
            telegramUserIdEncrypted: true,
          },
          where: { memberId },
        });
        expect(finalRouting?.telegramUserIdEncrypted).not.toBe(
          initialRouting.telegramUserIdEncrypted,
        );
        await expect(observer.hostedMailboxItem.count({
          where: {
            kind: "conversation.message",
            userId: memberId,
          },
        })).resolves.toBe(3);
      } finally {
        installDefaultHostedSecureBoxStringTestCodec();
        if (memberCreated) {
          await observer.hostedMember.deleteMany({
            where: { id: memberId },
          });
        }
        await disconnectClients([observer, ...inboundClients]);
      }
    });
  },
);

async function runPreparedTelegramPlanTransaction(input: {
  controlRootKeyId: string;
  existingControlRootKeyId: string | null;
  ingressRootKeyId: string;
  memberId: string;
  prisma: PrismaClient;
  update: ReturnType<typeof buildDirectTelegramUpdate>;
}) {
  let preparedDirectTelegramRouting: NonNullable<
    Parameters<typeof planHostedOnboardingTelegramWebhook>[0][
      "preparedDirectTelegramRouting"
    ]
  > | undefined;
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => {
      if (!preparedDirectTelegramRouting) {
        throw new Error("Expected prepared direct Telegram routing.");
      }
      return planHostedOnboardingTelegramWebhook({
        preparedDirectTelegramRouting,
        prisma: transaction,
        update: input.update,
      });
    },
    async () => {
      seedPreparedRoot({
        domain: "control",
        rootKeyId: input.controlRootKeyId,
        userId: input.memberId,
      });
      seedPreparedRoot({
        domain: "ingress",
        rootKeyId: input.ingressRootKeyId,
        userId: input.memberId,
      });
      const [preparedControlRoot, preparedMailboxCrypto] = await Promise.all([
        prepareHostedDomainRootForWeb({
          domain: "control",
          prepareMissing: false,
          prisma: input.prisma,
          reason: "test.direct-telegram-control-root",
          userId: input.memberId,
        }),
        prepareHostedMailboxItemAppendCrypto({
          prisma: input.prisma,
          userId: input.memberId,
        }),
      ]);
      preparedDirectTelegramRouting = {
        existingControlRootKeyId: input.existingControlRootKeyId,
        initialSenderResolution: "found",
        kind: "member",
        memberId: input.memberId,
        preparedControlRoot,
        preparedMailboxCrypto,
        senderResolution: "found",
        telegramThreadId,
        telegramUserId,
      };
    },
  );
}

async function insertActiveRootEnvelope(input: {
  domain: HostedCryptoDomain;
  prisma: PrismaClient;
  rootKeyId: string;
  userId: string;
}): Promise<void> {
  const envelope = buildRootEnvelope(input);
  await input.prisma.hostedUserCryptoEnvelope.create({
    data: {
      activatedAt: new Date(envelope.createdAt),
      domain: input.domain,
      id: `root_envelope_${randomUUID()}`,
      rootKeyId: input.rootKeyId,
      signedEnvelopeJson: envelope as unknown as Prisma.InputJsonValue,
      status: "active",
      userId: input.userId,
    },
  });
}

function seedPreparedRoot(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): void {
  const envelope = buildRootEnvelope(input);
  const pendingRoot = Promise.resolve({
    envelope,
    rootKey: new Uint8Array(32),
  });
  const cache = getHostedDomainRootUnwrapCache();
  if (!cache) {
    throw new Error("Expected a scoped hosted root cache.");
  }
  cache.set(`${input.userId}|${input.domain}|@active`, pendingRoot);
  cache.set(`${input.userId}|${input.domain}|${input.rootKeyId}`, pendingRoot);
}

function buildRootEnvelope(input: {
  domain: HostedCryptoDomain;
  rootKeyId: string;
  userId: string;
}): HostedDomainRootKeyEnvelopeV1 {
  const timestamp = "2026-08-12T00:00:00.000Z";
  return {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256",
      keyVersionName: "test-authority-key",
      signature: "test-signature",
      signedAt: timestamp,
    },
    createdAt: timestamp,
    domain: input.domain,
    generation: 1,
    rootKeyId: input.rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: timestamp,
    userId: input.userId,
    wraps: [{
      additionalAuthenticatedData: "test-aad",
      ciphertextBlob: "test-ciphertext",
      encryptionContext: {},
      kind: "gcp-kms",
      kmsKeyName: "test-kms-key",
      recipient: input.domain === "control"
        ? "web-control-kms"
        : "web-ingress-kms",
    }],
  };
}

function buildDirectTelegramUpdate(updateId: number) {
  return parseHostedTelegramWebhookUpdate(JSON.stringify({
    message: {
      business_connection_id: "setup",
      chat: {
        id: Number(telegramUserId),
        type: "private",
      },
      date: 1_774_522_600,
      from: {
        first_name: "Test",
        id: Number(telegramUserId),
      },
      message_id: updateId,
      text: "hello",
    },
    update_id: updateId,
  }));
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label}.`);
  }
  return value;
}

function installDefaultHostedSecureBoxStringTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(
          input.value.replace(/^hsb-test:/u, ""),
          "base64url",
        ).toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

async function settleWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<
  | { status: "fulfilled"; value: unknown }
  | { reason: unknown; status: "rejected" }
  | { status: "timed_out" }
> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ reason, status: "rejected" as const }),
      ),
      new Promise<{ status: "timed_out" }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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
