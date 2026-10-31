import "server-only";
import type { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isGameChangeExpired, parsePendingGameChange } from "./changes";
import { isGameInviteExpired, parseStoredTerms } from "./rules";
import { gamePairWhere, sameGamePlayers } from "./chat-membership";

/** Returns true only for the current proposal and proven audience; stale outbox work cannot announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  tx: { game: Pick<Prisma.TransactionClient["game"], "findFirst"> };
  now?: Date;
}): Promise<boolean> {
  const key = input.deliveryIdempotencyKey ?? "";
  const recap = /^game-recap:([^:]+)$/u.exec(key);
  if (recap) return assertGameRecapDeliveryCurrentTx(input, recap[1]);
  const missed = /^game-missed:([^:]+):([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(key);
  if (missed) return assertGameMissedDeliveryCurrentTx(input, missed[1], missed[2]);
  if (key.startsWith("game-cancelled:")) return assertGameCancelledDeliveryCurrentTx(input);
  if (key.startsWith("game-change-cancelled:") || key.startsWith("game-change-expired:")) return assertGameChangeResolvedDeliveryCurrentTx(input);
  const rematch = /^game-rematch:([^:]+)$/.exec(key);
  if (rematch) return assertGameRematchDeliveryCurrentTx(input, rematch[1]);
  const lifecycle = /^game-started:([^:]+)$/.exec(key);
  if (lifecycle) return assertGameStartedDeliveryCurrentTx(input, lifecycle[1]);
  if (!key.startsWith("game-change:")) return false;
  return assertGameChangeProposalDeliveryCurrentTx(input, key);
}

async function assertGameRecapDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const players = input.playerMemberIds ?? [];
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "settled" },
    include: { players: { take: 3 } },
  });
  if (!game || !sameGamePlayers(game.players.map((player) => player.memberId), players)) return stale();
  const current = await input.tx.game.findFirst({
    where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (current?.id !== gameId) return stale();
  return true;
}

async function assertGameMissedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, addressedMemberId: string,
): Promise<true> {
  const players = input.playerMemberIds ?? [];
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { players: { take: 3 } },
  });
  if (!game || !players.includes(addressedMemberId)
    || !sameGamePlayers(game.players.map((player) => player.memberId), players)) return stale();
  const current = await input.tx.game.findFirst({
    where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (current?.id !== gameId) return stale();
  return true;
}

async function assertGameChangeProposalDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string,
): Promise<true> {
  const match = /^game-change:([^:]+):([^:]+)$/.exec(key);
  if (!match) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: match[1], chatContainerMemberId: input.containerMemberId, status: { in: ["live", "negotiating"] } },
    include: { players: { take: 3 } },
  });
  const pending = parsePendingGameChange(game?.pendingChange);
  if (!game || isGameInviteExpired(game, input.now ?? new Date())
    || !pending || pending.id !== match[2] || game.players.length !== 2) return stale();
  if (!sameGamePlayers(game.players.map((player) => player.memberId), input.playerMemberIds ?? [])) return stale();
  const expired = game.status === "live" && isGameChangeExpired({
    entries: [],
    game: { id: game.id, createdBy: game.createdBy, status: "live", seats: 2, lengthDays: game.lengthDays, terms: parseStoredTerms(game.terms), inviteExpiresAt: game.inviteExpiresAt, startsOn: game.startsOn?.toISOString().slice(0, 10) ?? null },
    players: game.players.map((player) => ({ memberId: player.memberId, seat: player.seat, timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null })),
  }, pending, input.now ?? new Date());
  if (expired) stale();
  return true;
}

async function assertGameRematchDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "invited" },
    include: { players: { take: 2 } },
  });
  if (!game?.createdBy || !game.inviteeMemberId || game.players.length !== 1
    || isGameInviteExpired(game, input.now ?? new Date())
    || game.players[0]?.memberId !== game.createdBy
    || !sameGamePlayers([game.createdBy, game.inviteeMemberId], input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameCancelledDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const cancelled = /^game-cancelled:([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (!cancelled) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: cancelled[1], chatContainerMemberId: input.containerMemberId, status: "void",
      events: { some: { type: "cancelled" } } },
    include: { players: { take: 3 } },
  });
  if (!game || !sameGamePlayers(game.players.map((player) => player.memberId), input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameChangeResolvedDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const cancelled = /^game-change-(cancelled|expired):([^:]+):([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (!cancelled) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: cancelled[2], chatContainerMemberId: input.containerMemberId, status: { in: cancelled[1] === "expired" ? ["live", "negotiating", "settled", "void"] : ["live", "negotiating"] },
      events: { some: { type: `change_${cancelled[1]}`, commandKey: `game-change-resolved:${cancelled[2]}:${cancelled[3]}` } } },
    include: { players: { take: 3 } },
  });
  if (!game || !sameGamePlayers(game.players.map((player) => player.memberId), input.playerMemberIds ?? [])) return stale();
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
