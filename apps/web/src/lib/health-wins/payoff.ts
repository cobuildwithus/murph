import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { openGameTexts } from "../game/crypto";
import { assertGameMemberAuthCurrentForRead } from "../game/http/auth";
import { gameNotFound } from "../game/http/errors";
import { effectiveTermWords, outcomeFor, parseStoredResult, parseTermWords } from "../game/rules";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  type CachedHealthCandidate, type HealthCardSelection, previewRecordedCandidate, resolveRecordedSelection, specDigest,
} from "./card-options";
import { buildGameResultCard } from "./engine/game-result";
import { isHealthPayoffEnabled } from "./flag";

type Db = Pick<Prisma.TransactionClient, "$queryRaw">;
type Row = {
  gameId: string; settledAt: Date; lengthDays: number; startDate: string;
  ownerId: string; words: string; result: Prisma.JsonValue; termsVersion: number;
  stakeKind: "prize" | "dare"; stakeKey: string; ticketId: string;
  memberId: string; seat: number; name: string; debtorMemberId: string; debtorSeat: number; debtorName: string;
};

// A settled pair creates one modern prize/dare ticket for its unique winner.
const offerLimit = 24;

/** One snapshot of the result, current stake, matching ticket and both players' own profiles.
 * The writer checks the live post separately under the game lock to distinguish receipt replays. */
function payoffRows(db: Db, memberId: string, gameId?: string) {
  const where = gameId === undefined
    ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM health_post p WHERE p.game_id = g.id AND p.deleted_at IS NULL)`
    : Prisma.sql`AND g.id = ${gameId}`;
  return db.$queryRaw<Row[]>`SELECT g.id AS "gameId", g.settled_at AS "settledAt", g.length_days AS "lengthDays",
      mine.day_one::text AS "startDate", g.words_owner_member_id AS "ownerId", g.terms_words_encrypted AS words, g.result,
      (terms.version->>'n')::integer AS "termsVersion", stake.entry->>'kind' AS "stakeKind",
      t.stake_key AS "stakeKey", t.id AS "ticketId", mine.member_id AS "memberId", mine.seat,
      me.first_name_encrypted AS name, peer.member_id AS "debtorMemberId", peer.seat AS "debtorSeat",
      other.first_name_encrypted AS "debtorName"
    FROM game_player mine JOIN game g ON g.id = mine.game_id
    JOIN game_player peer ON peer.game_id = g.id AND peer.seat <> mine.seat
    JOIN game_profile me ON me.member_id = mine.member_id
    JOIN game_profile other ON other.member_id = peer.member_id
    CROSS JOIN LATERAL (SELECT g.terms #> '{versions,-1}' AS version) terms
    CROSS JOIN LATERAL (SELECT terms.version #> '{stakes,0}' AS entry) stake
    JOIN game_ticket t ON t.game_id = g.id AND t.stake_key = stake.entry->>'key'
      AND t.owed_to_seats = ARRAY[mine.seat] AND t.owed_by_seats = ARRAY[peer.seat] AND t.status IN ('open','redeemed')
    WHERE mine.member_id = ${memberId} AND mine.joined_at IS NOT NULL AND mine.left_at IS NULL AND mine.day_one IS NOT NULL
      AND peer.joined_at IS NOT NULL AND peer.left_at IS NULL AND g.max_players = 2 AND g.status = 'settled'
      AND g.settled_at BETWEEN timezone('UTC', statement_timestamp()) - interval '7 days' AND timezone('UTC', statement_timestamp())
      AND g.result IS NOT NULL AND jsonb_array_length(terms.version->'stakes') = 1 AND stake.entry->>'kind' IN ('dare','prize')
      AND NOT EXISTS (SELECT 1 FROM game_block b WHERE
        (b.blocker_member_id = mine.member_id AND b.blocked_member_id = peer.member_id) OR
        (b.blocker_member_id = peer.member_id AND b.blocked_member_id = mine.member_id))
      ${where}
    ORDER BY g.settled_at DESC, g.id DESC LIMIT ${gameId === undefined ? offerLimit : 1}`;
}

function payoffScores(row: Row) {
  const result = parseStoredResult(row.result);
  const mine = result.scores.find(score => score.memberId === row.memberId && score.seat === row.seat);
  const peer = result.scores.find(score => score.memberId === row.debtorMemberId && score.seat === row.debtorSeat);
  if (result.scores.length !== 2 || !mine || !peer || outcomeFor(result, row.memberId) !== "won") return null;
  return { mine: mine.score, peer: peer.score };
}

function payoffTexts(row: Row) {
  return [
    { memberId: row.ownerId, table: "game", field: "terms_words", rowId: row.gameId, value: row.words },
    { memberId: row.memberId, table: "game_profile", field: "first_name", rowId: row.memberId, value: row.name },
    { memberId: row.debtorMemberId, table: "game_profile", field: "first_name", rowId: row.debtorMemberId, value: row.debtorName },
  ] as const;
}

async function payoffCandidates(rows: Row[], signal?: AbortSignal) {
  const eligible = rows.flatMap(row => {
    const scores = payoffScores(row);
    return scores ? [{ row, scores }] : [];
  });
  const opened = await openGameTexts(eligible.flatMap(({ row }) => payoffTexts(row)), signal);
  return eligible.flatMap(({ row, scores }, i) => {
    const [terms, mine, peer] = opened.slice(i * 3, i * 3 + 3);
    if (!terms || !mine || !peer) return [];
    const words = effectiveTermWords(parseTermWords(terms), row.termsVersion);
    const task = (seat: number) => words.tasks.find(item => item.seat === seat)?.text ?? words.defaultTask;
    const myTask = task(row.seat), peerTask = task(row.debtorSeat);
    const item = words.stakes.find(entry => entry.key === row.stakeKey)?.item;
    if (!myTask || !peerTask || !item) return [];
    const contest = myTask === peerTask ? myTask : `${mine}: ${myTask} · ${peer}: ${peerTask}`;
    const card = buildGameResultCard({ gameId: row.gameId, startDate: row.startDate, lengthDays: row.lengthDays,
      contest, players: [{ memberId: row.memberId, firstName: mine, score: scores.mine, won: true },
        { memberId: row.debtorMemberId, firstName: peer, score: scores.peer, won: false }],
      stake: { kind: row.stakeKind, item } });
    const candidate: CachedHealthCandidate = { id: card.id, variants: [
      { option: "original", spec: card, specRevision: specDigest(card) },
    ] };
    return [{ row, candidate }];
  });
}

export async function readHealthPayoffs(auth: HostedNativeMemberAuth, signal?: AbortSignal) {
  const memberId = auth.member.id, db = getPrisma();
  if (!isHealthPayoffEnabled(memberId)) return { cards: [] };
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const candidates = await payoffCandidates(await payoffRows(db, memberId), signal);
  return db.$transaction(async tx => {
    await assertGameMemberAuthCurrentForRead(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    if (!isHealthPayoffEnabled(memberId) || !candidates.length) return { cards: [] };
    const current = new Set((await payoffRows(tx, memberId)).map(payoffBasis));
    return { cards: candidates.flatMap(({ candidate, row }) => current.has(payoffBasis(row)) ? [previewRecordedCandidate(candidate)] : []) };
  });
}

function payoffChanged() {
  return hostedOnboardingError({ code: "HEALTH_PAYOFF_CHANGED", httpStatus: 409, message: "Preview the payoff again before posting." });
}

/** Includes the sealed profile names and terms. The committing check needs no key service. */
function payoffBasis(row: Row) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

export async function preparePayoffSelection(memberId: string, pick: HealthCardSelection) {
  if (!isHealthPayoffEnabled(memberId)) throw gameNotFound();
  const rows = await payoffRows(getPrisma(), memberId, pick.candidateId.slice("game:".length));
  const [prepared] = await payoffCandidates(rows);
  if (!prepared) throw gameNotFound();
  const { candidate, row } = prepared;
  try {
    const card = resolveRecordedSelection([candidate], pick);
    if (!card) throw payoffChanged();
    return { gameId: row.gameId, debtorMemberId: row.debtorMemberId, ticketId: row.ticketId, card, basis: payoffBasis(row) };
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "HEALTH_ACTIVITY_CARD_CHANGED") throw payoffChanged();
    throw error;
  }
}

/** The caller holds the pair and game locks, in that order, through post publication and redemption. */
export async function assertPayoffCurrentTx(tx: Db, memberId: string, prepared: Awaited<ReturnType<typeof preparePayoffSelection>>) {
  if (!isHealthPayoffEnabled(memberId)) throw gameNotFound();
  const [row] = await payoffRows(tx, memberId, prepared.gameId);
  if (!row || !payoffScores(row)) throw gameNotFound();
  if (payoffBasis(row) !== prepared.basis) throw payoffChanged();
}
