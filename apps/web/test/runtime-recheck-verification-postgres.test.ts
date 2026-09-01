import { randomUUID } from "node:crypto";

import { HostedBillingStatus, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { HOSTED_MAILBOX_RETENTION_MS } from "@/src/lib/hosted-mailbox/store";
import {
  readHostedRuntimeRecoveryFacts,
} from "@/src/lib/hosted-ops/runtime-recheck-verification";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The runtime recheck verification proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "runtime recheck verification PostgreSQL boundary",
  () => {
    it("uses the mailbox owner's exact live-retention predicate in one read without mutation", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const rollback = new Error("Rollback runtime recheck verification proof.");
      const userId = `hbm_test_${randomUUID().replaceAll("-", "_")}`;
      const observedAt = new Date("2026-09-01T12:00:00.000Z");
      const retentionBoundary = new Date(
        observedAt.getTime() - HOSTED_MAILBOX_RETENTION_MS,
      );
      let proofCompleted = false;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ set_config: string }>>(Prisma.sql`
            SELECT set_config('statement_timeout', '30s', true)
          `);
          await tx.hostedMember.create({
            data: {
              billingStatus: HostedBillingStatus.active,
              id: userId,
            },
          });
          await tx.hostedWorkspace.create({
            data: {
              checkpointedAt: new Date("2026-09-01T11:00:00.000Z"),
              redactedStatusJson: {
              hostedMailboxSystemImportedSeq: "4",
              },
              systemMailboxProgressGeneration: 2n,
              userId,
              version: 10n,
            },
          });
          await tx.hostedMailboxLaneCounter.create({
            data: {
              consumedSeq: 0n,
              lane: "system",
              nextSeq: 5n,
              userId,
            },
          });
          await tx.hostedMailboxItem.createMany({
            data: [{
              createdAt: retentionBoundary,
              dedupeKey: `${userId}:retention-boundary`,
              id: `${userId}:retention-boundary`,
              kind: "device-sync.wake",
              lane: "system",
              laneSeq: 1n,
              occurredAt: retentionBoundary,
              payloadSchema: "murph.hosted-runtime-control.v1",
              userId,
            }, {
              createdAt: new Date(retentionBoundary.getTime() + 1),
              dedupeKey: `${userId}:expiry-boundary`,
              expiresAt: observedAt,
              id: `${userId}:expiry-boundary`,
              kind: "runtime.maintenance-requested",
              lane: "system",
              laneSeq: 2n,
              occurredAt: retentionBoundary,
              payloadSchema: "murph.hosted-runtime-control.v1",
              userId,
            }, {
              createdAt: new Date(retentionBoundary.getTime() + 2),
              dedupeKey: `${userId}:live-head`,
              expiresAt: new Date(observedAt.getTime() + 1),
              id: `${userId}:live-head`,
              kind: "device-sync.wake",
              lane: "system",
              laneSeq: 4n,
              occurredAt: retentionBoundary,
              payloadSchema: "murph.hosted-runtime-control.v1",
              userId,
            }, {
              createdAt: new Date(observedAt.getTime() + 1),
              dedupeKey: `${userId}:future-boundary`,
              id: `${userId}:future-boundary`,
              kind: "device-sync.wake",
              lane: "system",
              laneSeq: 3n,
              occurredAt: observedAt,
              payloadSchema: "murph.hosted-runtime-control.v1",
              userId,
            }],
          });
          const itemCountBefore = await tx.hostedMailboxItem.count({
            where: { userId },
          });

          const rows = await readHostedRuntimeRecoveryFacts({
            capturedHeadSequences: new Map([[userId, "2"]]),
            now: observedAt,
            prisma: tx,
            userIds: [userId],
          });

          expect(rows).toMatchObject([{
            allocatedSystemHighWater: 4n,
            canonicalSystemConsumed: 0n,
            capturedHeadSequence: null,
            pendingHeadKind: "device-sync.wake",
            pendingHeadSequence: 4n,
            userId,
            workspaceVersion: 10n,
          }]);
          await expect(tx.hostedMailboxItem.count({
            where: { userId },
          })).resolves.toBe(itemCountBefore);
          proofCompleted = true;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) {
          throw error;
        }
      } finally {
        await prisma.$disconnect();
      }

      expect(proofCompleted).toBe(true);
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgresql:"
      && (
        url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
      );
  } catch {
    return false;
  }
}
