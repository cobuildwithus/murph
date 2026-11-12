import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getHostedLinqChatSummary, listHostedLinqGroupMoveChats } from "../hosted-onboarding/linq-client";
import { hostedLinqGroupMoveAudience, prepareVerifiedHostedLinqGroupMoveAdoption } from "../hosted-routing/linq-group-line-move-ingress";
import { type HostedLinqGroupMoveCleanup, linqGroupMoveSelect } from "../hosted-routing/linq-group-line-move-store";
import { replaceHostedLinqGroupLineMoveRouteTx } from "../hosted-routing/thread-container-service";
import { groupMoveError, groupMoveHasPhone, readGroupMoveRoster, type OperatorGroupMove } from "./linq-group-line-move-state";

/** Discover without sending a message; incomplete or ambiguous inventory grants no authority. */
export async function adoptDiscoveredHostedLinqGroupMove(input: {
  move: OperatorGroupMove; cleanup: HostedLinqGroupMoveCleanup; prisma: PrismaClient;
}) {
  const { move, cleanup, prisma } = input;
  if (!move.addStartedAt || !move.addConfirmedAt) groupMoveError("ADD_NOT_CONFIRMED");
  if (move.adoptionDeadlineAt.getTime() <= Date.now()) groupMoveError("ADOPTION_DEADLINE_ELAPSED");
  const source = await readGroupMoveRoster(cleanup);
  if (!groupMoveHasPhone(source, cleanup.sourcePhone) || !groupMoveHasPhone(source, cleanup.targetPhone)) groupMoveError("ROSTER_MISMATCH");
  const audience = hostedLinqGroupMoveAudience(source, cleanup);
  if (!audience?.length) groupMoveError("ROSTER_UNAVAILABLE");
  const inventory = await listHostedLinqGroupMoveChats({ from: cleanup.targetPhone, to: cleanup.sourcePhone });
  if (!inventory.complete) groupMoveError("DISCOVERY_INCOMPLETE");
  const matches = inventory.chats.filter(chat => {
    const createdAt = Date.parse(chat.createdAt);
    return chat.id !== cleanup.sourceChatId && createdAt >= move.addStartedAt!.getTime() && createdAt <= Date.now()
      && chat.roster.service?.toLowerCase() === "imessage"
      && groupMoveHasPhone(chat.roster, cleanup.sourcePhone) && groupMoveHasPhone(chat.roster, cleanup.targetPhone)
      && JSON.stringify(hostedLinqGroupMoveAudience(chat.roster, cleanup)) === JSON.stringify(audience);
  });
  if (matches.length !== 1) groupMoveError(matches.length ? "DISCOVERY_AMBIGUOUS" : "DISCOVERY_PENDING");
  const candidate = matches[0]!;
  const roster = await getHostedLinqChatSummary({ chatId: candidate.id, timeoutMs: 3_000 });
  // Use the canonical projection so the route writer's exact-row comparison also
  // protects against concurrent cancellation, source fallback and webhook adoption.
  const current = await prisma.hostedLinqGroupLineMove.findUniqueOrThrow({ where: { id: move.id }, select: linqGroupMoveSelect });
  const prepared = await prepareVerifiedHostedLinqGroupMoveAdoption({ threadId: candidate.id, prisma, move: current, cleanup, candidate: roster });
  if (!prepared) groupMoveError("ROSTER_MISMATCH");
  await prisma.$transaction(tx => replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma: tx }));
}
