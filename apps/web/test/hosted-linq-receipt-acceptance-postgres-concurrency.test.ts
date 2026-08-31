import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  markHostedLinqDeliveryAcceptedTx,
  recordHostedLinqDeliveryAttemptTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import type {
  ParsedHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq receipt/acceptance proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Hosted Linq receipt/acceptance ordering with PostgreSQL",
  () => {
    it("converges when acceptance and its terminal receipt overlap", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const suffix = randomUUID();
      const idempotencyKey = `linq-receipt-race-${suffix}`;
      const deliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(idempotencyKey);
      const providerEventId = `linq-receipt-event-${suffix}`;
      const providerEventLookupKey =
        createHostedLinqProviderEventLookupKey(providerEventId);
      const messageId = `linq-receipt-message-${suffix}`;
      const messageLookupKey = createHostedLinqMessageLookupKey(messageId);
      const acceptanceWritten = createGate("acceptance write");
      const receiptWritten = createGate("receipt write");
      const acceptanceRead = createGate("acceptance catch-up read");
      const receiptRead = createGate("receipt delivery read");

      if (!deliveryLookupKey || !providerEventLookupKey || !messageLookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected deterministic Linq lookup keys.");
      }

      const event: ParsedHostedLinqProviderEvent = {
        apiVersion: "v3",
        deliveryStatus: "delivered",
        direction: null,
        eventId: providerEventId,
        eventType: "message.delivered",
        extractionJson: {},
        failureCode: null,
        failureReason: null,
        linqChatId: null,
        linqMessageId: messageId,
        linqChatLookupKey: null,
        messageIdSuffix: messageId.slice(-12),
        messageLookupKey,
        messageLookupKeyReadCandidates:
          createHostedLinqMessageLookupKeyReadCandidates(messageId),
        payloadHash: null,
        payloadSanitizedJson: {},
        payloadShapeJson: {},
        phoneNumber: null,
        phoneNumberHint: null,
        phoneNumberLookupKey: null,
        phoneNumberRole: "unknown",
        providerCreatedAt: new Date("2026-08-30T12:00:01.000Z"),
        providerReason: null,
        providerStatus: null,
        reactionCustomEmoji: null,
        reactionFromHandle: null,
        reactionIsFromMe: null,
        reactionPartIndex: null,
        reactionType: null,
        service: "iMessage",
        traceIdSuffix: null,
        webhookVersion: "2026-02-03",
      };

      try {
        await recordHostedLinqDeliveryAttemptTx({
          attemptedAt: new Date("2026-08-30T12:00:00.000Z"),
          idempotencyKey,
          prisma,
          source: "test",
          targetKind: "thread",
          template: "instant_first_turn_v1",
        });

        await Promise.all([
          prisma.$transaction(async (transaction) => {
            await markHostedLinqDeliveryAcceptedTx({
              acceptedAt: new Date("2026-08-30T12:00:00.500Z"),
              idempotencyKey,
              messageId,
              prisma: proxyAcceptanceTransaction(transaction, {
                acceptanceRead,
                acceptanceWritten,
                receiptWritten,
              }),
            });
          }),
          prisma.$transaction(async (transaction) => {
            await ingestHostedLinqProviderEventTx({
              event,
              prisma: proxyReceiptTransaction(transaction, {
                acceptanceRead,
                acceptanceWritten,
                receiptRead,
                receiptWritten,
              }),
              receivedAt: new Date("2026-08-30T12:00:01.100Z"),
            });
          }),
        ]);

        await expect(prisma.hostedLinqDelivery.findUnique({
          select: {
            deliveredAt: true,
            lastProviderEventId: true,
            status: true,
          },
          where: { idempotencyKey: deliveryLookupKey },
        })).resolves.toEqual({
          deliveredAt: event.providerCreatedAt,
          lastProviderEventId: providerEventLookupKey,
          status: "delivered",
        });
      } finally {
        await prisma.hostedLinqAlert.deleteMany({
          where: { eventId: providerEventLookupKey },
        });
        await prisma.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: deliveryLookupKey },
        });
        await prisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: providerEventLookupKey },
        });
        await prisma.$disconnect();
      }
    }, 20_000);
  },
);

type Gate = {
  open: () => void;
  wait: () => Promise<void>;
};

function createGate(label: string): Gate {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    open: () => resolve?.(),
    wait: () => Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(
          `Timed out waiting for ${label} while coordinating test transactions.`,
        )), 5_000);
      }),
    ]),
  };
}

function proxyAcceptanceTransaction(
  transaction: Prisma.TransactionClient,
  gates: {
    acceptanceRead: Gate;
    acceptanceWritten: Gate;
    receiptWritten: Gate;
  },
): Prisma.TransactionClient {
  const delivery = new Proxy(transaction.hostedLinqDelivery, {
    get(target, property, receiver) {
      if (property === "updateMany") {
        return async (
          args: Parameters<typeof transaction.hostedLinqDelivery.updateMany>[0],
        ) => {
          const result = await transaction.hostedLinqDelivery.updateMany(args);
          gates.acceptanceWritten.open();
          await gates.receiptWritten.wait();
          return result;
        };
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
  const providerEvent = new Proxy(transaction.hostedLinqProviderEvent, {
    get(target, property, receiver) {
      if (property === "findMany") {
        return async (
          args: Parameters<typeof transaction.hostedLinqProviderEvent.findMany>[0],
        ) => {
          const result = await transaction.hostedLinqProviderEvent.findMany(args);
          gates.acceptanceRead.open();
          return result;
        };
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return undefined;
      }
      if (property === "hostedLinqDelivery") {
        return delivery;
      }
      if (property === "hostedLinqProviderEvent") {
        return providerEvent;
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
}

function proxyReceiptTransaction(
  transaction: Prisma.TransactionClient,
  gates: {
    acceptanceRead: Gate;
    acceptanceWritten: Gate;
    receiptRead: Gate;
    receiptWritten: Gate;
  },
): Prisma.TransactionClient {
  const delivery = new Proxy(transaction.hostedLinqDelivery, {
    get(target, property, receiver) {
      if (property === "findFirst") {
        return async (
          args: Parameters<typeof transaction.hostedLinqDelivery.findFirst>[0],
        ) => {
          const result = await transaction.hostedLinqDelivery.findFirst(args);
          gates.receiptRead.open();
          await gates.acceptanceRead.wait();
          return result;
        };
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
  const providerEvent = new Proxy(transaction.hostedLinqProviderEvent, {
    get(target, property, receiver) {
      if (property === "createMany") {
        return async (
          args: Parameters<typeof transaction.hostedLinqProviderEvent.createMany>[0],
        ) => {
          await gates.acceptanceWritten.wait();
          const result = await transaction.hostedLinqProviderEvent.createMany(args);
          gates.receiptWritten.open();
          return result;
        };
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return undefined;
      }
      if (property === "hostedLinqDelivery") {
        return delivery;
      }
      if (property === "hostedLinqProviderEvent") {
        return providerEvent;
      }
      return bindMember(Reflect.get(target, property, receiver), target);
    },
  });
}

function bindMember(value: unknown, owner: object): unknown {
  return typeof value === "function" ? value.bind(owner) : value;
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
