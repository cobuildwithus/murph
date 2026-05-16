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
  startHostedWebhookNudgeWorkflow: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => mocks.prisma),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-workflow-start", () => ({
  startHostedWebhookNudgeWorkflow: mocks.startHostedWebhookNudgeWorkflow,
}));

import { appendHostedDeviceSyncDirtyWake } from "@/src/lib/device-sync/wake-service";

describe("appendHostedDeviceSyncDirtyWake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prismaTx) => Promise<unknown>) =>
        await callback(mocks.prismaTx),
    );
  });

  it("uses the dedupe key as dirty wake identity across recovery sweep times", async () => {
    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: "dirty-revision:2:connection:fingerprint:sweep",
      occurredAt: "2026-05-05T00:01:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });
    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: "dirty-revision:2:connection:fingerprint:sweep",
      occurredAt: "2026-05-05T00:02:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });
    await appendHostedDeviceSyncDirtyWake({
      connectionId: "dsc_dirty_1",
      dedupeKey: "dirty-revision:3:connection:fingerprint:sweep",
      occurredAt: "2026-05-05T00:03:00.000Z",
      provider: "oura",
      userId: "member_dirty_1",
    });

    const eventIds = mocks.appendHostedMailboxEnvelopeTx.mock.calls.map(
      ([input]) => input.envelope.eventId,
    );
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[2]).not.toBe(eventIds[0]);
    expect(mocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledTimes(3);
    expect(mocks.startHostedWebhookNudgeWorkflow).toHaveBeenCalledWith({
      mailboxItemId: eventIds[0],
      runnerNudgeIntent: "device-sync-dirty-recovery",
      source: "device-sync",
    });
  });
});
