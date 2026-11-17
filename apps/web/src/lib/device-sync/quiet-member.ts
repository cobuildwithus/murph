import { readJunctionHistoricalBackfillProgress } from "@murphai/device-syncd/hosted-runtime";
import { Prisma, type PrismaClient } from "@prisma/client";

import { hasHostedMailboxAutomationEngagementSince } from "../hosted-mailbox/store";
import { hasHostedMemberOwnPaidBilling } from "../hosted-onboarding/entitlement";
import { hasHostedLinqInboundWithinDays } from "../hosted-onboarding/linq-daily-state";
import { HOSTED_RECOVERY_LOCK_TIMEOUT_MS, HOSTED_RECOVERY_TRANSACTION_OPTIONS } from "../hosted-orchestration/recovery-batch";
import { getPrisma } from "../prisma";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";

type QuietMemberClient = PrismaClient | Prisma.TransactionClient;

// Members with no message, group chat, app open or active paid plan for this
// long sync their devices in one daily window. Their data still lands every day.
export const HOSTED_DEVICE_SYNC_QUIET_AFTER_DAYS = 60;
/** A routine Junction daily-total batch waits this long before its wake. */
export const HOSTED_DEVICE_SYNC_ROUTINE_WAKE_DEFER_MS = 30 * 60_000;

const DAY_MS = 24 * 60 * 60_000;
// The recovery sweep runs every five minutes, so an hour always services a
// deadline at the window start inside the window.
const QUIET_WINDOW_MS = 60 * 60_000;
// The window's scheduled reconcile drains held webhook dirt, so the batch
// release waits behind it and normally clears without another container.
const QUIET_DIRTY_RELEASE_DELAY_MS = 10 * 60_000;
const QUIET_RETURN_CHECK_LIMIT = 200;

export async function readHostedDeviceSyncMemberQuiet(input: {
  memberId: string;
  now: Date;
  prisma: QuietMemberClient;
}): Promise<boolean> {
  const since = new Date(input.now.getTime() - HOSTED_DEVICE_SYNC_QUIET_AFTER_DAYS * DAY_MS);
  const member = await input.prisma.hostedMember.findUnique({
    where: { id: input.memberId },
    select: {
      billingRef: {
        select: {
          currentBillingPhase: true,
          currentCheckoutOffer: true,
          stripeSubscriptionLookupKey: true,
        },
      },
      billingStatus: true,
      companionLastForegroundAt: true,
      createdAt: true,
      suspendedAt: true,
    },
  });
  if (
    !member
    || member.createdAt > since
    || (member.companionLastForegroundAt !== null && member.companionLastForegroundAt > since)
    || hasHostedMemberOwnPaidBilling(member)
  ) {
    return false;
  }
  // Group chat messages count against the group, so the sender's own group
  // activity comes from participant evidence. Rosters also renew it, which
  // keeps group game players on the normal cadence for everyone they play with.
  if (await input.prisma.hostedThreadContainerParticipant.findFirst({
    where: { lastSeenAt: { gte: since }, participantMemberId: input.memberId, removedAt: null },
    select: { containerMemberId: true },
  })) {
    return false;
  }
  if (await hasHostedLinqInboundWithinDays({
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    windowDays: HOSTED_DEVICE_SYNC_QUIET_AFTER_DAYS,
  })) {
    return false;
  }
  return !await hasHostedMailboxAutomationEngagementSince({
    prisma: input.prisma,
    since,
    userId: input.memberId,
  });
}

/**
 * Each connection's daily window starts at its connection time of day (UTC),
 * which spreads quiet connections across the day without stored state.
 */
export function resolveHostedDeviceSyncQuietWindow(input: {
  connectedAt: Date | string;
  now: Date;
}): { inside: true } | { inside: false; lastStart: Date; nextStart: Date } {
  const nowMs = input.now.getTime();
  const offsetMs = ((new Date(input.connectedAt).getTime() % DAY_MS) + DAY_MS) % DAY_MS;
  let startMs = nowMs - (nowMs % DAY_MS) + offsetMs;
  if (startMs > nowMs) startMs -= DAY_MS;
  return nowMs - startMs < QUIET_WINDOW_MS
    ? { inside: true }
    : { inside: false, lastStart: new Date(startMs), nextStart: new Date(startMs + DAY_MS) };
}

/** When a quiet connection's held webhook batch should wake, or null to keep today's rules. */
export async function resolveHostedDeviceSyncQuietDirtyReleaseAt(input: {
  connectedAt: Date | string;
  memberId: string;
  now: Date;
  prisma: QuietMemberClient;
}): Promise<Date | null> {
  const window = resolveHostedDeviceSyncQuietWindow(input);
  if (window.inside || !await readHostedDeviceSyncMemberQuiet(input)) return null;
  return new Date(window.nextStart.getTime() + QUIET_DIRTY_RELEASE_DELAY_MS);
}

/**
 * Moves a quiet member's due scheduled reconcile to its next daily window.
 * Returns false (wake as usual) inside the window, after a missed window, for
 * setup or history-retry work, for active members, or when another writer
 * changed the connection first.
 */
export async function postponeHostedDeviceSyncQuietReconcile(input: {
  connection: {
    connectedAt: string;
    connectionId: string;
    nextReconcileAt: string;
    userId: string;
  };
  now: Date;
  prisma?: PrismaClient;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "getConnectionRecordForUser" | "withHealthDataAdmissionLock">;
}): Promise<boolean> {
  const { connection } = input;
  const prisma = input.prisma ?? getPrisma();
  const window = resolveHostedDeviceSyncQuietWindow({
    connectedAt: connection.connectedAt,
    now: input.now,
  });
  // A schedule the last window never serviced (an outage) catches up now.
  if (window.inside || new Date(connection.nextReconcileAt) <= window.lastStart) return false;
  const quiet = (prisma: QuietMemberClient) =>
    readHostedDeviceSyncMemberQuiet({ memberId: connection.userId, now: input.now, prisma });
  // Most due connections belong to active members; only quiet ones take the lock.
  if (!await quiet(prisma)) return false;
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({ prisma });
  // Same member-then-connection lock and version guard as the preflight, so a
  // runtime apply or a returning member cannot interleave with this write.
  return store.withHealthDataAdmissionLock(connection.userId, connection.connectionId, async (tx) => {
    const record = await store.getConnectionRecordForUser(connection.userId, connection.connectionId, tx);
    if (
      !record
      || record.status !== "active"
      || ![null, "source_confirmed"].includes(record.setupPhase)
      || record.connectedAt.toISOString() !== connection.connectedAt
      || record.nextReconcileAt?.toISOString() !== connection.nextReconcileAt
      // A Junction history retry owns this schedule until it settles.
      || readJunctionHistoricalBackfillProgress(jsonRecord(record.metadataJson))?.status === "retrying"
      || !await quiet(tx)
    ) {
      return false;
    }
    const updated = await tx.deviceConnection.updateMany({
      where: {
        id: record.id, userId: record.userId, status: "active", connectedAt: record.connectedAt,
        updatedAt: record.updatedAt, nextReconcileAt: record.nextReconcileAt,
      },
      data: { nextReconcileAt: window.nextStart },
    });
    return updated.count === 1;
  }, { memberRowLockTimeoutMs: HOSTED_RECOVERY_LOCK_TIMEOUT_MS, transaction: HOSTED_RECOVERY_TRANSACTION_OPTIONS });
}

/**
 * Releases the held device batches of members who are no longer quiet: they
 * texted, joined a group chat, opened the app or started paying. Only a
 * deadline beyond the routine 30-minute batch can be a quiet hold. The sweep
 * runs this before releasing due batches, so a returning member's data starts
 * syncing in the same 5-minute sweep, with nothing added to message intake.
 */
export async function releaseHostedDeviceSyncReturnedQuietDeferrals(input: {
  now: Date;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const heldBeyond = new Date(input.now.getTime() + HOSTED_DEVICE_SYNC_ROUTINE_WAKE_DEFER_MS);
  const held = await prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT DISTINCT "user_id" AS "userId" FROM "device_sync_dirty_connection"
    WHERE "wake_deferred_until" > ${heldBeyond}
    LIMIT ${QUIET_RETURN_CHECK_LIMIT}
  `);
  let released = 0;
  for (const { userId } of held) {
    if (input.signal?.aborted) break;
    if (await readHostedDeviceSyncMemberQuiet({ memberId: userId, now: input.now, prisma })) continue;
    // Deadline-only write: the dirty content fence stays untouched.
    released += await prisma.$executeRaw(Prisma.sql`
      UPDATE "device_sync_dirty_connection"
      SET "wake_deferred_until" = ${input.now}
      WHERE "user_id" = ${userId} AND "wake_deferred_until" > ${heldBeyond}
    `);
  }
  return released;
}

function jsonRecord(value: Prisma.JsonValue | undefined): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
