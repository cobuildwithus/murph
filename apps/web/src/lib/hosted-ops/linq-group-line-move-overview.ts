import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { createHostedPhoneLookupKeyReadCandidates } from "../hosted-onboarding/contact-privacy";
import { readHostedLinqLinePhoneNumberByLookupKey } from "../hosted-onboarding/linq-line-phone-resolver";
import { listHostedLinqAssignableHomeLines } from "../hosted-onboarding/linq-line-store";
import { openHostedThreadDeliveryRoute } from "../hosted-routing/thread-delivery-route";
import { groupMoveError, groupMoveOperatorSelect, summarizeOperatorGroupMove } from "./linq-group-line-move-state";

export async function readHostedLinqGroupLineMoveOverview(input: {
  status?: "reserved" | "adopted" | "left" | "cancelled";
  sourceLineLookupKey?: string; afterMoveId?: string; afterContainerRef?: string; prisma?: PrismaClient;
}) {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedLinqGroupLineMove.findMany({ where: { status: input.status,
    ...(input.afterMoveId ? { id: { gt: input.afterMoveId } } : {}) }, orderBy: { id: "asc" }, take: 51, select: groupMoveOperatorSelect });
  const lines = await listHostedLinqAssignableHomeLines({ prisma });
  const page = input.sourceLineLookupKey ? await readCandidates(input.sourceLineLookupKey, input.afterContainerRef, prisma) : { candidates: [], unresolvedCandidates: [], nextContainerRef: null };
  return { moves: rows.slice(0, 50).map(summarizeOperatorGroupMove), nextMoveId: rows.length > 50 ? rows[49]!.id : null,
    assignableTargetLines: lines.map(line => ({ lineLookupKey: line.phoneNumberLookupKey, lineHint: line.phoneNumberHint })),
    ...page };
}

async function readCandidates(sourceLineLookupKey: string, after: string | undefined, prisma: PrismaClient) {
  const phone = await readHostedLinqLinePhoneNumberByLookupKey({ phoneNumberLookupKey: sourceLineLookupKey, prisma });
  if (!phone) groupMoveError("SOURCE_LINE_UNAVAILABLE");
  const keys = createHostedPhoneLookupKeyReadCandidates(phone);
  const routes = await prisma.hostedThreadRoute.findMany({ where: { channel: "linq",
    OR: [{ accountLookupKey: { in: keys } }, { accountLookupKey: null }],
    ...(after ? { threadIdentityLookupKey: { gt: after } } : {}),
  }, orderBy: { threadIdentityLookupKey: "asc" }, take: 51, select: {
    threadIdentityLookupKey: true, containerMemberId: true, accountLookupKey: true, deliveryRouteEncrypted: true,
    container: { select: { member: { select: {
      hostedMailboxItems: { where: { kind: "conversation.message" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      chatHostedGames: { where: { status: "live" }, take: 1, select: { id: true } },
    } } } },
  } });
  const candidates = [];
  const unresolvedCandidates = [];
  for (const route of routes.slice(0, 50)) {
    if (route.deliveryRouteEncrypted === null) {
      unresolvedCandidates.push({ containerRef: route.threadIdentityLookupKey,
        containerHint: route.containerMemberId.slice(-8), code: "delivery_route_missing" });
      continue;
    }
    let account = route.accountLookupKey;
    if (account === null) {
      const sealed = await openHostedThreadDeliveryRoute({ channel: "linq", containerMemberId: route.containerMemberId,
        encrypted: route.deliveryRouteEncrypted, prisma });
      if (sealed.channel !== "linq") groupMoveError("ROUTE_CHANGED");
      account = sealed.accountLookupKey;
    }
    if (!account || !keys.includes(account)) continue;
    candidates.push({ containerRef: route.threadIdentityLookupKey, containerHint: route.containerMemberId.slice(-8),
      lastActivityAt: route.container.member.hostedMailboxItems[0]?.createdAt.toISOString() ?? null,
      hasLiveGame: route.container.member.chatHostedGames.length > 0 });
  }
  return { candidates, unresolvedCandidates, nextContainerRef: routes.length > 50 ? routes[49]!.threadIdentityLookupKey : null };
}
