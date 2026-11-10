import "server-only";
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

type Ingress = { service?: string | null; threadId: string; recipientPhone: string | null; sender: string | null; text: string | null; isFromMe: boolean };
export type PreparedHostedLinqGroupMoveIngress = {
  fingerprint: string;
  action: "continue" | "consume" | "hold";
  adoption?: PreparedHostedLinqGroupLineMoveAdoption;
};

/** The shared parser trims display text. Correlation instead hashes one exact signed wire text part. */
export function readHostedLinqGroupMoveNoticeText(event: { data: unknown }): string | null {
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const message = "message" in data && data.message && typeof data.message === "object" ? data.message : data;
  if (!("parts" in message) || !Array.isArray(message.parts) || message.parts.length !== 1) return null;
  const part: unknown = message.parts[0];
  return part && typeof part === "object" && "type" in part && part.type === "text" && "value" in part && typeof part.value === "string"
    ? part.value : null;
}

function fingerprint(rows: readonly HostedLinqGroupLineMove[]): string { return sha256Hex(JSON.stringify(rows)); }

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

async function prepareMarkedAdoption(input: Ingress & { prisma: PrismaClient },
  move: HostedLinqGroupLineMove, cleanup: HostedLinqGroupMoveCleanup,
  candidate: HostedLinqChatSummary, prepared: PreparedHostedLinqGroupMoveIngress,
): Promise<PreparedHostedLinqGroupMoveIngress> {
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
    return { ...prepared, action: "hold" };
  }
  const expected = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: cleanup.sourceChatId, prisma: input.prisma });
  if (expected?.containerMemberId !== move.containerMemberId || !expected.deliveryRouteState?.deliveryRouteEncrypted)
    holdHostedLinqGroupLineMove("HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED");
  const route = await prepareHostedThreadContainerDeliveryRoute({ accountLookupKey: move.toAccountLookupKey,
    channel: "linq", containerMemberId: move.containerMemberId, observedDeliveryRouteEncrypted: expected.deliveryRouteState.deliveryRouteEncrypted,
    prisma: input.prisma, threadId: input.threadId });
  return { ...prepared, action: "consume", adoption: { move, cleanup, expected, destination: route, verifiedAt: new Date(Math.min(sourceChat.observedAt.getTime(), candidate.observedAt.getTime())) } };
}

/** All encrypted opens, provider reads and destination sealing happen before BEGIN. */
export async function prepareHostedLinqGroupMoveIngress(input: Ingress & {
  prisma: PrismaClient; route: HostedThreadRouteSnapshot | null;
}): Promise<PreparedHostedLinqGroupMoveIngress> {
  const rows = await readHostedLinqGroupMovesForIngress(input);
  const prepared: PreparedHostedLinqGroupMoveIngress = { fingerprint: fingerprint(rows), action: "continue" };
  if (!rows.length || input.isFromMe) return prepared;
  const source = rows.filter(move => linqGroupMoveSourceMatches(move, input.threadId));
  if (source.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  if (source[0]) return { ...prepared, action: source[0].status === "reserved" ? "hold" : "consume" };
  const destination = rows.filter(move => linqGroupMoveDestinationMatches(move, input.threadId));
  if (destination.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  if (destination[0]) {
    const move = destination[0];
    const cleanup = await openHostedLinqGroupMoveCleanup(move, input.prisma);
    if (input.route?.containerMemberId !== move.containerMemberId || normalizePhoneNumber(input.recipientPhone) !== cleanup.targetPhone)
      return { ...prepared, action: "hold" };
    if (normalizePhoneNumber(input.sender) === cleanup.sourcePhone) return { ...prepared, action: "consume" };
  }
  if (input.route) return prepared;
  return prepareUnboundReservation(input, rows, prepared);
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
  const marked = input.text !== null && normalizePhoneNumber(input.sender) === cleanup.sourcePhone && sha256Hex(input.text) === move.noticeTextHash;
  if (marked && input.service?.trim().toLowerCase() === "imessage" && move.adoptionDeadlineAt.getTime() > Date.now()) {
    return prepareMarkedAdoption(input, move, cleanup, candidate, prepared);
  }
  // Expiry removes automatic adoption authority, never the admission protection.
  if (marked || !candidate.handlesComplete || candidate.handles.length > 32
    || candidate.handles.some(handle => normalizePhoneNumber(handle.handle) === cleanup.sourcePhone && (handle.status === null || handle.status.toLowerCase() === "active")))
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
  return input.prepared.action;
}
