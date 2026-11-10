import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { readHostedLinqLinePhoneNumberByLookupKey } from "../hosted-onboarding/linq-line-phone-resolver";
import { listHostedLinqAssignableHomeLines } from "../hosted-onboarding/linq-line-store";
import { groupMoveError, groupMoveOperatorSelect, summarizeOperatorGroupMove } from "./linq-group-line-move-state";

export async function readHostedLinqGroupLineMoveOverview(input: {
  status?: "reserved" | "adopted" | "left" | "cancelled";
  sourceLineLookupKey?: string; afterMoveId?: string; afterContainerRef?: string; prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedLinqGroupLineMove.findMany({ where: { status: input.status,
    ...(input.afterMoveId ? { id: { gt: input.afterMoveId } } : {}) }, orderBy: { id: "asc" }, take: 51, select: groupMoveOperatorSelect });
  const lines = await listHostedLinqAssignableHomeLines({ prisma });
  const candidates = input.sourceLineLookupKey ? await readCandidates(input.sourceLineLookupKey, input.afterContainerRef, prisma) : [];
  return { moves: rows.slice(0, 50).map(summarizeOperatorGroupMove), nextMoveId: rows.length > 50 ? rows[49]!.id : null,
    assignableTargetLines: lines.map(line => ({ lineLookupKey: line.phoneNumberLookupKey, lineHint: line.phoneNumberHint })),
    candidates: candidates.slice(0, 50), nextContainerRef: candidates.length > 50 ? candidates[49]!.containerRef : null };
}

async function readCandidates(sourceLineLookupKey: string, after: string | undefined, prisma: PrismaClient) {
  const phone = await readHostedLinqLinePhoneNumberByLookupKey({ phoneNumberLookupKey: sourceLineLookupKey, prisma });
  if (!phone) groupMoveError("SOURCE_LINE_UNAVAILABLE");
  const routes = await prisma.hostedThreadRoute.findMany({ where: { channel: "linq",
    accountLookupKey: { in: createHostedPhoneLookupKeyReadCandidates(phone) },
    ...(after ? { threadIdentityLookupKey: { gt: after } } : {}),
  }, orderBy: { threadIdentityLookupKey: "asc" }, take: 51, select: {
    threadIdentityLookupKey: true, containerMemberId: true,
    container: { select: { member: { select: {
      hostedMailboxItems: { where: { kind: "conversation.message" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      chatHostedGames: { where: { status: "live" }, take: 1, select: { id: true } },
    } } } },
  } });
  return routes.map(route => ({ containerRef: route.threadIdentityLookupKey, containerHint: route.containerMemberId.slice(-8),
    lastActivityAt: route.container.member.hostedMailboxItems[0]?.createdAt.toISOString() ?? null,
    hasLiveGame: route.container.member.chatHostedGames.length > 0 }));
}
