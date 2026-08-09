import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkpointHostedWorkspace,
  checkpointHostedWorkspaceTx,
} from "@/src/lib/hosted-workspace/store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted workspace checkpoint proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted workspace checkpoint PostgreSQL atomicity",
  () => {
    let observer: PrismaClient | null = null;
    let checkpointClient: PrismaClient | null = null;
    let appendClient: PrismaClient | null = null;
    let blockerClient: PrismaClient | null = null;
    const memberIds: string[] = [];

    beforeAll(() => {
      observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      checkpointClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      appendClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      blockerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      if (observer && memberIds.length > 0) {
        await observer.hostedMember.deleteMany({
          where: {
            id: { in: memberIds },
          },
        });
      }
      await Promise.all([
        observer?.$disconnect(),
        checkpointClient?.$disconnect(),
        appendClient?.$disconnect(),
        blockerClient?.$disconnect(),
      ]);
    });

    it("returns the successor and preserves exact stamping, contiguous bounds, retention, and monotonic counters", async () => {
      const client = requirePrisma(observer);
      const userId = await createMember(client, memberIds);
      const otherUserId = await createMember(client, memberIds);
      const now = new Date();
      const oldSnapshotRef = createBundleRef("checkpoint_pg_old");
      const nextSnapshotRef = createBundleRef("checkpoint_pg_next");
      const liveCreatedAt = new Date(now.getTime() - 60_000);
      const oldCreatedAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(now.getTime() - 1);
      const ids = {
        beyondImported: createId("beyond"),
        exact3: createId("exact3"),
        exact5: createId("exact5"),
        expired6: createId("expired6"),
        gap4: createId("gap4"),
        old7: createId("old7"),
        otherUser: createId("other"),
        systemLane: createId("system"),
        wrongKind8: createId("wrong_kind"),
      };

      await client.hostedWorkspace.create({
        data: {
          snapshotRef: oldSnapshotRef,
          userId,
          version: 4n,
        },
      });
      await client.hostedMailboxLaneCounter.createMany({
        data: [
          {
            consumedSeq: 2n,
            lane: "conversation",
            nextSeq: 11n,
            userId,
          },
          {
            consumedSeq: 3n,
            lane: "system",
            nextSeq: 8n,
            userId,
          },
          {
            consumedSeq: 0n,
            lane: "conversation",
            nextSeq: 2n,
            userId: otherUserId,
          },
        ],
      });
      await client.hostedMailboxItem.createMany({
        data: [
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.exact3,
            laneSeq: 3n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.gap4,
            laneSeq: 4n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.exact5,
            laneSeq: 5n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            expiresAt: expiredAt,
            id: ids.expired6,
            laneSeq: 6n,
            userId,
          }),
          mailboxItem({
            createdAt: oldCreatedAt,
            id: ids.old7,
            laneSeq: 7n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.wrongKind8,
            kind: "assistant.ask.requested",
            laneSeq: 8n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.beyondImported,
            laneSeq: 9n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.systemLane,
            lane: "system",
            laneSeq: 1n,
            userId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            id: ids.otherUser,
            laneSeq: 1n,
            userId: otherUserId,
          }),
        ],
      });

      const first = await checkpointHostedWorkspace({
        checkpointedAt: now,
        expectedVersion: 4n,
        handledConversationMailboxItemIds: [
          ids.exact3,
          ids.exact5,
          ids.wrongKind8,
          ids.beyondImported,
          ids.systemLane,
          ids.otherUser,
        ],
        prisma: client,
        reason: "idle_shutdown",
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "8",
          hostedMailboxSystemHandledThroughSeq: "99",
        },
        snapshotRef: nextSnapshotRef,
        userId,
      });

      expect(first).toMatchObject({
        conversationInputAhead: true,
        replacedSnapshotRef: oldSnapshotRef,
        status: "updated",
        workspace: {
          checkpointedAt: now.toISOString(),
          snapshotRef: nextSnapshotRef,
          version: "5",
        },
      });
      await expect(readCounter(client, userId, "conversation")).resolves.toBe(3n);
      await expect(readCounter(client, userId, "system")).resolves.toBe(7n);
      await expect(readConsumedIds(client, Object.values(ids))).resolves.toEqual([
        ids.exact3,
        ids.exact5,
      ]);

      const second = await checkpointHostedWorkspace({
        checkpointedAt: new Date(now.getTime() + 1_000),
        expectedVersion: 5n,
        handledConversationMailboxItemIds: [ids.gap4, ids.wrongKind8],
        nextWakeAt: new Date(now.getTime() + 60_000),
        nextWakeReason: "mailbox",
        prisma: client,
        reason: "idle_shutdown",
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "8",
        },
        snapshotRef: createBundleRef("checkpoint_pg_second"),
        userId,
      });

      expect(second.status).toBe("updated");
      expect(second).not.toHaveProperty("conversationInputAhead");
      await expect(readCounter(client, userId, "conversation")).resolves.toBe(7n);
      await expect(readConsumedIds(client, Object.values(ids))).resolves.toEqual([
        ids.exact3,
        ids.gap4,
        ids.exact5,
      ]);

      await expect(checkpointHostedWorkspace({
        checkpointedAt: new Date(now.getTime() + 2_000),
        expectedVersion: 6n,
        prisma: client,
        reason: "idle_shutdown",
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxSystemHandledThroughSeq: "1",
        },
        snapshotRef: createBundleRef("checkpoint_pg_monotonic"),
        userId,
      })).resolves.toMatchObject({ status: "updated" });
      await expect(readCounter(client, userId, "conversation")).resolves.toBe(7n);
      await expect(readCounter(client, userId, "system")).resolves.toBe(7n);

      await client.hostedMailboxItem.delete({
        where: { id: ids.wrongKind8 },
      });
      await expect(checkpointHostedWorkspace({
        checkpointedAt: new Date(now.getTime() + 3_000),
        expectedVersion: 7n,
        handledConversationMailboxItemIds: [ids.beyondImported],
        prisma: client,
        reason: "idle_shutdown",
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "99",
        },
        snapshotRef: createBundleRef("checkpoint_pg_append_bound"),
        userId,
      })).resolves.toMatchObject({ status: "updated" });
      await expect(readCounter(client, userId, "conversation")).resolves.toBe(10n);
    });

    it("leaves workspace, exact items, and both counters untouched after CAS loss", async () => {
      const client = requirePrisma(observer);
      const userId = await createMember(client, memberIds);
      const itemId = createId("stale_item");
      const oldSnapshotRef = createBundleRef("checkpoint_pg_stale_current");

      await client.hostedWorkspace.create({
        data: {
          snapshotRef: oldSnapshotRef,
          userId,
          version: 4n,
        },
      });
      await client.hostedMailboxLaneCounter.createMany({
        data: [
          {
            consumedSeq: 0n,
            lane: "conversation",
            nextSeq: 2n,
            userId,
          },
          {
            consumedSeq: 0n,
            lane: "system",
            nextSeq: 2n,
            userId,
          },
        ],
      });
      await client.hostedMailboxItem.create({
        data: mailboxItem({
          createdAt: new Date(),
          id: itemId,
          laneSeq: 1n,
          userId,
        }),
      });

      const result = await checkpointHostedWorkspace({
        expectedVersion: 3n,
        handledConversationMailboxItemIds: [itemId],
        prisma: client,
        reason: "idle_shutdown",
        redactedStatusJson: {
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxSystemHandledThroughSeq: "1",
        },
        snapshotRef: createBundleRef("checkpoint_pg_stale_attempt"),
        userId,
      });

      expect(result).toMatchObject({
        replacedSnapshotRef: null,
        status: "conflict",
        workspace: {
          snapshotRef: oldSnapshotRef,
          version: "4",
        },
      });
      await expect(client.hostedMailboxItem.findUnique({
        select: { consumedAt: true },
        where: { id: itemId },
      })).resolves.toEqual({ consumedAt: null });
      await expect(readCounter(client, userId, "conversation")).resolves.toBe(0n);
      await expect(readCounter(client, userId, "system")).resolves.toBe(0n);
      await expect(client.hostedWorkspace.findUnique({
        select: { snapshotRef: true, version: true },
        where: { userId },
      })).resolves.toEqual({
        snapshotRef: oldSnapshotRef,
        version: 4n,
      });
    });

    it("loses a blocked CAS without mailbox mutation when a concurrent checkpoint commits first", async () => {
      const observerClient = requirePrisma(observer);
      const checkpoint = requirePrisma(checkpointClient);
      const winner = requirePrisma(blockerClient);
      const userId = await createMember(observerClient, memberIds);
      const itemId = createId("concurrent_stale_item");
      const originalSnapshotRef = createBundleRef("checkpoint_pg_race_original");
      const winnerSnapshotRef = createBundleRef("checkpoint_pg_race_winner");
      const winnerReady = createDeferred();
      const releaseWinner = createDeferred();
      const checkpointPidReady = createDeferred<number>();

      await observerClient.hostedWorkspace.create({
        data: {
          snapshotRef: originalSnapshotRef,
          userId,
          version: 4n,
        },
      });
      await observerClient.hostedMailboxLaneCounter.createMany({
        data: [
          {
            consumedSeq: 0n,
            lane: "conversation",
            nextSeq: 2n,
            userId,
          },
          {
            consumedSeq: 0n,
            lane: "system",
            nextSeq: 2n,
            userId,
          },
        ],
      });
      await observerClient.hostedMailboxItem.create({
        data: mailboxItem({
          createdAt: new Date(),
          id: itemId,
          laneSeq: 1n,
          userId,
        }),
      });

      const winnerTask = winner.$transaction(async (tx) => {
        const result = await checkpointHostedWorkspaceTx({
          expectedVersion: 4n,
          reason: "canonical_runtime_commit",
          snapshotRef: winnerSnapshotRef,
          tx,
          userId,
        });
        winnerReady.resolve();
        await releaseWinner.promise;
        return result;
      });
      await winnerReady.promise;

      const checkpointTask = checkpoint.$transaction(async (tx) => {
        checkpointPidReady.resolve(await readBackendPid(tx));
        return checkpointHostedWorkspaceTx({
          expectedVersion: 4n,
          handledConversationMailboxItemIds: [itemId],
          reason: "idle_shutdown",
          redactedStatusJson: {
            hostedMailboxConversationImportedSeq: "1",
            hostedMailboxSystemHandledThroughSeq: "1",
          },
          snapshotRef: createBundleRef("checkpoint_pg_race_loser"),
          tx,
          userId,
        });
      });
      const checkpointPid = await checkpointPidReady.promise;

      try {
        await waitForBlockedBackend({
          observer: observerClient,
          pid: checkpointPid,
        });
      } finally {
        releaseWinner.resolve();
      }

      await expect(winnerTask).resolves.toMatchObject({
        replacedSnapshotRef: originalSnapshotRef,
        status: "updated",
        workspace: {
          snapshotRef: winnerSnapshotRef,
          version: "5",
        },
      });
      await expect(checkpointTask).resolves.toMatchObject({
        replacedSnapshotRef: null,
        status: "conflict",
        workspace: {
          snapshotRef: winnerSnapshotRef,
          version: "5",
        },
      });
      await expect(observerClient.hostedMailboxItem.findUnique({
        select: { consumedAt: true },
        where: { id: itemId },
      })).resolves.toEqual({ consumedAt: null });
      await expect(readCounter(observerClient, userId, "conversation")).resolves.toBe(0n);
      await expect(readCounter(observerClient, userId, "system")).resolves.toBe(0n);
      await expect(observerClient.hostedWorkspace.findUnique({
        select: { snapshotRef: true, version: true },
        where: { userId },
      })).resolves.toEqual({
        snapshotRef: winnerSnapshotRef,
        version: 5n,
      });
    });

    it("rolls back the workspace CAS when the blocked mailbox statement fails", async () => {
      const observerClient = requirePrisma(observer);
      const checkpoint = requirePrisma(checkpointClient);
      const blocker = requirePrisma(blockerClient);
      const userId = await createMember(observerClient, memberIds);
      const itemId = createId("rollback_item");
      const oldSnapshotRef = createBundleRef("checkpoint_pg_rollback_old");
      const releaseBlocker = createDeferred();
      const blockerReady = createDeferred();

      await observerClient.hostedWorkspace.create({
        data: {
          snapshotRef: oldSnapshotRef,
          userId,
          version: 4n,
        },
      });
      await observerClient.hostedMailboxLaneCounter.createMany({
        data: [
          {
            consumedSeq: 0n,
            lane: "conversation",
            nextSeq: 2n,
            userId,
          },
          {
            consumedSeq: 0n,
            lane: "system",
            nextSeq: 2n,
            userId,
          },
        ],
      });
      await observerClient.hostedMailboxItem.create({
        data: mailboxItem({
          createdAt: new Date(),
          id: itemId,
          laneSeq: 1n,
          userId,
        }),
      });

      const blockerTask = blocker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT next_seq
          FROM hosted_mailbox_lane_counter
          WHERE user_id = ${userId}
            AND lane = 'conversation'
          FOR UPDATE
        `;
        blockerReady.resolve();
        await releaseBlocker.promise;
      });
      await blockerReady.promise;

      const checkpointTask = checkpoint.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT set_config('lock_timeout', '500ms', true)
        `;
        return checkpointHostedWorkspaceTx({
          expectedVersion: 4n,
          handledConversationMailboxItemIds: [itemId],
          reason: "idle_shutdown",
          redactedStatusJson: {
            hostedMailboxConversationImportedSeq: "1",
            hostedMailboxSystemHandledThroughSeq: "1",
          },
          snapshotRef: createBundleRef("checkpoint_pg_rollback_next"),
          tx,
          userId,
        });
      });

      try {
        await expect(checkpointTask).rejects.toThrow(/55P03|lock timeout/u);
      } finally {
        releaseBlocker.resolve();
      }

      await blockerTask;
      await expect(observerClient.hostedMailboxItem.findUnique({
        select: { consumedAt: true },
        where: { id: itemId },
      })).resolves.toEqual({ consumedAt: null });
      await expect(readCounter(observerClient, userId, "conversation")).resolves.toBe(0n);
      await expect(readCounter(observerClient, userId, "system")).resolves.toBe(0n);
      await expect(observerClient.hostedWorkspace.findUnique({
        select: { snapshotRef: true, version: true },
        where: { userId },
      })).resolves.toEqual({
        snapshotRef: oldSnapshotRef,
        version: 4n,
      });
    });

    it("commits a valid checkpoint and reports a newer append that wins while the CAS waits", async () => {
      const observerClient = requirePrisma(observer);
      const checkpoint = requirePrisma(checkpointClient);
      const appender = requirePrisma(appendClient);
      const blocker = requirePrisma(blockerClient);
      const userId = await createMember(observerClient, memberIds);
      const importedItemId = createId("imported");
      const appendedItemId = createId("appended");
      const releaseBlocker = createDeferred();
      const blockerReady = createDeferred();
      const checkpointPidReady = createDeferred<number>();

      await observerClient.hostedWorkspace.create({
        data: {
          snapshotRef: createBundleRef("checkpoint_pg_concurrent_old"),
          userId,
          version: 4n,
        },
      });
      await observerClient.hostedMailboxLaneCounter.create({
        data: {
          consumedSeq: 1n,
          lane: "conversation",
          nextSeq: 2n,
          userId,
        },
      });
      await observerClient.hostedMailboxItem.create({
        data: {
          ...mailboxItem({
            createdAt: new Date(),
            id: importedItemId,
            laneSeq: 1n,
            userId,
          }),
          consumedAt: new Date(),
        },
      });

      const blockerTask = blocker.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT user_id
          FROM hosted_workspace
          WHERE user_id = ${userId}
          FOR UPDATE
        `;
        blockerReady.resolve();
        await releaseBlocker.promise;
      });
      await blockerReady.promise;

      const checkpointTask = checkpoint.$transaction(async (tx) => {
        checkpointPidReady.resolve(await readBackendPid(tx));
        return checkpointHostedWorkspaceTx({
          expectedVersion: 4n,
          reason: "idle_shutdown",
          redactedStatusJson: {
            hostedMailboxConversationImportedSeq: "1",
          },
          snapshotRef: createBundleRef("checkpoint_pg_concurrent_next"),
          tx,
          userId,
        });
      });
      const checkpointPid = await checkpointPidReady.promise;

      try {
        await waitForBlockedBackend({
          observer: observerClient,
          pid: checkpointPid,
        });
        await appender.$transaction(async (tx) => {
          const [allocation] = await tx.$queryRaw<Array<{ laneSeq: bigint }>>`
            UPDATE hosted_mailbox_lane_counter
            SET next_seq = next_seq + 1,
                updated_at = NOW()
            WHERE user_id = ${userId}
              AND lane = 'conversation'
            RETURNING next_seq - 1 AS "laneSeq"
          `;
          if (!allocation) {
            throw new Error("Expected a conversation lane allocation.");
          }
          await tx.hostedMailboxItem.create({
            data: mailboxItem({
              createdAt: new Date(),
              id: appendedItemId,
              laneSeq: allocation.laneSeq,
              userId,
            }),
          });
        });
      } finally {
        releaseBlocker.resolve();
      }

      await blockerTask;
      await expect(checkpointTask).resolves.toMatchObject({
        conversationInputAhead: true,
        status: "updated",
        workspace: {
          version: "5",
        },
      });
      await expect(observerClient.hostedMailboxItem.findUnique({
        select: { consumedAt: true, laneSeq: true },
        where: { id: appendedItemId },
      })).resolves.toEqual({
        consumedAt: null,
        laneSeq: 2n,
      });
    });
  },
);

function mailboxItem(input: {
  createdAt: Date;
  expiresAt?: Date;
  id: string;
  kind?: string;
  lane?: string;
  laneSeq: bigint;
  userId: string;
}): Prisma.HostedMailboxItemCreateManyInput {
  return {
    createdAt: input.createdAt,
    dedupeKey: `${input.id}_dedupe`,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    id: input.id,
    kind: input.kind ?? "conversation.message",
    lane: input.lane ?? "conversation",
    laneSeq: input.laneSeq,
    occurredAt: input.createdAt,
    payloadSchema: "hosted.execution.wake.v1",
    userId: input.userId,
  };
}

async function createMember(
  prisma: PrismaClient,
  memberIds: string[],
): Promise<string> {
  const memberId = `member_checkpoint_pg_${randomUUID().replaceAll("-", "")}`;
  memberIds.push(memberId);
  await prisma.hostedMember.create({
    data: {
      billingStatus: "active",
      id: memberId,
    },
  });
  return memberId;
}

async function readConsumedIds(
  prisma: PrismaClient,
  ids: string[],
): Promise<string[]> {
  const rows = await prisma.hostedMailboxItem.findMany({
    orderBy: { laneSeq: "asc" },
    select: { id: true },
    where: {
      consumedAt: { not: null },
      id: { in: ids },
    },
  });
  return rows.map((row) => row.id);
}

async function readCounter(
  prisma: PrismaClient,
  userId: string,
  lane: string,
): Promise<bigint> {
  const row = await prisma.hostedMailboxLaneCounter.findUnique({
    select: { consumedSeq: true },
    where: {
      userId_lane: { lane, userId },
    },
  });
  if (!row) {
    throw new Error("Expected a hosted mailbox lane counter.");
  }
  return row.consumedSeq;
}

function createBundleRef(id: string) {
  return {
    hash: `${id}_hash`,
    key: `bundles/vault/${id}.bundle.json`,
    size: 128,
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

function createId(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "")}`;
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::integer AS "pid"
  `;
  if (!row) {
    throw new Error("Expected a PostgreSQL backend id.");
  }
  return row.pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS "blocked"
    `;
    if (row?.blocked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the checkpoint backend to wait on a database lock.");
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Hosted workspace checkpoint Prisma client is unavailable.");
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
