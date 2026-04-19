import type { Prisma } from "@prisma/client";
import type { HostedWakeRecord } from "@murphai/hosted-execution/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedExecutionWakePayloadTx: vi.fn(),
  materializeHostedAssistantCronWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-wake/queue", () => ({
  appendHostedExecutionWakePayloadTx: mocks.appendHostedExecutionWakePayloadTx,
  materializeHostedAssistantCronWakeTx: mocks.materializeHostedAssistantCronWakeTx,
}));

import { materializeHostedDueWakesTx } from "@/src/lib/hosted-wake/materialize";

describe("materializeHostedDueWakesTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.materializeHostedAssistantCronWakeTx.mockResolvedValue(createAppendHostedWakeResult({
      kind: "assistant.cron.tick",
      seq: "11",
      userId: "member_123",
    }));
    mocks.appendHostedExecutionWakePayloadTx.mockResolvedValue(createAppendHostedWakeResult({
      kind: "device-sync.wake",
      seq: "12",
      userId: "member_123",
    }));
  });

  it("materializes due assistant and reconcile wakes and preserves only future hints", async () => {
    const tx = createMaterializeTx({
      dueConnections: [{
        id: "connection_due",
        nextReconcileAt: new Date("2026-04-17T00:00:00.000Z"),
        provider: "oura",
      }],
      nextConnection: {
        nextReconcileAt: new Date("2026-04-17T02:00:00.000Z"),
      },
    });

    const result = await materializeHostedDueWakesTx({
      now: new Date("2026-04-17T01:00:00.000Z"),
      tx: tx as Prisma.TransactionClient,
      userId: "member_123",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T00:30:00.000Z",
        deviceSyncWakeAt: "2026-04-17T00:45:00.000Z",
      },
    });

    expect(mocks.materializeHostedAssistantCronWakeTx).toHaveBeenCalledWith({
      occurredAt: "2026-04-17T01:00:00.000Z",
      reason: "alarm",
      tx,
      userId: "member_123",
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).toHaveBeenCalledWith(expect.objectContaining({
      tx,
      wake: expect.objectContaining({
        connectionId: "connection_due",
        kind: "device-sync.wake",
        reason: "reconcile_due",
        userId: "member_123",
      }),
    }));
    expect(result).toEqual({
      targetSeqHint: "12",
      wakeMaterializationHints: {
        assistantWakeAt: null,
        deviceSyncWakeAt: "2026-04-17T02:00:00.000Z",
      },
    });
  });

  it("does not enqueue far-future work", async () => {
    const tx = createMaterializeTx({
      dueConnections: [{
        id: "connection_future",
        nextReconcileAt: new Date("2026-04-17T03:00:00.000Z"),
        provider: "oura",
      }],
      nextConnection: {
        nextReconcileAt: new Date("2026-04-17T03:00:00.000Z"),
      },
    });

    const result = await materializeHostedDueWakesTx({
      now: new Date("2026-04-17T01:00:00.000Z"),
      tx: tx as Prisma.TransactionClient,
      userId: "member_123",
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T04:00:00.000Z",
        deviceSyncWakeAt: "2026-04-17T03:00:00.000Z",
      },
    });

    expect(mocks.materializeHostedAssistantCronWakeTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedExecutionWakePayloadTx).not.toHaveBeenCalled();
    expect(tx.deviceConnection.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      targetSeqHint: null,
      wakeMaterializationHints: {
        assistantWakeAt: "2026-04-17T04:00:00.000Z",
        deviceSyncWakeAt: "2026-04-17T03:00:00.000Z",
      },
    });
  });
});

function createMaterializeTx(input: {
  dueConnections: Array<{
    id: string;
    nextReconcileAt: Date | null;
    provider: string;
  }>;
  nextConnection: {
    nextReconcileAt: Date | null;
  } | null;
}) {
  return {
    deviceConnection: {
      findFirst: vi.fn(async () => input.nextConnection),
      findMany: vi.fn(async () => input.dueConnections),
    },
  };
}

function createAppendHostedWakeResult(input: {
  kind: HostedWakeRecord["kind"];
  seq: string;
  userId: string;
}): {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedWakeRecord;
} {
  const now = "2026-04-17T01:00:00.000Z";

  return {
    duplicate: false,
    inserted: true,
    updatedExisting: false,
    wake: {
      behavior: "ordered",
      createdAt: now,
      dedupeKey: `${input.kind}:${input.seq}`,
      id: `wake_${input.seq}`,
      kind: input.kind,
      occurredAt: now,
      payloadBytes: 128,
      payloadSchema: "murph.hosted-wake-execution.v1",
      quarantineCode: null,
      quarantinedAt: null,
      seq: input.seq,
      updatedAt: now,
      userId: input.userId,
    },
  };
}
