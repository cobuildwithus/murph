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
import { describe, expect, it } from "vitest";

import {
  getHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import {
  lockAndReadActiveHostedDomainRootKeyIdTx,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  readHostedMemberRoutingRecord,
  readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  parseHostedLinqWebhookEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {
  planHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  runHostedOnboardingWebhookTransaction,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted Linq activation concurrency proof requires a local DATABASE_URL.",
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
  "hosted Linq activation PostgreSQL concurrency",
  () => {
    it("releases root authority for a member-first owner and appends once after retry", async () => {
      const fixtureId = randomUUID();
      const memberId = `member_linq_activation_${fixtureId}`;
      const memberPhone = buildFixturePhone(fixtureId, 5);
      const recipientPhone = buildFixturePhone(fixtureId, 6);
      const chatId = `chat_linq_activation_${fixtureId}`;
      const controlRootKeyId = `control_${fixtureId}`;
      const ingressRootKeyId = `ingress_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activation = createPrismaClient({ databaseUrl, poolMax: 1 });
      const inbound = createPrismaClient({ databaseUrl, poolMax: 1 });
      const activationOwnsMember = createDeferred();
      const allowActivationRoot = createDeferred();
      const event = buildDirectLinqEvent({
        chatId,
        eventId: `event_linq_activation_${fixtureId}`,
        memberPhone,
        messageId: `message_linq_activation_${fixtureId}`,
        recipientPhone,
      });
      let firstAttempt: Promise<unknown> | null = null;

      await observer.hostedMember.create({
        data: {
          billingStatus: HostedBillingStatus.active,
          id: memberId,
        },
      });
      await observer.$transaction(async (tx) => {
        const identityPrivate = await buildHostedMemberIdentityPrivateColumns({
          memberId,
          phoneNumber: memberPhone,
          prisma: tx,
          privyUserId: null,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: null,
        });
        await tx.hostedMemberIdentity.create({
          data: {
            ...identityPrivate,
            maskedPhoneNumberHint: "*** test",
            memberId,
            phoneLookupKey: requireValue(
              createHostedPhoneLookupKey(memberPhone),
              "member phone lookup key",
            ),
            phoneNumberVerifiedAt: new Date("2026-08-12T00:00:00.000Z"),
          },
        });
        await upsertHostedMemberHomeLinqBindingTx({
          clearPending: true,
          homeLineAssignedAt: new Date("2026-08-12T00:00:00.000Z"),
          linqChatId: chatId,
          memberId,
          participantContact: createHostedLinqParticipantContact({
            kind: "phone",
            value: memberPhone,
          }),
          prisma: tx,
          recipientPhone,
        });
      }, transactionOptions);
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

      const routingRecord = await readHostedMemberRoutingRecord({
        memberId,
        prisma: observer,
      });
      const routingState = await readHostedMemberRoutingState({
        memberId,
        prisma: observer,
      });
      if (!routingRecord || !routingState) {
        throw new Error("Expected a prepared Linq routing fixture.");
      }
      const preparedDirectMailboxPayloadRoot = {
        activeControlRootKeyId: controlRootKeyId,
        memberId,
        rootKeyId: ingressRootKeyId,
        routingRecord,
        routingState,
      };

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
        firstAttempt = runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        });
        const firstOutcome = await settleWithin(firstAttempt, 1_000);

        allowActivationRoot.resolve();
        await expect(activationTransaction).resolves.toBeUndefined();

        expect(firstOutcome).toMatchObject({
          reason: {
            code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
            details: {
              preparationTarget: "direct_linq_mailbox",
              reason: "member",
            },
            retryable: true,
          },
          status: "rejected",
        });
        await expect(runPreparedLinqPlanTransaction({
          controlRootKeyId,
          event,
          ingressRootKeyId,
          memberId,
          preparedDirectMailboxPayloadRoot,
          prisma: inbound,
        })).resolves.toMatchObject({
          response: {
            ok: true,
            reason: "wake-appended-active-member",
          },
        });

        const recoveryError = new Error("prepared ingress root unavailable");
        await expect(runHostedOnboardingWebhookTransaction(
          inbound,
          (transaction) => planHostedOnboardingLinqWebhook({
            directMailboxPreparationFailure: recoveryError,
            event,
            prisma: transaction,
          }),
        )).resolves.toMatchObject({
          response: {
            duplicate: true,
            ignored: true,
            ok: true,
            reason: "duplicate-webhook-event",
          },
          wakeHandoffs: [{
            eventId: event.event_id,
            source: "linq",
            userId: memberId,
          }],
        });

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
  },
);

async function runPreparedLinqPlanTransaction(input: {
  controlRootKeyId: string;
  event: ReturnType<typeof buildDirectLinqEvent>;
  ingressRootKeyId: string;
  memberId: string;
  preparedDirectMailboxPayloadRoot: NonNullable<
    Parameters<typeof planHostedOnboardingLinqWebhook>[0][
      "preparedDirectMailboxPayloadRoot"
    ]
  >;
  prisma: PrismaClient;
}) {
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => planHostedOnboardingLinqWebhook({
      event: input.event,
      preparedDirectMailboxPayloadRoot:
        input.preparedDirectMailboxPayloadRoot,
      prisma: transaction,
    }),
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

function buildDirectLinqEvent(input: {
  chatId: string;
  eventId: string;
  memberPhone: string;
  messageId: string;
  recipientPhone: string;
}) {
  return parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: "2026-08-12T00:00:00.000Z",
    data: {
      chat: {
        id: input.chatId,
        is_group: false,
        owner_handle: {
          handle: input.recipientPhone,
          id: "owner-handle",
          is_me: true,
          service: "sms",
        },
      },
      direction: "inbound",
      id: input.messageId,
      is_from_me: false,
      parts: [{ type: "text", value: "hello" }],
      sender_handle: {
        handle: input.memberPhone,
        id: "sender-handle",
        service: "sms",
      },
      sent_at: "2026-08-12T00:00:00.000Z",
      service: "sms",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));
}

function buildFixturePhone(fixtureId: string, prefixDigit: number): string {
  const digits = fixtureId.replaceAll("-", "").slice(0, 7);
  const suffix = String(Number.parseInt(digits, 16) % 10_000_000).padStart(
    7,
    "0",
  );
  return `+155${prefixDigit}${suffix}`;
}

function requireValue(value: string | null, label: string): string {
  if (!value) {
    throw new Error(`Expected ${label}.`);
  }
  return value;
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
