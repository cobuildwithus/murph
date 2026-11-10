import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { openHostedUserSecureBoxString, sealHostedUserSecureBoxString, type HostedSecureBoxPrismaClient } from "../hosted-crypto/secure-box";
import { createHostedExternalThreadIdentityLookupKeyReadCandidates, createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { readHostedLinqLinePhoneNumberByLookupKey } from "../hosted-onboarding/linq-line-phone-resolver";

export const linqGroupMoveSelect = {
  id: true, containerMemberId: true, fromAccountLookupKey: true, toAccountLookupKey: true,
  fromThreadIdentityLookupKey: true, toThreadIdentityLookupKey: true, sourceCleanupEncrypted: true,
  noticeTextHash: true, status: true, adoptionDeadlineAt: true,
} satisfies Prisma.HostedLinqGroupLineMoveSelect;
export type HostedLinqGroupLineMove = Prisma.HostedLinqGroupLineMoveGetPayload<{ select: typeof linqGroupMoveSelect }>;
type MoveClient = Pick<Prisma.TransactionClient, "hostedLinqGroupLineMove">;
export const adoptedLinqGroupMoveStatuses = ["adopted", "left"];
const cleanupSchema = z.object({ schema: z.literal("murph.linq-group-line-move.v1"),
  sourceChatId: z.string().trim().min(1).max(4096), sourcePhone: z.string(), targetPhone: z.string(),
}).strict();
export type HostedLinqGroupMoveCleanup = z.infer<typeof cleanupSchema>;

export function holdHostedLinqGroupLineMove(code = "HOSTED_LINQ_GROUP_LINE_MOVE_PENDING"): never {
  throw hostedOnboardingError({ code, httpStatus: 503, retryable: true,
    message: "The group line move is pending. Retry this webhook after the move settles." });
}

/** One bounded indexed read, independent of the total move history. Cancelled rows grant nothing. */
export async function readHostedLinqGroupMovesForIngress(input: {
  threadId: string; recipientPhone: string | null; prisma: MoveClient;
}): Promise<HostedLinqGroupLineMove[]> {
  const identities = createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: input.threadId });
  const rows = await input.prisma.hostedLinqGroupLineMove.findMany({ select: linqGroupMoveSelect, take: 5,
    where: { OR: [
      { fromThreadIdentityLookupKey: { in: identities }, status: { in: ["reserved", ...adoptedLinqGroupMoveStatuses] } },
      { toThreadIdentityLookupKey: { in: identities }, status: { in: adoptedLinqGroupMoveStatuses } },
      { toAccountLookupKey: { in: createHostedPhoneLookupKeyReadCandidates(input.recipientPhone) }, status: "reserved" },
    ] }, orderBy: { id: "asc" },
  });
  // Ordinarily at most three relations match. Ambiguous rotated rows fail closed.
  if (rows.length > 4) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  return rows;
}

export function linqGroupMoveSourceMatches(move: HostedLinqGroupLineMove, threadId: string): boolean {
  return createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId }).includes(move.fromThreadIdentityLookupKey);
}
export function linqGroupMoveDestinationMatches(move: HostedLinqGroupLineMove, threadId: string): boolean {
  return move.toThreadIdentityLookupKey !== null && createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId }).includes(move.toThreadIdentityLookupKey);
}

function cleanupAad(move: Pick<HostedLinqGroupLineMove, "id" | "containerMemberId">) {
  return { table: "hosted_linq_group_line_move", field: "source_cleanup_encrypted", rowId: move.id,
    objectKey: move.containerMemberId, purpose: "linq-group-line-move-cleanup" } as const;
}

/** Reservation preparation only; ownership comes from fresh provider inventory, never caller-supplied phones. */
export async function prepareHostedLinqGroupMoveCleanup(input: {
  id: string; containerMemberId: string; fromAccountLookupKey: string; toAccountLookupKey: string;
  sourceChatId: string; prisma: PrismaClient;
}): Promise<string> {
  // Callers must run this before opening their transaction.
  const sourcePhone = await readHostedLinqLinePhoneNumberByLookupKey({ phoneNumberLookupKey: input.fromAccountLookupKey, prisma: input.prisma });
  const targetPhone = await readHostedLinqLinePhoneNumberByLookupKey({ phoneNumberLookupKey: input.toAccountLookupKey, prisma: input.prisma });
  if (!sourcePhone || !targetPhone || sourcePhone === targetPhone) throw new Error("Group line move requires two verified service numbers.");
  const cleanup = cleanupSchema.parse({ schema: "murph.linq-group-line-move.v1", sourceChatId: input.sourceChatId, sourcePhone, targetPhone });
  const encrypted = await sealHostedUserSecureBoxString({ aad: cleanupAad(input), lane: "hosted-member-private-field",
    scope: "linq-group-line-move-cleanup:v1", userId: input.containerMemberId, prisma: input.prisma, value: JSON.stringify(cleanup) });
  if (!encrypted) throw new Error("Group line move cleanup encryption failed.");
  return encrypted;
}

export async function openHostedLinqGroupMoveCleanup(move: HostedLinqGroupLineMove, prisma: HostedSecureBoxPrismaClient): Promise<HostedLinqGroupMoveCleanup> {
  const value = await openHostedUserSecureBoxString({ aad: cleanupAad(move), lane: "hosted-member-private-field",
    scope: "linq-group-line-move-cleanup:v1", userId: move.containerMemberId, prisma, value: move.sourceCleanupEncrypted });
  const cleanup = cleanupSchema.parse(JSON.parse(value ?? "null"));
  if (normalizePhoneNumber(cleanup.sourcePhone) !== cleanup.sourcePhone || normalizePhoneNumber(cleanup.targetPhone) !== cleanup.targetPhone
    || cleanup.sourcePhone === cleanup.targetPhone
    || !createHostedPhoneLookupKeyReadCandidates(cleanup.sourcePhone).includes(move.fromAccountLookupKey)
    || !createHostedPhoneLookupKeyReadCandidates(cleanup.targetPhone).includes(move.toAccountLookupKey)
    || !linqGroupMoveSourceMatches(move, cleanup.sourceChatId)) throw new Error("Group line move cleanup authority is invalid.");
  return cleanup;
}

/** Used only at the existing game audience boundary; no new roster is stored. */
export async function readHostedLinqGroupMoveServicePhones(input: {
  containerMemberId: string; threadId: string; prisma: PrismaClient;
}): Promise<readonly string[]> {
  const identities = createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: input.threadId });
  const rows = await input.prisma.hostedLinqGroupLineMove.findMany({ select: linqGroupMoveSelect, take: 3,
    where: { containerMemberId: input.containerMemberId, OR: [
      { status: "reserved", fromThreadIdentityLookupKey: { in: identities } },
      { status: "adopted", toThreadIdentityLookupKey: { in: identities } },
    ] }, orderBy: { id: "asc" },
  });
  if (rows.length > 1) holdHostedLinqGroupLineMove("HOSTED_LINQ_GROUP_LINE_MOVE_AMBIGUOUS");
  const move = rows[0];
  if (!move) return [];
  const cleanup = await openHostedLinqGroupMoveCleanup(move, input.prisma);
  return [cleanup.sourcePhone, cleanup.targetPhone];
}
