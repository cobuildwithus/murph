import "server-only";

import { Prisma, type Game, type GamePlayer, type GameInvitee } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isRecord } from "../primitives";
import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { labelTarget, openGameTexts, sealGameText } from "./crypto";

const GAME_DELETION_LIMIT = 1_000;
const ACTIVE = new Set(["invited", "negotiating", "live"]);
type GameRow = Game & { players: GamePlayer[]; invitees: GameInvitee[] };
type Db = Pick<Prisma.TransactionClient, "game" | "gameContactLabel" | "gameProfile">;

/** Each viewer keeps only their own encrypted name for a deleted person. */
export type DepartedLabel = { ownerMemberId: string; nameEncrypted: string | null };
export function departedLabels(value: Prisma.JsonValue | null): DepartedLabel[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 9) throw new Error("Stored departure labels are malformed.");
  return value.map(label => {
    if (!isRecord(label) || typeof label.ownerMemberId !== "string"
      || (label.nameEncrypted !== null && typeof label.nameEncrypted !== "string")) throw new Error("Stored departure label is malformed.");
    return { ownerMemberId: label.ownerMemberId, nameEncrypted: label.nameEncrypted };
  });
}

interface PreparedGame {
  id: string;
  fingerprint: string;
  kept: null | {
    owner: string;
    termsWordsEncrypted: string;
    departures: { seat: number; joined: boolean; labels: DepartedLabel[] }[];
  };
}
export interface PreparedGameAccountDeletion { games: PreparedGame[] }

function participantOf(memberIds: readonly string[]): Prisma.GameWhereInput {
  return { OR: [
    { players: { some: { memberId: { in: [...memberIds] } } } },
    { wordsOwnerMemberId: { in: [...memberIds] } },
    { createdBy: { in: [...memberIds] } },
    { invitees: { some: { memberId: { in: [...memberIds] } } }, OR: [
      { status: "invited" }, { status: "void", players: { some: { leftAt: { not: null } } } },
    ] },
  ] };
}
async function readAffectedGames(db: Pick<Db, "game">, memberIds: readonly string[]): Promise<GameRow[]> {
  const rows = await db.game.findMany({ include: { players: true, invitees: true }, orderBy: { id: "asc" }, take: GAME_DELETION_LIMIT + 1, where: participantOf(memberIds) });
  if (rows.length > GAME_DELETION_LIMIT) throw new Error("Account deletion game set exceeds its bound.");
  return rows;
}
function participants(row: GameRow) {
  const players = row.players.flatMap(player => player.memberId ? [{ memberId: player.memberId, seat: player.seat, joined: true }] : []);
  const invitees = row.maxPlayers === 2 && (row.status === "invited" || row.players.some(player => player.leftAt !== null))
    ? row.invitees.flatMap(invitee => invitee.memberId && !players.some(player => player.memberId === invitee.memberId)
      ? [{ memberId: invitee.memberId, seat: invitee.seat, joined: false }] : []) : [];
  return [...players, ...invitees].sort((a, b) => a.seat - b.seat);
}
function fingerprint(row: GameRow): string {
  return JSON.stringify([row.updatedAt, row.maxPlayers, row.status, row.createdBy, row.wordsOwnerMemberId, row.termsWordsEncrypted,
    row.inviteTokenEncrypted, row.pendingChange, row.result,
    [...row.players].sort((a, b) => a.seat - b.seat), [...row.invitees].sort((a, b) => a.seat - b.seat)]);
}

/** Bounded crypto preparation runs without a transaction or game lock. */
export async function prepareGameAccountDeletion(input: { memberIds: readonly string[]; prisma: Db }): Promise<PreparedGameAccountDeletion> {
  const leaving = new Set(input.memberIds);
  const rows = await readAffectedGames(input.prisma, input.memberIds);
  const plans = rows.map(row => ({ row, survivors: participants(row).filter(player => !leaving.has(player.memberId)),
    leavers: participants(row).filter(player => leaving.has(player.memberId)) }));
  const owners = [...new Set(plans.flatMap(plan => plan.survivors.map(player => player.memberId)))];
  const [labels, profiles] = await Promise.all([
    input.prisma.gameContactLabel.findMany({ where: { ownerMemberId: { in: owners }, subjectMemberId: { in: [...leaving] } } }),
    input.prisma.gameProfile.findMany({ select: { firstNameEncrypted: true, memberId: true }, where: { memberId: { in: [...leaving, ...owners] } } }),
  ]);
  const firstNames = await openGameTexts(profiles.filter(profile => leaving.has(profile.memberId)).map(profile => ({ field: "first_name", memberId: profile.memberId, rowId: profile.memberId, table: "game_profile" as const, value: profile.firstNameEncrypted })));
  const names = new Map(profiles.filter(profile => leaving.has(profile.memberId)).map((profile, index) => [profile.memberId, firstNames[index] ?? ""]));
  const transfers = plans.filter(plan => plan.survivors.length > 0 && leaving.has(plan.row.wordsOwnerMemberId));
  const words = await openGameTexts(transfers.map(({ row }) => ({ field: "terms_words", memberId: row.wordsOwnerMemberId, rowId: row.id, table: "game" as const, value: row.termsWordsEncrypted })));
  const wordsOf = new Map(transfers.map(({ row }, index) => [row.id, words[index]]));
  const games: PreparedGame[] = [];
  for (const { row, survivors, leavers } of plans) {
    const owner = leaving.has(row.wordsOwnerMemberId)
      ? survivors.find(player => profiles.some(profile => profile.memberId === player.memberId))?.memberId
      : row.wordsOwnerMemberId;
    if (survivors.length === 0) { games.push({ id: row.id, fingerprint: fingerprint(row), kept: null }); continue; }
    if (!owner) throw new Error("A surviving game has no encryption-capable owner.");
    const departures: NonNullable<PreparedGame["kept"]>["departures"] = [];
    for (const leaver of leavers) {
      const keptLabels: DepartedLabel[] = [];
      for (const survivor of survivors) {
        const label = labels.find(item => item.ownerMemberId === survivor.memberId && item.subjectMemberId === leaver.memberId);
        // An unaccepted invitation's label is still private to its creator.
        const pending = !leaver.joined && survivor.memberId === row.createdBy ? row.invitees.find(invitee => invitee.seat === leaver.seat)?.pendingLabel : null;
        const pendingName = isRecord(pending) && typeof pending.nameEncrypted === "string" ? pending.nameEncrypted : null;
        const nameEncrypted = pendingName ?? label?.nameEncrypted ?? await sealGameText(labelTarget(survivor.memberId, "name"), names.get(leaver.memberId) ?? "");
        keptLabels.push({ ownerMemberId: survivor.memberId, nameEncrypted });
      }
      departures.push({ seat: leaver.seat, joined: leaver.joined, labels: keptLabels });
    }
    const plainWords = wordsOf.get(row.id);
    const termsWordsEncrypted = plainWords === undefined ? row.termsWordsEncrypted
      : await sealGameText({ field: "terms_words", memberId: owner, rowId: row.id, table: "game" }, plainWords);
    if (!termsWordsEncrypted) throw new Error("Game words transfer returned no ciphertext.");
    games.push({ id: row.id, fingerprint: fingerprint(row), kept: { owner, termsWordsEncrypted, departures } });
  }
  return { games };
}

/** Caller locks deleting members first; revalidation fails closed for a fresh preparation. */
export async function applyGameAccountDeletionTx(input: { memberIds: readonly string[]; now: Date; prepared: PreparedGameAccountDeletion; tx: Prisma.TransactionClient }): Promise<{ calledOff: number; deleted: number; kept: number }> {
  const { tx } = input;
  const leaving = [...input.memberIds];
  const discovered = await readAffectedGames(tx, leaving);
  const ids = [...new Set([...input.prepared.games.map(game => game.id), ...discovered.map(game => game.id)])].sort();
  if (ids.length) await tx.$queryRaw`SELECT id FROM game WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const current = await readAffectedGames(tx, leaving);
  const prepared = new Map(input.prepared.games.map(game => [game.id, game]));
  if (current.length !== prepared.size || current.some(row => prepared.get(row.id)?.fingerprint !== fingerprint(row))) {
    throw hostedOnboardingError({ code: "ACCOUNT_DELETION_GAME_STATE_CHANGED", httpStatus: 503,
      message: "A game changed while your account was being deleted. Retry account deletion.", retryable: true });
  }
  let calledOff = 0;
  let deleted = 0;
  for (const row of current) {
    const plan = prepared.get(row.id)!.kept;
    if (!plan) { await tx.game.delete({ where: { id: row.id } }); deleted += 1; continue; }
    const remaining = row.players.filter(player => player.memberId && !leaving.includes(player.memberId) && player.leftAt === null);
    const active = ACTIVE.has(row.status) && (row.maxPlayers === 2 || (row.status !== "invited" && remaining.length < 2));
    if (active) calledOff += 1;
    await tx.game.update({ where: { id: row.id }, data: {
      wordsOwnerMemberId: plan.owner, termsWordsEncrypted: plan.termsWordsEncrypted,
      recapEncrypted: null, pendingChange: Prisma.DbNull,
      ...(active ? { status: "void", result: Prisma.DbNull } : {}),
      ...(row.createdBy && leaving.includes(row.createdBy) ? { createdBy: null, inviteTokenEncrypted: null } : {}),
      ...(!active && row.result !== null ? { result: withoutMembers(row.result, leaving) } : {}),
    } });
    // Remove entries before changing the member key referenced by their FK.
    await tx.gameEntry.deleteMany({ where: { gameId: row.id, memberId: { in: leaving } } });
    await retainDeparturesTx(tx, row, plan, leaving, input.now);
    if (active) await tx.gameTicket.deleteMany({ where: { gameId: row.id } });
    for (const departure of plan.departures) await tx.gameEvent.create({ data: { actor: "system", gameId: row.id,
      payload: { v: 1, calledOff: active, seat: departure.seat }, type: "player_left" } });
  }
  // Cancelled/expired invitations need no crypto plan, but keep no lookup or label.
  await tx.gameInvitee.updateMany({ where: { memberId: { in: leaving } }, data: { memberId: null, recipientLookupKey: null, pendingLabel: Prisma.DbNull } });
  await tx.gameEvent.updateMany({ where: { actor: { in: leaving } }, data: { actor: "system" } });
  return { calledOff, deleted, kept: current.length - deleted };
}

/** Keep seat identities and each surviving viewer's encrypted labels together. */
async function retainDeparturesTx(tx: Prisma.TransactionClient, row: GameRow, plan: NonNullable<PreparedGame["kept"]>, leaving: readonly string[], now: Date): Promise<void> {
  for (const player of row.players) {
    const departure = plan.departures.find(item => item.joined && item.seat === player.seat);
    const labels = departure?.labels ?? departedLabels(player.departedLabel).filter(label => !leaving.includes(label.ownerMemberId));
    if (!departure && player.departedLabel === null) continue;
    await tx.gamePlayer.update({ where: { gameId_seat: { gameId: row.id, seat: player.seat } }, data: {
      departedLabel: labels.length ? labels : Prisma.DbNull,
      ...(departure ? { memberId: null, leftAt: player.leftAt ?? now } : {}),
    } });
  }
  for (const departure of plan.departures.filter(item => !item.joined)) {
    await tx.gamePlayer.create({ data: { gameId: row.id, seat: departure.seat,
      memberId: null, joinedAt: null, timeZone: null, leftAt: now, departedLabel: departure.labels } });
  }
  if (row.createdBy && leaving.includes(row.createdBy)) {
    await tx.gameInvitee.updateMany({ where: { gameId: row.id }, data: { pendingLabel: Prisma.DbNull } });
  }
}

function withoutMembers(result: Prisma.JsonValue, memberIds: readonly string[]): Prisma.InputJsonObject {
  const root = isRecord(result) ? result : {};
  const scores = Array.isArray(root.scores) ? root.scores : [];
  return toPrismaJsonObject({ ...root, scores: scores.map(score => isRecord(score) && memberIds.includes(String(score.memberId)) ? { ...score, memberId: "" } : score) });
}
