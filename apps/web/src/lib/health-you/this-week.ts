import "server-only";
import { obligationDays } from "../game/board-streak";
import { readGameBlocks, isHiddenBy } from "../game/blocks";
import { openGameTexts } from "../game/crypto";
import { toRuleState } from "../game/row";
import {
  dayIndexAt,
  effectiveTermWords,
  eligibleFromDay,
  isScheduledDay,
  parseTermWords,
  playerStreak,
  termsForDay,
} from "../game/rules";
import { readNamesForViewer } from "../game/viewer-names";
import { weekdayOf } from "../game/time";
import { getPrisma } from "../prisma";
import type { ThisWeekRow } from "./contract";
import { distance, offset } from "./engine/model";

export type WorkingOnReader = (memberId: string) => Promise<Extract<ThisWeekRow, { kind: "workingOn" }>[]>;
export async function readThisWeek(
  memberId: string,
  today: string,
  clock: Date,
  signal: AbortSignal,
  workingOn: WorkingOnReader = async () => [],
): Promise<ThisWeekRow[]> {
  const db = getPrisma();
  const games = await db.game.findMany({
    where: { status: "live", players: { some: { memberId, leftAt: null, dayOne: { not: null } } } },
    orderBy: { id: "asc" },
    take: 101,
    include: { players: { take: 10 }, invitees: { take: 10 } },
  });
  if (games.length > 100) throw new Error("Current games exceed the view limit");
  const ids = games.map((g) => g.id);
  const entries = ids.length
    ? await db.gameEntry.findMany({
        where: { gameId: { in: ids }, memberId },
        take: 5001,
        select: {
          id: true,
          gameId: true,
          memberId: true,
          attempt: true,
          dayIndex: true,
          kind: true,
          withdrawnAt: true,
          receivedAt: true,
          incomplete: true,
        },
      })
    : [];
  if (entries.length > 5000) throw new Error("Current game entries exceed the view limit");
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
  const others = games.flatMap((g) =>
    g.players.flatMap((p) =>
      p.memberId && p.memberId !== memberId && p.joinedAt && !p.leftAt ? [p.memberId] : [],
    ),
  );
  const blocks = await readGameBlocks(db, memberId, others);
  const names = await readNamesForViewer(
    memberId,
    others.filter((id) => !isHiddenBy(blocks, id)),
  );
  const monday = offset(today, -weekdayOf(today));
  const rows: ThisWeekRow[] = [];
  for (const [i, g] of games.entries()) {
    const state = toRuleState(
      g,
      entries.filter((e) => e.gameId === g.id).map((e) => ({ ...e, mediaKeys: [], blurHash: null })),
    );
    const me = state.players.find((p) => p.memberId === memberId);
    if (!me?.dayOne || !plain[i]) continue;
    const now = new Date(clock.getTime() + Number(g.devClockOffsetMs ?? 0));
    const index = dayIndexAt(me, now)!;
    const words = effectiveTermWords(parseTermWords(plain[i]!), termsForDay(state.game.terms, index).n);
    const title = words.tasks.find((t) => t.seat === me.seat)?.text ?? words.defaultTask;
    if (!title) continue;
    const dates = new Map(obligationDays([{ state, now }], memberId)?.map((d) => [d.date, d]));
    const days = Array.from({ length: 7 }, (_, n) => {
      const date = offset(monday, n),
        d = dates.get(date),
        idx = distance(date, me.dayOne!);
      if (d) return d.done ? "done" : d.ended ? "missed" : "todo";
      return idx >= eligibleFromDay(state, me) && idx >= index && idx < g.lengthDays && isScheduledDay(state, idx)
        ? "todo"
        : "none";
    });
    const partner = state.players.find(
      (p) => p.memberId !== memberId && !p.leftAt && !isHiddenBy(blocks, p.memberId),
    );
    rows.push({
      kind: "challenge",
      gameId: g.id,
      title,
      streak: playerStreak(state, me, now),
      days,
      partner: partner
        ? { memberId: partner.memberId, firstName: names.get(partner.memberId) ?? "Partner" }
        : null,
    });
  }
  return [...rows, ...(await workingOn(memberId))];
}
