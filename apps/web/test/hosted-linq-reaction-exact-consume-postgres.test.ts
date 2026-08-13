import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  recordHostedLinqRuntimeDeliveryOutcomeTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq reaction exact-consume proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Hosted Linq reaction exact consume with PostgreSQL",
  () => {
    it("consumes only exact same-owner conversation rows after accepted delivery", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const ownerMemberId = `hbm_reaction_consume_owner_${suffix}`;
      const foreignMemberId = `hbm_reaction_consume_foreign_${suffix}`;
      const acceptedItemId = `hmi_reaction_consume_accepted_${suffix}`;
      const failedItemId = `hmi_reaction_consume_failed_${suffix}`;
      const ambiguousItemId = `hmi_reaction_consume_ambiguous_${suffix}`;
      const alreadyConsumedItemId = `hmi_reaction_consume_existing_${suffix}`;
      const foreignItemId = `hmi_reaction_consume_foreign_${suffix}`;
      const systemItemId = `hmi_reaction_consume_system_${suffix}`;
      const acceptedIdempotencyKey =
        `assistant-outbox:reaction-consume-accepted-${suffix}`;
      const failedIdempotencyKey =
        `assistant-outbox:reaction-consume-failed-${suffix}`;
      const occurredAt = new Date("2026-08-10T18:00:00.000Z");
      const alreadyConsumedAt = new Date("2026-08-10T18:00:00.500Z");
      const acceptedAt = new Date("2026-08-10T18:00:02.000Z");
      const deliveryIds: string[] = [];

      try {
        await prisma.hostedMember.createMany({
          data: [{ id: ownerMemberId }, { id: foreignMemberId }],
        });
        await prisma.hostedMailboxItem.createMany({
          data: [
            mailboxItem({
              id: acceptedItemId,
              laneSeq: 1n,
              occurredAt,
              userId: ownerMemberId,
            }),
            mailboxItem({
              id: failedItemId,
              laneSeq: 2n,
              occurredAt,
              userId: ownerMemberId,
            }),
            mailboxItem({
              id: ambiguousItemId,
              laneSeq: 3n,
              occurredAt,
              userId: ownerMemberId,
            }),
            mailboxItem({
              consumedAt: alreadyConsumedAt,
              id: alreadyConsumedItemId,
              laneSeq: 4n,
              occurredAt,
              userId: ownerMemberId,
            }),
            mailboxItem({
              id: foreignItemId,
              laneSeq: 1n,
              occurredAt,
              userId: foreignMemberId,
            }),
            mailboxItem({
              id: systemItemId,
              kind: "device-sync.wake",
              lane: "system",
              laneSeq: 1n,
              occurredAt,
              userId: ownerMemberId,
            }),
          ],
        });

        const accepted = await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt,
          answeredMailboxItemIds: [
            acceptedItemId,
            alreadyConsumedItemId,
            foreignItemId,
            systemItemId,
          ],
          attemptedAt: new Date("2026-08-10T18:00:01.000Z"),
          idempotencyKey: acceptedIdempotencyKey,
          linqChatId: `chat-reaction-consume-${suffix}`,
          prisma,
          sourceRef: `intent-reaction-consume-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: ownerMemberId,
        });
        if (accepted.deliveryId) {
          deliveryIds.push(accepted.deliveryId);
        }
        expect(accepted.recorded).toBe(true);

        await expect(readConsumedAtById({
          ids: [
            acceptedItemId,
            alreadyConsumedItemId,
            foreignItemId,
            systemItemId,
          ],
          prisma,
        })).resolves.toEqual({
          [acceptedItemId]: acceptedAt,
          [alreadyConsumedItemId]: alreadyConsumedAt,
          [foreignItemId]: null,
          [systemItemId]: null,
        });

        const replay = await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt,
          answeredMailboxItemIds: [acceptedItemId],
          attemptedAt: new Date("2026-08-10T18:00:01.000Z"),
          idempotencyKey: acceptedIdempotencyKey,
          linqChatId: `chat-reaction-consume-${suffix}`,
          prisma,
          sourceRef: `intent-reaction-consume-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: ownerMemberId,
        });
        expect(replay).toEqual(accepted);
        await expect(prisma.hostedMailboxItem.findUnique({
          select: { consumedAt: true },
          where: { id: acceptedItemId },
        })).resolves.toEqual({ consumedAt: acceptedAt });

        const failed = await recordHostedLinqRuntimeDeliveryOutcomeTx({
          answeredMailboxItemIds: [failedItemId],
          attemptedAt: new Date("2026-08-10T18:00:03.000Z"),
          failedAt: new Date("2026-08-10T18:00:04.000Z"),
          failureCode: "ASSISTANT_REACTION_DELIVERY_RETRYABLE",
          idempotencyKey: failedIdempotencyKey,
          linqChatId: `chat-reaction-consume-${suffix}`,
          prisma,
          sourceRef: `intent-reaction-consume-failed-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: ownerMemberId,
        });
        if (failed.deliveryId) {
          deliveryIds.push(failed.deliveryId);
        }
        expect(failed.recorded).toBe(true);
        await expect(readConsumedAtById({
          ids: [failedItemId, ambiguousItemId],
          prisma,
        })).resolves.toEqual({
          [ambiguousItemId]: null,
          [failedItemId]: null,
        });
      } finally {
        await prisma.hostedLinqDelivery.deleteMany({
          where: { id: { in: deliveryIds } },
        });
        await prisma.hostedMember.deleteMany({
          where: { id: { in: [ownerMemberId, foreignMemberId] } },
        });
        await prisma.$disconnect();
      }
    });
  },
);

function mailboxItem(input: {
  consumedAt?: Date;
  id: string;
  kind?: string;
  lane?: string;
  laneSeq: bigint;
  occurredAt: Date;
  userId: string;
}) {
  return {
    consumedAt: input.consumedAt,
    dedupeKey: `reaction-consume:${input.id}`,
    id: input.id,
    kind: input.kind ?? "conversation.message",
    lane: input.lane ?? "conversation",
    laneSeq: input.laneSeq,
    occurredAt: input.occurredAt,
    payloadSchema: "murph.hosted-execution.conversation-message.v1",
    userId: input.userId,
  };
}

async function readConsumedAtById(input: {
  ids: readonly string[];
  prisma: ReturnType<typeof createPrismaClient>;
}): Promise<Record<string, Date | null>> {
  const rows = await input.prisma.hostedMailboxItem.findMany({
    orderBy: { id: "asc" },
    select: { consumedAt: true, id: true },
    where: { id: { in: [...input.ids] } },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.consumedAt]));
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
