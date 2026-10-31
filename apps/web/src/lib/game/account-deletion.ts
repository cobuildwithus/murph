import "server-only";

import { Prisma, type Game, type GamePlayer } from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isRecord } from "../primitives";
import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { labelTarget, openGameTexts, sealGameText } from "./crypto";

/**
 * Account deletion and the weekly game. A member who deletes their account
 * leaves every game they're in: an open or live game is called off (void, no
 * result, no tickets), a finished one keeps its result. The other player keeps
 * the game, their own posts and any tickets, and sees the name they knew the
 * leaver by. The leaver's seat, posts and labels go with their profile; a game
 * nobody else is in goes with them.
 *
 * Sealing calls KMS, so `prepare` runs before the deletion transaction and
 * `apply` revalidates every game under its row lock inside it.
 */

const GAME_DELETION_LIMIT = 1_000;
const ACTIVE = new Set(["invited", "negotiating", "live"]);

/** Stored on `game.departed_player`. */
export interface GameDepartedPlayer {
  v: 1;
  seat: number;
  at: string;
  /** The remaining member: their key seals the name, and the game's words once the creator left. */
  viewerMemberId: string;
  /** The name the remaining member knew them by, sealed as that member's own contact label. */
  nameEncrypted: string | null;
}

export function parseGameDepartedPlayer(value: Prisma.JsonValue | null): GameDepartedPlayer | null {
  if (value === null) return null;
  if (!isRecord(value) || value.v !== 1 || !Number.isInteger(value.seat) || typeof value.at !== "string"
    || typeof value.viewerMemberId !== "string" || (value.nameEncrypted !== null && typeof value.nameEncrypted !== "string")) {
    throw new Error("Stored game departure is malformed.");
  }
  return { v: 1, seat: Number(value.seat), at: value.at, viewerMemberId: value.viewerMemberId, nameEncrypted: value.nameEncrypted };
}

/** Whose key seals the game's own words: its creator, or the remaining member once the creator left. */
export function gameWordsMemberId(row: Pick<Game, "createdBy" | "departedPlayer">): string {
  const owner = row.createdBy ?? parseGameDepartedPlayer(row.departedPlayer)?.viewerMemberId;
  if (!owner) throw new Error("Stored game has no words owner.");
  return owner;
}

type GameRow = Game & { players: GamePlayer[] };
type Db = Pick<Prisma.TransactionClient, "game" | "gameContactLabel" | "gameProfile">;

interface PreparedGame {
  id: string;
  fingerprint: string;
  departure: { seat: number; viewerMemberId: string; nameEncrypted: string | null; termsWordsEncrypted: string | null; leaverIds: string[] } | null;
}

export interface PreparedGameAccountDeletion {
  games: PreparedGame[];
}

function participantOf(memberIds: readonly string[]): Prisma.GameWhereInput {
  return { OR: [
    { players: { some: { memberId: { in: [...memberIds] } } } },
    { createdBy: { in: [...memberIds] } },
    // Only an open addressed invite, or one kept after its creator left: cancelled
    // or expired ones they never joined need no plan (their reference is cleared below).
    { inviteeMemberId: { in: [...memberIds] }, OR: [{ status: "invited" }, { status: "void", departedPlayer: { not: Prisma.DbNull } }] },
  ] };
}

async function readAffectedGames(db: Pick<Db, "game">, memberIds: readonly string[]): Promise<GameRow[]> {
  const rows = await db.game.findMany({ include: { players: true }, orderBy: { id: "asc" }, take: GAME_DELETION_LIMIT + 1, where: participantOf(memberIds) });
  if (rows.length > GAME_DELETION_LIMIT) throw new Error("Account deletion game set exceeds its bound.");
  return rows;
}

/** Players, plus an open addressed rematch's invitee (or one kept after its creator left). */
function participants(row: GameRow): string[] {
  const players = row.players.map((player) => player.memberId);
  const invitee = row.inviteeMemberId && !players.includes(row.inviteeMemberId)
    && (row.status === "invited" || row.departedPlayer !== null) ? [row.inviteeMemberId] : [];
  return [...players, ...invitee];
}

function fingerprint(row: GameRow): string {
  return JSON.stringify([row.status, row.createdBy, row.inviteeMemberId, row.termsWordsEncrypted, row.departedPlayer,
    row.players.map((player) => [player.memberId, player.seat]).sort()]);
}

export async function prepareGameAccountDeletion(input: { memberIds: readonly string[]; prisma: Db }): Promise<PreparedGameAccountDeletion> {
  const leaving = new Set(input.memberIds);
  const rows = await readAffectedGames(input.prisma, input.memberIds);
  const plans = rows.map((row) => {
    const everyone = participants(row);
    const survivors = everyone.filter((memberId) => !leaving.has(memberId));
    const leavers = everyone.filter((memberId) => leaving.has(memberId));
    // A 1v1 keeps its one remaining member; with nobody left the game goes too.
    return { row, survivor: survivors.length === 1 ? survivors[0] : null, leavers };
  });
  const kept = plans.filter((plan) => plan.survivor !== null && plan.leavers.length > 0);
  const [labels, profiles] = await Promise.all([
    input.prisma.gameContactLabel.findMany({ where: { OR: kept.map((plan) => ({ ownerMemberId: plan.survivor!, subjectMemberId: { in: plan.leavers } })) } }),
    input.prisma.gameProfile.findMany({ select: { firstNameEncrypted: true, memberId: true }, where: { memberId: { in: [...leaving] } } }),
  ]);
  // One open batch: each leaver's own name, and each kept game's words while the creator still holds them.
  const firstNames = await openGameTexts(profiles.map((profile) => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })));
  const nameOf = new Map(profiles.map((profile, index) => [profile.memberId, firstNames[index] ?? ""]));
  const creatorLeft = kept.filter((plan) => plan.row.createdBy !== null && leaving.has(plan.row.createdBy));
  const words = await openGameTexts(creatorLeft.map(({ row }) => ({ field: "terms_words", memberId: row.createdBy!, rowId: row.id, table: "game" as const, value: row.termsWordsEncrypted })));
  const wordsOf = new Map(creatorLeft.map(({ row }, index) => [row.id, words[index]]));
  const games: PreparedGame[] = [];
  for (const { row, survivor, leavers } of plans) {
    if (leavers.length === 0) continue;
    if (survivor === null) {
      games.push({ id: row.id, fingerprint: fingerprint(row), departure: null });
      continue;
    }
    const leaver = leavers[0];
    const label = labels.find((candidate) => candidate.ownerMemberId === survivor && candidate.subjectMemberId === leaver);
    // Labels bind to their owner, so the survivor's own label moves as-is.
    const nameEncrypted = label?.nameEncrypted ?? await sealGameText(labelTarget(survivor, "name"), nameOf.get(leaver) ?? "");
    const plainWords = wordsOf.get(row.id);
    const termsWordsEncrypted = plainWords === undefined ? null
      : await sealGameText({ field: "terms_words", memberId: survivor, rowId: row.id, table: "game" }, plainWords ?? "");
    const seat = row.players.find((player) => player.memberId === leaver)?.seat ?? row.players.length;
    games.push({ id: row.id, fingerprint: fingerprint(row), departure: { leaverIds: leavers, nameEncrypted, seat, termsWordsEncrypted, viewerMemberId: survivor } });
  }
  return { games };
}

/**
 * Inside the deletion transaction, after the deleting members are locked
 * (owner before game, matching game chat commands). Any game that changed
 * since `prepare` fails the deletion closed for a retry.
 */
export async function applyGameAccountDeletionTx(input: { memberIds: readonly string[]; now: Date; prepared: PreparedGameAccountDeletion; tx: Prisma.TransactionClient }): Promise<{ calledOff: number; deleted: number; kept: number }> {
  const { tx } = input;
  const ids = [...new Set([...input.prepared.games.map((game) => game.id),
    ...(await tx.game.findMany({ select: { id: true }, where: participantOf(input.memberIds), take: GAME_DELETION_LIMIT + 1 })).map((game) => game.id)])].sort();
  if (ids.length > 0) await tx.$queryRaw`SELECT id FROM game WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const current = await readAffectedGames(tx, input.memberIds);
  const prepared = new Map(input.prepared.games.map((game) => [game.id, game]));
  const relevant = current.filter((row) => participants(row).some((memberId) => input.memberIds.includes(memberId)));
  if (relevant.length !== prepared.size || relevant.some((row) => prepared.get(row.id)?.fingerprint !== fingerprint(row))) {
    throw hostedOnboardingError({
      code: "ACCOUNT_DELETION_GAME_STATE_CHANGED",
      httpStatus: 503,
      message: "A game changed while your account was being deleted. Retry account deletion.",
      retryable: true,
    });
  }
  let calledOff = 0;
  let deleted = 0;
  for (const row of relevant) {
    const plan = prepared.get(row.id)!;
    if (!plan.departure) {
      await tx.game.delete({ where: { id: row.id } });
      deleted += 1;
      continue;
    }
    const { departure } = plan;
    const active = ACTIVE.has(row.status);
    if (active) calledOff += 1;
    const leftCreator = row.createdBy !== null && departure.leaverIds.includes(row.createdBy);
    const leftInvitee = row.inviteeMemberId !== null && departure.leaverIds.includes(row.inviteeMemberId);
    const departed: GameDepartedPlayer = { v: 1, at: input.now.toISOString(), nameEncrypted: departure.nameEncrypted, seat: departure.seat, viewerMemberId: departure.viewerMemberId };
    await tx.game.update({
      where: { id: row.id },
      data: {
        departedPlayer: toPrismaJsonObject({ ...departed }),
        recapEncrypted: null,
        // Called off: no winner and no tickets. A finished game keeps its result.
        ...(active ? { status: "void", liveRosterKey: null, pendingChange: Prisma.DbNull } : {}),
        // Cleared here, before the member row goes, so the creator cascade never reaches a kept game.
        ...(leftCreator ? { createdBy: null, termsWordsEncrypted: departure.termsWordsEncrypted ?? row.termsWordsEncrypted, inviteTokenEncrypted: null, pendingLabel: Prisma.DbNull } : {}),
        ...(leftInvitee ? { inviteeMemberId: null } : {}),
        ...(row.result !== null ? { result: withoutMembers(row.result, departure.leaverIds) } : {}),
      },
    });
    // Tickets stay as history for the other player, with the leaver's side cleared.
    await tx.gameTicket.updateMany({ data: { owedBy: null }, where: { gameId: row.id, owedBy: { in: departure.leaverIds } } });
    await tx.gameTicket.updateMany({ data: { owedTo: null }, where: { gameId: row.id, owedTo: { in: departure.leaverIds } } });
    await tx.gameEvent.create({ data: { actor: "system", gameId: row.id, payload: { v: 1, calledOff: active, seat: departure.seat }, type: "player_left" } });
  }
  // An expired addressed invite the leaver never took keeps no trace of them.
  await tx.game.updateMany({ data: { inviteeMemberId: null }, where: { inviteeMemberId: { in: [...input.memberIds] } } });
  return { calledOff, deleted, kept: relevant.length - deleted };
}

/** A frozen result keeps every seat's score; only the leaver's member id goes. */
function withoutMembers(result: Prisma.JsonValue, memberIds: readonly string[]): Prisma.InputJsonObject {
  const root = isRecord(result) ? result : {};
  const scores = Array.isArray(root.scores) ? root.scores : [];
  return toPrismaJsonObject({ ...root, scores: scores.map((score) => isRecord(score) && memberIds.includes(String(score.memberId)) ? { ...score, memberId: "" } : score) });
}
