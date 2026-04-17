import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { decodeHostedWakeInlinePayload } from "@/src/lib/hosted-wake/payload";
import { encodeHostedWakeInlinePayload } from "@/src/lib/hosted-wake/payload";
import {
  appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx,
  commitHostedExecutionCursorTx,
  listHostedWakesAfterSeq,
  type AppendHostedWakeResult,
} from "@/src/lib/hosted-wake/store";

interface TestCursorState {
  committedSeq: bigint;
  createdAt: Date;
  nextSeq: bigint;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

interface TestWakeState {
  behavior: "coalescing" | "edge_triggered" | "ordered";
  coalescingKey: string | null;
  createdAt: Date;
  dedupeKey: string | null;
  id: string;
  kind: string;
  occurredAt: Date;
  payloadBytes: number | null;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  quarantineCode: string | null;
  quarantinedAt: Date | null;
  seq: bigint;
  updatedAt: Date;
  userId: string;
}

describe("hosted wake store", () => {
  it("rejects cursor commits that advance past the allocated wake head", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 3n,
      expectedVersion: 4n,
      snapshotRef: {
        checkpoint: "wake_3",
      },
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "3",
        userId: "member_123",
        version: "4",
      }),
    });
  });

  it("commits the cursor when the requested seq is already allocated", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 4n,
      snapshotRef: {
        checkpoint: "wake_2",
      },
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "3",
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: "5",
      }),
    });
  });

  it("updates the latest unresolved coalescing wake instead of allocating a new seq", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "coalescing",
          coalescingKey: "member.channels.updated:member_123",
          dedupeKey: "dispatch:member.channels.updated:first",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 1,
          },
          seq: 1n,
          userId: "member_123",
        },
      ],
    });

    const result = await appendHostedCoalescingWakeTx({
      coalescingKey: "member.channels.updated:member_123",
      dedupeKey: "dispatch:member.channels.updated:second",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: "murph.hosted-wake-dispatch.v1",
      tx,
      userId: "member_123",
    });

    expect(result.inserted).toBe(false);
    expect(result.updatedExisting).toBe(true);
    expect(result.wake.seq).toBe("1");
    expect(result.wake.dedupeKey).toBe("dispatch:member.channels.updated:second");
    expect(
      decodeHostedWakeInlinePayload({
        payloadInlineCiphertext: result.wake.payloadInlineCiphertext,
        userId: "member_123",
      }),
    ).toEqual({
      revision: 2,
    });

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.wakes).toHaveLength(1);
    expect(listed.wakes[0]?.seq).toBe("1");
  });

  it("suppresses duplicate unresolved edge-triggered wakes", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "edge_triggered",
          coalescingKey: "member.channels.updated:member_123",
          dedupeKey: "dispatch:member.channels.updated:first",
          kind: "member.channels.updated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 1,
          },
          seq: 1n,
          userId: "member_123",
        },
      ],
    });

    const result = await appendHostedEdgeTriggeredWakeTx({
      coalescingKey: "member.channels.updated:member_123",
      dedupeKey: "dispatch:member.channels.updated:second",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: "murph.hosted-wake-dispatch.v1",
      tx,
      userId: "member_123",
    });

    expect(result.inserted).toBe(false);
    expect(result.updatedExisting).toBe(false);
    expect(result.wake.seq).toBe("1");

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.wakes).toHaveLength(1);
    expect(listed.wakes[0]?.dedupeKey).toBe("dispatch:member.channels.updated:first");
  });
});

function createHostedWakeStoreHarness(input?: {
  cursor?: Partial<TestCursorState>;
  wakes?: Array<{
    behavior: TestWakeState["behavior"];
    coalescingKey: string | null;
    dedupeKey: string | null;
    kind: string;
    occurredAt: string;
    payload: unknown;
    seq: bigint;
    userId: string;
  }>;
}): Prisma.TransactionClient {
  const userId = input?.cursor?.userId ?? "member_123";
  const createdAt = new Date("2026-04-17T00:00:00.000Z");
  const state: {
    cursor: TestCursorState;
    wakes: TestWakeState[];
  } = {
    cursor: {
      committedSeq: input?.cursor?.committedSeq ?? 0n,
      createdAt: input?.cursor?.createdAt ?? createdAt,
      nextSeq: input?.cursor?.nextSeq ?? 1n,
      snapshotRef: input?.cursor?.snapshotRef ?? null,
      updatedAt: input?.cursor?.updatedAt ?? createdAt,
      userId,
      version: input?.cursor?.version ?? 0n,
    },
    wakes: (input?.wakes ?? []).map((wake, index) => ({
      behavior: wake.behavior,
      coalescingKey: wake.coalescingKey,
      createdAt,
      dedupeKey: wake.dedupeKey,
      id: `wake_${index + 1}`,
      kind: wake.kind,
      occurredAt: new Date(wake.occurredAt),
      payloadBytes: JSON.stringify(wake.payload).length,
      payloadInlineCiphertext: encodeWakePayloadForHarness(wake.userId, wake.payload),
      payloadRef: null,
      payloadSchema: "murph.hosted-wake-dispatch.v1",
      quarantineCode: null,
      quarantinedAt: null,
      seq: wake.seq,
      updatedAt: createdAt,
      userId: wake.userId,
    })),
  };

  const tx = {
    $queryRaw(strings: TemplateStringsArray): Array<{ seq: bigint } | { user_id: string }> {
      const sql = strings.join(" ");

      if (sql.includes("SELECT user_id")) {
        return [{ user_id: state.cursor.userId }];
      }

      if (sql.includes("UPDATE hosted_execution_cursor")) {
        const seq = state.cursor.nextSeq;
        state.cursor.nextSeq += 1n;
        state.cursor.updatedAt = new Date(state.cursor.updatedAt.getTime() + 1);
        return [{ seq }];
      }

      throw new Error(`Unexpected raw query: ${sql}`);
    },
    hostedExecutionCursor: {
      upsert(args: {
        create: { userId: string };
        update: object;
        where: { userId: string };
      }): TestCursorState {
        if (args.where.userId !== state.cursor.userId) {
          state.cursor = {
            committedSeq: 0n,
            createdAt,
            nextSeq: 1n,
            snapshotRef: null,
            updatedAt: createdAt,
            userId: args.create.userId,
            version: 0n,
          };
        }

        return cloneCursor(state.cursor);
      },
      updateMany(args: {
        data: {
          committedSeq: bigint;
          snapshotRef: Prisma.InputJsonValue | typeof Prisma.DbNull;
          version: { increment: bigint | number };
        };
        where: {
          committedSeq: { lte: bigint };
          nextSeq: { gt: bigint };
          userId: string;
          version: bigint;
        };
      }): { count: number } {
        const matches = state.cursor.userId === args.where.userId
          && state.cursor.version === args.where.version
          && state.cursor.committedSeq <= args.where.committedSeq.lte
          && state.cursor.nextSeq > args.where.nextSeq.gt;

        if (!matches) {
          return { count: 0 };
        }

        state.cursor.committedSeq = args.data.committedSeq;
        state.cursor.snapshotRef = args.data.snapshotRef === Prisma.DbNull
          ? null
          : args.data.snapshotRef as Prisma.JsonValue;
        state.cursor.version += BigInt(args.data.version.increment);
        state.cursor.updatedAt = new Date(state.cursor.updatedAt.getTime() + 1);
        return { count: 1 };
      },
    },
    hostedWake: {
      create(args: {
        data: {
          behavior: TestWakeState["behavior"];
          coalescingKey: string | null;
          dedupeKey: string | null;
          id: string;
          kind: string;
          occurredAt: Date;
          payloadBytes: number | null;
          payloadInlineCiphertext: string | null;
          payloadRef: string | null;
          payloadSchema: string;
          seq: bigint;
          userId: string;
        };
      }): TestWakeState {
        const wake: TestWakeState = {
          behavior: args.data.behavior,
          coalescingKey: args.data.coalescingKey,
          createdAt,
          dedupeKey: args.data.dedupeKey,
          id: args.data.id,
          kind: args.data.kind,
          occurredAt: args.data.occurredAt,
          payloadBytes: args.data.payloadBytes,
          payloadInlineCiphertext: args.data.payloadInlineCiphertext,
          payloadRef: args.data.payloadRef,
          payloadSchema: args.data.payloadSchema,
          quarantineCode: null,
          quarantinedAt: null,
          seq: args.data.seq,
          updatedAt: createdAt,
          userId: args.data.userId,
        };
        state.wakes.push(wake);
        return cloneWake(wake);
      },
      findFirst(args: {
        orderBy: { seq: "desc" };
        where: {
          coalescingKey: string | null;
          quarantinedAt: null;
          seq: { gt: bigint };
          userId: string;
        };
      }): TestWakeState | null {
        const candidate = state.wakes
          .filter((wake) =>
            wake.coalescingKey === args.where.coalescingKey
            && wake.userId === args.where.userId
            && wake.quarantinedAt === null
            && wake.seq > args.where.seq.gt)
          .sort((left, right) => Number(right.seq - left.seq))[0];

        return candidate ? cloneWake(candidate) : null;
      },
      findMany(args: {
        orderBy: { seq: "asc" };
        take: number;
        where: {
          quarantinedAt: null;
          seq: { gt: bigint };
          userId: string;
        };
      }): TestWakeState[] {
        return state.wakes
          .filter((wake) =>
            wake.userId === args.where.userId
            && wake.quarantinedAt === null
            && wake.seq > args.where.seq.gt)
          .sort((left, right) => Number(left.seq - right.seq))
          .slice(0, args.take)
          .map((wake) => cloneWake(wake));
      },
      findUnique(args: { where: { dedupeKey: string } }): TestWakeState | null {
        const wake = state.wakes.find((candidate) => candidate.dedupeKey === args.where.dedupeKey);
        return wake ? cloneWake(wake) : null;
      },
      update(args: {
        data: Partial<Pick<
          TestWakeState,
          "dedupeKey" | "kind" | "occurredAt" | "payloadBytes"
          | "payloadInlineCiphertext" | "payloadRef" | "payloadSchema"
          | "quarantineCode" | "quarantinedAt"
        >>;
        where: { id: string };
      }): TestWakeState {
        const wake = state.wakes.find((candidate) => candidate.id === args.where.id);

        if (!wake) {
          throw new Error(`Missing hosted wake ${args.where.id}`);
        }

        Object.assign(wake, args.data);
        wake.updatedAt = new Date(wake.updatedAt.getTime() + 1);
        return cloneWake(wake);
      },
    },
  };

  return tx as unknown as Prisma.TransactionClient;
}

function encodeWakePayloadForHarness(userId: string, payload: unknown): string {
  return encodeHostedWakeInlinePayload({
    userId,
    value: payload,
  }).payloadInlineCiphertext;
}

function cloneCursor(cursor: TestCursorState): TestCursorState {
  return {
    ...cursor,
    createdAt: new Date(cursor.createdAt),
    snapshotRef: cursor.snapshotRef === null ? null : structuredClone(cursor.snapshotRef),
    updatedAt: new Date(cursor.updatedAt),
  };
}

function cloneWake(wake: TestWakeState): TestWakeState {
  return {
    ...wake,
    createdAt: new Date(wake.createdAt),
    occurredAt: new Date(wake.occurredAt),
    updatedAt: new Date(wake.updatedAt),
  };
}
