import "server-only";
import type { Prisma } from "@prisma/client";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";

export type GameChatLifecycleKind = "started" | "rematch" | "change_cancelled" | "change_expired" | "cancelled" | "recap" | "missed";

export function gameChatLifecycleEventId(gameId: string, kind: GameChatLifecycleKind, proposalId?: string): string {
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
  now: Date;
  tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">;
}): Promise<void> {
  const key = createHostedLinqDeliveryIdempotencyLookupKey(gameChatLifecycleEventId(input.gameId, input.kind, input.proposalId));
  if (!key) throw new Error("Game lifecycle delivery identity is unavailable.");
  await input.tx.hostedLinqDelivery.createMany({
    data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
      source: "game_lifecycle", sourceRef: (input.kind === "change_cancelled" || input.kind === "change_expired") ? `${input.gameId}:${input.proposalId}` : input.gameId, template: `game_${input.kind}`,
      status: "awaiting_generation", targetKind: "thread", attemptedAt: input.now }],
    skipDuplicates: true,
  });
}

export function gameMissedDayEventId(gameId: string, memberId: string, firstMissedDate: string): string {
  return `game-missed:${gameId}:${memberId}:${firstMissedDate}`;
}

export async function reserveGameMissedDayTx(input: { gameId: string; memberId: string; firstMissedDate: string; dueAt: Date; tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery"> }): Promise<void> {
  const eventId = gameMissedDayEventId(input.gameId, input.memberId, input.firstMissedDate);
  const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId);
  if (!key) throw new Error("Game missed-day delivery identity is unavailable.");
  await input.tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
    source: "game_lifecycle", sourceRef: `${input.gameId}:${input.memberId}:${input.firstMissedDate}`, template: "game_missed",
    status: "awaiting_generation", targetKind: "thread", attemptedAt: input.dueAt, retryAfterAt: input.dueAt }], skipDuplicates: true });
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
