import "server-only";

import { readHostedLinqGroupLeave } from "./linq-group-leave";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { createHostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { sha256Hex } from "../primitives";
import { prepareHostedThreadContainerDeliveryRoute, type PreparedHostedLinqGroupLineMoveAdoption } from "./thread-container-service";
import { readHostedThreadRouteByThreadIdentity, type HostedThreadRouteSnapshot } from "./thread-route-store";
import { holdHostedLinqGroupLineMove, linqGroupMoveDestinationMatches, linqGroupMoveSourceMatches,
  openHostedLinqGroupMoveCleanup, readHostedLinqGroupMovesForIngress, type HostedLinqGroupLineMove, type HostedLinqGroupMoveCleanup } from "./linq-group-line-move-store";

type Ingress = { service?: string | null; threadId: string; recipientPhone: string | null; sender: string | null; isFromMe: boolean; eventCreatedAt?: string };
export type PreparedHostedLinqGroupMoveIngress = {
  fingerprint: string;
  action: "continue" | "consume" | "hold";
  adoption?: PreparedHostedLinqGroupLineMoveAdoption;
  retryAfterAdoption?: boolean;
  expireSourceReservationId?: string;
};

export const HOSTED_LINQ_GROUP_MOVE_SOURCE_HOLD_MS = 60_000;

function fingerprint(rows: readonly HostedLinqGroupLineMove[]): string { return sha256Hex(JSON.stringify(rows)); }

function eventCreationTime(input: Ingress): number | null {
  const time = Date.parse(input.eventCreatedAt ?? "");
  return Number.isFinite(time) && time <= Date.now() ? time : null;
}

function predatesMoveAdd(input: Ingress, move: HostedLinqGroupLineMove): boolean {
  const createdAt = eventCreationTime(input);
  return createdAt === null || !move.addStartedAt || createdAt < move.addStartedAt.getTime();
}

/** Compare complete provider handles, including unknown phones and emails, never the member projection. */
export function hostedLinqGroupMoveAudience(chat: HostedLinqChatSummary, cleanup: HostedLinqGroupMoveCleanup): string[] | null {
  if (chat.isGroup !== true || !chat.handlesComplete || !chat.handles.length || chat.handles.length > 32) return null;
  const active = chat.handles.filter(handle => handle.status === null || handle.status.trim().toLowerCase() === "active");
  const audience: string[] = [];
  for (const handle of active) {
    if (normalizePhoneNumber(handle.handle) === cleanup.sourcePhone || normalizePhoneNumber(handle.handle) === cleanup.targetPhone) continue;
    const contact = createHostedLinqParticipantContact({ kind: handle.handle.includes("@") ? "email" : "phone", value: handle.handle });
    if (!contact || handle.isMe) return null;
    audience.push(`${contact.kind}:${contact.value}`);
  }
  return [...new Set(audience)].sort();
}

async function readRoster(chatId: string): Promise<HostedLinqChatSummary> {
  try { return await getHostedLinqChatSummary({ chatId, timeoutMs: 3_000 }); }
  catch { holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_ROSTER_UNAVAILABLE"); }
}

async function prepareAdoption(input: Ingress & { prisma: PrismaClient },
  move: HostedLinqGroupLineMove, cleanup: HostedLinqGroupMoveCleanup,
  candidate: HostedLinqChatSummary, prepared: PreparedHostedLinqGroupMoveIngress,
): Promise<PreparedHostedLinqGroupMoveIngress> {
  const adoption = await prepareVerifiedHostedLinqGroupMoveAdoption({ ...input, move, cleanup, candidate });
  return adoption ? { ...prepared, action: "consume", retryAfterAdoption: normalizePhoneNumber(input.sender) !== cleanup.sourcePhone, adoption }
    : { ...prepared, action: "hold" };
}

/** Shared fresh-roster proof for webhook and explicit Ops discovery; no synthetic message. */
export async function prepareVerifiedHostedLinqGroupMoveAdoption(input: {
  threadId: string; prisma: PrismaClient; move: HostedLinqGroupLineMove;
  cleanup: HostedLinqGroupMoveCleanup; candidate: HostedLinqChatSummary;
}): Promise<PreparedHostedLinqGroupLineMoveAdoption | null> {
  const { move, cleanup, candidate } = input;
  const sourceChat = await readRoster(cleanup.sourceChatId);
  const oldAudience = hostedLinqGroupMoveAudience(sourceChat, cleanup);
  const newAudience = hostedLinqGroupMoveAudience(candidate, cleanup);
  if (!oldAudience || !newAudience) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_ROSTER_UNAVAILABLE");
  // Require the receiving line as active self, and both service numbers on the destination.
  const active = candidate.handles.filter(handle => handle.status === null || handle.status.toLowerCase() === "active");
  const sourceSelf = sourceChat.handles.some(handle => handle.isMe && normalizePhoneNumber(handle.handle) === cleanup.sourcePhone && (handle.status === null || handle.status.toLowerCase() === "active"));
  if (!oldAudience.length || JSON.stringify(oldAudience) !== JSON.stringify(newAudience) || !sourceSelf
    || !active.some(handle => handle.isMe && normalizePhoneNumber(handle.handle) === cleanup.targetPhone)
    || !active.some(handle => normalizePhoneNumber(handle.handle) === cleanup.sourcePhone)) {
    await input.prisma.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: "reserved" }, data: { lastErrorCode: "roster_mismatch" } });
    return null;
  }
  const expected = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: cleanup.sourceChatId, prisma: input.prisma });
  if (expected?.containerMemberId !== move.containerMemberId || !expected.deliveryRouteState?.deliveryRouteEncrypted)
    holdHostedLinqGroupLineMove("HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED");
  const route = await prepareHostedThreadContainerDeliveryRoute({ accountLookupKey: move.toAccountLookupKey,
    channel: "linq", containerMemberId: move.containerMemberId, observedDeliveryRouteEncrypted: expected.deliveryRouteState.deliveryRouteEncrypted,
    prisma: input.prisma, threadId: input.threadId });
  return { move, cleanup, expected, destination: route, verifiedAt: new Date(Math.min(sourceChat.observedAt.getTime(), candidate.observedAt.getTime())) };
}

/** All encrypted opens, provider reads and destination sealing happen before BEGIN. */
export async function prepareHostedLinqGroupMoveIngress(input: Ingress & {
  prisma: PrismaClient; route: HostedThreadRouteSnapshot | null;
}): Promise<PreparedHostedLinqGroupMoveIngress> {
  if (await readHostedLinqGroupLeave({ chatId: input.threadId, prisma: input.prisma })) return { fingerprint: fingerprint([]), action: "consume" };
  const rows = await readHostedLinqGroupMovesForIngress(input);
  const prepared: PreparedHostedLinqGroupMoveIngress = { fingerprint: fingerprint(rows), action: "continue" };
  if (!rows.length || input.isFromMe) return prepared;
  const source = rows.filter(move => move.status !== "cancelled" && linqGroupMoveSourceMatches(move, input.threadId));
  if (source.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  if (source[0]) {
    if (source[0].status === "reserved" && input.route?.containerMemberId !== source[0].containerMemberId)
      return { ...prepared, action: "hold" };
    return prepareSourceIngress(input, source[0], prepared);
  }
  const destination = rows.filter(move => linqGroupMoveDestinationMatches(move, input.threadId));
  if (destination.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  if (destination[0]) {
    const move = destination[0];
    const cleanup = await openHostedLinqGroupMoveCleanup(move, input.prisma);
    if (input.route?.containerMemberId !== move.containerMemberId || normalizePhoneNumber(input.recipientPhone) !== cleanup.targetPhone)
      return { ...prepared, action: "hold" };
    // Keep the add boundary after adoption too: an old target copy must not
    // duplicate source work merely because a fresh event won the new route.
    if (predatesMoveAdd(input, move)) return { ...prepared, action: "consume" };
    if (normalizePhoneNumber(input.sender) === cleanup.sourcePhone) return { ...prepared, action: "consume" };
  }
  if (input.route) return prepared;
  const createdAt = eventCreationTime(input);
  // Before adoption there is no durable target-chat identity. Conservatively
  // fence old unbound events on this line, even when today's roster lacks self.
  if (rows.some(move => move.status === "cancelled" && (createdAt === null || createdAt <= move.updatedAt.getTime())))
    return { ...prepared, action: "consume" };
  return prepareUnboundReservation(input, rows, prepared);
}

function prepareSourceIngress(input: Ingress, move: HostedLinqGroupLineMove,
  prepared: PreparedHostedLinqGroupMoveIngress,
): PreparedHostedLinqGroupMoveIngress {
  if (move.status !== "reserved") return { ...prepared, action: "consume" };
  if (move.adoptionDeadlineAt.getTime() <= Date.now()) return prepared;
  const createdAt = Date.parse(input.eventCreatedAt ?? "");
  if (Number.isFinite(createdAt) && Date.now() - createdAt >= HOSTED_LINQ_GROUP_MOVE_SOURCE_HOLD_MS)
    return { ...prepared, expireSourceReservationId: move.id };
  return { ...prepared, action: "hold" };
}

async function prepareUnboundReservation(input: Ingress & { prisma: PrismaClient },
  rows: readonly HostedLinqGroupLineMove[], prepared: PreparedHostedLinqGroupMoveIngress,
): Promise<PreparedHostedLinqGroupMoveIngress> {
  const reserved = rows.filter(move => move.status === "reserved" && createHostedPhoneLookupKeyReadCandidates(input.recipientPhone).includes(move.toAccountLookupKey));
  if (reserved.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  const move = reserved[0];
  if (!move) return prepared;
  const cleanup = await openHostedLinqGroupMoveCleanup(move, input.prisma);
  const candidate = await readRoster(input.threadId);
  if (candidate.isGroup !== true || !candidate.handlesComplete || !candidate.handles.length || candidate.handles.length > 32)
    return { ...prepared, action: "hold" };
  const containsSource = candidate.handles.some(handle => normalizePhoneNumber(handle.handle) === cleanup.sourcePhone
    && (handle.status === null || handle.status.trim().toLowerCase() === "active"));
  if (containsSource && input.service?.trim().toLowerCase() === "imessage" && move.adoptionDeadlineAt.getTime() > Date.now()) {
    if (predatesMoveAdd(input, move)) return { ...prepared, action: "hold" };
    return prepareAdoption(input, move, cleanup, candidate, prepared);
  }
  // Expiry removes automatic adoption authority, never the admission protection.
  if (containsSource)
    return { ...prepared, action: "hold" };
  return prepared;
}

/** A stale/missing preparation retries via the existing prepared-transaction owner. */
export async function applyHostedLinqGroupMoveIngressTx(input: Ingress & {
  prepared?: PreparedHostedLinqGroupMoveIngress; prisma: Prisma.TransactionClient;
}): Promise<"continue" | "consume"> {
  const rows = await readHostedLinqGroupMovesForIngress(input);
  if (!rows.length && (!input.prepared || input.prepared.fingerprint === fingerprint(rows))) return "continue";
  if (!input.prepared || input.prepared.fingerprint !== fingerprint(rows)) holdHostedLinqGroupLineMove("HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED");
  // The planner invokes adoption separately, before taking a single-chat lock.
  if (input.prepared.adoption) holdHostedLinqGroupLineMove("HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED");
  if (input.prepared.action === "hold") holdHostedLinqGroupLineMove();
  // Both paths own the source chat lock. Without a proven cross-line message id,
  // admitting source work must permanently disarm this reservation's adoption.
  // This update commits with ordinary mailbox admission, or rolls back with it.
  if (input.prepared.expireSourceReservationId) await input.prisma.hostedLinqGroupLineMove.updateMany({
    where: { id: input.prepared.expireSourceReservationId, status: "reserved" },
    data: { adoptionDeadlineAt: new Date(0), lastErrorCode: "source_hold_expired" },
  });
  return input.prepared.action;
}
