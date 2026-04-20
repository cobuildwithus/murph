import { describe, expect, it, vi } from "vitest";

import { findUncommittedWakeByCoalescingKeyTx } from "@/src/lib/hosted-ingress/store-data";
import type { HostedIngressMutationTx } from "@/src/lib/hosted-ingress/store.types";

describe("findUncommittedWakeByCoalescingKeyTx", () => {
  it("only considers non-acquired pending wakes for coalescing", async () => {
    const tx = createHostedIngressMutationTx();

    await findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: "device-sync.wake:member_123:global",
      tx,
      userId: "member_123",
    });

    expect(tx.hostedExecutionCursor.upsert).toHaveBeenCalledWith({
      create: {
        userId: "member_123",
      },
      update: {},
      where: {
        userId: "member_123",
      },
    });
    expect(tx.hostedIngressEvent.findFirst).toHaveBeenCalledWith({
      orderBy: {
        seq: "desc",
      },
      where: {
        coalescingKey: "device-sync.wake:member_123:global",
        quarantinedAt: null,
        runId: null,
        seq: {
          gt: 41n,
        },
        state: "pending",
        userId: "member_123",
      },
    });
  });

  it("returns early when no coalescing key is present", async () => {
    const tx = createHostedIngressMutationTx();

    await expect(findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: null,
      tx,
      userId: "member_123",
    })).resolves.toBeNull();

    expect(tx.hostedExecutionCursor.upsert).not.toHaveBeenCalled();
    expect(tx.hostedIngressEvent.findFirst).not.toHaveBeenCalled();
  });
});

function createHostedIngressMutationTx(): HostedIngressMutationTx {
  const tx = {} as HostedIngressMutationTx;

  Object.assign(tx, {
    hostedExecutionCursor: {
      upsert: vi.fn(async () => ({
        committedSeq: 41n,
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        nextSeq: 42n,
        snapshotRef: null,
        updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        userId: "member_123",
        version: 7n,
      })),
    },
    hostedIngressEvent: {
      findFirst: vi.fn(async () => null),
    },
  });

  return tx;
}
