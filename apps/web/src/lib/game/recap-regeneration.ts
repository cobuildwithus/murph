import "server-only";
import { getPrisma } from "../prisma";
import { areGamePlayersBlocked, lockGamePair } from "./blocks";
import { sameGamePlayers } from "./chat-membership";
import { isGameOn } from "./access";
import { gameChatLifecycleEventId, reserveGameChatLifecycleTx } from "./chat-lifecycle-receipt";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

export interface GameRecapRegenerationRequest {
  gameId: string;
  regenerationId: string;
  execute: boolean;
}

/** Ops authentication belongs to the route. No provider, crypto or signal work here. */
export async function requestGameRecapRegeneration(input: GameRecapRegenerationRequest & { operatorMemberId: string }) {
  const prisma = getPrisma();
  const eventId = gameChatLifecycleEventId(input.gameId, "recap", undefined, input.regenerationId);
  const result = (outcome: string) => ({ gameId: input.gameId, regenerationId: input.regenerationId, eventId,
    dryRun: !input.execute, outcome });
  const seed = await prisma.game.findUnique({ where: { id: input.gameId }, select: { players: { select: { memberId: true }, take: 3 } } });
  const players = seed?.players.map((player) => player.memberId) ?? [];
  if (!sameGamePlayers(players, players)) return result("ineligible_roster");
  return prisma.$transaction(async (tx) => {
    await lockGamePair(tx, players[0]!, players[1]!);
    // Account deletion also owns this row before changing the roster or recap.
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: input.gameId }, select: {
      status: true, departedPlayer: true, chatContainerMemberId: true, recapEncrypted: true,
      players: { select: { memberId: true }, take: 3 },
    } });
    if (!game || !sameGamePlayers(game.players.map((player) => player.memberId), players)) return result("ineligible_roster");
    if (game.status !== "settled") return result("not_settled");
    if (game.departedPlayer !== null) return result("player_departed");
    if (!isGameOn(game)) return result("game_disabled");
    if (!game.chatContainerMemberId) return result("chat_unavailable");
    if (await areGamePlayersBlocked(tx, players[0]!, players[1]!)) return result("players_blocked");
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: eventId }, select: { id: true } });
    if (prior) return result("already_requested");
    if (!game.recapEncrypted) return result("recap_unavailable");
    const latest = await tx.gameEvent.findFirst({ where: { gameId: input.gameId, type: "recap_regeneration_requested" },
      orderBy: { id: "desc" }, select: { commandKey: true } });
    // Do not overlap generations or replace the story while its delivery is
    // uncertain. Accepted/delivered receipts already own their provider identity.
    const key = createHostedLinqDeliveryIdempotencyLookupKey(latest?.commandKey ?? gameChatLifecycleEventId(input.gameId, "recap"));
    const delivery = key ? await tx.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key }, select: { status: true } }) : null;
    if (delivery && !["accepted", "delivered", "read", "skipped"].includes(delivery.status)) return result("delivery_pending");
    if (latest && !delivery) return result("delivery_unavailable");
    if (!input.execute) return result("would_regenerate");
    await tx.gameEvent.create({ data: { gameId: input.gameId, actor: input.operatorMemberId,
      type: "recap_regeneration_requested", commandKey: eventId, payload: {} } });
    await reserveGameChatLifecycleTx({ gameId: input.gameId, kind: "recap", regenerationId: input.regenerationId, now: new Date(), tx });
    return result("reserved");
  });
}
