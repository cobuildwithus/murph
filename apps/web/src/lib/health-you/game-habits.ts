import "server-only";
import { createHash } from "node:crypto";
import { toLocalDayKey } from "@murphai/contracts";
import { Prisma } from "@prisma/client";
import { openGameTexts } from "../game/crypto";
import { effectiveTermWords, parseStoredTerms, parseTermWords, termsForDay } from "../game/rules";
import { offset, type Observation } from "./engine/model";

type Proof = {
  gameId: string;
  seat: number;
  dayIndex: number;
  date: string;
  receivedAt: Date;
  wordsRevision: string;
};
type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "game">;

/** Read only credited photo artifacts of the owner's current memberships. A post's words,
 * an unchecked day and an unproven device summary cannot attest to completion. */
export async function gameProofs(db: Db, memberId: string, clock: Date) {
  // Fetch the extra month needed to reconstruct a 365-day view. UTC margins
  // cover both sides of the date line before the replica zone is known.
  const today = clock.toISOString().slice(0, 10);
  const rows = await db.$queryRaw<Proof[]>`
    SELECT e.game_id AS "gameId", p.seat, e.day_index AS "dayIndex",
      to_char(p.day_one + e.day_index, 'YYYY-MM-DD') AS date, e.received_at AS "receivedAt",
      md5(g.terms::text || g.terms_words_encrypted) AS "wordsRevision"
    FROM game_entry e
    JOIN game_player p USING (game_id, member_id)
    JOIN game g ON g.id = e.game_id
    WHERE e.member_id = ${memberId} AND p.joined_at IS NOT NULL AND p.left_at IS NULL
      AND g.status IN ('live','settled') AND e.attempt > 0 AND e.withdrawn_at IS NULL
      AND e.incomplete IS NOT TRUE AND e.kind IN ('photo','heart_rate') AND cardinality(e.media_keys) > 0
      AND p.day_one + e.day_index BETWEEN ${offset(today, -395)}::date AND ${offset(today, 1)}::date
      AND e.received_at <= ${clock}
    ORDER BY e.game_id,e.day_index,e.attempt LIMIT 5001`;
  if (rows.length > 5000) throw new Error("Private habit evidence exceeds the read limit");
  return {
    rows,
    revision: rows.length ? createHash("sha256").update(JSON.stringify(rows)).digest("hex") : "",
  };
}

/** Match whole task titles only. Compound targets, negations and open-ended goals stay unknown. */
export function habitTask(title: string): Observation | null {
  const text = title.trim().toLowerCase().replace(/[.!]$/, "").replace(/\s+/g, " ");
  const step =
    /^(?:(?:walk|hit|get|take|reach) )?(\d{1,2}(?:,\d{3})|\d{3,5}|\d{1,2}(?:\.\d)?k) steps(?: (?:daily|a day|per day))?$/.exec(
      text,
    );
  if (step) {
    const goal = Number(step[1].replace(",", "").replace("k", "")) * (step[1].endsWith("k") ? 1000 : 1);
    return goal >= 500 && goal <= 40000 ? { type: "step_goal", goal_steps: goal } : null;
  }
  if (/^(?:strength training|lift weights|weight training|resistance training)$/.test(text))
    return { type: "strength_training" };
  if (/^(?:no alcohol|alcohol[- ]free|avoid alcohol|no alcoholic drinks)$/.test(text))
    return { type: "no_alcohol" };
  if (/^(?:traditional|finnish) sauna$/.test(text)) return { type: "sauna", traditional_sauna: true };
  if (/^(?:push[- ]?ups|meditat(?:e|ion)|cold plunge|lights out)$/.test(text))
    return {
      type: text.startsWith("push")
        ? "pushups"
        : text.startsWith("meditat")
          ? "meditation"
          : text.replace(" ", "_"),
    };
  return null;
}
export async function habitEvidence(
  db: Db,
  memberId: string,
  rows: Proof[],
  zone: string,
  signal: AbortSignal,
) {
  const ids = [...new Set(rows.map((r) => r.gameId))];
  if (!ids.length) return [];
  const games = await db.game.findMany({
    where: { id: { in: ids }, players: { some: { memberId, joinedAt: { not: null }, leftAt: null } } },
    select: { id: true, terms: true, termsWordsEncrypted: true, wordsOwnerMemberId: true },
  });
  const plain = await openGameTexts(
    games.map((g) => ({
      memberId: g.wordsOwnerMemberId,
      table: "game",
      rowId: g.id,
      field: "terms_words",
      value: g.termsWordsEncrypted,
    })),
    signal,
  );
  const terms = new Map(
    games.map((g, i) => [g.id, { rules: parseStoredTerms(g.terms), words: parseTermWords(plain[i]!) }]),
  );
  return rows.flatMap((r) => {
    const game = terms.get(r.gameId);
    if (!game) return [];
    const version = effectiveTermWords(game.words, termsForDay(game.rules, r.dayIndex).n);
    const title = version.tasks.find((t) => t.seat === r.seat)?.text ?? version.defaultTask;
    const habit = title && habitTask(title);
    return habit
      ? [
          {
            ...habit,
            date: r.date,
            reported_at: toLocalDayKey(r.receivedAt, zone),
            done: true,
            verified_by: "photo",
          },
        ]
      : [];
  });
}
