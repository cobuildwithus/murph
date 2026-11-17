import { JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS } from "@murphai/device-syncd/hosted-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  postponeHostedDeviceSyncQuietReconcile,
  readHostedDeviceSyncMemberQuiet,
  resolveHostedDeviceSyncQuietDirtyReleaseAt,
  resolveHostedDeviceSyncQuietWindow,
} from "@/src/lib/device-sync/quiet-member";
import { pullForwardHostedDeviceSyncQuietDeferrals } from "@/src/lib/device-sync/quiet-member-return";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const LONG_AGO = new Date("2026-08-01T00:00:00.000Z");
const RECENT = new Date("2026-11-01T00:00:00.000Z");
// Connected at 15:30 UTC, so the daily window is 15:30-16:30 UTC.
const CONNECTED_AT = "2026-05-02T15:30:00.000Z";

const QUIET_MEMBER = {
  billingRef: null, billingStatus: "canceled", companionLastForegroundAt: null, createdAt: LONG_AGO, suspendedAt: null,
};

function quietPrisma(overrides: {
  member?: Record<string, unknown> | null;
  groupParticipant?: boolean;
  linqInbound?: boolean;
  mailboxEngagement?: boolean;
  updatedCount?: number;
} = {}) {
  return {
    deviceConnection: { updateMany: vi.fn().mockResolvedValue({ count: overrides.updatedCount ?? 1 }) },
    hostedThreadContainerParticipant: {
      findFirst: vi.fn().mockResolvedValue(overrides.groupParticipant ? { containerMemberId: "member_group" } : null),
    },
    hostedLinqDailyState: {
      findFirst: vi.fn().mockResolvedValue(overrides.linqInbound ? { memberId: "member_quiet" } : null),
    },
    hostedMailboxItem: {
      findFirst: vi.fn().mockResolvedValue(overrides.mailboxEngagement ? { id: "item_engaged" } : null),
    },
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(overrides.member === undefined ? QUIET_MEMBER : overrides.member),
    },
  };
}

const asClient = (prisma: ReturnType<typeof quietPrisma>) => prisma as never;

describe("quiet member device sync", () => {
  it("is quiet only with no message, group chat, app open, paid plan or recent signup in 60 days", async () => {
    const read = (prisma: ReturnType<typeof quietPrisma>) =>
      readHostedDeviceSyncMemberQuiet({ memberId: "member_quiet", now: NOW, prisma: asClient(prisma) });
    // A canceled subscription keeps its Stripe reference; only an active paid plan counts.
    const retainedSubscription = { currentBillingPhase: null, currentCheckoutOffer: null, stripeSubscriptionLookupKey: "sub" };

    expect(await read(quietPrisma())).toBe(true);
    expect(await read(quietPrisma({ member: { ...QUIET_MEMBER, billingRef: retainedSubscription } }))).toBe(true);
    expect(await read(quietPrisma({ member: { ...QUIET_MEMBER, billingStatus: "active" } }))).toBe(true);
    expect(await read(quietPrisma({
      member: { ...QUIET_MEMBER, billingRef: retainedSubscription, billingStatus: "active" },
    }))).toBe(false);
    expect(await read(quietPrisma({ member: null }))).toBe(false);
    expect(await read(quietPrisma({ member: { ...QUIET_MEMBER, createdAt: RECENT } }))).toBe(false);
    expect(await read(quietPrisma({ member: { ...QUIET_MEMBER, companionLastForegroundAt: RECENT } }))).toBe(false);
    expect(await read(quietPrisma({ groupParticipant: true }))).toBe(false);
    expect(await read(quietPrisma({ linqInbound: true }))).toBe(false);
    expect(await read(quietPrisma({ mailboxEngagement: true }))).toBe(false);
  });

  it("checks the 60-day Linq and mailbox windows", async () => {
    const prisma = quietPrisma();
    await readHostedDeviceSyncMemberQuiet({ memberId: "member_quiet", now: NOW, prisma: asClient(prisma) });

    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        lastSeenAt: { gte: new Date("2026-09-18T12:00:00.000Z") },
        participantMemberId: "member_quiet",
        removedAt: null,
      },
    }));
    expect(prisma.hostedLinqDailyState.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        dayUtc: { gte: new Date("2026-09-18T00:00:00.000Z") },
        memberId: "member_quiet",
      }),
    }));
    expect(prisma.hostedMailboxItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { gte: new Date("2026-09-18T12:00:00.000Z") },
        userId: "member_quiet",
      }),
    }));
  });

  it("gives each connection one daily hour starting at its connection time of day", () => {
    const window = (now: string) => resolveHostedDeviceSyncQuietWindow({
      connectedAt: CONNECTED_AT,
      now: new Date(now),
    });

    expect(window("2026-11-17T12:00:00.000Z")).toEqual({
      inside: false,
      lastStart: new Date("2026-11-16T15:30:00.000Z"),
      nextStart: new Date("2026-11-17T15:30:00.000Z"),
    });
    expect(window("2026-11-17T15:30:00.000Z")).toEqual({ inside: true });
    expect(window("2026-11-17T16:29:59.999Z")).toEqual({ inside: true });
    expect(window("2026-11-17T16:30:00.000Z")).toEqual({
      inside: false,
      lastStart: new Date("2026-11-17T15:30:00.000Z"),
      nextStart: new Date("2026-11-18T15:30:00.000Z"),
    });
    expect(resolveHostedDeviceSyncQuietWindow({
      connectedAt: "2026-05-02T23:45:00.000Z",
      now: new Date("2026-11-18T00:30:00.000Z"),
    })).toEqual({ inside: true });
  });

  it("holds a quiet member's webhook batch until ten minutes into the next window", async () => {
    const quiet = quietPrisma();
    expect(await resolveHostedDeviceSyncQuietDirtyReleaseAt({
      connectedAt: CONNECTED_AT, memberId: "member_quiet", now: NOW, prisma: asClient(quiet),
    })).toEqual(new Date("2026-11-17T15:40:00.000Z"));

    expect(await resolveHostedDeviceSyncQuietDirtyReleaseAt({
      connectedAt: CONNECTED_AT, memberId: "member_quiet", now: NOW, prisma: asClient(quietPrisma({ linqInbound: true })),
    })).toBeNull();

    const inside = quietPrisma();
    expect(await resolveHostedDeviceSyncQuietDirtyReleaseAt({
      connectedAt: CONNECTED_AT,
      memberId: "member_quiet",
      now: new Date("2026-11-17T15:45:00.000Z"),
      prisma: asClient(inside),
    })).toBeNull();
    expect(inside.hostedMember.findUnique).not.toHaveBeenCalled();
  });

  it("moves a quiet member's due reconcile to the next window under the admission lock", async () => {
    const connection = {
      connectedAt: CONNECTED_AT,
      connectionId: "dsc_quiet",
      nextReconcileAt: "2026-11-17T11:58:00.000Z",
      userId: "member_quiet",
    };
    const UPDATED_AT = new Date("2026-11-17T06:00:00.000Z");
    const record = (overrides: Record<string, unknown> = {}) => ({
      connectedAt: new Date(CONNECTED_AT), id: "dsc_quiet", metadataJson: {},
      nextReconcileAt: new Date(connection.nextReconcileAt), setupPhase: null, status: "active",
      updatedAt: UPDATED_AT, userId: "member_quiet", ...overrides,
    });
    const run = async (input: {
      connection?: typeof connection;
      now?: Date;
      prisma?: ReturnType<typeof quietPrisma>;
      record?: ReturnType<typeof record> | null;
    } = {}) => {
      const prisma = input.prisma ?? quietPrisma();
      const store = {
        getConnectionRecordForUser: vi.fn().mockResolvedValue(input.record === undefined ? record() : input.record),
        withHealthDataAdmissionLock: vi.fn(async (_userId: string, _connectionId: string, run: (tx: unknown) => unknown) => run(prisma)),
      };
      const postponed = await postponeHostedDeviceSyncQuietReconcile({
        connection: input.connection ?? connection, now: input.now ?? NOW, prisma: asClient(prisma), store: store as never,
      });
      return { postponed, prisma, store };
    };

    const quiet = await run();
    expect(quiet.postponed).toBe(true);
    expect(quiet.store.withHealthDataAdmissionLock).toHaveBeenCalledWith(
      "member_quiet", "dsc_quiet", expect.any(Function), expect.objectContaining({ memberRowLockTimeoutMs: expect.any(Number) }),
    );
    // The quiet check runs before the lock and again inside it.
    expect(quiet.prisma.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(quiet.prisma.deviceConnection.updateMany).toHaveBeenCalledWith({
      data: { nextReconcileAt: new Date("2026-11-17T15:30:00.000Z") },
      where: {
        connectedAt: new Date(CONNECTED_AT), id: "dsc_quiet", nextReconcileAt: new Date("2026-11-17T11:58:00.000Z"),
        status: "active", updatedAt: UPDATED_AT, userId: "member_quiet",
      },
    });

    expect((await run({ prisma: quietPrisma({ updatedCount: 0 }) })).postponed).toBe(false);
    const active = await run({ prisma: quietPrisma({ mailboxEngagement: true }) });
    expect(active.postponed).toBe(false);
    expect(active.store.withHealthDataAdmissionLock).not.toHaveBeenCalled();
    const inside = await run({ now: new Date("2026-11-17T15:35:00.000Z") });
    expect(inside.postponed).toBe(false);
    expect(inside.prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    // Due before the last window started: that window was missed, so catch up.
    const missed = await run({ connection: { ...connection, nextReconcileAt: "2026-11-16T15:30:00.000Z" } });
    expect(missed.postponed).toBe(false);
    expect(missed.prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    for (const changed of [
      null,
      record({ setupPhase: "awaiting_source" }),
      record({ nextReconcileAt: new Date("2026-11-17T12:30:00.000Z") }),
      record({ metadataJson: {
        [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status]: "retrying",
        [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]: "2026-05-01T00:00:00.000Z",
        [JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]: "2026-05-02T15:30:00.000Z",
      } }),
    ]) {
      const result = await run({ record: changed });
      expect(result.postponed).toBe(false);
      expect(result.prisma.deviceConnection.updateMany).not.toHaveBeenCalled();
    }
  });

  it("pulls only daily-window batches forward when the member comes back", async () => {
    const prisma = { $executeRaw: vi.fn().mockResolvedValue(0) };
    await pullForwardHostedDeviceSyncQuietDeferrals({
      now: NOW,
      prisma: prisma as never,
      userId: "member_quiet",
    });
    const [query] = prisma.$executeRaw.mock.calls[0] as [{ sql: string; values: unknown[] }];
    expect(query.sql).toContain("SET \"wake_deferred_until\" = ?");
    expect(query.sql).toContain("\"wake_deferred_until\" > ?");
    expect(query.values).toEqual([NOW, "member_quiet", new Date("2026-11-17T12:30:00.000Z")]);
  });
});
