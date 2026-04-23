import { describe, expect, it, vi } from "vitest";

import {
  findCurrentHostedIngressEventAliasByWakeId,
  findUncommittedWakeByCoalescingKeyTx,
  replaceHostedIngressEventAliasTx,
} from "@/src/lib/hosted-ingress/store-data";
import type {
  HostedIngressEventAliasRow,
  HostedIngressMutationTx,
} from "@/src/lib/hosted-ingress/store.types";

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

describe("findCurrentHostedIngressEventAliasByWakeId", () => {
  it("reads at most two current aliases and returns the sole current row", async () => {
    const currentAlias = buildHostedIngressEventAliasRow({
      eventId: "evt_current",
      ingressEventId: "wake_123",
    });
    const hostedIngressEventAlias = {
      findMany: vi.fn(async () => [currentAlias]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const tx = createHostedIngressMutationTx({
      hostedIngressEventAlias,
    });

    await expect(findCurrentHostedIngressEventAliasByWakeId({
      ingressEventId: "wake_123",
      tx,
      userId: "member_123",
    })).resolves.toEqual(currentAlias);

    expect(hostedIngressEventAlias.findMany).toHaveBeenCalledWith({
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          eventId: "desc",
        },
      ],
      take: 2,
      where: {
        ingressEventId: "wake_123",
        replacedByEventId: null,
        userId: "member_123",
      },
    });
  });

  it("fails closed when a wake has multiple current aliases", async () => {
    const hostedIngressEventAlias = {
      findMany: vi.fn(async () => [
        buildHostedIngressEventAliasRow({
          eventId: "evt_b",
          ingressEventId: "wake_123",
        }),
        buildHostedIngressEventAliasRow({
          createdAt: new Date("2026-04-20T00:00:01.000Z"),
          eventId: "evt_a",
          ingressEventId: "wake_123",
        }),
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const tx = createHostedIngressMutationTx({
      hostedIngressEventAlias,
    });

    await expect(findCurrentHostedIngressEventAliasByWakeId({
      ingressEventId: "wake_123",
      tx,
      userId: "member_123",
    })).rejects.toThrow(/multiple current aliases/i);
  });
});

describe("replaceHostedIngressEventAliasTx", () => {
  it("updates exactly one current alias row", async () => {
    const hostedIngressEventAlias = {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const tx = createHostedIngressMutationTx({
      hostedIngressEventAlias,
    });

    await expect(replaceHostedIngressEventAliasTx({
      eventId: "evt_old",
      replacedByEventId: "evt_new",
      tx,
      userId: "member_123",
    })).resolves.toBeUndefined();

    expect(hostedIngressEventAlias.updateMany).toHaveBeenCalledWith({
      data: {
        replacedByEventId: "evt_new",
      },
      where: {
        eventId: "evt_old",
        replacedByEventId: null,
        userId: "member_123",
      },
    });
  });

  it("throws when the current alias row is missing", async () => {
    const hostedIngressEventAlias = {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    const tx = createHostedIngressMutationTx({
      hostedIngressEventAlias,
    });

    await expect(replaceHostedIngressEventAliasTx({
      eventId: "evt_old",
      replacedByEventId: "evt_new",
      tx,
      userId: "member_123",
    })).rejects.toThrow(/expected exactly one current row/i);
  });
});

function buildHostedIngressEventAliasRow(
  overrides: Partial<HostedIngressEventAliasRow> = {},
): HostedIngressEventAliasRow {
  return {
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    eventId: "evt_alias",
    ingressEventId: "wake_alias",
    replacedByEventId: null,
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    userId: "member_123",
    ...overrides,
  };
}

function createHostedIngressMutationTx(
  overrides: Partial<Record<string, unknown>> = {},
): HostedIngressMutationTx {
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
    hostedIngressEventAlias: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    ...overrides,
  });

  return tx;
}
