import "server-only";

import { groupGameRecapPlayers } from "./recap-cohort";
import { readCurrentGameTalk, type GameNoticeAudience } from "./talk";

import { isPairRoster } from "./roster";
import { parseGameRecapEventId } from "@murphai/hosted-execution/runtime-control";
import { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { gameResolutionNoticeKind, parseGameResolutionNotice, readGameChangeResolution } from "./change-resolution";
import { isGameInviteExpired } from "./rules";
import { readGroupGameChatAuthority, sameGamePlayers } from "./chat-membership";

/** Returns true only for the current proposal and proven audience; stale outbox work cannot announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  audience?: GameNoticeAudience;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<boolean> {
  const key = input.deliveryIdempotencyKey ?? "";
  if (key.startsWith("game-talk:")) return assertGameTalkDeliveryCurrentTx(input, key);
  if (key.startsWith("game-challenge:")) return assertGameChallengeDeliveryCurrentTx(input, key);
  const recap = parseGameRecapEventId(key);
  if (recap) return assertGameRecapDeliveryCurrentTx(input, recap.gameId, recap.regenerationId);
  if (key.startsWith("game-recap:")) return stale();
  const missed = /^game-missed:([^:]+):([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(key);
  if (missed) return assertGameMissedDeliveryCurrentTx(input, missed[1], missed[2]);
  if (key.startsWith("game-cancelled:")) return assertGameCancelledDeliveryCurrentTx(input);
  if (key.startsWith("game-change-cancelled:") || key.startsWith("game-change-expired:") || key.startsWith("game-change-resolved:")) return assertGameChangeResolvedDeliveryCurrentTx(input);
  const rematch = /^game-rematch:([^:]+)$/.exec(key);
  if (rematch) return assertGameRematchDeliveryCurrentTx(input, rematch[1]);
  const lifecycle = /^game-started:([^:]+)$/.exec(key);
  if (lifecycle) return assertGameStartedDeliveryCurrentTx(input, lifecycle[1]);
  if (!key.startsWith("game-change:")) return false;
  return assertGameChangeProposalDeliveryCurrentTx(input, key);
}

async function assertGameTalkDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const match = /^game-talk:([^:]+):([^:]+)$/u.exec(key);
  if (!match) return stale();
  await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${match[1]} FOR UPDATE`;
  const candidate = await input.tx.game.findUnique({ where: { id: match[1] }, select: { maxPlayers: true } });
  if (candidate?.maxPlayers === 10 && !input.audience) return stale();
  const current = await readCurrentGameTalk(input.tx, match[1], match[2], input.now ?? new Date(), input.audience);
  if (!current || current.game.chatContainerMemberId !== input.containerMemberId
    || current.game.maxPlayers !== 10 && !sameGamePlayers(current.game.players.map(player => player.memberId), input.playerMemberIds ?? [])) return stale();
  return true;
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
    || (current.row.maxPlayers !== 10 && !isPairRoster(players)) || !players.includes(current.challenge.actor) || !entry || entry.memberId === current.challenge.actor
    || !players.includes(entry.memberId) || entry.incomplete
    || !await deliveryAudienceCurrent(input, current.row, input.playerMemberIds ?? [])) return stale();
  return true;
}

async function assertGameRecapDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, regenerationId?: string,
): Promise<true> {
  const players = input.playerMemberIds ?? [];
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "settled", OR: [{ maxPlayers: 10 }, { maxPlayers: 2, players: { none: { leftAt: { not: null } } } }],
      ...(regenerationId ? { events: { some: { commandKey: `${input.deliveryIdempotencyKey}:accepted`, type: "recap_regeneration_accepted" } } } : {}) },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || game.maxPlayers === 10 && !groupGameRecapPlayers(game) || !await deliveryAudienceCurrent(input, game, players)) return stale();
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
  // The caller retains this lock through the provider dispatch-fence commit.
  await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${match[1]} FOR UPDATE`;
  const { readCurrentGameChange } = await import("./service");
  const current = await readCurrentGameChange(input.tx, match[1], match[2], input.now ?? new Date());
  if (!current || current.row.chatContainerMemberId !== input.containerMemberId
    || !await deliveryAudienceCurrent(input, current.row, input.playerMemberIds ?? [])) return stale();
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
  const notice = parseGameResolutionNotice(input.deliveryIdempotencyKey ?? "");
  if (!notice) return stale();
  const resolution = await readGameChangeResolution(input.tx, notice.gameId, notice.proposalId);
  if (!resolution || gameResolutionNoticeKind(resolution.outcome) !== notice.kind
    || resolution.game.chatContainerMemberId !== input.containerMemberId
    || !await deliveryAudienceCurrent(input, resolution.game, input.playerMemberIds ?? [])) return stale();
  return true;
}
async function assertGameStartedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || game.maxPlayers === 10 && game.players.some(player => player.leftAt)
    || !await deliveryAudienceCurrent(input, game, input.playerMemberIds ?? [])) return stale();
  return true;
}

function stale(): never {
  throw hostedOnboardingError({ code: "GAME_CHANGE_SUPERSEDED", httpStatus: 409, message: "This proposed game change is no longer current.", retryable: false });
}

async function deliveryAudienceCurrent(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], game: Parameters<typeof readGroupGameChatAuthority>[0], players: readonly string[]): Promise<boolean> {
  if (game.maxPlayers !== 10) return sameGamePlayers(game.players.map(player => player.memberId), players);
  return Boolean(input.audience && await readGroupGameChatAuthority(game, input.containerMemberId, input.audience, input.tx));
}
