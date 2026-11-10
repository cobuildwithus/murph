import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates, createHostedExternalThreadLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { addHostedLinqChatParticipant, leaveHostedLinqChat, removeHostedLinqChatParticipant } from "../hosted-onboarding/linq-client";
import { openHostedThreadDeliveryRoute } from "../hosted-routing/thread-delivery-route";
import { openHostedLinqGroupMoveCleanup, prepareHostedLinqGroupMoveCleanup, type HostedLinqGroupMoveCleanup } from "../hosted-routing/linq-group-line-move-store";
import { activeGroupMoveHandles, assertGroupMoveLinesCanSend, assertGroupMoveQuiet, assertGroupMoveReservationAvailable, assertGroupMoveSourceSelf,
  GROUP_MOVE_ADOPTION_MS, groupMoveError, groupMoveFailureCode, groupMoveHasPhone, groupMoveOperatorSelect, lockGroupMoveSource,
  readGroupMoveRoster, readOperatorGroupMove, recordGroupMoveError, summarizeOperatorGroupMove, type OperatorGroupMove } from "./linq-group-line-move-state";

export async function startHostedLinqGroupLineMove(input: { containerRef: string; targetLineLookupKey: string; prisma?: PrismaClient }) {
  const prisma = input.prisma ?? getPrisma();
  const move = await reserveGroupMove(input, prisma);
  return operateHostedLinqGroupLineMove({ operation: "resume", moveId: move.id, prisma });
}

async function reserveGroupMove(input: { containerRef: string; targetLineLookupKey: string }, prisma: PrismaClient) {
  const expected = await prisma.hostedThreadRoute.findUnique({ where: {
    channel_threadIdentityLookupKey: { channel: "linq", threadIdentityLookupKey: input.containerRef },
  } });
  if (!expected?.accountLookupKey) groupMoveError("ROUTE_REQUIRED");
  const route = await openHostedThreadDeliveryRoute({ channel: "linq", containerMemberId: expected.containerMemberId,
    encrypted: expected.deliveryRouteEncrypted, prisma });
  if (route.channel !== "linq" || route.accountLookupKey !== expected.accountLookupKey
    || !createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: route.threadId }).includes(expected.threadIdentityLookupKey)
    || !createHostedExternalThreadLookupKeyReadCandidates({ channel: "linq", threadId: route.threadId, accountLookupKey: route.accountLookupKey }).includes(expected.threadLookupKey)) groupMoveError("ROUTE_CHANGED");
  const id = randomUUID();
  const sourceCleanupEncrypted = await prepareHostedLinqGroupMoveCleanup({ id, containerMemberId: expected.containerMemberId,
    fromAccountLookupKey: expected.accountLookupKey, toAccountLookupKey: input.targetLineLookupKey, sourceChatId: route.threadId, prisma });
  const data = { id, containerMemberId: expected.containerMemberId, fromAccountLookupKey: expected.accountLookupKey,
    toAccountLookupKey: input.targetLineLookupKey, fromThreadIdentityLookupKey: expected.threadIdentityLookupKey,
    toThreadIdentityLookupKey: null, sourceCleanupEncrypted,
    status: "reserved", adoptionDeadlineAt: new Date(Date.now() + GROUP_MOVE_ADOPTION_MS) };
  const cleanup = await openHostedLinqGroupMoveCleanup(data, prisma);
  const roster = await readGroupMoveRoster(cleanup);
  assertGroupMoveSourceSelf(roster, cleanup);
  if (roster.service?.toLowerCase() !== "imessage" || activeGroupMoveHandles(roster).length < 3) groupMoveError("IMESSAGE_GROUP_REQUIRED");
  if (groupMoveHasPhone(roster, cleanup.targetPhone)) groupMoveError("TARGET_ALREADY_PRESENT");
  return prisma.$transaction(async tx => {
    await assertGroupMoveReservationAvailable({ containerMemberId: data.containerMemberId, cleanup, prisma: tx });
    const routes = await tx.hostedThreadRoute.findMany({ where: { containerMemberId: data.containerMemberId }, take: 2 });
    if (routes.length !== 1 || JSON.stringify(routes[0]) !== JSON.stringify(expected)) groupMoveError("ROUTE_CHANGED");
    if (Date.now() - roster.observedAt.getTime() > 30_000) groupMoveError("ROSTER_UNAVAILABLE");
    await assertGroupMoveLinesCanSend(cleanup, tx);
    await assertGroupMoveQuiet({ containerMemberId: data.containerMemberId, chatId: cleanup.sourceChatId, prisma: tx });
    return tx.hostedLinqGroupLineMove.create({ data, select: groupMoveOperatorSelect });
  });
}

export async function operateHostedLinqGroupLineMove(input: {
  operation: "resume" | "cancel" | "retry_leave"; moveId: string; prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const move = await readOperatorGroupMove(input.moveId, prisma);
  if (move.status === "left" || move.status === "cancelled") return summarizeOperatorGroupMove(move);
  if (input.operation === "cancel" && move.status !== "reserved") groupMoveError("ALREADY_ADOPTED");
  if (input.operation === "retry_leave" && move.status !== "adopted") groupMoveError("NOT_ADOPTED");
  // Encryption and all provider calls are outside transactions, including after route deletion.
  try {
    const cleanup = await openHostedLinqGroupMoveCleanup(move, prisma);
    if (input.operation === "cancel") await cancelGroupMove(move, cleanup, prisma);
    else if (move.status === "adopted") await leaveGroupMove(move, cleanup, prisma);
    else await resumeGroupMove(move, cleanup, prisma);
  } catch (error) {
    await recordGroupMoveError(move, groupMoveFailureCode(error), prisma);
  }
  return summarizeOperatorGroupMove(await readOperatorGroupMove(move.id, prisma));
}

async function resumeGroupMove(move: OperatorGroupMove, cleanup: HostedLinqGroupMoveCleanup, prisma: PrismaClient) {
  if (move.adoptionDeadlineAt.getTime() <= Date.now()) {
    await recordGroupMoveError(move, "adoption_deadline_elapsed", prisma); return;
  }
  let roster = await readGroupMoveRoster(cleanup);
  assertGroupMoveSourceSelf(roster, cleanup);
  if (!groupMoveHasPhone(roster, cleanup.targetPhone)) {
    // Never blindly repeat a claimed add. Disarm and clean up an unconfirmed attempt.
    if (move.addStartedAt) {
      await recordGroupMoveError(move, "add_unconfirmed", prisma);
      await cancelGroupMove(await readOperatorGroupMove(move.id, prisma), cleanup, prisma);
      return;
    }
    const claimed = await prisma.$transaction(async tx => {
      await lockGroupMoveSource(cleanup, tx);
      await assertGroupMoveLinesCanSend(cleanup, tx);
      return tx.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved", addStartedAt: null,
        adoptionDeadlineAt: { gt: new Date() } }, data: { addStartedAt: new Date(), lastErrorCode: null } });
    });
    if (!claimed.count) return;
    try {
      await addHostedLinqChatParticipant({ chatId: cleanup.sourceChatId, handle: cleanup.targetPhone });
      roster = await readGroupMoveRoster(cleanup);
    }
    catch (error) {
      await recordGroupMoveError(move, groupMoveFailureCode(error), prisma);
      await cancelGroupMove(await readOperatorGroupMove(move.id, prisma), cleanup, prisma);
      return;
    }
    if (!groupMoveHasPhone(roster, cleanup.targetPhone)) {
      await recordGroupMoveError(move, "add_unconfirmed", prisma);
      await cancelGroupMove(await readOperatorGroupMove(move.id, prisma), cleanup, prisma);
      return;
    }
  }
  await prisma.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved" },
    data: { addConfirmedAt: move.addConfirmedAt ?? new Date(), lastErrorCode: null } });
}

async function cancelGroupMove(move: OperatorGroupMove, cleanup: HostedLinqGroupMoveCleanup, prisma: PrismaClient) {
  // Permanently disarm adoption and further producer claims before external cleanup.
  const disarmed = await prisma.$transaction(async tx => {
    await lockGroupMoveSource(cleanup, tx);
    return tx.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved" },
      data: { adoptionDeadlineAt: new Date(0) } });
  });
  if (!disarmed.count) return;
  let roster = await readGroupMoveRoster(cleanup);
  assertGroupMoveSourceSelf(roster, cleanup);
  const current = await readOperatorGroupMove(move.id, prisma);
  if (!groupMoveHasPhone(roster, cleanup.targetPhone) && current.addStartedAt && !current.addConfirmedAt && !current.lastErrorCode?.startsWith("add_rejected")) {
    await recordGroupMoveError(move, current.lastErrorCode?.startsWith("add_") ? current.lastErrorCode : "add_outcome_unknown", prisma); return;
  }
  if (groupMoveHasPhone(roster, cleanup.targetPhone)) {
    // Positive presence settles a claimed add even if its response/progress write was lost.
    await prisma.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved" }, data: { addConfirmedAt: current.addConfirmedAt ?? new Date() } });
    await removeHostedLinqChatParticipant({ chatId: cleanup.sourceChatId, handle: cleanup.targetPhone });
    roster = await readGroupMoveRoster(cleanup);
    if (groupMoveHasPhone(roster, cleanup.targetPhone)) { await recordGroupMoveError(move, "remove_pending", prisma); return; }
  }
  await prisma.$transaction(async tx => {
    await lockGroupMoveSource(cleanup, tx);
    await tx.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved", adoptionDeadlineAt: new Date(0) },
      data: { status: "cancelled", lastErrorCode: current.lastErrorCode?.startsWith("add_") ? current.lastErrorCode : null } });
  });
}

async function leaveGroupMove(move: OperatorGroupMove, cleanup: HostedLinqGroupMoveCleanup, prisma: PrismaClient) {
  let roster = await readGroupMoveRoster(cleanup);
  if (groupMoveHasPhone(roster, cleanup.sourcePhone)) {
    assertGroupMoveSourceSelf(roster, cleanup);
    if (activeGroupMoveHandles(roster).length < 4) { await recordGroupMoveError(move, "leave_requires_four_participants", prisma); return; }
    await leaveHostedLinqChat({ chatId: cleanup.sourceChatId });
    roster = await readGroupMoveRoster(cleanup);
    if (groupMoveHasPhone(roster, cleanup.sourcePhone)) { await recordGroupMoveError(move, "leave_pending", prisma); return; }
  }
  await prisma.$transaction(async tx => {
    await lockGroupMoveSource(cleanup, tx);
    await tx.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "adopted" },
      data: { status: "left", leaveConfirmedAt: new Date(), lastErrorCode: null } });
  });
}
