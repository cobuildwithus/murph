import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
} from "@murphai/hosted-execution";

import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import { runHostedRetentionCleanup } from "@/src/lib/hosted-retention/cleanup";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Assistant Ask retention proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "reviewed Assistant Ask retention boundary",
  () => {
    let prisma: PrismaClient | null = null;
    let memberId: string | null = null;

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      if (prisma && memberId) {
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
      }
      await prisma?.$disconnect();
    });

    it("keeps the outbox-owned fixed completion valid after actual mailbox deletion", async () => {
      const client = requirePrisma(prisma);
      const suffix = randomUUID().replaceAll("-", "");
      memberId = `member_assistant_ask_retention_${suffix}`;
      const requestId = `aask_req_retention_${suffix}`;
      const completionId = `aask_done_retention_${suffix}`;
      const expiresAt = new Date("2026-07-16T12:10:00.000Z");
      const cleanupAt = new Date("2026-07-16T13:00:00.000Z");

      await client.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });
      await client.hostedMailboxItem.createMany({
        data: [
          {
            dedupeKey: requestId,
            expiresAt,
            id: requestId,
            kind: "assistant.ask.requested",
            lane: "system",
            laneSeq: 1n,
            occurredAt: new Date("2026-07-16T12:00:00.000Z"),
            payloadInlineCiphertext: "encrypted-request-fixture",
            payloadSchema: "hosted.execution.wake.v1",
            userId: memberId,
          },
          {
            dedupeKey: completionId,
            expiresAt,
            id: completionId,
            kind: "assistant.ask.completed",
            lane: "system",
            laneSeq: 2n,
            occurredAt: new Date("2026-07-16T12:05:00.000Z"),
            payloadInlineCiphertext: "encrypted-completion-fixture",
            payloadSchema: "hosted.execution.wake.v1",
            userId: memberId,
          },
        ],
      });

      await expect(client.hostedMailboxItem.count({
        where: { id: { in: [requestId, completionId] } },
      })).resolves.toBe(2);
      const cleanup = await runHostedRetentionCleanup({
        now: cleanupAt,
        prisma: client,
        signalRuntimeRecheck: async () => undefined,
      });
      expect(cleanup.expiredMailboxItemsDeleted).toBeGreaterThanOrEqual(2);
      await expect(client.hostedMailboxItem.count({
        where: { id: { in: [requestId, completionId] } },
      })).resolves.toBe(0);

      const delivery = {
        answeredMailboxItemIds: [completionId],
        assistantAskCompletionExpiresAt: expiresAt.toISOString(),
        boundRuntimeMemberId: memberId,
        idempotencyKey:
          createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
            completionId,
          ),
        now: cleanupAt,
      };
      await expect(client.$transaction(async (tx) =>
        await assertHostedAssistantAskCompletionDeliveryAuthorityTx({
          ...delivery,
          assistantAskFallback: false,
          tx,
        })
      )).resolves.toEqual({ assistantAskFallbackRequired: true });
      await expect(client.$transaction(async (tx) =>
        await assertHostedAssistantAskCompletionDeliveryAuthorityTx({
          ...delivery,
          assistantAskFallback: true,
          tx,
        })
      )).resolves.toBeUndefined();
    });
  },
);

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Assistant Ask retention Prisma client is unavailable.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
