import "server-only";
import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isGameChangeExpired, parsePendingGameChange } from "./changes";
import { parseStoredTerms } from "./rules";
import { sameGamePlayers } from "./chat-membership";

/** Returns true only for the current proposal and proven audience; stale outbox work cannot announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  tx: { game: Pick<Prisma.TransactionClient["game"], "findFirst"> };
  now?: Date;
}): Promise<boolean> {
  const lifecycle = /^game-started:([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (lifecycle) return assertGameStartedDeliveryCurrentTx(input, lifecycle[1]);
  if (!input.deliveryIdempotencyKey?.startsWith("game-change:")) return false;
  const match = /^game-change:([^:]+):([^:]+)$/.exec(input.deliveryIdempotencyKey);
  if (!match) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: match[1], chatContainerMemberId: input.containerMemberId, status: { in: ["live", "negotiating"] } },
    include: { players: { take: 3 } },
  });
  const pending = parsePendingGameChange(game?.pendingChange);
  if (!game || !pending || pending.id !== match[2] || game.players.length !== 2) return stale();
  if (!sameGamePlayers(game.players.map((player) => player.memberId), input.playerMemberIds ?? [])) return stale();
  const expired = game.status === "live" && isGameChangeExpired({
    entries: [],
    game: { id: game.id, createdBy: game.createdBy, status: "live", seats: 2, lengthDays: game.lengthDays, terms: parseStoredTerms(game.terms), inviteExpiresAt: game.inviteExpiresAt, startsOn: game.startsOn?.toISOString().slice(0, 10) ?? null },
    players: game.players.map((player) => ({ memberId: player.memberId, seat: player.seat, timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null })),
  }, pending, input.now ?? new Date());
  if (expired) stale();
  return true;
}
async function assertGameStartedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { players: { take: 3 } },
  });
  if (!game || !sameGamePlayers(game.players.map((player) => player.memberId), input.playerMemberIds ?? [])) return stale();
  return true;
}

function stale(): never {
  throw hostedOnboardingError({ code: "GAME_CHANGE_SUPERSEDED", httpStatus: 409, message: "This proposed game change is no longer current.", retryable: false });
}
