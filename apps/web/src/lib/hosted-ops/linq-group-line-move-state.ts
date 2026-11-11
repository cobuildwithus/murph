import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { HOSTED_OUTBOX_QUIESCENT_SNAPSHOT_STATUS_KEY } from "@murphai/hosted-execution/runtime-control";
import { isHostedWorkspaceSnapshotV2Ref, parseHostedExecutionSnapshotRef } from "@murphai/hosted-execution/parsers";
import { GAME_MISSED_CHECK_IN_MAX_LATENESS_MS } from "../game/missed-check-in";
import { lockHostedRuntimeOwnerRowTx } from "../hosted-execution/runtime-owner";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates, createHostedLinqChatLookupKeyReadCandidates, createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getHostedLinqChatSummary, type HostedLinqChatSummary } from "../hosted-onboarding/linq-client";
import { readHostedMailboxProgress } from "../hosted-mailbox/projection";
import { resolveHostedLinqEgressPolicyForRuntime } from "../hosted-onboarding/linq-egress-engagement";
import { acquireHostedLinqLinePhoneLockTx, listHostedLinqAssignableHomeLines } from "../hosted-onboarding/linq-line-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { acquireHostedLinqChatOwnershipLockTx } from "../hosted-routing/linq-chat-ownership-lock";
import { linqGroupMoveSelect, type HostedLinqGroupMoveCleanup } from "../hosted-routing/linq-group-line-move-store";

export const groupMoveOperatorSelect = { ...linqGroupMoveSelect, addStartedAt: true, addConfirmedAt: true,
  removeStartedAt: true, removeAcceptedAt: true,
  adoptedAt: true, leaveConfirmedAt: true, lastErrorCode: true, createdAt: true } satisfies Prisma.HostedLinqGroupLineMoveSelect;
export type OperatorGroupMove = Prisma.HostedLinqGroupLineMoveGetPayload<{ select: typeof groupMoveOperatorSelect }>;
export const GROUP_MOVE_QUIET_MS = 60_000;
export const GROUP_MOVE_ADOPTION_MS = 24 * 60 * 60_000;
// Drain recent provider work; age alone never proves runtime outbox settlement.
const GROUP_MOVE_DELIVERY_DRAIN_MS = 15 * 60_000;

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
    removeStartedAt: row.removeStartedAt?.toISOString() ?? null, removeAcceptedAt: row.removeAcceptedAt?.toISOString() ?? null,
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

/** Indexed control metadata probes; never open payloads or the runtime archive. */
export async function assertGroupMoveQuiet(input: { containerMemberId: string; chatId: string; prisma: Prisma.TransactionClient }) {
  const { prisma, containerMemberId } = input;
  const cutoff = new Date(Date.now() - GROUP_MOVE_QUIET_MS);
  const chatKeys = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const recent = await prisma.hostedLinqProviderEvent.findFirst({ where: {
    linqChatLookupKey: { in: chatKeys }, eventType: "message.received",
    OR: [{ receivedAt: { gte: cutoff } }, { providerCreatedAt: { gte: cutoff } }],
  }, select: { eventId: true } });
  if (recent) groupMoveError("CHAT_NOT_QUIET");
  // System acknowledgements advance the lane watermark without stamping items.
  const progress = await readHostedMailboxProgress({ userId: containerMemberId, prisma });
  const pending = progress.maxSeqByLane.some(row => BigInt(row.maxSeq) > BigInt(
    progress.consumedSeqByLane.find(consumed => consumed.lane === row.lane)?.consumedSeq ?? "0"));
  const recentConversation = await prisma.hostedMailboxItem.findFirst({ where: { userId: containerMemberId,
    kind: "conversation.message", createdAt: { gte: cutoff } }, select: { id: true } });
  const runtime = await lockHostedRuntimeOwnerRowTx(prisma, containerMemberId);
  const drainedBefore = new Date(Date.now() - GROUP_MOVE_DELIVERY_DRAIN_MS);
  const settledBefore = runtime?.phase === "idle"
    ? await readQuiescentSnapshotTime(prisma, containerMemberId) : null;
  const delivery = await prisma.hostedLinqDelivery.findFirst({ where: {
    OR: [{ linqChatLookupKey: { in: chatKeys } }, { payloadOwnerMemberId: containerMemberId }],
    status: { in: ["attempted", "provider_dispatch_started", "accepted", "awaiting_generation", "generation_queued"] },
    // Accepted sends also persist as deduplication history. An uncorrelated
    // dispatch fence can still own a runtime outbox retry, regardless of age.
    NOT: { OR: [{
      payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null,
      attemptedAt: { lt: drainedBefore }, updatedAt: { lt: drainedBefore },
      OR: [
        { status: "accepted", acceptedAt: { not: null, lt: drainedBefore },
          source: { in: ["hosted_runtime_linq_delivery", "hosted_webhook_side_effect"] } },
        ...(settledBefore ? [{ status: "provider_dispatch_started", source: "hosted_runtime_linq_delivery",
          attemptedAt: { lt: settledBefore }, updatedAt: { lt: settledBefore },
          acceptedAt: null, deliveredAt: null, skippedAt: null, messageLookupKey: null,
          failedAt: null, failureCode: null, lastReceiptAt: null, retryAfterAt: null }] : []),
      ],
    }, ...(settledBefore ? [{
      // Published missed-check-ins retain their generation receipt after expiry.
      // Egress rejects them using this same deadline; the current snapshot also
      // proves that the runtime has no remaining outbox obligation.
      source: "game_lifecycle", status: "generation_queued",
      template: { in: ["game_missed", "game_group_missed"] },
      createdAt: { lt: new Date(Date.now() - GAME_MISSED_CHECK_IN_MAX_LATENESS_MS) },
      attemptedAt: { lt: new Date(Math.min(drainedBefore.getTime(), settledBefore.getTime())) },
      updatedAt: { lt: new Date(Math.min(drainedBefore.getTime(), settledBefore.getTime())) },
      payloadOwnerMemberId: containerMemberId, payloadCiphertext: null, payloadSchema: null,
      acceptedAt: null, deliveredAt: null, skippedAt: null, messageLookupKey: null,
      failedAt: null, failureCode: null, lastReceiptAt: null, retryAfterAt: null,
    }] : [])] },
  }, select: { id: true } });
  if (pending || recentConversation || (runtime && runtime.phase !== "idle") || delivery) groupMoveError("WORK_PENDING");
}

async function readQuiescentSnapshotTime(prisma: Prisma.TransactionClient, userId: string): Promise<Date | null> {
  const workspace = await prisma.hostedWorkspace.findUnique({ where: { userId },
    select: { snapshotRef: true, redactedStatusJson: true } });
  const status = workspace?.redactedStatusJson;
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  try {
    const snapshot = parseHostedExecutionSnapshotRef(workspace.snapshotRef);
    if (!isHostedWorkspaceSnapshotV2Ref(snapshot) || snapshot.userId !== userId
      || snapshot.encryption.aad.userId !== userId
      || status[HOSTED_OUTBOX_QUIESCENT_SNAPSHOT_STATUS_KEY] !== snapshot.snapshotId) return null;
    const at = new Date(snapshot.createdAt);
    return Number.isFinite(at.getTime()) && at.getTime() <= Date.now() ? at : null;
  } catch { return null; }
}
