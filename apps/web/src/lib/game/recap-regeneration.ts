import "server-only";
import { groupGameRecapPlayers } from "./recap-cohort";
import { getPrisma } from "../prisma";
import { lockGamePair } from "./blocks";
import { hasGameChatBlock, sameGamePlayers } from "./chat-membership";
import { isGameOn } from "./access";
import { gameChatLifecycleEventId, reserveGameChatLifecycleTx } from "./chat-lifecycle-receipt";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

export interface GameRecapRegenerationRequest {
  gameId: string;
  regenerationId: string;
  execute: boolean;
}

type RecapRoster = { maxPlayers: number; settledAt: Date | null; status: string;
  players: Array<{ memberId: string | null; leftAt: Date | null }> };

function recapRosterRefusal(game: RecapRoster | null, expected: readonly string[]): string | null {
  if (!game) return "ineligible_roster";
  if (game.maxPlayers === 10 && game.status !== "settled") return "not_settled";
  const players = game.maxPlayers === 10 ? groupGameRecapPlayers(game) : game.players;
  if (game.maxPlayers === 10 && !players) return "player_departed";
  if (!sameGamePlayers(players?.map(player => player.memberId) ?? [], expected)) return "ineligible_roster";
  if (game.status !== "settled") return "not_settled";
  if (game.maxPlayers !== 10 && game.players.some(player => player.leftAt !== null)) return "player_departed";
  return null;
}

/** Ops authentication belongs to the route. No provider, crypto or signal work here. */
export async function requestGameRecapRegeneration(input: GameRecapRegenerationRequest & { operatorMemberId: string }) {
  const prisma = getPrisma();
  const eventId = gameChatLifecycleEventId(input.gameId, "recap", undefined, input.regenerationId);
  const result = (outcome: string) => ({ gameId: input.gameId, regenerationId: input.regenerationId, eventId,
    dryRun: !input.execute, outcome });
  const seed = await prisma.game.findUnique({ where: { id: input.gameId }, select: { maxPlayers: true, settledAt: true, status: true, players: { select: { memberId: true, leftAt: true }, take: 11 } } });
  if (seed?.maxPlayers === 10 && seed.status !== "settled") return result("not_settled");
  const cohort = seed?.maxPlayers === 10 ? groupGameRecapPlayers(seed) : seed?.players;
  if (seed?.maxPlayers === 10 && !cohort) return result("player_departed");
  const players = cohort?.map(player => player.memberId) ?? [];
  if (!sameGamePlayers(players, players)) return result("ineligible_roster");
  return prisma.$transaction(async (tx) => {
    if (seed?.maxPlayers !== 10) await lockGamePair(tx, players[0]!, players[1]!);
    // Account deletion also owns this row before changing the roster or recap.
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: input.gameId }, select: {
      maxPlayers: true, settledAt: true, status: true, chatContainerMemberId: true, recapEncrypted: true,
      players: { select: { memberId: true, leftAt: true }, take: 11 },
    } });
    const refusal = recapRosterRefusal(game, players);
    if (!game || refusal) return result(refusal ?? "ineligible_roster");
    if (!isGameOn(game)) return result("game_disabled");
    if (!game.chatContainerMemberId) return result("chat_unavailable");
    if (await hasGameChatBlock(tx, game.players.flatMap(player => player.memberId ? [player.memberId] : []))) return result("players_blocked");
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: eventId }, select: { id: true } });
    if (prior) return result("already_requested");
    if (!game.recapEncrypted) return result("recap_unavailable");
    const latest = await tx.gameEvent.findFirst({ where: { gameId: input.gameId, type: "recap_regeneration_requested" },
      orderBy: { id: "desc" }, select: { commandKey: true } });
    // Do not overlap generations or replace the story while its delivery is
    // uncertain. Accepted/delivered receipts already own their provider identity.
    const key = createHostedLinqDeliveryIdempotencyLookupKey(latest?.commandKey ?? gameChatLifecycleEventId(input.gameId, "recap"));
    const delivery = key ? await tx.hostedLinqDelivery.findUnique({ where: { idempotencyKey: key }, select: { status: true } }) : null;
    if (delivery && !["accepted", "delivered", "read", "sent_no_receipt_expected", "skipped"].includes(delivery.status)) return result("delivery_pending");
    if (latest && !delivery) return result("delivery_unavailable");
    if (!input.execute) return result("would_regenerate");
    await tx.gameEvent.create({ data: { gameId: input.gameId, actor: input.operatorMemberId,
      type: "recap_regeneration_requested", commandKey: eventId, payload: {} } });
    await reserveGameChatLifecycleTx({ gameId: input.gameId, kind: "recap", regenerationId: input.regenerationId, now: new Date(), tx });
    return result("reserved");
  });
}
