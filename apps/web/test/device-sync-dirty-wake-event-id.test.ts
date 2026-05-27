import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
    envelope: { eventId: string; userId: string };
  }) => ({
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: {
      id: input.envelope.eventId,
      userId: input.envelope.userId,
    },
  })),
  prisma: {
    $transaction: vi.fn(),
  },
  prismaTx: {
    __tx: true,
  },
  signalHostedDeviceSyncMailboxRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedDeviceSyncMailboxRuntime: mocks.signalHostedDeviceSyncMailboxRuntime,
}));

import {
  appendHostedDeviceSyncDirtyWake,
  buildHostedDeviceSyncDirtyWakeDedupeKey,
} from "@/src/lib/device-sync/wake-service";

describe("appendHostedDeviceSyncDirtyWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prismaTx) => Promise<unknown>) =>
        await callback(mocks.prismaTx),
    );
    mocks.signalHostedDeviceSyncMailboxRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_dirty_1",
    });
  });

  it("uses the dedupe key as dirty wake identity across recovery sweep times", async () => {
    const secondRevisionDedupeKey = buildHostedDeviceSyncDirtyWakeDedupeKey({
      connectionId: "dsc_dirty_1",
      dirtyRevision: 2n,
      provider: "oura",
    });
    const thirdRevisionDedupeKey = buildHostedDeviceSyncDirtyWakeDedupeKey({
      connectionId: "dsc_dirty_1",
      dirtyRevision: 3n,
      provider: "oura",
    });

    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: secondRevisionDedupeKey,
      occurredAt: "2026-05-05T00:01:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });
    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: secondRevisionDedupeKey,
      occurredAt: "2026-05-05T00:02:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });
    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: thirdRevisionDedupeKey,
      occurredAt: "2026-05-05T00:03:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      ([input]) => input.envelope.eventId,
    );
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[0]).toBe(secondRevisionDedupeKey);
    expect(eventIds[2]).toBe(thirdRevisionDedupeKey);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledTimes(3);
    expect(mocks.signalHostedDeviceSyncMailboxRuntime).toHaveBeenCalledWith({
      mailboxItemId: eventIds[0],
      recoveryIntent: "device-sync-dirty-recovery",
    });
  });
});
