import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpHostedExecutionCursorVersionTx: vi.fn(),
  createHostedIngressEventAliasTx: vi.fn(),
  ensureHostedExecutionCursorRow: vi.fn(),
  findCurrentHostedIngressEventAliasByWakeId: vi.fn(),
  findHostedIngressByDedupeKey: vi.fn(),
  findHostedIngressByEventId: vi.fn(),
  findUncommittedWakeByCoalescingKeyTx: vi.fn(),
  hydrateHostedIngressEventTx: vi.fn(),
  lockHostedExecutionCursorRowTx: vi.fn(),
  replaceHostedIngressEventAliasTx: vi.fn(),
  writeHostedIngressPayloadStorageTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ingress/store-data", () => ({
  bumpHostedExecutionCursorVersionTx: mocks.bumpHostedExecutionCursorVersionTx,
  createHostedIngressEventAliasTx: mocks.createHostedIngressEventAliasTx,
  ensureHostedExecutionCursorRow: mocks.ensureHostedExecutionCursorRow,
  findCurrentHostedIngressEventAliasByWakeId: mocks.findCurrentHostedIngressEventAliasByWakeId,
  findHostedIngressByDedupeKey: mocks.findHostedIngressByDedupeKey,
  findHostedIngressByEventId: mocks.findHostedIngressByEventId,
  findUncommittedWakeByCoalescingKeyTx: mocks.findUncommittedWakeByCoalescingKeyTx,
  lockHostedExecutionCursorRowTx: mocks.lockHostedExecutionCursorRowTx,
  replaceHostedIngressEventAliasTx: mocks.replaceHostedIngressEventAliasTx,
  writeHostedIngressPayloadStorageTx: mocks.writeHostedIngressPayloadStorageTx,
}));

vi.mock("@/src/lib/hosted-ingress/store-projections", () => ({
  hydrateHostedIngressEventTx: mocks.hydrateHostedIngressEventTx,
}));

import { appendHostedCoalescingWakeTx } from "@/src/lib/hosted-ingress/store-append";
import type { HostedIngressEventRow } from "@/src/lib/hosted-ingress/store.types";

describe("appendHostedCoalescingWakeTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.ensureHostedExecutionCursorRow.mockResolvedValue({
      committedSeq: 40n,
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      nextSeq: 41n,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      snapshotRef: null,
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
      userId: "member_123",
      version: 7n,
    });
    mocks.findHostedIngressByEventId.mockResolvedValue(null);
    mocks.findHostedIngressByDedupeKey.mockResolvedValue(null);
    mocks.findCurrentHostedIngressEventAliasByWakeId.mockResolvedValue(null);
    mocks.findUncommittedWakeByCoalescingKeyTx.mockResolvedValue(buildHostedIngressEventRow());
    mocks.createHostedIngressEventAliasTx.mockImplementation(async (input) => ({
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      eventId: input.eventId,
      ingressEventId: input.ingressEventId,
      replacedByEventId: input.replacedByEventId ?? null,
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
      userId: input.userId,
    }));
    mocks.hydrateHostedIngressEventTx.mockImplementation(async ({ record }) => record);
    mocks.lockHostedExecutionCursorRowTx.mockResolvedValue(undefined);
    mocks.replaceHostedIngressEventAliasTx.mockResolvedValue(undefined);
    mocks.writeHostedIngressPayloadStorageTx.mockResolvedValue(undefined);
    mocks.bumpHostedExecutionCursorVersionTx.mockResolvedValue(undefined);
  });

  it("materializes the current dedupe-key alias before writing a replacement chain", async () => {
    const result = await appendHostedCoalescingWakeTx({
      coalescingKey: "wake:resource-sync",
      eventId: "evt_older",
      kind: "device-sync.wake",
      occurredAt: "2026-04-20T00:00:01.000Z",
      payload: {
        reason: "older-arrival",
      },
      payloadSchema: "murph.hosted-ingress-execution.v1",
      tx: {} as never,
      userId: "member_123",
    });

    expect(result).toEqual({
      duplicate: false,
      inserted: false,
      updatedExisting: false,
      wake: buildHostedIngressEventRow(),
    });
    expect(mocks.createHostedIngressEventAliasTx).toHaveBeenNthCalledWith(1, {
      eventId: "wake_current",
      ingressEventId: "wake_current_id",
      tx: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.createHostedIngressEventAliasTx).toHaveBeenNthCalledWith(2, {
      eventId: "evt_older",
      ingressEventId: "wake_current_id",
      replacedByEventId: "wake_current",
      tx: expect.anything(),
      userId: "member_123",
    });
    expect(mocks.replaceHostedIngressEventAliasTx).not.toHaveBeenCalled();
    expect(mocks.findCurrentHostedIngressEventAliasByWakeId).toHaveBeenCalledWith({
      ingressEventId: "wake_current_id",
      tx: expect.anything(),
      userId: "member_123",
    });
  });

  it("materializes and replaces the current dedupe-key alias before inserting a newer current alias", async () => {
    const updatedWake = {
      ...buildHostedIngressEventRow(),
      occurredAt: new Date("2026-04-20T00:00:03.000Z"),
      updatedAt: new Date("2026-04-20T00:00:03.000Z"),
    };
    const tx = {
      hostedIngressEvent: {
        update: vi.fn(async () => updatedWake),
      },
    };

    const result = await appendHostedCoalescingWakeTx({
      coalescingKey: "wake:resource-sync",
      eventId: "evt_newer",
      kind: "device-sync.wake",
      occurredAt: "2026-04-20T00:00:03.000Z",
      payload: {
        reason: "newer-arrival",
      },
      payloadSchema: "murph.hosted-ingress-execution.v1",
      tx: tx as never,
      userId: "member_123",
    });

    expect(result).toEqual({
      duplicate: false,
      inserted: false,
      updatedExisting: true,
      wake: updatedWake,
    });
    expect(mocks.createHostedIngressEventAliasTx).toHaveBeenNthCalledWith(1, {
      eventId: "wake_current",
      ingressEventId: "wake_current_id",
      tx,
      userId: "member_123",
    });
    expect(mocks.replaceHostedIngressEventAliasTx).toHaveBeenCalledWith({
      eventId: "wake_current",
      replacedByEventId: "evt_newer",
      tx,
      userId: "member_123",
    });
    expect(mocks.createHostedIngressEventAliasTx).toHaveBeenNthCalledWith(2, {
      eventId: "evt_newer",
      ingressEventId: "wake_current_id",
      tx,
      userId: "member_123",
    });
    expect(mocks.createHostedIngressEventAliasTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replaceHostedIngressEventAliasTx.mock.invocationCallOrder[0],
    );
    expect(mocks.replaceHostedIngressEventAliasTx.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createHostedIngressEventAliasTx.mock.invocationCallOrder[1],
    );
    expect(mocks.writeHostedIngressPayloadStorageTx).toHaveBeenCalledWith({
      ingressEventId: "wake_current_id",
      payload: expect.objectContaining({
        payloadBytes: expect.any(Number),
      }),
      payloadSchema: "murph.hosted-ingress-execution.v1",
      tx,
      userId: "member_123",
    });
    expect(tx.hostedIngressEvent.update).toHaveBeenCalledWith({
      data: {
        kind: "device-sync.wake",
        occurredAt: new Date("2026-04-20T00:00:03.000Z"),
        payloadBytes: expect.any(Number),
        payloadInlineCiphertext: expect.any(String),
        payloadRef: null,
        payloadSchema: "murph.hosted-ingress-execution.v1",
        quarantineCode: null,
        quarantinedAt: null,
      },
      where: {
        id: "wake_current_id",
      },
    });
  });
});

function buildHostedIngressEventRow(): HostedIngressEventRow {
  return {
    behavior: "coalescing",
    completedAt: null,
    coalescingKey: "wake:resource-sync",
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    dedupeKey: "wake_current",
    id: "wake_current_id",
    kind: "device-sync.wake",
    occurredAt: new Date("2026-04-20T00:00:02.000Z"),
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline",
    payloadRef: null,
    payloadSchema: "murph.hosted-ingress-execution.v1",
    quarantineCode: null,
    quarantinedAt: null,
    runId: null,
    seq: 41n,
    state: "pending",
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    userId: "member_123",
  };
}
