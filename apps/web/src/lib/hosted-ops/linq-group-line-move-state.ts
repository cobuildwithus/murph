import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates, createHostedLinqChatLookupKeyReadCandidates, createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { resolveHostedLinqEgressPolicyForRuntime } from "../hosted-onboarding/linq-egress-engagement";
import { acquireHostedLinqLinePhoneLockTx, listHostedLinqAssignableHomeLines } from "../hosted-onboarding/linq-line-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { acquireHostedLinqChatOwnershipLockTx } from "../hosted-routing/linq-chat-ownership-lock";
import { linqGroupMoveSelect, type HostedLinqGroupMoveCleanup } from "../hosted-routing/linq-group-line-move-store";

export const groupMoveOperatorSelect = { ...linqGroupMoveSelect, addStartedAt: true, addConfirmedAt: true,
  adoptedAt: true, leaveConfirmedAt: true, lastErrorCode: true, createdAt: true } satisfies Prisma.HostedLinqGroupLineMoveSelect;
export type OperatorGroupMove = Prisma.HostedLinqGroupLineMoveGetPayload<{ select: typeof groupMoveOperatorSelect }>;
export const GROUP_MOVE_QUIET_MS = 60_000;
export const GROUP_MOVE_ADOPTION_MS = 24 * 60 * 60_000;

export function groupMoveError(code: string): never {
  throw hostedOnboardingError({ code: `HOSTED_LINQ_GROUP_MOVE_${code}`, httpStatus: code === "NOT_FOUND" ? 404 : 409,
    retryable: false, message: "Group move cannot proceed. Check the operation code and current move status." });
}


/** Persist fixed operation vocabulary and numeric provider codes, never provider text. */
export function groupMoveFailureCode(error: unknown): string {
  if (!isHostedOnboardingError(error)) return "operation_unconfirmed";
  if (error.code.startsWith("HOSTED_LINQ_GROUP_MOVE_")) return error.code.slice("HOSTED_LINQ_GROUP_MOVE_".length).toLowerCase();
  if (!/^LINQ_GROUP_(ADD|REMOVE|LEAVE)_(REJECTED|UNCONFIRMED)$/u.test(error.code)) return "operation_unconfirmed";
  const base = error.code.slice("LINQ_GROUP_".length).toLowerCase();
  const code = error.details?.providerErrorCode;
  const status = error.details?.status;
  if (typeof code === "number" && Number.isSafeInteger(code)) return `${base}_provider_${code}`;
  return typeof status === "number" && Number.isSafeInteger(status) ? `${base}_http_${status}` : base;
}

export async function readOperatorGroupMove(id: string, prisma: PrismaClient): Promise<OperatorGroupMove> {
  const row = await prisma.hostedLinqGroupLineMove.findUnique({ where: { id }, select: groupMoveOperatorSelect });
  if (!row) groupMoveError("NOT_FOUND");
  return row;
}

export function summarizeOperatorGroupMove(row: OperatorGroupMove) {
  return { moveId: row.id, containerHint: row.containerMemberId.slice(-8), status: row.status,
    sourceLineLookupKey: row.fromAccountLookupKey, targetLineLookupKey: row.toAccountLookupKey,
    adoptionDeadlineAt: row.adoptionDeadlineAt.toISOString(),
    adoptionExpired: row.status === "reserved" && row.adoptionDeadlineAt.getTime() <= Date.now(), holdActive: row.status === "reserved",
    sourceHoldActive: row.status === "reserved" && row.adoptionDeadlineAt.getTime() > Date.now(),
    addStartedAt: row.addStartedAt?.toISOString() ?? null, addConfirmedAt: row.addConfirmedAt?.toISOString() ?? null,
    adoptedAt: row.adoptedAt?.toISOString() ?? null,
    leaveConfirmedAt: row.leaveConfirmedAt?.toISOString() ?? null, code: row.lastErrorCode };
}

export async function recordGroupMoveError(move: OperatorGroupMove, code: string, prisma: PrismaClient) {
  await prisma.hostedLinqGroupLineMove.updateMany({ where: { id: move.id, status: move.status }, data: { lastErrorCode: code } });
}

/** Complete, fresh provider evidence is required for absence as well as presence. */
export async function readGroupMoveRoster(cleanup: HostedLinqGroupMoveCleanup): Promise<HostedLinqChatSummary> {
  const chat = await getHostedLinqChatSummary({ chatId: cleanup.sourceChatId, timeoutMs: 3_000 });
  if (chat.isGroup !== true || !chat.handlesComplete || chat.handles.length === 0 || chat.handles.length > 32
    || Date.now() - chat.observedAt.getTime() > 30_000 || chat.observedAt.getTime() > Date.now()) groupMoveError("ROSTER_UNAVAILABLE");
  return chat;
}

export function activeGroupMoveHandles(chat: HostedLinqChatSummary) {
  return chat.handles.filter(handle => handle.status === null || handle.status.trim().toLowerCase() === "active");
}
export function groupMoveHasPhone(chat: HostedLinqChatSummary, phone: string) {
  return activeGroupMoveHandles(chat).some(handle => normalizePhoneNumber(handle.handle) === phone);
}
export function assertGroupMoveSourceSelf(chat: HostedLinqChatSummary, cleanup: HostedLinqGroupMoveCleanup) {
  const self = activeGroupMoveHandles(chat).filter(handle => handle.isMe);
  if (self.length !== 1 || normalizePhoneNumber(self[0]?.handle) !== cleanup.sourcePhone) groupMoveError("SOURCE_NOT_SELF");
}

export async function assertGroupMoveLinesCanSend(cleanup: HostedLinqGroupMoveCleanup, prisma: Prisma.TransactionClient) {
  const target = (await listHostedLinqAssignableHomeLines({ prisma })).find(line => line.phoneNumber === cleanup.targetPhone);
  if (!target) groupMoveError("TARGET_NOT_ASSIGNABLE");
  const { policy } = await resolveHostedLinqEgressPolicyForRuntime({ fromPhoneNumber: cleanup.sourcePhone,
    target: cleanup.sourceChatId, targetKind: "thread", prisma });
  if (policy.kind === "block") groupMoveError("SOURCE_CANNOT_SEND");
}

/** Source chat locks also serialize the consumer's ingress and adoption. */
export async function lockGroupMoveSource(cleanup: HostedLinqGroupMoveCleanup, prisma: Prisma.TransactionClient) {
  await acquireHostedLinqChatOwnershipLockTx({ chatId: cleanup.sourceChatId, tx: prisma });
}

export async function assertGroupMoveReservationAvailable(input: {
  containerMemberId: string; cleanup: HostedLinqGroupMoveCleanup; prisma: Prisma.TransactionClient;
}) {
  const { cleanup, prisma } = input;
  await lockGroupMoveSource(cleanup, prisma);
  // Reuse the inventory's raw-phone lock, independent of privacy-key rotation.
  await acquireHostedLinqLinePhoneLockTx({ phoneNumber: cleanup.targetPhone, prisma });
  const conflict = await prisma.hostedLinqGroupLineMove.findFirst({ where: { OR: [
    { status: "reserved", toAccountLookupKey: { in: createHostedPhoneLookupKeyReadCandidates(cleanup.targetPhone) } },
    { status: "reserved", fromThreadIdentityLookupKey: { in: createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: cleanup.sourceChatId }) } },
    { containerMemberId: input.containerMemberId, status: { in: ["reserved", "adopted"] } },
  ] }, select: { id: true } });
  if (conflict) groupMoveError("MOVE_CONFLICT");
}

/** Indexed existence probes, never payload scans or runtime workspace reads. */
export async function assertGroupMoveQuiet(input: { containerMemberId: string; chatId: string; prisma: Prisma.TransactionClient }) {
  const { prisma, containerMemberId } = input;
  const cutoff = new Date(Date.now() - GROUP_MOVE_QUIET_MS);
  const chatKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recent = await prisma.hostedLinqProviderEvent.findFirst({ where: {
    linqChatLookupKey: { in: chatKeys }, eventType: "message.received",
    OR: [{ receivedAt: { gte: cutoff } }, { providerCreatedAt: { gte: cutoff } }],
  }, select: { eventId: true } });
  if (recent) groupMoveError("CHAT_NOT_QUIET");
  const pending = await prisma.hostedMailboxItem.findFirst({ where: { userId: containerMemberId,
    OR: [{ consumedAt: null }, { kind: "conversation.message", createdAt: { gte: cutoff } }] }, select: { id: true } });
  const runtime = await prisma.hostedRuntimeOwner.findUnique({ where: { userId: containerMemberId }, select: { phase: true } });
  const delivery = await prisma.hostedLinqDelivery.findFirst({ where: {
    OR: [{ linqChatLookupKey: { in: chatKeys } }, { payloadOwnerMemberId: containerMemberId }],
    status: { in: ["attempted", "provider_dispatch_started", "accepted", "awaiting_generation", "generation_queued"] },
  }, select: { id: true } });
  if (pending || (runtime && runtime.phase !== "idle") || delivery) groupMoveError("WORK_PENDING");
}
