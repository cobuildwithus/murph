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
    const memberIds: string[] = [];

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      if (prisma && memberIds.length > 0) {
        await prisma.hostedMember.deleteMany({
          where: { id: { in: memberIds } },
        });
      }
      await prisma?.$disconnect();
    });

    it("keeps the outbox-owned fixed completion valid after mailbox content retirement", async () => {
      const client = requirePrisma(prisma);
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_assistant_ask_retention_${suffix}`;
      memberIds.push(memberId);
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
      expect(cleanup.expiredMailboxContentRetired).toBeGreaterThanOrEqual(2);
      const retiredItems = await client.hostedMailboxItem.findMany({
        select: {
          contentRetiredAt: true,
          payloadInlineCiphertext: true,
          payloadRef: true,
        },
        where: { id: { in: [requestId, completionId] } },
      });
      expect(retiredItems).toHaveLength(2);
      expect(retiredItems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contentRetiredAt: cleanupAt,
          payloadInlineCiphertext: null,
          payloadRef: null,
        }),
      ]));

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

    it("records policy non-replies without advancing across a younger conversation gap", async () => {
      const client = requirePrisma(prisma);
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_message_retention_floor_${suffix}`;
      memberIds.push(memberId);
      const cleanupAt = new Date("2026-07-25T12:00:00.000Z");
      const expiredAt = new Date("2026-07-10T12:00:00.000Z");
      const liveAt = new Date("2026-07-24T12:00:00.000Z");
      const firstId = `retention_first_${suffix}`;
      const gapId = `retention_gap_${suffix}`;
      const laterId = `retention_later_${suffix}`;

      await client.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });
      await client.hostedMailboxLaneCounter.create({
        data: {
          consumedSeq: 0n,
          lane: "conversation",
          nextSeq: 4n,
          userId: memberId,
        },
      });
      await client.hostedMailboxItem.createMany({
        data: [
          {
            createdAt: expiredAt,
            dedupeKey: firstId,
            id: firstId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 1n,
            occurredAt: expiredAt,
            payloadInlineCiphertext: "encrypted-first-fixture",
            payloadSchema: "hosted.execution.wake.v1",
            userId: memberId,
          },
          {
            createdAt: liveAt,
            dedupeKey: gapId,
            id: gapId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 2n,
            occurredAt: liveAt,
            payloadInlineCiphertext: "encrypted-gap-fixture",
            payloadSchema: "hosted.execution.wake.v1",
            userId: memberId,
          },
          {
            createdAt: liveAt,
            dedupeKey: laterId,
            expiresAt: new Date("2026-07-25T11:00:00.000Z"),
            id: laterId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 3n,
            occurredAt: liveAt,
            payloadInlineCiphertext: "encrypted-later-fixture",
            payloadSchema: "hosted.execution.wake.v1",
            userId: memberId,
          },
        ],
      });

      const cleanup = await runHostedRetentionCleanup({
        now: cleanupAt,
        prisma: client,
        signalRuntimeRecheck: async () => undefined,
      });
      expect(cleanup.expiredConversationPolicyNonRepliesRecorded)
        .toBeGreaterThanOrEqual(2);
      await expect(client.hostedMailboxLaneCounter.findUniqueOrThrow({
        where: {
          userId_lane: {
            lane: "conversation",
            userId: memberId,
          },
        },
      })).resolves.toMatchObject({ consumedSeq: 1n });
      await expect(client.hostedMailboxItem.findMany({
        orderBy: { laneSeq: "asc" },
        select: {
          consumedAt: true,
          contentRetiredAt: true,
          laneSeq: true,
          payloadInlineCiphertext: true,
          retentionDisposition: true,
        },
        where: { userId: memberId },
      })).resolves.toEqual([
        expect.objectContaining({
          consumedAt: cleanupAt,
          contentRetiredAt: cleanupAt,
          laneSeq: 1n,
          payloadInlineCiphertext: null,
          retentionDisposition: "policy_non_reply.content_expired",
        }),
        expect.objectContaining({
          consumedAt: null,
          contentRetiredAt: null,
          laneSeq: 2n,
          payloadInlineCiphertext: "encrypted-gap-fixture",
          retentionDisposition: null,
        }),
        expect.objectContaining({
          consumedAt: cleanupAt,
          contentRetiredAt: cleanupAt,
          laneSeq: 3n,
          payloadInlineCiphertext: null,
          retentionDisposition: "policy_non_reply.content_expired",
        }),
      ]);
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
