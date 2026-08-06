import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hasUnresolvedHostedLinqProviderDispatchForChatTx,
  HOSTED_LINQ_APP_CARD_REJECTED_FAILURE_CODE,
  recordHostedLinqRuntimeDeliveryOutcomeTx,
  recordHostedLinqRuntimeProviderDispatchFenceTx,
  transitionHostedLinqRuntimeAppCardFallbackFenceTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq app-card fallback proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Hosted Linq app-card fallback ownership with PostgreSQL",
  () => {
    it("closes the original provider fence when an exact card replay is accepted", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const suffix = randomUUID();
      const intentId = `intent-card-replay-${suffix}`;
      const idempotencyKey = `assistant-outbox:${intentId}`;
      const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
        idempotencyKey,
      );
      const linqChatId = `chat-card-replay-${suffix}`;
      if (!lookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected deterministic delivery lookup key.");
      }

      try {
        await expect(recordHostedLinqRuntimeProviderDispatchFenceTx({
          attemptedAt: new Date("2026-08-06T11:59:00.000Z"),
          idempotencyKey,
          linqChatId,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
        })).resolves.toMatchObject({ claimed: true });
        await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
          linqChatId,
          prisma,
        })).resolves.toBe(true);

        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt: new Date("2026-08-06T11:59:02.000Z"),
          attemptedAt: new Date("2026-08-06T11:59:01.000Z"),
          idempotencyKey,
          linqChatId,
          messageId: `message-card-replay-${suffix}`,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
          threadIsDirect: true,
          userId: `member-card-replay-${suffix}`,
        });

        await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
          linqChatId,
          prisma,
        })).resolves.toBe(false);
      } finally {
        await prisma.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: lookupKey },
        });
        await prisma.$disconnect();
      }
    });

    it("closes a stale card fence before claiming text fallback on the current chat", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const suffix = randomUUID();
      const intentId = `intent-card-fallback-${suffix}`;
      const predecessorIdempotencyKey = `assistant-outbox:${intentId}`;
      const fallbackIdempotencyKey = `${predecessorIdempotencyKey}:fallback`;
      const predecessorLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
        predecessorIdempotencyKey,
      );
      const fallbackLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
        fallbackIdempotencyKey,
      );
      const predecessorLinqChatId = `chat-card-fallback-stale-${suffix}`;
      const fallbackLinqChatId = `chat-card-fallback-current-${suffix}`;
      if (!predecessorLookupKey || !fallbackLookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected deterministic delivery lookup keys.");
      }

      try {
        await expect(recordHostedLinqRuntimeProviderDispatchFenceTx({
          attemptedAt: new Date("2026-08-06T12:00:00.000Z"),
          idempotencyKey: predecessorIdempotencyKey,
          linqChatId: predecessorLinqChatId,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
        })).resolves.toMatchObject({ claimed: true });

        await expect(transitionHostedLinqRuntimeAppCardFallbackFenceTx({
          attemptedAt: new Date("2026-08-06T12:00:01.000Z"),
          fallbackIdempotencyKey,
          linqChatId: fallbackLinqChatId,
          predecessorIdempotencyKey,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
        })).resolves.toMatchObject({ claimed: true });

        await expect(prisma.hostedLinqDelivery.findUnique({
          select: {
            failedAt: true,
            failureCode: true,
            status: true,
          },
          where: { idempotencyKey: predecessorLookupKey },
        })).resolves.toMatchObject({
          failedAt: new Date("2026-08-06T12:00:01.000Z"),
          failureCode: HOSTED_LINQ_APP_CARD_REJECTED_FAILURE_CODE,
          status: "failed",
        });
        await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
          linqChatId: predecessorLinqChatId,
          prisma,
        })).resolves.toBe(false);
        await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
          linqChatId: fallbackLinqChatId,
          prisma,
        })).resolves.toBe(true);

        await expect(transitionHostedLinqRuntimeAppCardFallbackFenceTx({
          attemptedAt: new Date("2026-08-06T12:00:01.500Z"),
          fallbackIdempotencyKey,
          linqChatId: fallbackLinqChatId,
          predecessorIdempotencyKey,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
        })).resolves.toMatchObject({ claimed: false });

        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt: new Date("2026-08-06T12:00:02.000Z"),
          attemptedAt: new Date("2026-08-06T12:00:01.000Z"),
          idempotencyKey: fallbackIdempotencyKey,
          linqChatId: fallbackLinqChatId,
          messageId: `message-card-fallback-${suffix}`,
          prisma,
          sourceRef: intentId,
          targetKind: "thread",
          threadIsDirect: true,
          userId: `member-card-fallback-${suffix}`,
        });

        await expect(hasUnresolvedHostedLinqProviderDispatchForChatTx({
          linqChatId: fallbackLinqChatId,
          prisma,
        })).resolves.toBe(false);
      } finally {
        await prisma.hostedLinqDelivery.deleteMany({
          where: {
            idempotencyKey: {
              in: [predecessorLookupKey, fallbackLookupKey],
            },
          },
        });
        await prisma.$disconnect();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
