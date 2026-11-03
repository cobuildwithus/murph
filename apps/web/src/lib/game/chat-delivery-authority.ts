import "server-only";

import { isPairRoster, hasGameIdentity } from "./roster";
import { parseGameRecapEventId } from "@murphai/hosted-execution/runtime-control";
import { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isGameChangeExpired, parsePendingGameChange } from "./changes";
import { isGameInviteExpired, parseStoredTerms } from "./rules";
import { readGroupGameChatAuthority, type GameChatAudience, sameGamePlayers } from "./chat-membership";

/** Returns true only for the current proposal and proven audience; stale outbox work cannot announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  audience?: GameChatAudience;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<boolean> {
  const key = input.deliveryIdempotencyKey ?? "";
  if (key.startsWith("game-challenge:")) return assertGameChallengeDeliveryCurrentTx(input, key);
  const recap = parseGameRecapEventId(key);
  if (recap) return assertGameRecapDeliveryCurrentTx(input, recap.gameId, recap.regenerationId);
  if (key.startsWith("game-recap:")) return stale();
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

async function assertGameChallengeDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const match = /^game-challenge:([^:]+):([^:]+)$/u.exec(key);
  if (!match) return stale();
  // Serialize the claim with concessions, retakes, withdrawal and game end.
  await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${match[1]} FOR UPDATE`;
  const { readGameChallengeCase } = await import("./service");
  const current = await readGameChallengeCase(input.tx, match[1], match[2], input.now ?? new Date());
  const players = current?.state.players.filter(player => !player.leftAt).map(player => player.memberId) ?? [];
  const entry = current?.state.entries.find(entry => entry.id === match[2]);
  if (!current || current.status !== "open" || current.row.chatContainerMemberId !== input.containerMemberId
    || !isPairRoster(players) || !players.includes(current.challenge.actor) || !entry || entry.memberId === current.challenge.actor
    || !players.includes(entry.memberId) || !sameGamePlayers(players, input.playerMemberIds ?? [])) return stale();
  return true;
}

async function assertGameRecapDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, regenerationId?: string,
): Promise<true> {
  const players = input.playerMemberIds ?? [];
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "settled", players: { none: { leftAt: { not: null } } },
      ...(regenerationId ? { events: { some: { commandKey: `${input.deliveryIdempotencyKey}:accepted`, type: "recap_regeneration_accepted" } } } : {}) },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !await deliveryAudienceCurrent(input, game, players)) return stale();
  if (game.maxPlayers === 10 && await input.tx.gameReport?.findFirst({ where: { gameId }, select: { id: true } })) return stale();
  return true;
}

async function assertGameMissedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, addressedMemberId: string,
): Promise<true> {
  const players = input.playerMemberIds ?? [];
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || game.maxPlayers === 10 || !players.includes(addressedMemberId)
    || !await deliveryAudienceCurrent(input, game, players)) return stale();
  return true;
}

async function assertGameChangeProposalDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string,
): Promise<true> {
  const match = /^game-change:([^:]+):([^:]+)$/.exec(key);
  if (!match) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: match[1], chatContainerMemberId: input.containerMemberId, status: { in: ["live", "negotiating"] } },
    include: { invitees: true, players: { take: 11 } },
  });
  const pending = parsePendingGameChange(game?.pendingChange);
  if (!game || isGameInviteExpired(game, input.now ?? new Date())
    || !pending || pending.id !== match[2] || !isPairRoster(game.players)) return stale();
  if (!await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
  const expired = game.status === "live" && isGameChangeExpired({
    entries: [],
    game: { id: game.id, createdBy: game.createdBy, status: "live", seats: 2, lengthDays: game.lengthDays, terms: parseStoredTerms(game.terms), inviteExpiresAt: game.inviteExpiresAt, startsOn: game.startsOn?.toISOString().slice(0, 10) ?? null },
    players: game.players.filter(hasGameIdentity).map((player) => ({ memberId: player.memberId, seat: player.seat, timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null })),
  }, pending, input.now ?? new Date());
  if (expired) stale();
  return true;
}

async function assertGameRematchDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "invited" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (game?.maxPlayers === 10) {
    if (!await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
    return true;
  }
  if (!game?.createdBy || !game.invitees[0]?.memberId || game.players.length !== 1
    || isGameInviteExpired(game, input.now ?? new Date())
    || game.players[0]?.memberId !== game.createdBy
    || !sameGamePlayers([game.createdBy, game.invitees[0]?.memberId], input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameCancelledDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const cancelled = /^game-cancelled:([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (!cancelled) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: cancelled[1], chatContainerMemberId: input.containerMemberId, status: "void",
      events: { some: { type: "cancelled" } } },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameChangeResolvedDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const cancelled = /^game-change-(cancelled|expired):([^:]+):([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (!cancelled) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: cancelled[2], chatContainerMemberId: input.containerMemberId, status: { in: cancelled[1] === "expired" ? ["live", "negotiating", "settled", "void"] : ["live", "negotiating"] },
      events: { some: { type: `change_${cancelled[1]}`, commandKey: `game-change-resolved:${cancelled[2]}:${cancelled[3]}` } } },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameStartedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
  return true;
}

function stale(): never {
  throw hostedOnboardingError({ code: "GAME_CHANGE_SUPERSEDED", httpStatus: 409, message: "This proposed game change is no longer current.", retryable: false });
}

async function deliveryAudienceCurrent(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], game: Parameters<typeof readGroupGameChatAuthority>[0], players: readonly string[]): Promise<boolean> {
  if (game.maxPlayers !== 10) return sameGamePlayers(game.players.map(player => player.memberId), players);
  return Boolean(input.audience && await readGroupGameChatAuthority(game, input.containerMemberId, input.audience, input.tx));
}
