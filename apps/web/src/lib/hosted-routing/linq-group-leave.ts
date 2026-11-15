import { ContractValidationError } from "@murphai/contracts/validation-error";
import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { createHostedLinqChatLookupKeyReadCandidates, createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { decryptHostedContactPhoneEnvelope, encryptHostedContactPhoneEnvelope } from "../hosted-onboarding/contact-phone-envelope";
import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getHostedLinqChatSummary, leaveHostedLinqChat } from "../hosted-onboarding/linq-client";
import { getPrisma } from "../prisma";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { acquireHostedLinqChatOwnershipLockTx } from "./linq-chat-ownership-lock";
import { deleteExactHostedLinqThreadRouteTx, lockHostedThreadRouteByThreadIdentityTx, type HostedLinqExactThreadRoute } from "./thread-route-store";

export type HostedLinqGroupLeaveReason = "oversized" | "operator_cleanup" | "assistant" | "blocked_participant";
/** A roster Murph never admits; the room is left with this marker reason. */
export type HostedLinqGroupRosterRejection = Extract<HostedLinqGroupLeaveReason, "oversized" | "blocked_participant">;
export type HostedLinqGroupLeaveTarget = { chatId: string };
export type HostedLinqGroupLeaveResult =
  | { status: "left"; postCommitLinqGroupLeave: HostedLinqGroupLeaveTarget }
  | { status: "already_left" }
  | { status: "unavailable"; reason: "active_game" | "game_bound" | "active_move" | "route_changed" };

function identityKeys(chatId: string | number) {
  return createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: chatId });
}

function codec(threadIdentityLookupKey: string) {
  return {
    aad: (version: string) => Buffer.from(JSON.stringify(["hosted-linq-group-leave:v1", version, threadIdentityLookupKey])),
    keyPurpose: "linq-group-leave-chat-id", label: "Linq group leave identity", schema: "hosted-linq-group-leave:v1",
  };
}

export function prepareHostedLinqGroupLeave(chatId: string, reason: HostedLinqGroupLeaveReason) {
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId });
  if (!threadIdentityLookupKey) throw new ContractValidationError("Group leave requires a thread identity.");
  return { chatId, reason, threadIdentityLookupKey,
    chatIdEncrypted: encryptHostedContactPhoneEnvelope({ codec: codec(threadIdentityLookupKey), phoneNumber: chatId }) };
}

export async function readHostedLinqGroupLeave(input: {
  chatId: string | number; prisma: HostedOnboardingReadClient;
}) {
  try {
    return await input.prisma.hostedLinqGroupLeave.findFirst({
      where: { threadIdentityLookupKey: { in: identityKeys(input.chatId) } },
      select: { threadIdentityLookupKey: true },
    });
  } catch {
    throw hostedOnboardingError({ code: "HOSTED_LINQ_GROUP_LEAVE_READ_UNAVAILABLE", httpStatus: 503,
      retryable: true, message: "Group departure authority is unavailable." });
  }
}

export async function assertHostedLinqGroupNotLeft(input: {
  chatId: string | number; prisma: HostedOnboardingReadClient;
}): Promise<void> {
  if (await readHostedLinqGroupLeave(input)) throw hostedOnboardingError({
    code: "HOSTED_LINQ_GROUP_LEFT", httpStatus: 403,
    retryable: false, message: "The group has been left locally.",
  });
}

/** Caller supplies a pre-opened exact route, or null for strictly unbound leave. */
export async function leaveHostedLinqGroupTx(input: {
  expected: HostedLinqExactThreadRoute | null;
  prepared: ReturnType<typeof prepareHostedLinqGroupLeave>;
  prisma: Prisma.TransactionClient;
}): Promise<HostedLinqGroupLeaveResult> {
  const { prepared, prisma, expected } = input;
  await acquireHostedLinqChatOwnershipLockTx({ chatId: prepared.chatId, tx: prisma });
  await lockHostedThreadRouteByThreadIdentityTx({ prisma,
    authority: { channel: "linq", threadId: prepared.chatId, containerMemberId: expected?.containerMemberId ?? "" } });
  if (await readHostedLinqGroupLeave({ chatId: prepared.chatId, prisma })) return { status: "already_left" };
  const identities = identityKeys(prepared.chatId);
  const routes = await prisma.hostedThreadRoute.findMany({ where: { channel: "linq", threadIdentityLookupKey: { in: identities } },
    select: { containerMemberId: true, threadIdentityLookupKey: true }, take: 2 });
  if (expected ? routes.length !== 1 || routes[0]?.containerMemberId !== expected.containerMemberId
    || routes[0]?.threadIdentityLookupKey !== expected.threadIdentityLookupKey : routes.length !== 0)
    return { status: "unavailable", reason: "route_changed" };
  const conflict = await readLeaveConflict({ anyGame: prepared.reason === "assistant", identities, containerMemberId: expected?.containerMemberId, prisma });
  if (conflict) return { status: "unavailable", reason: conflict };
  const inserted = await prisma.hostedLinqGroupLeave.createMany({ data: {
    threadIdentityLookupKey: prepared.threadIdentityLookupKey, chatIdEncrypted: prepared.chatIdEncrypted, reason: prepared.reason,
  }, skipDuplicates: true });
  if (!inserted.count) return { status: "already_left" };
  await prisma.hostedLinqGroupSighting.updateMany({ where: { chatLookupKey: { in: createHostedLinqChatLookupKeyReadCandidates(prepared.chatId) } },
    data: { leaveMarkerKey: prepared.threadIdentityLookupKey } });
  if (expected && !await deleteExactHostedLinqThreadRouteTx({ expected, prisma })) {
    // Throw, rather than return unavailable: the marker must roll back too.
    throw hostedOnboardingError({ code: "HOSTED_LINQ_GROUP_LEAVE_ROUTE_CHANGED", httpStatus: 409,
      retryable: true, message: "The group route changed before departure." });
  }
  return { status: "left", postCommitLinqGroupLeave: { chatId: prepared.chatId } };
}

async function readLeaveConflict(input: {
  anyGame: boolean; identities: string[]; containerMemberId?: string; prisma: Prisma.TransactionClient;
}): Promise<"active_game" | "game_bound" | "active_move" | null> {
  if (input.containerMemberId && await input.prisma.game.findFirst({
    where: { chatContainerMemberId: input.containerMemberId, ...(input.anyGame ? {} : { status: { in: ["invited", "negotiating", "live"] } }) }, select: { id: true },
  })) return input.anyGame ? "game_bound" : "active_game";
  if (await input.prisma.hostedLinqGroupLineMove.findFirst({ where: { status: { in: ["reserved", "adopted"] }, OR: [
    ...(input.containerMemberId ? [{ containerMemberId: input.containerMemberId }] : []),
    { fromThreadIdentityLookupKey: { in: input.identities } }, { toThreadIdentityLookupKey: { in: input.identities } },
  ] }, select: { id: true } })) return "active_move";
  return null;
}

export type HostedLinqGroupLeaveProviderOutcome = "accepted" | "unconfirmed" | "rejected" | "failed" | "not_attempted" | "removed" | "fewer_than_four" | "verified_still_active";
const PROVIDER_LEAVE_RETRY_MS = 60 * 60 * 1000;
const PROVIDER_LEAVE_MAX_ATTEMPTS = 5;

/** Reservations, including interrupted requests, consume the bounded attempt budget. */
export async function requestHostedLinqGroupLeaveAfterCommit(
  target: HostedLinqGroupLeaveTarget,
  prisma: PrismaClient = getPrisma(),
  now = new Date(),
): Promise<HostedLinqGroupLeaveProviderOutcome> {
  let outcome: HostedLinqGroupLeaveProviderOutcome;
  try {
    const eligible = { threadIdentityLookupKey: { in: identityKeys(target.chatId) }, providerRemovedAt: null, providerLeaveTerminalCode: null,
      OR: [{ providerLeaveLastAttemptAt: null }, { providerLeaveLastAttemptAt: { lte: new Date(now.getTime() - PROVIDER_LEAVE_RETRY_MS) } }] };
    const claimed = await prisma.hostedLinqGroupLeave.updateMany({
      where: { ...eligible, providerLeaveAttempts: { lt: PROVIDER_LEAVE_MAX_ATTEMPTS } },
      data: { providerLeaveAttempts: { increment: 1 }, providerLeaveLastAttemptAt: now },
    });
    if (!claimed.count) return await verifyExhaustedLeave(target, prisma, eligible);
    outcome = await dispatchClaimedLeave(target, prisma, now);
  } catch {
    // The marker is already durable. A later sweep owns recovery after a DB failure.
    outcome = "failed";
  }
  console.info("Hosted Linq group departure provider outcome.", { code: outcome });
  return outcome;
}

async function dispatchClaimedLeave(target: HostedLinqGroupLeaveTarget, prisma: PrismaClient, now: Date): Promise<HostedLinqGroupLeaveProviderOutcome> {
  try {
    await leaveHostedLinqChat(target);
    return "accepted";
  } catch (error) {
    const details = isHostedOnboardingError(error) ? error.details : undefined;
    const code = details?.status === 409 ? details.providerErrorCode : null;
    if (code === 2013 || code === 2015) {
      await prisma.hostedLinqGroupLeave.updateMany({
        where: { threadIdentityLookupKey: { in: identityKeys(target.chatId) }, providerRemovedAt: null },
        data: code === 2013 ? { providerRemovedAt: now } : { providerLeaveTerminalCode: "fewer_than_four" },
      });
      return code === 2013 ? "removed" : "fewer_than_four";
    }
    return isHostedOnboardingError(error) && error.code === "LINQ_GROUP_LEAVE_UNCONFIRMED" ? "unconfirmed"
      : isHostedOnboardingError(error) && error.code === "LINQ_GROUP_LEAVE_REJECTED" ? "rejected" : "failed";
  }
}

async function verifyExhaustedLeave(target: HostedLinqGroupLeaveTarget, prisma: PrismaClient, eligible: Prisma.HostedLinqGroupLeaveWhereInput): Promise<HostedLinqGroupLeaveProviderOutcome> {
  // Claim the sole bounded diagnostic read on the next eligible tick, allowing
  // the final queued request time to settle. A crash leaves truthful uncertainty.
  const claimed = await prisma.hostedLinqGroupLeave.updateMany({
    where: { ...eligible, providerLeaveAttempts: { gte: PROVIDER_LEAVE_MAX_ATTEMPTS } },
    data: { providerLeaveTerminalCode: "unconfirmed" },
  });
  if (!claimed.count) return "not_attempted";
  try {
    const roster = await getHostedLinqChatSummary({ chatId: target.chatId, timeoutMs: 3_000 });
    if (roster.handles.some(handle => handle.isMe && handle.status?.trim().toLowerCase() === "active")) {
      await prisma.hostedLinqGroupLeave.updateMany({ where: { threadIdentityLookupKey: { in: identityKeys(target.chatId) },
        providerRemovedAt: null, providerLeaveTerminalCode: "unconfirmed" }, data: { providerLeaveTerminalCode: "verified_still_active" } });
      return "verified_still_active";
    }
  } catch { /* Lack of a successful read is still unconfirmed, never absence. */ }
  return "unconfirmed";
}

/** Provider-capable retention calls this once per tick; no unbounded fanout. */
export async function sweepHostedLinqGroupLeaves(input: { prisma: PrismaClient; now: Date }): Promise<number> {
  const { prisma, now } = input;
  const rows = await prisma.hostedLinqGroupLeave.findMany({ where: {
    providerRemovedAt: null, providerLeaveTerminalCode: null,
    OR: [{ providerLeaveLastAttemptAt: null }, { providerLeaveLastAttemptAt: { lte: new Date(now.getTime() - PROVIDER_LEAVE_RETRY_MS) } }],
  }, orderBy: [{ providerLeaveLastAttemptAt: { sort: "asc", nulls: "first" } }, { threadIdentityLookupKey: "asc" }],
    take: 10, select: { threadIdentityLookupKey: true, chatIdEncrypted: true } });
  let attempted = 0;
  for (const row of rows) {
    try {
      const chatId = decryptHostedContactPhoneEnvelope({ codec: codec(row.threadIdentityLookupKey), encrypted: row.chatIdEncrypted });
      if (!identityKeys(chatId).includes(row.threadIdentityLookupKey)) throw new TypeError("Invalid departure identity.");
      if (await requestHostedLinqGroupLeaveAfterCommit({ chatId }, prisma, now) !== "not_attempted") attempted++;
    } catch { console.warn("Hosted Linq group departure sweep failed.", { code: "marker_unavailable" }); }
  }
  return attempted;
}

/** Bounded rotation seam; repeat while the prior key is configured, before retiring it. */
export async function rotateHostedLinqGroupLeaveBatch(prisma: PrismaClient): Promise<number> {
  const { currentVersion } = readHostedContactPrivacyKeyring(process.env);
  const rows = await prisma.hostedLinqGroupLeave.findMany({
    where: { NOT: { threadIdentityLookupKey: { contains: `:${currentVersion}:` } } },
    orderBy: { threadIdentityLookupKey: "asc" }, take: 100,
  });
  let rotated = 0;
  for (const row of rows) {
    const chatId = decryptHostedContactPhoneEnvelope({ codec: codec(row.threadIdentityLookupKey), encrypted: row.chatIdEncrypted });
    if (!identityKeys(chatId).includes(row.threadIdentityLookupKey)) throw new TypeError("Group departure identity does not match its marker.");
    const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId })!;
    const chatIdEncrypted = encryptHostedContactPhoneEnvelope({ codec: codec(threadIdentityLookupKey), phoneNumber: chatId });
    rotated += await prisma.$transaction(async tx => {
      await acquireHostedLinqChatOwnershipLockTx({ chatId, tx });
      const updated = await tx.hostedLinqGroupLeave.updateMany({
        where: { threadIdentityLookupKey: row.threadIdentityLookupKey, chatIdEncrypted: row.chatIdEncrypted },
        data: { threadIdentityLookupKey, chatIdEncrypted },
      });
      return updated.count;
    });
  }
  return rotated;
}
