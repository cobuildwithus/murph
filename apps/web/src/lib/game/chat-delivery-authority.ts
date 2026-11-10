import "server-only";
import { readGameRecapEntryIdsTx } from "./recap-witness";

import { groupGameRecapPlayers } from "./recap-cohort";
import { readCurrentGameTalk, type GameNoticeAudience } from "./talk";

import { isPairRoster } from "./roster";
import { parseGameRecapEventId } from "@murphai/hosted-execution/runtime-control";
import { Prisma } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { gameResolutionNoticeKind, parseGameResolutionNotice, readGameChangeResolution } from "./change-resolution";
import { currentTerms, isGameInviteExpired, parseStoredTerms } from "./rules";
import { readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { GameChatAudienceError, readGroupGameNoticeAuthority, sameGamePlayers } from "./chat-membership";
import type { HostedGameEveningCheckInPolicy, HostedGameGroupMissedCheckInPolicy, HostedGamePrivateEveningCheckInPolicy, HostedGamePrivateKickoffPolicy } from "@murphai/hosted-execution/runtime-control";
import { isGroupMissedDayBatchCurrentTx } from "./group-missed-day";
import { isEveningBatchCurrentTx } from "./evening-check-in";
import { isPrivateEveningCurrentTx } from "./private-notification";
import { isPrivateKickoffCurrentTx } from "./private-kickoff";
import { isMissedCheckInExpired } from "./missed-check-in";

/** Returns true only for the current proposal and proven audience; stale outbox work cannot announce a replaced edit. */
export async function assertGameProposalDeliveryCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  containerMemberId: string;
  playerMemberIds?: readonly string[];
  audience?: GameNoticeAudience;
  rematchTermsVersion?: number | null;
  groupMissedPolicy?: HostedGameGroupMissedCheckInPolicy;
  eveningPolicy?: HostedGameEveningCheckInPolicy;
  privateEveningPolicy?: HostedGamePrivateEveningCheckInPolicy;
  privateKickoffPolicy?: HostedGamePrivateKickoffPolicy;
  tx: Prisma.TransactionClient;
  now?: Date;
}): Promise<boolean> {
  const key = input.deliveryIdempotencyKey ?? "";
  if (key.startsWith("game-talk:")) return assertGameTalkDeliveryCurrentTx(input, key);
  if (key.startsWith("game-challenge:")) return assertGameChallengeDeliveryCurrentTx(input, key);
  const recap = parseGameRecapEventId(key);
  if (recap) return assertGameRecapDeliveryCurrentTx(input, recap.gameId, recap.regenerationId);
  if (key.startsWith("game-recap:")) return stale();
  if (key.startsWith("game-missed:")) return assertGameMissedEventDeliveryCurrentTx(input, key);
  if (key.startsWith("game-evening:")) return assertGameEveningDeliveryCurrentTx(input, key);
  if (key.startsWith("game-evening-private:")) return assertPrivateEveningDeliveryCurrentTx(input, key);
  if (key.startsWith("game-dm:")) return assertPrivateKickoffDeliveryCurrentTx(input, key);
  if (key.startsWith("game-cancelled:")) return assertGameCancelledDeliveryCurrentTx(input);
  if (key.startsWith("game-change-cancelled:") || key.startsWith("game-change-expired:") || key.startsWith("game-change-resolved:")) return assertGameChangeResolvedDeliveryCurrentTx(input);
  const rematch = /^game-rematch:([^:]+)$/.exec(key);
  if (rematch) return assertGameRematchDeliveryCurrentTx(input, rematch[1]);
  if (key.startsWith("game-rematch:")) return stale();
  const lifecycle = /^game-started:([^:]+)$/.exec(key);
  if (lifecycle) return assertGameStartedDeliveryCurrentTx(input, lifecycle[1]);
  if (!key.startsWith("game-change:")) return false;
  return assertGameChangeProposalDeliveryCurrentTx(input, key);
}

async function assertPrivateEveningDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const policy = input.privateEveningPolicy;
  if (!policy || policy.eventId !== key || policy.memberId !== input.containerMemberId
    || !await isPrivateEveningCurrentTx(policy, input.tx, input.now ?? new Date())) return stale();
  return true;
}

async function assertPrivateKickoffDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const policy = input.privateKickoffPolicy;
  if (!policy || policy.eventId !== key || policy.memberId !== input.containerMemberId
    || !await isPrivateKickoffCurrentTx(policy, input.tx, input.now ?? new Date())) return stale();
  return true;
}

async function assertGameEveningDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const policy = input.eveningPolicy;
  if (!policy || policy.eventId !== key || policy.roomId !== input.containerMemberId
    || !await isEveningBatchCurrentTx(policy, input.playerMemberIds ?? [], input.audience, input.tx, input.now ?? new Date())) return stale();
  return true;
}

async function assertGameMissedEventDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const missed = /^game-missed:([^:]+):([^:]+):(\d{4}-\d{2}-\d{2})$/u.exec(key);
  if (!missed) return stale();
  // Every send passes here, and the outbox can retry for about a day after the sweep has let go.
  const receipt = await input.tx.hostedLinqDelivery.findUnique({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(key) ?? "" }, select: { createdAt: true } });
  if (receipt && isMissedCheckInExpired({ reservedAt: receipt.createdAt, now: input.now ?? new Date() })) return stale();
  if (missed[2] !== "group") return assertGameMissedDeliveryCurrentTx(input, missed[1], missed[2]);
  const policy = input.groupMissedPolicy;
  if (!policy || policy.eventId !== key || policy.roomId !== input.containerMemberId || !input.audience
    || !await isGroupMissedDayBatchCurrentTx(policy, input.audience, input.tx, input.now ?? new Date())) return stale();
  return true;
}

async function assertGameTalkDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], key: string): Promise<true> {
  const match = /^game-talk:([^:]+):([^:]+)$/u.exec(key);
  if (!match) return stale();
  await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${match[1]} FOR UPDATE`;
  const candidate = await input.tx.game.findUnique({ where: { id: match[1] }, select: { maxPlayers: true } });
  if (candidate?.maxPlayers === 10 && !input.audience) return stale();
  const current = await readCurrentGameTalk(input.tx, match[1], match[2], input.now ?? new Date(), input.audience);
  if (!current || current.game.chatContainerMemberId !== input.containerMemberId
    || !await deliveryAudienceCurrent(input, current.game)) return stale();
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
    || !await deliveryAudienceCurrent(input, current.row)) return stale();
  return true;
}

async function assertGameRecapDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, regenerationId?: string,
): Promise<true> {
  await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "settled", OR: [{ maxPlayers: 10 }, { maxPlayers: 2, players: { none: { leftAt: { not: null } } } }],
      ...(regenerationId ? { events: { some: { commandKey: `${input.deliveryIdempotencyKey}:accepted`, type: "recap_regeneration_accepted" } } } : {}) },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || game.maxPlayers === 10 && !groupGameRecapPlayers(game) || !await deliveryAudienceCurrent(input, game)) return stale();
  requirePrivatePairNoticeAudience(input, game);
  if (!await readGameRecapEntryIdsTx(input.tx, game, input.deliveryIdempotencyKey!)) return stale();
  return true;
}

async function assertGameMissedDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string, addressedMemberId: string,
): Promise<true> {
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "live" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || game.maxPlayers === 10 || !game.players.some(player => player.memberId === addressedMemberId && !player.leftAt)
    || !await deliveryAudienceCurrent(input, game)) return stale();
  requirePrivatePairNoticeAudience(input, game);
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
    || !await deliveryAudienceCurrent(input, current.row)) return stale();
  return true;
}

async function assertGameRematchDeliveryCurrentTx(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], gameId: string,
): Promise<true> {
  if (input.rematchTermsVersion != null) await input.tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
  const game = await input.tx.game.findFirst({
    where: { id: gameId, chatContainerMemberId: input.containerMemberId, status: "invited" },
    include: { invitees: true, players: { take: 11 } },
  });
  if (game?.maxPlayers === 10) {
    if (currentTerms(parseStoredTerms(game.terms)).n !== input.rematchTermsVersion || isGameInviteExpired(game, input.now ?? new Date())) return stale();
    if (!await deliveryAudienceCurrent(input, game)) return stale();
    return true;
  }
  return assertPairRematchDeliveryCurrent(input, game);
}

async function assertPairRematchDeliveryCurrent(
  input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0],
  game: Prisma.GameGetPayload<{ include: { invitees: true; players: true } }> | null,
): Promise<true> {
  if (!game?.createdBy || !game.invitees[0]?.memberId || game.players.length !== 1
    || isGameInviteExpired(game, input.now ?? new Date())
    || game.players[0]?.memberId !== game.createdBy
    || !await deliveryAudienceCurrent(input, game)) return stale();
  return true;
}

/** Read the immutable mailbox revision outside the short provider-claim transaction. */
export async function readGameRematchDeliveryRevision(eventId: string | null, containerMemberId: string): Promise<number | null> {
  if (!eventId?.startsWith("game-rematch:")) return null;
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: containerMemberId });
  if (!wake || !("notification" in wake)) return null;
  const policy = wake.notification.responsePolicy;
  return policy?.kind === "require_game_rematch" && policy.eventId === eventId && eventId === `game-rematch:${policy.gameId}`
    ? policy.termsVersion : null;
}
async function assertGameCancelledDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const cancelled = /^game-cancelled:([^:]+)$/.exec(input.deliveryIdempotencyKey ?? "");
  if (!cancelled) return stale();
  const game = await input.tx.game.findFirst({
    where: { id: cancelled[1], chatContainerMemberId: input.containerMemberId, status: "void",
      events: { some: { type: "cancelled" } } },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !await deliveryAudienceCurrent(input, game)) return stale();
  return true;
}
async function assertGameChangeResolvedDeliveryCurrentTx(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0]): Promise<true> {
  const notice = parseGameResolutionNotice(input.deliveryIdempotencyKey ?? "");
  if (!notice) return stale();
  const resolution = await readGameChangeResolution(input.tx, notice.gameId, notice.proposalId);
  if (!resolution || gameResolutionNoticeKind(resolution.outcome) !== notice.kind
    || resolution.game.chatContainerMemberId !== input.containerMemberId
    || !await deliveryAudienceCurrent(input, resolution.game)) return stale();
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
    || !await deliveryAudienceCurrent(input, game)) return stale();
  return true;
}

function stale(): never {
  throw hostedOnboardingError({ code: "GAME_CHANGE_SUPERSEDED", httpStatus: 409, message: "This proposed game change is no longer current.", retryable: false });
}

async function deliveryAudienceCurrent(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], game: Parameters<typeof readGroupGameNoticeAuthority>[0]): Promise<boolean> {
  return Boolean(input.audience && await readGroupGameNoticeAuthority(game, input.containerMemberId, input.audience, input.tx));
}

/** Pair recap and missed-day writers can read app-only pair lore. Hold their
 * queued text while bystanders are present; never retire it as stale game work.
 */
function requirePrivatePairNoticeAudience(input: Parameters<typeof assertGameProposalDeliveryCurrentTx>[0], game: Parameters<typeof readGroupGameNoticeAuthority>[0]): void {
  if (game.maxPlayers !== 2) return;
  const players = game.players.map(player => player.memberId);
  if (!input.audience || input.audience.contacts.length > 2 || !sameGamePlayers(input.audience.memberIds, players)) {
    throw new GameChatAudienceError("participants_changed", "This pair notice requires only its players in the chat.");
  }
}
