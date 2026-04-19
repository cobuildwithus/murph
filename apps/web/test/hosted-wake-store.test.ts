import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA } from "@murphai/hosted-execution";

import {
  encodeHostedWakeStoredPayload,
} from "@/src/lib/hosted-wake/payload";
import { issueHostedWakeFetchProof } from "@/src/lib/hosted-wake/commit-proof";
import {
  appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx,
  appendHostedOrderedWakeTx,
  commitHostedExecutionCursorTx,
  listHostedWakesAfterSeq,
  projectHostedWakeRecord,
  readLatestHostedWakeLifecycleByKind,
  readHostedExecutionCursor,
  recordHostedWakeTerminalTx,
} from "@/src/lib/hosted-wake/store";
import {
  findHostedExecutionWakeEventIdTx,
  readHostedExecutionWakeLifecycleStateTx,
  readHostedExecutionWakeTargetTx,
} from "@/src/lib/hosted-wake/queue";

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

interface TestWakePayloadState {
  createdAt: Date;
  payloadBytes: number;
  payloadCiphertext: string;
  payloadSchema: string;
  updatedAt: Date;
  userId: string;
  wakeId: string;
}

interface TestWakeEventState {
  createdAt: Date;
  eventId: string;
  replacedByEventId: string | null;
  updatedAt: Date;
  userId: string;
  wakeId: string;
}

interface TestWakeTerminalState {
  createdAt: Date;
  fetchedCommittedSeq: bigint;
  state: "completed" | "replaced";
  updatedAt: Date;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}

describe("hosted wake store", () => {
  beforeEach(() => {
    process.env.HOSTED_WAKE_ENCRYPTION_KEY =
      "2222222222222222222222222222222222222222222222222222222222222222";
    process.env.HOSTED_WAKE_ENCRYPTION_KEY_VERSION = "test";
    delete process.env.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON;
    process.env.HOSTED_WAKE_COMMIT_PROOF_KEY_ID = "test";
    process.env.HOSTED_WAKE_COMMIT_PROOF_KEY =
      "1111111111111111111111111111111111111111111111111111111111111111";
    delete process.env.HOSTED_WAKE_COMMIT_PROOF_KEYRING_JSON;
  });

  it("fails closed when projecting a corrupted wake record kind or schema", () => {
    expect(() =>
      projectHostedWakeRecord(makeProjectedWakeRow({
        kind: "legacy.dispatch",
      })),
    ).toThrow(/Hosted wake kind is invalid/i);

    expect(() =>
      projectHostedWakeRecord(makeProjectedWakeRow({
        kind: "assistant.cron.tick",
        payloadSchema: "murph.hosted-wake-conversation-message.v1",
      })),
    ).toThrow(/Hosted wake payload schema is invalid/i);

    expect(() =>
      projectHostedWakeRecord(makeProjectedWakeRow({
        kind: "conversation.message",
        payloadSchema: "murph.hosted-wake-system.v1",
      })),
    ).toThrow(/Hosted wake payload schema is invalid/i);
  });

  it("rejects cursor commits that skip over already-allocated wake rows", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 5n,
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
        nextSeq: "5",
        userId: "member_123",
        version: "4",
      }),
    });
  });

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
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_123",
        }),
      ],
    });

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });
    const wake = listed.wakes[0];

    expect(wake).toEqual(expect.objectContaining({
      fetchProof: expect.any(String),
      id: expect.any(String),
      seq: "2",
    }));

    await expect(recordHostedWakeTerminalTx({
      fetchProof: wake!.fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: wake!.id,
      wakeSeq: 2n,
    })).resolves.toBe(true);

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

  it("rejects advancing the cursor without a recorded terminal receipt", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_123",
        }),
      ],
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
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "3",
        userId: "member_123",
        version: "4",
      }),
    });
  });

  it("rejects recording terminal state with a proof for a different wake", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_123",
        }),
      ],
    });

    await expect(recordHostedWakeTerminalTx({
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: 1n,
        userId: "member_123",
        wakeId: "wake_other",
        wakeSeq: 2n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/wakeId/i);
  });

  it("allows snapshot-only CAS updates at the already-committed seq", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 7n,
      snapshotRef: {
        checkpoint: "wake_2_finalized",
      },
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: {
          checkpoint: "wake_2_finalized",
        },
        userId: "member_123",
        version: "8",
      }),
    });
  });

  it("treats already-committed cursor seqs as stale no-op commits when the snapshot is unchanged", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 7n,
      snapshotRef: {
        checkpoint: "wake_2",
      },
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: "7",
      }),
    });
  });

  it("rejects stale cursor commits that move backward", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 7n,
      snapshotRef: {
        checkpoint: "wake_1",
      },
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: {
          checkpoint: "wake_2",
        },
        userId: "member_123",
        version: "7",
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
          dedupeKey: "first",
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
      dedupeKey: "second",
      eventId: "second",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      tx,
      userId: "member_123",
    });

    expect(result.inserted).toBe(false);
    expect(result.updatedExisting).toBe(true);
    expect(result.wake.seq).toBe("1");
    expect(result.wake.dedupeKey).toBe("first");
    expect(result.wake.payloadCiphertext).toEqual(expect.any(String));
    expect(result.wake).not.toHaveProperty("payloadJson");

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.wakes).toHaveLength(1);
    expect(listed.wakes[0]?.seq).toBe("1");
    expect(listed.wakes[0]?.fetchProof).toEqual(expect.any(String));
    expect(listed.wakes[0]?.payloadCiphertext).toEqual(expect.any(String));
    expect(listed.wakes[0]).not.toHaveProperty("payloadJson");

    await expect(findHostedExecutionWakeEventIdTx({
      eventId: "first",
      tx,
      userId: "member_123",
    })).resolves.toBe("first");
    await expect(findHostedExecutionWakeEventIdTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toBe("second");
    await expect(readHostedExecutionWakeTargetTx({
      eventId: "first",
      tx,
      userId: "member_123",
    })).resolves.toBeNull();
    await expect(readHostedExecutionWakeTargetTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      eventId: "second",
      seq: "1",
      userId: "member_123",
    });
    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "first",
      tx,
      userId: "member_123",
    })).resolves.toBe("replaced");
    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toBe("queued");
  });

  it("fails closed when another user queries a wake event id they do not own", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_member_123",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 1,
          },
          seq: 1n,
          userId: "member_123",
        },
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_member_456",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:01:00.000Z",
          payload: {
            revision: 2,
          },
          seq: 2n,
          userId: "member_456",
        },
      ],
    });

    await expect(findHostedExecutionWakeEventIdTx({
      eventId: "evt_member_456",
      tx,
      userId: "member_123",
    })).resolves.toBeNull();

    await expect(readHostedExecutionWakeTargetTx({
      eventId: "evt_member_456",
      tx,
      userId: "member_123",
    })).resolves.toBeNull();

    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "evt_member_456",
      tx,
      userId: "member_123",
    })).resolves.toBeNull();
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
          dedupeKey: "first",
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
      dedupeKey: "second",
      eventId: "second",
      kind: "member.channels.updated",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
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
    expect(listed.wakes[0]?.dedupeKey).toBe("first");
    expect(listed.wakes[0]?.fetchProof).toEqual(expect.any(String));
  });

  it("does not allocate a new seq when a duplicate dedupe key is discovered after the cursor lock", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "member.activated:stripe.invoice.paid:member_123:evt_123",
          kind: "member.activated",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 1,
          },
          seq: 1n,
          userId: "member_123",
        },
      ],
    });

    const result = await appendHostedOrderedWakeTx({
      dedupeKey: "member.activated:stripe.invoice.paid:member_123:evt_123",
      eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
      kind: "member.activated",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      tx,
      userId: "member_123",
    });

    expect(result.duplicate).toBe(true);
    await expect(readHostedExecutionCursor({
      prisma: tx,
      userId: "member_123",
    })).resolves.toEqual(expect.objectContaining({
      committedSeq: "0",
      nextSeq: "2",
      userId: "member_123",
    }));
  });

  it("floors unseen wake reads at the committed cursor position", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 3n,
        nextSeq: 5n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_4",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 4,
          },
          seq: 4n,
          userId: "member_123",
        },
      ],
    });

    const listed = await listHostedWakesAfterSeq({
      afterSeq: 1n,
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.wakes).toHaveLength(1);
    expect(listed.wakes[0]?.seq).toBe("4");
    expect(listed.wakes[0]?.fetchProof).toEqual(expect.any(String));
    expect(listed.wakes[0]?.payloadCiphertext).toEqual(expect.any(String));
    expect(listed.wakes[0]).not.toHaveProperty("payloadJson");
  });

  it("returns the spilled wake payload ciphertext without exposing storage internals", async () => {
    const payload = {
      blob: "x".repeat(20_000),
    };
    const encoded = encodeWakePayloadForHarness("member_123", payload);
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_spilled",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload,
          seq: 1n,
          userId: "member_123",
        },
      ],
    });

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });

    expect(encoded.storage).toBe("ref");
    expect(listed.wakes).toHaveLength(1);
    expect(listed.wakes[0]).toEqual(expect.objectContaining({
      payloadBytes: encoded.payloadBytes,
      payloadCiphertext: expect.any(String),
      seq: "1",
    }));
    expect(listed.wakes[0]).not.toHaveProperty("payloadJson");
    expect(listed.wakes[0]).not.toHaveProperty("payloadRef");
  });

  it("keeps quarantined wakes visible for cursor advancement without hydrating payloads", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 3n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_quarantined",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            revision: 1,
          },
          quarantinedAt: "2026-04-17T00:00:30.000Z",
          seq: 1n,
          userId: "member_123",
        },
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "evt_active",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:01:00.000Z",
          payload: {
            revision: 2,
          },
          seq: 2n,
          userId: "member_123",
        },
      ],
    });

    const listed = await listHostedWakesAfterSeq({
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.wakes).toEqual([
      expect.objectContaining({
        quarantineCode: "invalid-dispatch-payload",
        quarantinedAt: "2026-04-17T00:00:30.000Z",
        seq: "1",
      }),
      expect.objectContaining({
        payloadCiphertext: expect.any(String),
        quarantinedAt: null,
        seq: "2",
      }),
    ]);
    expect(listed.wakes[0]).not.toHaveProperty("payloadJson");
    expect(listed.wakes[1]).not.toHaveProperty("payloadJson");
  });

  it("resolves wake schedule and lifecycle lookups by the original dispatch event id", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
      wakes: [
        {
          behavior: "ordered",
          coalescingKey: null,
          dedupeKey: "telegram:update:321",
          kind: "conversation.message",
          occurredAt: "2026-04-17T00:00:00.000Z",
          payload: {
            channel: "telegram",
            telegramMessage: {
              messageId: "message_321",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello",
              threadId: "thread_321",
            },
          },
          seq: 1n,
          userId: "member_123",
        },
      ],
    });

    await expect(findHostedExecutionWakeEventIdTx({
      eventId: "telegram:update:321",
      tx,
      userId: "member_123",
    })).resolves.toBe("telegram:update:321");

    await expect(readHostedExecutionWakeTargetTx({
      eventId: "telegram:update:321",
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      eventId: "telegram:update:321",
      seq: "1",
      userId: "member_123",
    });

    await expect(readLatestHostedWakeLifecycleByKind({
      kind: "conversation.message",
      prisma: tx,
      userId: "member_123",
    })).resolves.toEqual({
      eventId: "telegram:update:321",
      state: "queued",
    });
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
    quarantinedAt?: string | null;
    seq: bigint;
    userId: string;
  }>;
}): Prisma.TransactionClient {
  const userId = input?.cursor?.userId ?? "member_123";
  const createdAt = new Date("2026-04-17T00:00:00.000Z");
  const wakeEvents: TestWakeEventState[] = [];
  const payloads: TestWakePayloadState[] = [];
  const wakeTerminals: TestWakeTerminalState[] = [];
  const state: {
    cursor: TestCursorState;
    wakeEvents: TestWakeEventState[];
    wakeTerminals: TestWakeTerminalState[];
    payloads: TestWakePayloadState[];
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
    wakeEvents,
    wakeTerminals,
    payloads,
    wakes: (input?.wakes ?? []).map((wake, index) => {
      const id = `wake_${index + 1}`;
      const encoded = encodeWakePayloadForHarness(wake.userId, wake.payload);
      if (encoded.payloadRefCiphertext) {
        payloads.push({
          createdAt,
          payloadBytes: encoded.payloadBytes,
          payloadCiphertext: encoded.payloadRefCiphertext,
          payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
          updatedAt: createdAt,
          userId: wake.userId,
          wakeId: id,
        });
      }

      if (wake.dedupeKey) {
        wakeEvents.push({
          createdAt,
          eventId: wake.dedupeKey,
          replacedByEventId: null,
          updatedAt: createdAt,
          userId: wake.userId,
          wakeId: id,
        });
      }

      return {
        behavior: wake.behavior,
        coalescingKey: wake.coalescingKey,
        createdAt,
        dedupeKey: wake.dedupeKey,
        id,
        kind: wake.kind,
        occurredAt: new Date(wake.occurredAt),
        payloadBytes: encoded.payloadBytes,
        payloadInlineCiphertext: encoded.payloadInlineCiphertext,
        payloadRef: encoded.storage === "ref" ? id : null,
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        quarantineCode: wake.quarantinedAt ? "invalid-dispatch-payload" : null,
        quarantinedAt: wake.quarantinedAt ? new Date(wake.quarantinedAt) : null,
        seq: wake.seq,
        updatedAt: createdAt,
        userId: wake.userId,
      };
    }),
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
          committedSeq: bigint;
          nextSeq?: { gt: bigint };
          userId: string;
          version: bigint;
        };
      }): { count: number } {
        const matches = state.cursor.userId === args.where.userId
          && state.cursor.version === args.where.version
          && state.cursor.committedSeq === args.where.committedSeq
          && (
            !args.where.nextSeq
            || state.cursor.nextSeq > args.where.nextSeq.gt
          );

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
    hostedWakePayload: {
      deleteMany(args: { where: { wakeId: string } }): { count: number } {
        const before = state.payloads.length;
        state.payloads = state.payloads.filter((payload) => payload.wakeId !== args.where.wakeId);
        return {
          count: before - state.payloads.length,
        };
      },
      findMany(args: {
        where: {
          userId: string;
          wakeId: { in: string[] };
        };
      }): TestWakePayloadState[] {
        return state.payloads
          .filter((payload) =>
            payload.userId === args.where.userId
            && args.where.wakeId.in.includes(payload.wakeId))
          .map((payload) => cloneWakePayload(payload));
      },
      findUnique(args: { where: { wakeId: string } }): TestWakePayloadState | null {
        const payload = state.payloads.find((candidate) => candidate.wakeId === args.where.wakeId);
        return payload ? cloneWakePayload(payload) : null;
      },
      upsert(args: {
        create: Omit<TestWakePayloadState, "createdAt" | "updatedAt">;
        update: Omit<TestWakePayloadState, "createdAt" | "wakeId">;
        where: { wakeId: string };
      }): TestWakePayloadState {
        const payload = state.payloads.find((candidate) => candidate.wakeId === args.where.wakeId);

        if (!payload) {
          const createdPayload: TestWakePayloadState = {
            ...args.create,
            createdAt,
            updatedAt: createdAt,
          };
          state.payloads.push(createdPayload);
          return cloneWakePayload(createdPayload);
        }

        Object.assign(payload, args.update);
        payload.updatedAt = new Date(payload.updatedAt.getTime() + 1);
        return cloneWakePayload(payload);
      },
    },
    hostedWakeEvent: {
      create(args: {
        data: Omit<TestWakeEventState, "createdAt" | "updatedAt">;
      }): TestWakeEventState {
        const event: TestWakeEventState = {
          ...args.data,
          createdAt,
          updatedAt: createdAt,
        };
        state.wakeEvents.push(event);
        return cloneWakeEvent(event);
      },
      findFirst(args: {
        orderBy?: { createdAt: "desc" };
        where:
          | {
            replacedByEventId: null;
            userId: string;
            wakeId: string;
          }
          | {
            eventId: string;
            userId: string;
          };
      }): TestWakeEventState | null {
        const where = args.where;

        if ("eventId" in where) {
          const event = state.wakeEvents.find((candidate) =>
            candidate.eventId === where.eventId
            && candidate.userId === where.userId);
          return event ? cloneWakeEvent(event) : null;
        }

        const event = state.wakeEvents
          .filter((candidate) =>
            candidate.replacedByEventId === where.replacedByEventId
            && candidate.userId === where.userId
            && candidate.wakeId === where.wakeId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

        return event ? cloneWakeEvent(event) : null;
      },
      findUnique(args: {
        where: {
          eventId: string;
        };
      }): TestWakeEventState | null {
        const event = state.wakeEvents.find((candidate) => candidate.eventId === args.where.eventId);
        return event ? cloneWakeEvent(event) : null;
      },
      updateMany(args: {
        data: {
          replacedByEventId: string;
        };
        where: {
          eventId: string;
          replacedByEventId: null;
          userId: string;
        };
      }): { count: number } {
        const event = state.wakeEvents.find((candidate) =>
          candidate.eventId === args.where.eventId
          && candidate.replacedByEventId === args.where.replacedByEventId
          && candidate.userId === args.where.userId);

        if (!event) {
          return { count: 0 };
        }

        event.replacedByEventId = args.data.replacedByEventId;
        event.updatedAt = new Date(event.updatedAt.getTime() + 1);
        return { count: 1 };
      },
    },
    hostedWakeTerminal: {
      create(args: {
        data: Omit<TestWakeTerminalState, "createdAt" | "updatedAt">;
      }): TestWakeTerminalState {
        const terminal: TestWakeTerminalState = {
          ...args.data,
          createdAt,
          updatedAt: createdAt,
        };
        state.wakeTerminals.push(terminal);
        return cloneWakeTerminal(terminal);
      },
      findUnique(args: {
        where: {
          wakeId: string;
        };
      }): TestWakeTerminalState | null {
        const terminal = state.wakeTerminals.find((candidate) => candidate.wakeId === args.where.wakeId);
        return terminal ? cloneWakeTerminal(terminal) : null;
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
        orderBy?: { seq: "desc" };
        select?: {
          id: true;
          quarantinedAt?: true;
        };
        where:
          | {
            coalescingKey: string | null;
            quarantinedAt: null;
            seq: { gt: bigint };
            userId: string;
          }
          | {
            id: string;
            seq: bigint;
            userId: string;
          }
          | {
            seq: bigint;
            userId: string;
          }
          | {
            kind: string;
            userId: string;
          };
      }): TestWakeState | Pick<TestWakeState, "id" | "quarantinedAt"> | null {
        const where = args.where;

        if ("kind" in where) {
          const candidate = state.wakes
            .filter((wake) =>
              wake.kind === where.kind
              && wake.userId === where.userId)
            .sort((left, right) => Number(right.seq - left.seq))[0];

          return candidate ? cloneWake(candidate) : null;
        }

        if ("id" in where) {
          const candidate = state.wakes.find((wake) =>
            wake.id === where.id
            && wake.seq === where.seq
            && wake.userId === where.userId);

          if (!candidate) {
            return null;
          }

          if (args.select?.id) {
            return {
              id: candidate.id,
              ...(args.select.quarantinedAt ? { quarantinedAt: candidate.quarantinedAt } : {}),
            };
          }

          return cloneWake(candidate);
        }

        if (typeof where.seq === "bigint") {
          const candidate = state.wakes.find((wake) =>
            wake.seq === where.seq
            && wake.userId === where.userId);

          if (!candidate) {
            return null;
          }

          if (args.select?.id) {
            return {
              id: candidate.id,
              ...(args.select.quarantinedAt ? { quarantinedAt: candidate.quarantinedAt } : {}),
            };
          }

          return cloneWake(candidate);
        }

        const candidate = state.wakes
          .filter((wake) =>
            wake.coalescingKey === where.coalescingKey
            && wake.userId === where.userId
            && wake.quarantinedAt === null
            && wake.seq > where.seq.gt)
          .sort((left, right) => Number(right.seq - left.seq))[0];

        return candidate ? cloneWake(candidate) : null;
      },
      findMany(args: {
        orderBy?: { seq: "asc" };
        take?: number;
        where:
          | {
            seq: { gt: bigint };
            userId: string;
          }
          | {
            dedupeKey: {
              endsWith: string;
              startsWith: string;
            };
          };
      }): TestWakeState[] {
        const where = args.where;

        if ("dedupeKey" in where) {
          return state.wakes
            .filter((wake) =>
              typeof wake.dedupeKey === "string"
              && wake.dedupeKey.startsWith(where.dedupeKey.startsWith)
              && wake.dedupeKey.endsWith(where.dedupeKey.endsWith))
            .map((wake) => cloneWake(wake));
        }

        return state.wakes
          .filter((wake) =>
            wake.userId === where.userId
            && wake.seq > where.seq.gt)
          .sort((left, right) => Number(left.seq - right.seq))
          .slice(0, args.take)
          .map((wake) => cloneWake(wake));
      },
      findUnique(args: {
        where:
          | { dedupeKey: string }
          | { id: string };
      }): TestWakeState | null {
        const where = args.where;

        if ("id" in where) {
          const wake = state.wakes.find((candidate) => candidate.id === where.id);
          return wake ? cloneWake(wake) : null;
        }

        const wake = state.wakes.find((candidate) => candidate.dedupeKey === where.dedupeKey);
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

function createHarnessWake(input: {
  kind: string;
  seq: bigint;
  userId: string;
}): {
  behavior: TestWakeState["behavior"];
  coalescingKey: string | null;
  dedupeKey: string | null;
  kind: string;
  occurredAt: string;
  payload: unknown;
  seq: bigint;
  userId: string;
} {
  return {
    behavior: "ordered",
    coalescingKey: null,
    dedupeKey: `${input.kind}:${input.seq}`,
    kind: input.kind,
    occurredAt: "2026-04-17T00:00:00.000Z",
    payload: {
      eventId: `evt_${input.seq}`,
      kind: input.kind,
      occurredAt: "2026-04-17T00:00:00.000Z",
      reason: "manual",
      userId: input.userId,
    },
    seq: input.seq,
    userId: input.userId,
  };
}

function makeProjectedWakeRow(
  overrides: Partial<Parameters<typeof projectHostedWakeRecord>[0]> = {},
): Parameters<typeof projectHostedWakeRecord>[0] {
  return {
    behavior: "ordered",
    coalescingKey: null,
    createdAt: new Date("2026-04-17T00:00:00.000Z"),
    dedupeKey: null,
    id: "wake_123",
    kind: "assistant.cron.tick",
    occurredAt: new Date("2026-04-17T00:00:00.000Z"),
    payloadBytes: 1,
    payloadInlineCiphertext: null,
    payloadRef: null,
    payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
    quarantineCode: null,
    quarantinedAt: null,
    seq: 1n,
    updatedAt: new Date("2026-04-17T00:00:00.000Z"),
    userId: "member_123",
    ...overrides,
  };
}

function encodeWakePayloadForHarness(userId: string, payload: unknown) {
  return encodeHostedWakeStoredPayload({
    userId,
    value: payload,
  });
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

function cloneWakePayload(payload: TestWakePayloadState): TestWakePayloadState {
  return {
    ...payload,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
  };
}

function cloneWakeEvent(event: TestWakeEventState): TestWakeEventState {
  return {
    ...event,
    createdAt: new Date(event.createdAt),
    updatedAt: new Date(event.updatedAt),
  };
}

function cloneWakeTerminal(terminal: TestWakeTerminalState): TestWakeTerminalState {
  return {
    ...terminal,
    createdAt: new Date(terminal.createdAt),
    updatedAt: new Date(terminal.updatedAt),
  };
}
