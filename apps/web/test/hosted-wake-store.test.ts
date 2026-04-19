import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA } from "@murphai/hosted-execution";
import type {
  HostedWakeSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionCursorSnapshotRef } from "@murphai/hosted-execution/parsers";

import {
  encodeHostedWakeStoredPayload,
} from "@/src/lib/hosted-wake/payload";
import { issueHostedWakeFetchProof } from "@/src/lib/hosted-wake/fetch-proof";
import {
  appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx,
  commitHostedExecutionCursorTx,
  countPendingHostedWakes,
  listHostedExecutableWakes,
  projectHostedWakeRecord,
  quarantineHostedWakeTx,
  readLatestHostedWakeLifecycleByKind,
  readHostedExecutionCursor,
  readHostedWakeLifecycleByEventIdTx,
  recordHostedWakeTerminalTx,
} from "@/src/lib/hosted-wake/store";
import {
  findHostedWakeByEventIdTx,
} from "@/src/lib/hosted-wake/store-data";
import {
  findHostedExecutionWakeEventIdTx,
  readHostedExecutionWakeLifecycleStateTx,
  readHostedExecutionWakeTargetTx,
} from "@/src/lib/hosted-wake/queue";

function makeSnapshotRef(label: string): HostedWakeSnapshotRef {
  return {
    hash: `hash_${label}`,
    key: `bundles/vault/${label}`,
    size: label.length,
    updatedAt: "2026-04-17T00:00:00.000Z",
  };
}

interface TestCursorState {
  committedSeq: bigint;
  createdAt: Date;
  nextSeq: bigint;
  snapshotRef: HostedWakeSnapshotRef | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

interface TestWakeState {
  behavior: "coalescing" | "ordered";
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
  fetchedCursorVersion: bigint;
  state: "completed" | "quarantined";
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
    process.env.HOSTED_WAKE_FETCH_PROOF_KEY_ID = "test";
    process.env.HOSTED_WAKE_FETCH_PROOF_KEY =
      "1111111111111111111111111111111111111111111111111111111111111111";
    delete process.env.HOSTED_WAKE_FETCH_PROOF_KEYRING_JSON;
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
      snapshotRef: makeSnapshotRef("wake_3"),
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
      snapshotRef: makeSnapshotRef("wake_3"),
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

    const listed = await listHostedExecutableWakes({
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
      snapshotRef: makeSnapshotRef("wake_2"),
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "3",
        snapshotRef: makeSnapshotRef("wake_2"),
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
      snapshotRef: makeSnapshotRef("wake_2"),
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
        fetchedCursorVersion: 4n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
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

  it("rejects a legacy fetch proof that omits wakeEventId binding", async () => {
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

    const nowSeconds = Math.floor(Date.now() / 1000);
    const legacyClaims = {
      exp: nowSeconds + 5 * 60,
      fetchedCommittedSeq: "1",
      fetchedCursorVersion: "4",
      iat: nowSeconds,
      kind: "hosted-wake-fetch-proof" as const,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: "2",
    };
    const encodedClaims = Buffer.from(JSON.stringify(legacyClaims), "utf8").toString("base64url");
    const signature = createHmac(
      "sha256",
      Buffer.from(process.env.HOSTED_WAKE_FETCH_PROOF_KEY ?? "", "hex"),
    )
      .update("murph.hosted-wake.fetch-proof.v1:")
      .update(encodedClaims)
      .digest("base64url");
    const fetchProof = `${process.env.HOSTED_WAKE_FETCH_PROOF_KEY_ID ?? "v1"}.${encodedClaims}.${signature}`;

    await expect(recordHostedWakeTerminalTx({
      fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/required claims/i);
  });

  it("rejects recording terminal state from a stale fetch proof before cursor advancement", async () => {
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
        fetchedCommittedSeq: 0n,
        fetchedCursorVersion: 3n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/stale/i);
  });

  it("locks the cursor before recording terminal state", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
      requireCursorLockBeforeWakeMutation: true,
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
        fetchedCursorVersion: 4n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).resolves.toBe(true);
  });

  it("rolls the cursor fence when quarantine mutates a wake and requires a fresh quarantine receipt before commit", async () => {
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

    const initialFetchProof = issueHostedWakeFetchProof({
      fetchedCommittedSeq: 1n,
      fetchedCursorVersion: 4n,
      userId: "member_123",
      wakeEventId: "assistant.cron.tick:2",
      wakeId: "wake_1",
      wakeSeq: 2n,
    });

    await expect(quarantineHostedWakeTx({
      fetchProof: initialFetchProof,
      quarantineCode: "invalid-wake-payload",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).resolves.toBe(true);

    await expect(readHostedExecutionCursor({
      prisma: tx,
      userId: "member_123",
    })).resolves.toEqual(expect.objectContaining({
      committedSeq: "1",
      nextSeq: "3",
      userId: "member_123",
      version: "5",
    }));

    await expect(recordHostedWakeTerminalTx({
      fetchProof: initialFetchProof,
      state: "quarantined",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/stale/i);

    await expect(commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 4n,
      snapshotRef: makeSnapshotRef("wake_2_stale_version"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "3",
        userId: "member_123",
        version: "5",
      }),
    });

    await expect(commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 5n,
      snapshotRef: makeSnapshotRef("wake_2_without_refetch"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "3",
        userId: "member_123",
        version: "5",
      }),
    });

    const latestFetch = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });
    const latestWake = latestFetch.wakes[0];

    expect(latestFetch.cursor.version).toBe("5");
    expect(latestWake).toEqual(expect.objectContaining({
      id: "wake_1",
      quarantineCode: "invalid-wake-payload",
      quarantinedAt: expect.any(String),
      seq: "2",
    }));

    await expect(recordHostedWakeTerminalTx({
      fetchProof: latestWake!.fetchProof,
      state: "quarantined",
      tx,
      userId: "member_123",
      wakeId: latestWake!.id,
      wakeSeq: 2n,
    })).resolves.toBe(true);

    await expect(commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 5n,
      snapshotRef: makeSnapshotRef("wake_2"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "3",
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: "6",
      }),
    });
  });

  it("rejects quarantining a wake from a stale fetch proof", async () => {
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

    await expect(quarantineHostedWakeTx({
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: 0n,
        fetchedCursorVersion: 3n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      quarantineCode: "invalid-wake-payload",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/stale/i);
  });

  it("rejects quarantining a wake from a legacy fetch proof that omits wakeEventId binding", async () => {
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

    const nowSeconds = Math.floor(Date.now() / 1000);
    const legacyClaims = {
      exp: nowSeconds + 5 * 60,
      fetchedCommittedSeq: "1",
      fetchedCursorVersion: "4",
      iat: nowSeconds,
      kind: "hosted-wake-fetch-proof" as const,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: "2",
    };
    const encodedClaims = Buffer.from(JSON.stringify(legacyClaims), "utf8").toString("base64url");
    const signature = createHmac(
      "sha256",
      Buffer.from(process.env.HOSTED_WAKE_FETCH_PROOF_KEY ?? "", "hex"),
    )
      .update("murph.hosted-wake.fetch-proof.v1:")
      .update(encodedClaims)
      .digest("base64url");
    const fetchProof = `${process.env.HOSTED_WAKE_FETCH_PROOF_KEY_ID ?? "v1"}.${encodedClaims}.${signature}`;

    await expect(quarantineHostedWakeTx({
      fetchProof,
      quarantineCode: "invalid-wake-payload",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/required claims/i);
  });

  it("locks the cursor before quarantining a wake", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 1n,
        nextSeq: 3n,
        userId: "member_123",
        version: 4n,
      },
      requireCursorLockBeforeWakeMutation: true,
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_123",
        }),
      ],
    });

    await expect(quarantineHostedWakeTx({
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: 1n,
        fetchedCursorVersion: 4n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      quarantineCode: "invalid-wake-payload",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).resolves.toBe(true);
  });

  it("refreshes the terminal receipt fetch fence when the same wake is re-fetched from the current cursor", async () => {
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
        fetchedCommittedSeq: 0n,
        fetchedCursorVersion: 3n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).rejects.toThrow(/stale/i);

    await expect(recordHostedWakeTerminalTx({
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: 1n,
        fetchedCursorVersion: 4n,
        userId: "member_123",
        wakeEventId: "assistant.cron.tick:2",
        wakeId: "wake_1",
        wakeSeq: 2n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 2n,
    })).resolves.toBe(true);

    await expect(commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 4n,
      snapshotRef: makeSnapshotRef("wake_2"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "3",
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: "5",
      }),
    });
  });

  it("commits snapshot-only cursor CAS updates at the already-committed seq without a terminal receipt", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 7n,
      snapshotRef: makeSnapshotRef("wake_2_finalized"),
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: makeSnapshotRef("wake_2_finalized"),
        userId: "member_123",
        version: "8",
      }),
    });
  });

  it("rejects snapshot-only cursor CAS updates when the expected version is stale", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 6n,
      snapshotRef: makeSnapshotRef("wake_2_finalized"),
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: "7",
      }),
    });
  });

  it("returns null from event-id wake lookup when a scoped event points at another user's wake", async () => {
    const tx = createHostedWakeStoreHarness({
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 1n,
          userId: "member_a",
        }),
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_b",
        }),
      ],
    });

    tx.hostedWakeEvent.create({
      data: {
        eventId: "corrupt-event",
        replacedByEventId: null,
        userId: "member_a",
        wakeId: "wake_2",
      },
    });

    await expect(findHostedWakeByEventIdTx({
      eventId: "corrupt-event",
      tx,
      userId: "member_a",
    })).resolves.toBeNull();
  });

  it("fails closed when lifecycle resolution finds an owner-mismatched wake for the scoped event", async () => {
    const tx = createHostedWakeStoreHarness({
      wakes: [
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 1n,
          userId: "member_a",
        }),
        createHarnessWake({
          kind: "assistant.cron.tick",
          seq: 2n,
          userId: "member_b",
        }),
      ],
    });

    tx.hostedWakeEvent.create({
      data: {
        eventId: "corrupt-event",
        replacedByEventId: null,
        userId: "member_a",
        wakeId: "wake_2",
      },
    });

    await expect(readHostedWakeLifecycleByEventIdTx({
      eventId: "corrupt-event",
      tx,
      userId: "member_a",
    })).resolves.toBeNull();
  });

  it("treats already-committed cursor seqs as stale no-op commits when the snapshot is unchanged", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 2n,
        nextSeq: 4n,
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 2n,
      expectedVersion: 7n,
      snapshotRef: makeSnapshotRef("wake_2"),
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: makeSnapshotRef("wake_2"),
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
        snapshotRef: makeSnapshotRef("wake_2"),
        userId: "member_123",
        version: 7n,
      },
    });

    const result = await commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 7n,
      snapshotRef: makeSnapshotRef("wake_1"),
      tx,
      userId: "member_123",
    });

    expect(result).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "2",
        nextSeq: "4",
        snapshotRef: makeSnapshotRef("wake_2"),
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

    const listed = await listHostedExecutableWakes({
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

  it("resolves the same hosted wake event id separately for each owner", async () => {
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
          dedupeKey: "evt_shared",
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
          dedupeKey: "evt_shared",
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

    await expect(readHostedExecutionWakeTargetTx({
      eventId: "evt_shared",
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      eventId: "evt_shared",
      seq: "1",
      userId: "member_123",
    });

    await expect(readHostedExecutionWakeTargetTx({
      eventId: "evt_shared",
      tx,
      userId: "member_456",
    })).resolves.toEqual({
      eventId: "evt_shared",
      seq: "2",
      userId: "member_456",
    });
  });

  it("allows different users to append the same wake dedupe key", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
      },
    });

    const first = await appendHostedOrderedWakeTx({
      dedupeKey: "shared-provider-event",
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-17T00:00:00.000Z",
      payload: {
        revision: 1,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      tx,
      userId: "member_123",
    });
    const second = await appendHostedOrderedWakeTx({
      dedupeKey: "shared-provider-event",
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-17T00:01:00.000Z",
      payload: {
        revision: 2,
      },
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      tx,
      userId: "member_456",
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
    expect(second.duplicate).toBe(false);
    expect(first.wake.userId).toBe("member_123");
    expect(second.wake.userId).toBe("member_456");
    expect(second.wake.seq).toBe("1");
  });

  it("keeps rejecting a stale coalesced wake receipt even after the caller learns the rewritten cursor version", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
        version: 7n,
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

    const initialFetch = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });
    const staleWake = initialFetch.wakes[0];

    expect(initialFetch.cursor.version).toBe("7");
    expect(staleWake).toEqual(expect.objectContaining({
      id: "wake_1",
      occurredAt: "2026-04-17T00:00:00.000Z",
      seq: "1",
    }));

    const rewrite = await appendHostedCoalescingWakeTx({
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

    expect(rewrite.updatedExisting).toBe(true);
    expect(rewrite.wake.id).toBe("wake_1");
    expect(rewrite.wake.seq).toBe("1");

    await expect(recordHostedWakeTerminalTx({
      fetchProof: staleWake!.fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: staleWake!.id,
      wakeSeq: 1n,
    })).rejects.toThrow(/stale/i);

    const staleCommit = await commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 7n,
      snapshotRef: makeSnapshotRef("wake_1_stale"),
      tx,
      userId: "member_123",
    });

    expect(staleCommit).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "0",
        nextSeq: "2",
        userId: "member_123",
        version: "8",
      }),
    });

    const staleRetry = await commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 8n,
      snapshotRef: makeSnapshotRef("wake_1_stale_retry"),
      tx,
      userId: "member_123",
    });

    expect(staleRetry).toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "0",
        nextSeq: "2",
        userId: "member_123",
        version: "8",
      }),
    });
    await expect(countPendingHostedWakes({
      prisma: tx,
      userId: "member_123",
    })).resolves.toBe(1);
    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toBe("queued");

    const latestFetch = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });
    const latestWake = latestFetch.wakes[0];

    expect(latestFetch.cursor.version).toBe("8");
    expect(latestWake).toEqual(expect.objectContaining({
      id: "wake_1",
      occurredAt: "2026-04-17T00:01:00.000Z",
      seq: "1",
    }));
    expect(latestWake?.fetchProof).toEqual(expect.any(String));

    await expect(recordHostedWakeTerminalTx({
      fetchProof: latestWake!.fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: latestWake!.id,
      wakeSeq: 1n,
    })).resolves.toBe(true);
    await expect(countPendingHostedWakes({
      prisma: tx,
      userId: "member_123",
    })).resolves.toBe(0);
    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toBe("completed");

    const latestCommit = await commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 8n,
      snapshotRef: makeSnapshotRef("wake_1_latest"),
      tx,
      userId: "member_123",
    });

    expect(latestCommit).toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: makeSnapshotRef("wake_1_latest"),
        userId: "member_123",
        version: "9",
      }),
    });
  });

  it("rejects a coalesced wake proof whose logical event identity was replaced in place", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
        version: 7n,
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

    await appendHostedCoalescingWakeTx({
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

    await expect(recordHostedWakeTerminalTx({
      fetchProof: issueHostedWakeFetchProof({
        fetchedCommittedSeq: 0n,
        fetchedCursorVersion: 8n,
        userId: "member_123",
        wakeEventId: "first",
        wakeId: "wake_1",
        wakeSeq: 1n,
      }),
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: "wake_1",
      wakeSeq: 1n,
    })).rejects.toThrow(/identity/i);
  });

  it("clears a pre-rewrite terminal receipt when a coalescing wake is rewritten in place", async () => {
    const tx = createHostedWakeStoreHarness({
      cursor: {
        committedSeq: 0n,
        nextSeq: 2n,
        userId: "member_123",
        version: 7n,
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

    const initialFetch = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });
    const initialWake = initialFetch.wakes[0];

    await expect(recordHostedWakeTerminalTx({
      fetchProof: initialWake!.fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: initialWake!.id,
      wakeSeq: 1n,
    })).resolves.toBe(true);

    await expect(appendHostedCoalescingWakeTx({
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
    })).resolves.toEqual(expect.objectContaining({
      updatedExisting: true,
      wake: expect.objectContaining({
        id: "wake_1",
        seq: "1",
      }),
    }));

    const latestFetch = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });
    const latestWake = latestFetch.wakes[0];

    expect(latestFetch.cursor.version).toBe("8");
    await expect(readHostedExecutionWakeLifecycleStateTx({
      eventId: "second",
      tx,
      userId: "member_123",
    })).resolves.toBe("queued");
    await expect(commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 8n,
      snapshotRef: makeSnapshotRef("wake_1_without_fresh_terminal"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: false,
      cursor: expect.objectContaining({
        committedSeq: "0",
        nextSeq: "2",
        userId: "member_123",
        version: "8",
      }),
    });

    await expect(recordHostedWakeTerminalTx({
      fetchProof: latestWake!.fetchProof,
      state: "completed",
      tx,
      userId: "member_123",
      wakeId: latestWake!.id,
      wakeSeq: 1n,
    })).resolves.toBe(true);

    await expect(commitHostedExecutionCursorTx({
      committedSeq: 1n,
      expectedVersion: 8n,
      snapshotRef: makeSnapshotRef("wake_1_with_fresh_terminal"),
      tx,
      userId: "member_123",
    })).resolves.toEqual({
      committed: true,
      cursor: expect.objectContaining({
        committedSeq: "1",
        nextSeq: "2",
        snapshotRef: makeSnapshotRef("wake_1_with_fresh_terminal"),
        userId: "member_123",
        version: "9",
      }),
    });
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

  it("lists executable wake proofs from the current committed cursor", async () => {
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
          dedupeKey: "evt_1",
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
          dedupeKey: "evt_2",
          kind: "assistant.cron.tick",
          occurredAt: "2026-04-17T00:00:01.000Z",
          payload: {
            revision: 2,
          },
          seq: 2n,
          userId: "member_123",
        },
      ],
    });

    const listed = await listHostedExecutableWakes({
      prisma: tx,
      userId: "member_123",
    });

    expect(listed.cursor).toEqual(expect.objectContaining({
      committedSeq: "0",
      nextSeq: "3",
      userId: "member_123",
    }));
    expect(listed.wakes.map((wake) => wake.seq)).toEqual(["1", "2"]);
    expect(listed.wakes[0]?.fetchProof).toEqual(expect.any(String));
    expect(listed.wakes[1]?.fetchProof).toEqual(expect.any(String));
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

    const listed = await listHostedExecutableWakes({
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

    const listed = await listHostedExecutableWakes({
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
  requireCursorLockBeforeWakeMutation?: boolean;
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
    cursorLocked: boolean;
    cursor: TestCursorState;
    wakeEvents: TestWakeEventState[];
    wakeTerminals: TestWakeTerminalState[];
    payloads: TestWakePayloadState[];
    wakes: TestWakeState[];
  } = {
    cursorLocked: false,
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
        state.cursorLocked = true;
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
      update(args: {
        data: {
          version: { increment: bigint | number };
        };
        where: {
          userId: string;
        };
      }): TestCursorState {
        if (state.cursor.userId !== args.where.userId) {
          throw new Error(`Missing hosted execution cursor ${args.where.userId}`);
        }

        state.cursor.version += BigInt(args.data.version.increment);
        state.cursor.updatedAt = new Date(state.cursor.updatedAt.getTime() + 1);
        return cloneCursor(state.cursor);
      },
      updateMany(args: {
        data: {
          committedSeq: bigint;
          snapshotRef: HostedWakeSnapshotRef | typeof Prisma.DbNull;
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
        if (args.data.snapshotRef === Prisma.DbNull) {
          state.cursor.snapshotRef = null;
        } else {
          state.cursor.snapshotRef = parseHostedExecutionCursorSnapshotRef(
            structuredClone(args.data.snapshotRef),
            "Hosted execution cursor snapshotRef",
          );
        }
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
        orderBy?: { createdAt: "asc" | "desc" };
        where:
          | {
            replacedByEventId: null;
            userId: string;
            wakeId: string;
          }
          | {
            eventId: string;
            userId?: string;
          };
      }): TestWakeEventState | null {
        const where = args.where;

        if ("eventId" in where) {
          const event = state.wakeEvents.find((candidate) =>
            candidate.eventId === where.eventId
            && (where.userId === undefined || candidate.userId === where.userId));
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
          userId_eventId: {
            eventId: string;
            userId: string;
          };
        };
      }): TestWakeEventState | null {
        const event = state.wakeEvents.find((candidate) =>
          candidate.eventId === args.where.userId_eventId.eventId
          && candidate.userId === args.where.userId_eventId.userId);
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
        if (input?.requireCursorLockBeforeWakeMutation && !state.cursorLocked) {
          throw new Error("Expected hosted execution cursor to be locked before writing terminal state.");
        }
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
      update(args: {
        data: {
          fetchedCommittedSeq: bigint;
          fetchedCursorVersion: bigint;
        };
        where: {
          wakeId: string;
        };
      }): TestWakeTerminalState {
        if (input?.requireCursorLockBeforeWakeMutation && !state.cursorLocked) {
          throw new Error("Expected hosted execution cursor to be locked before writing terminal state.");
        }
        const terminal = state.wakeTerminals.find((candidate) => candidate.wakeId === args.where.wakeId);

        if (!terminal) {
          throw new Error(`Unknown hosted wake terminal ${args.where.wakeId}.`);
        }

        terminal.fetchedCommittedSeq = args.data.fetchedCommittedSeq;
        terminal.fetchedCursorVersion = args.data.fetchedCursorVersion;
        terminal.updatedAt = new Date(terminal.updatedAt.getTime() + 1);
        return cloneWakeTerminal(terminal);
      },
      deleteMany(args: {
        where: {
          wakeId: string;
        };
      }): { count: number } {
        const before = state.wakeTerminals.length;
        state.wakeTerminals = state.wakeTerminals.filter((terminal) => terminal.wakeId !== args.where.wakeId);
        return {
          count: before - state.wakeTerminals.length,
        };
      },
      findMany(args: {
        where: {
          userId: string;
          wakeId: { in: string[] };
        };
        select: {
          fetchedCommittedSeq?: true;
          fetchedCursorVersion?: true;
          state?: true;
          userId?: true;
          wakeId?: true;
          wakeSeq?: true;
        };
      }): Array<Partial<TestWakeTerminalState>> {
        return state.wakeTerminals
          .filter((terminal) =>
            terminal.userId === args.where.userId
            && args.where.wakeId.in.includes(terminal.wakeId))
          .map((terminal) => {
            const selected: Partial<TestWakeTerminalState> = {};

            if (args.select.fetchedCommittedSeq) {
              selected.fetchedCommittedSeq = terminal.fetchedCommittedSeq;
            }
            if (args.select.fetchedCursorVersion) {
              selected.fetchedCursorVersion = terminal.fetchedCursorVersion;
            }
            if (args.select.state) {
              selected.state = terminal.state;
            }
            if (args.select.userId) {
              selected.userId = terminal.userId;
            }
            if (args.select.wakeId) {
              selected.wakeId = terminal.wakeId;
            }
            if (args.select.wakeSeq) {
              selected.wakeSeq = terminal.wakeSeq;
            }

            return selected;
          });
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
              quarantinedAt: args.select.quarantinedAt ? candidate.quarantinedAt : null,
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
              quarantinedAt: args.select.quarantinedAt ? candidate.quarantinedAt : null,
            };
          }

          return cloneWake(candidate);
        }

        const candidate = "coalescingKey" in where
          ? state.wakes
            .filter((wake) =>
              wake.coalescingKey === where.coalescingKey
              && wake.userId === where.userId
              && wake.quarantinedAt === null
              && wake.seq > where.seq.gt)
            .sort((left, right) => Number(right.seq - left.seq))[0]
          : undefined;

        return candidate ? cloneWake(candidate) : null;
      },
      findMany(args: {
        orderBy?: { seq: "asc" };
        select?: {
          id?: true;
          quarantinedAt?: true;
          seq?: true;
          userId?: true;
        };
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
      }): Array<TestWakeState | Partial<TestWakeState>> {
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
          .map((wake) => {
            if (!args.select) {
              return cloneWake(wake);
            }

            const selected: Partial<TestWakeState> = {};
            if (args.select.id) {
              selected.id = wake.id;
            }
            if (args.select.quarantinedAt) {
              selected.quarantinedAt = wake.quarantinedAt;
            }
            if (args.select.seq) {
              selected.seq = wake.seq;
            }
            if (args.select.userId) {
              selected.userId = wake.userId;
            }

            return selected;
          });
      },
      updateMany(args: {
        data: {
          quarantineCode: string;
          quarantinedAt: Date;
        };
        where: {
          id: string;
          quarantinedAt: null;
          seq: bigint;
          userId: string;
        };
      }): { count: number } {
        if (input?.requireCursorLockBeforeWakeMutation && !state.cursorLocked) {
          throw new Error("Expected hosted execution cursor to be locked before mutating a quarantined wake.");
        }
        const wake = state.wakes.find((candidate) =>
          candidate.id === args.where.id
          && candidate.seq === args.where.seq
          && candidate.userId === args.where.userId
          && candidate.quarantinedAt === null);

        if (!wake) {
          return { count: 0 };
        }

        wake.quarantineCode = args.data.quarantineCode;
        wake.quarantinedAt = new Date(args.data.quarantinedAt);
        wake.updatedAt = new Date(wake.updatedAt.getTime() + 1);
        return { count: 1 };
      },
      findUnique(args: {
        where:
          | {
            userId_dedupeKey: {
              dedupeKey: string;
              userId: string;
            };
          }
          | { id: string };
      }): TestWakeState | null {
        const where = args.where;

        if ("id" in where) {
          const wake = state.wakes.find((candidate) => candidate.id === where.id);
          return wake ? cloneWake(wake) : null;
        }

        const wake = state.wakes.find((candidate) =>
          candidate.dedupeKey === where.userId_dedupeKey.dedupeKey
          && candidate.userId === where.userId_dedupeKey.userId);
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
    version: cursor.version ?? 0n,
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
