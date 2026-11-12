import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadIdentityLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { decryptHostedContactPhoneEnvelope, encryptHostedContactPhoneEnvelope } from "../hosted-onboarding/contact-phone-envelope";
import { readHostedContactPrivacyKeyring } from "../hosted-onboarding/env";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { leaveHostedLinqChat } from "../hosted-onboarding/linq-client";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { acquireHostedLinqChatOwnershipLockTx } from "./linq-chat-ownership-lock";
import { deleteExactHostedLinqThreadRouteTx, lockHostedThreadRouteByThreadIdentityTx, type HostedLinqExactThreadRoute } from "./thread-route-store";

export type HostedLinqGroupLeaveReason = "oversized" | "operator_cleanup" | "assistant";
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
  if (!threadIdentityLookupKey) throw new TypeError("Group leave requires a thread identity.");
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

export type HostedLinqGroupLeaveProviderOutcome = "accepted" | "unconfirmed" | "rejected" | "failed";

/** One request-local attempt. Acceptance is not evidence of provider removal. */
export async function requestHostedLinqGroupLeaveAfterCommit(target: HostedLinqGroupLeaveTarget): Promise<HostedLinqGroupLeaveProviderOutcome> {
  let outcome: HostedLinqGroupLeaveProviderOutcome;
  try {
    await leaveHostedLinqChat(target);
    outcome = "accepted";
  } catch (error) {
    outcome = isHostedOnboardingError(error) && error.code === "LINQ_GROUP_LEAVE_UNCONFIRMED" ? "unconfirmed"
      : isHostedOnboardingError(error) && error.code === "LINQ_GROUP_LEAVE_REJECTED" ? "rejected" : "failed";
  }
  console.info("Hosted Linq group departure provider outcome.", { code: outcome });
  return outcome;
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
