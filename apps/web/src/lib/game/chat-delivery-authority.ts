import "server-only";
import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isGameChangeExpired, parsePendingGameChange } from "./changes";
import { parseStoredTerms } from "./rules";

/** Rechecked by the existing Linq pre-provider dispatch owner; stale outbox work must not announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  tx: { game: Pick<Prisma.TransactionClient["game"], "findFirst"> };
  now?: Date;
}): Promise<void> {
  if (!input.deliveryIdempotencyKey?.startsWith("game-change:")) return;
  const match = /^game-change:([^:]+):([^:]+)$/.exec(input.deliveryIdempotencyKey);
  if (!match) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: match[1], chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { players: { take: 3 } },
  });
  const pending = parsePendingGameChange(game?.pendingChange);
  if (!game || !pending || pending.id !== match[2] || game.players.length !== 2) return stale();
  if (input.playerMemberIds && !game.players.every((player) => input.playerMemberIds!.includes(player.memberId))) return stale();
  const expired = isGameChangeExpired({
    entries: [],
    game: { id: game.id, createdBy: game.createdBy, status: "live", seats: 2, lengthDays: game.lengthDays, terms: parseStoredTerms(game.terms), inviteExpiresAt: game.inviteExpiresAt, startsOn: game.startsOn?.toISOString().slice(0, 10) ?? null },
    players: game.players.map((player) => ({ memberId: player.memberId, seat: player.seat, timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null })),
  }, pending, input.now ?? new Date());
  if (expired) stale();
}
function stale(): never {
  throw hostedOnboardingError({ code: "GAME_CHANGE_SUPERSEDED", httpStatus: 409, message: "This proposed game change is no longer current.", retryable: false });
}
