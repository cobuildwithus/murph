import { lockGamePair } from "./blocks";
import { gamePairWhere } from "./chat-membership";
import { GAME_MAX_OPEN_PER_PAIR } from "./rules";
import "server-only";
import { Prisma } from "@prisma/client";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

export type GameChatLifecycleKind = "started" | "rematch" | "change_cancelled" | "change_expired" | "cancelled" | "recap" | "missed";

export function gameChatLifecycleEventId(gameId: string, kind: GameChatLifecycleKind, proposalId?: string, regenerationId?: string): string {
  if (kind === "recap" && regenerationId) return `game-recap:${gameId}:${regenerationId}`;
  if (kind === "missed") throw new Error("Missed-day lifecycle identity requires the player and first date.");
  if (kind === "change_cancelled" || kind === "change_expired") {
    if (!proposalId) throw new Error("Game change resolution requires its proposal identity.");
    return `game-${kind.replace("_", "-")}:${gameId}:${proposalId}`;
  }
  return `game-${kind}:${gameId}`;
}

/** Durable acceptance intent, before any model, route discovery or provider work. */
export async function reserveGameChatLifecycleTx(input: {
  gameId: string;
  kind: GameChatLifecycleKind;
  proposalId?: string;
  regenerationId?: string;
  now: Date;
  tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">;
}): Promise<void> {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(gameChatLifecycleEventId(input.gameId, input.kind, input.proposalId, input.regenerationId));
  if (!key) throw new Error("Game lifecycle delivery identity is unavailable.");
  await input.tx.hostedLinqDelivery.createMany({
    data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
      source: "game_lifecycle", sourceRef: (input.kind === "change_cancelled" || input.kind === "change_expired") ? `${input.gameId}:${input.proposalId}` : input.regenerationId ? `${input.gameId}:${input.regenerationId}` : input.gameId, template: `game_${input.kind}`,
      status: "awaiting_generation", targetKind: "thread", attemptedAt: input.now }],
    skipDuplicates: true,
  });
}

export function gameMissedDayEventId(gameId: string, memberId: string, firstMissedDate: string): string {
  return `game-missed:${gameId}:${memberId}:${firstMissedDate}`;
}

/** Existing receipts deduplicate one pair/day batch, including concurrent sweeps. */
export async function reserveGameMissedDayTx(input: {
  gameId: string; memberId: string; playerMemberIds: readonly string[]; firstMissedDate: string; dueAt: Date; tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const { tx, playerMemberIds: players } = input;
  if (players.length !== 2) return false;
  await lockGamePair(tx, players[0]!, players[1]!);
  const active = await tx.game.findMany({ where: { ...gamePairWhere(players), status: "live" }, select: { id: true }, take: GAME_MAX_OPEN_PER_PAIR });
  const current = await tx.game.findFirst({ where: { id: input.gameId, status: "live", chatContainerMemberId: { not: null } }, select: { chatContainerMemberId: true } });
  if (!current?.chatContainerMemberId) return false;
  // Read through the existing room-owner index, not all delivery history.
  // Keep the single-game identity. With several games, either
  // player's first due miss claims the pair's one daily message.
  const prior = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT receipt.id FROM hosted_linq_delivery receipt
    JOIN game_player first_player ON first_player.game_id = split_part(receipt.source_ref, ':', 1)
    WHERE receipt.payload_owner_member_id = ${current.chatContainerMemberId}
      AND receipt.source = 'game_lifecycle' AND receipt.template = 'game_missed'
      AND first_player.member_id = ${players[0]}
      AND EXISTS (SELECT 1 FROM game_player second_player
        WHERE second_player.game_id = first_player.game_id AND second_player.member_id = ${players[1]})
      AND split_part(receipt.source_ref, ':', 3) = ${input.firstMissedDate}
      AND (${active.length > 1} OR split_part(receipt.source_ref, ':', 2) = ${input.memberId})
    LIMIT 1`);
  if (prior.length) return false;
  const eventId = gameMissedDayEventId(input.gameId, input.memberId, input.firstMissedDate);
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!key) throw new Error("Game missed-day delivery identity is unavailable.");
  const created = await input.tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
    source: "game_lifecycle", sourceRef: `${input.gameId}:${input.memberId}:${input.firstMissedDate}`, template: "game_missed",
    status: "awaiting_generation", targetKind: "thread", payloadOwnerMemberId: current.chatContainerMemberId, attemptedAt: input.dueAt, retryAfterAt: input.dueAt }], skipDuplicates: true });
  return created.count === 1;
}

/** App proposals, including invite negotiation, own one ordinary proposal send. */
export async function reserveGameChatProposalTx(input: {
  gameId: string; proposalId: string; now: Date;
  tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">;
}): Promise<void> {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${input.gameId}:${input.proposalId}`);
  if (!key) throw new Error("Game proposal delivery identity is unavailable.");
  await input.tx.hostedLinqDelivery.createMany({
    data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
      source: "game_lifecycle", sourceRef: input.gameId, template: "game_proposal",
      status: "awaiting_generation", targetKind: "thread", attemptedAt: input.now }],
    skipDuplicates: true,
  });
}

/** Queue publication and this transition share the notification's transaction. */
export async function markGameChatGenerationQueuedTx(eventId: string, tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">, containerMemberId?: string): Promise<void> {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!key) throw new Error("Game lifecycle delivery identity is unavailable.");
  const changed = await tx.hostedLinqDelivery.updateMany({
    where: { idempotencyKey: key, source: "game_lifecycle", status: "awaiting_generation" },
    data: { status: "generation_queued", retryAfterAt: new Date(Date.now() + 60_000), ...(containerMemberId ? { payloadOwnerMemberId: containerMemberId } : {}) },
  });
  if (containerMemberId && changed.count !== 1) {
    const existing = await tx.hostedLinqDelivery.count({ where: { idempotencyKey: key, source: "game_lifecycle", status: "generation_queued", payloadOwnerMemberId: containerMemberId } });
    if (existing !== 1) throw new Error("Game chat lifecycle requires its pending lifecycle receipt.");
  }
}

/**
 * A block ends the pair's game chat: nothing still waiting to be sent there
 * about these games goes out, including a new chat not yet set up.
 */
export async function skipGameChatLifecycleTx(tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">, gameIds: readonly string[], now: Date): Promise<void> {
  if (gameIds.length === 0) return;
  await tx.hostedLinqDelivery.updateMany({
    data: { retryAfterAt: null, skipReason: "game_blocked", skippedAt: now, status: "skipped" },
    where: { source: "game_lifecycle", skippedAt: null, status: { in: ["awaiting_generation", "generation_queued"] },
      OR: [{ sourceRef: { in: [...gameIds] } }, ...gameIds.map((gameId) => ({ sourceRef: { startsWith: `${gameId}:` } }))] },
  });
}
