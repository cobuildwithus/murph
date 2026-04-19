import type { HostedWakeRecord } from "@murphai/hosted-execution/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedExecutionWakePayloadTx: vi.fn(),
  buildHostedDeviceSyncWake: vi.fn(),
  materializeHostedAssistantCronWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/wake", () => ({
  buildHostedDeviceSyncWake: mocks.buildHostedDeviceSyncWake,
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
    mocks.buildHostedDeviceSyncWake.mockImplementation((input: {
      connectionId: string;
      hint: {
        nextReconcileAt: string | null;
        occurredAt: string;
        reason: "scheduled-reconcile";
      };
      occurredAt: string;
      provider: string;
      source: "scheduled-reconcile";
      traceId: string;
      userId: string;
    }) => ({
      connectionId: input.connectionId,
      eventId: `device-sync:${input.connectionId}:${input.traceId}`,
      hint: input.hint,
      kind: "device-sync.wake" as const,
      occurredAt: input.occurredAt,
      provider: input.provider,
      reason: "reconcile_due" as const,
      userId: input.userId,
    }));
    mocks.appendHostedExecutionWakePayloadTx.mockResolvedValue(createAppendHostedWakeResult({
      kind: "device-sync.wake",
      seq: "12",
      userId: "member_123",
    }));
  });

  it("materializes due assistant and reconcile wakes from canonical Postgres state", async () => {
    const tx = createMaterializeTx({
      assistantNextWakeAt: new Date("2026-04-17T00:30:00.000Z"),
      connections: [{
        id: "connection_due",
        nextReconcileAt: new Date("2026-04-17T00:00:00.000Z"),
        provider: "oura",
        userId: "member_123",
      }],
    });

    const result = await materializeHostedDueWakesTx({
      appendAssistantCronWake: ({ occurredAt, reason, userId }) => mocks.materializeHostedAssistantCronWakeTx({
        occurredAt,
        reason,
        tx,
        userId,
      }),
      appendWakePayload: ({ wake }) => mocks.appendHostedExecutionWakePayloadTx({
        tx,
        wake,
      }),
      now: new Date("2026-04-17T01:00:00.000Z"),
      tx,
      userId: "member_123",
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
        deviceSyncWakeAt: null,
      },
    });
  });

  it("materializes due assistant wakes even when Cloudflare clears its local hints", async () => {
    const tx = createMaterializeTx({
      assistantNextWakeAt: new Date("2026-04-17T00:15:00.000Z"),
      connections: [],
    });

    const result = await materializeHostedDueWakesTx({
      appendAssistantCronWake: ({ occurredAt, reason, userId }) => mocks.materializeHostedAssistantCronWakeTx({
        occurredAt,
        reason,
        tx,
        userId,
      }),
      appendWakePayload: ({ wake }) => mocks.appendHostedExecutionWakePayloadTx({
        tx,
        wake,
      }),
      now: new Date("2026-04-17T01:00:00.000Z"),
      tx,
      userId: "member_123",
    });

    expect(mocks.materializeHostedAssistantCronWakeTx).toHaveBeenCalledWith({
      occurredAt: "2026-04-17T01:00:00.000Z",
      reason: "alarm",
      tx,
      userId: "member_123",
    });
    expect(mocks.appendHostedExecutionWakePayloadTx).not.toHaveBeenCalled();
    expect(result).toEqual({
      targetSeqHint: "11",
      wakeMaterializationHints: {
        assistantWakeAt: null,
        deviceSyncWakeAt: null,
      },
    });
  });

  it("does not enqueue far-future work but still returns the canonical next device-sync wake hint", async () => {
    const tx = createMaterializeTx({
      assistantNextWakeAt: new Date("2026-04-17T04:00:00.000Z"),
      connections: [{
        id: "connection_future",
        nextReconcileAt: new Date("2026-04-17T03:00:00.000Z"),
        provider: "oura",
        userId: "member_123",
      }],
    });

    const result = await materializeHostedDueWakesTx({
      appendAssistantCronWake: ({ occurredAt, reason, userId }) => mocks.materializeHostedAssistantCronWakeTx({
        occurredAt,
        reason,
        tx,
        userId,
      }),
      appendWakePayload: ({ wake }) => mocks.appendHostedExecutionWakePayloadTx({
        tx,
        wake,
      }),
      now: new Date("2026-04-17T01:00:00.000Z"),
      tx,
      userId: "member_123",
    });

    expect(mocks.materializeHostedAssistantCronWakeTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedExecutionWakePayloadTx).not.toHaveBeenCalled();
    expect(tx.deviceConnection.findMany).toHaveBeenCalledOnce();
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
  assistantNextWakeAt?: Date | null;
  connections: Array<{
    id: string;
    nextReconcileAt: Date | null;
    provider: string;
    status?: string;
    userId?: string;
  }>;
}) {
  const connections = input.connections.map((connection) => ({
    ...connection,
    status: connection.status ?? "active",
    userId: connection.userId ?? "member_123",
  }));

  return {
    deviceConnection: {
      findFirst: vi.fn(async (args?: {
        where?: {
          nextReconcileAt?: {
            gt?: Date;
          };
          status?: string;
          userId?: string;
        };
      }) => {
        const gt = args?.where?.nextReconcileAt?.gt ?? null;
        const status = args?.where?.status ?? null;
        const userId = args?.where?.userId ?? null;
        const nextConnection = connections
          .filter((connection) => (
            connection.nextReconcileAt !== null
            && (gt === null || connection.nextReconcileAt > gt)
            && (status === null || connection.status === status)
            && (userId === null || connection.userId === userId)
          ))
          .sort((left, right) => (
            left.nextReconcileAt!.getTime() - right.nextReconcileAt!.getTime()
            || left.id.localeCompare(right.id)
          ))[0];
        return nextConnection
          ? { nextReconcileAt: nextConnection.nextReconcileAt }
          : null;
      }),
      findMany: vi.fn(async (args?: {
        where?: {
          nextReconcileAt?: {
            lte?: Date;
          };
          status?: string;
          userId?: string;
        };
      }) => {
        const lte = args?.where?.nextReconcileAt?.lte ?? null;
        const status = args?.where?.status ?? null;
        const userId = args?.where?.userId ?? null;
        return connections
          .filter((connection) => (
            connection.nextReconcileAt !== null
            && (lte === null || connection.nextReconcileAt <= lte)
            && (status === null || connection.status === status)
            && (userId === null || connection.userId === userId)
          ))
          .sort((left, right) => (
            left.nextReconcileAt!.getTime() - right.nextReconcileAt!.getTime()
            || left.id.localeCompare(right.id)
          ))
          .map((connection) => ({
            id: connection.id,
            nextReconcileAt: connection.nextReconcileAt,
            provider: connection.provider,
          }));
      }),
    },
    hostedExecutionCursor: {
      upsert: vi.fn(async () => ({
        assistantNextWakeAt: input.assistantNextWakeAt ?? null,
        committedSeq: 0n,
        createdAt: new Date("2026-04-17T00:00:00.000Z"),
        nextSeq: 1n,
        snapshotRef: null,
        updatedAt: new Date("2026-04-17T00:00:00.000Z"),
        userId: "member_123",
        version: 0n,
      })),
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
