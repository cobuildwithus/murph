import "server-only";

import { Prisma } from "@prisma/client";
import { isRecord } from "../primitives";
import { gameChangeCancellationNeedsNotice, parsePendingGameChange, type StoredGamePendingChange } from "./changes";
import { reserveGameChatLifecycleTx } from "./chat-lifecycle-receipt";

export const GAME_ROSTER_CHANGE_REASON = "The playing roster changed, so that request was cleared without applying it.";
export const GAME_ENDED_CHANGE_REASON = "The game ended before that request could apply.";
export type GameChangeOutcome = "change_applied" | "change_declined" | "change_cancelled" | "change_expired";
type ResolutionGame = { id: string; maxPlayers: number; chatContainerMemberId: string | null; pendingChange: unknown };
type Tally = { yes: number; no: number; total: number };

/** Caller holds the game lock. One owner clears a group ask, records truth and reserves delivery. */
export async function resolveGroupGameChangeTx(input: {
  tx: Prisma.TransactionClient; game: ResolutionGame; actor: string; now: Date;
  outcome: GameChangeOutcome; reason: string; answeredInBoundChat?: boolean;
  proposal?: StoredGamePendingChange; tally?: Tally; termsVersion?: number; effectiveFromDay?: number;
}): Promise<void> {
  if (input.game.maxPlayers !== 10) return;
  const proposal = input.proposal ?? parsePendingGameChange(input.game.pendingChange);
  if (!proposal) return;
  const { tx, game, outcome } = input;
  await tx.game.update({ where: { id: game.id }, data: { pendingChange: Prisma.DbNull } });
  await tx.gameEvent.createMany({ skipDuplicates: true, data: [{ gameId: game.id, actor: input.actor,
    type: outcome, commandKey: `game-change-resolved:${game.id}:${proposal.id}`,
    payload: { v: 1, proposalId: proposal.id, reason: input.reason, changeKind: proposal.change.kind,
      startsOn: proposal.startsOn, ...(input.tally ? { tally: input.tally } : {}),
      ...(input.termsVersion === undefined ? {} : { termsVersion: input.termsVersion }),
      ...(input.effectiveFromDay === undefined ? {} : { effectiveFromDay: input.effectiveFromDay }) } }] });
  if (!game.chatContainerMemberId || input.answeredInBoundChat) return;
  if (outcome === "change_cancelled" && !gameChangeCancellationNeedsNotice(proposal, "cancel", false, true)) return;
  await reserveGameChatLifecycleTx({ tx, gameId: game.id, proposalId: proposal.id, now: input.now,
    kind: outcome === "change_applied" || outcome === "change_declined" ? "change_resolved" : outcome });
}

/** Historical outcome owns notice truth; current audience authority still owns disclosure. */
export async function readGameChangeResolution(db: Pick<Prisma.TransactionClient, "game" | "gameEvent">, gameId: string, proposalId: string) {
  const [game, event] = await Promise.all([
    db.game.findUnique({ where: { id: gameId }, include: { invitees: true, players: { take: 11 } } }),
    db.gameEvent.findUnique({ where: { commandKey: `game-change-resolved:${gameId}:${proposalId}` }, select: { gameId: true, type: true, payload: true } }),
  ]);
  if (!game || event?.gameId !== gameId || !isRecord(event.payload) || event.payload.proposalId !== proposalId
    || !["change_applied", "change_declined", "change_cancelled", "change_expired"].includes(event.type)) return null;
  const outcome = event.type as GameChangeOutcome;
  if (game.maxPlayers !== 10 && (outcome === "change_applied" || outcome === "change_declined"
    || outcome === "change_cancelled" && !["live", "negotiating"].includes(game.status))) return null;
  const payload = event.payload;
  const tally = isRecord(payload.tally) && [payload.tally.yes, payload.tally.no, payload.tally.total].every(value => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10)
    ? { yes: Number(payload.tally.yes), no: Number(payload.tally.no), total: Number(payload.tally.total) } : undefined;
  return { game, outcome, reason: typeof payload.reason === "string" ? payload.reason : null, tally,
    changeKind: payload.changeKind === "start_now" ? "start_now" as const : "edit" as const,
    startsOn: typeof payload.startsOn === "string" ? payload.startsOn : null };
}

export function gameResolutionNoticeKind(outcome: GameChangeOutcome) {
  return outcome === "change_applied" || outcome === "change_declined" ? "change_resolved" : outcome;
}

export function parseGameResolutionNotice(key: string) {
  const match = /^game-change-(cancelled|expired|resolved):([^:]+):([^:]+)$/u.exec(key);
  if (!match) return null;
  const kind = match[1] === "cancelled" ? "change_cancelled" as const : match[1] === "expired" ? "change_expired" as const : "change_resolved" as const;
  return { kind, gameId: match[2], proposalId: match[3] };
}
