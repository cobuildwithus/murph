import "server-only";
import { ProgressReadTiming } from "./read-timing";
import { addDaysToIsoDate } from "@murphai/contracts";
import { Prisma } from "@prisma/client";
import { daysBetween } from "../time";
import { getPrisma } from "../../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import type { GameEntryData, GameEntryKind } from "../contract";
import { openGameTexts } from "../crypto";
import { gameNotFound } from "../http/errors";
import { effectiveTermWords, parseStoredTerms, parseTermWords, termsForDay } from "../rules";
import { openProgressMany, progressLookup } from "./crypto";
import { EXERCISES, type DayAmount } from "./registry";
import type { FriendMeasure } from "./friends";

import { normalizeTask, type InferredMeasure } from "./infer";
import { entryContribution, taskMeasureId, type ProgressTask, type PendingProgressTask, GAME_LIMIT, ENTRY_LIMIT } from "./series";
import type { MeasureState } from "./state";

export interface FriendGameSeries {
  incomplete: boolean;
  /** Peer contributions cover only the requested dates. Never settle lifetime passes from these. */
  windowed?: true;
  amounts: Map<string, DayAmount[]>;
  measures: Map<string, FriendMeasure>;
  pending: PendingProgressTask[];
  /** Each member's latest task per measure, by the day it counted for. */
  tasks: Map<string, Map<string, { date: string; text: string }>>;
}

type FriendScope = { viewer: string; period: { from: string; to: string } | null };
type GameSeats = { id: string; players: { memberId: string | null; dayOne: Date | null }[] };

function periodEntries(games: readonly GameSeats[], viewer: string, period: NonNullable<FriendScope["period"]>): Prisma.GameEntryWhereInput {
  // All viewer entries retain their exercise catalog and latest challenge. Each peer's
  // credited dates are relative to their own frozen day one, including late uploads.
  const peers = games.flatMap(game => game.players.flatMap(player => {
    if (!player.dayOne || !player.memberId || player.memberId === viewer) return [];
    const first = player.dayOne.toISOString().slice(0, 10);
    return [{ gameId: game.id, memberId: player.memberId,
      dayIndex: { gte: daysBetween(first, period.from), lte: daysBetween(first, period.to) } }];
  }));
  return { OR: [{ memberId: viewer }, ...peers] };
}

/** Find contributing games before loading their encrypted words. The viewer keeps
 * their lifetime catalog. Check for omitted peer days before settling lifetime passes. */
async function friendGameIds(memberIds: string[], scope?: FriendScope) {
  const inRange = scope?.period
    ? Prisma.sql`(member_id = ${scope.viewer} OR credited BETWEEN ${scope.period.from}::date AND ${scope.period.to}::date)`
    : Prisma.sql`TRUE`;
  return getPrisma().$queryRaw<{ id: string; windowed: boolean }[]>(Prisma.sql`
    WITH eligible AS NOT MATERIALIZED (
      SELECT e.game_id, e.member_id, p.day_one + e.day_index AS credited
      FROM game_entry e
      JOIN game_player p USING (game_id, member_id)
      JOIN game g ON g.id = e.game_id
      WHERE e.member_id = ANY(${memberIds}::text[]) AND p.day_one IS NOT NULL
        AND g.status IN ('live', 'settled', 'void')
        AND e.attempt > 0 AND e.withdrawn_at IS NULL AND e.incomplete IS NOT TRUE
    )
    SELECT DISTINCT game_id AS id, EXISTS (SELECT 1 FROM eligible WHERE NOT ${inRange}) AS windowed
    FROM eligible WHERE ${inRange} ORDER BY id LIMIT ${ENTRY_LIMIT + 1}
  `);
}

async function friendInputPage(gameIds: string[], memberIds: string[], remaining: number, scope?: FriendScope) {
  const db = getPrisma();
  const games = await db.game.findMany({ where: { id: { in: gameIds } },
    select: { id: true, terms: true, termsWordsEncrypted: true, wordsOwnerMemberId: true,
      players: { where: { memberId: { in: memberIds } }, take: 10, select: { memberId: true, seat: true, dayOne: true } } } });
  const entries = await db.gameEntry.findMany({ where: { gameId: { in: games.map(game => game.id) },
    memberId: { in: memberIds }, attempt: { gt: 0 }, withdrawnAt: null, OR: [{ incomplete: false }, { incomplete: null }],
    AND: scope?.period ? periodEntries(games, scope.viewer, scope.period) : undefined },
    take: remaining + 1, orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: { id: true, memberId: true, gameId: true, kind: true, dayIndex: true, attempt: true, payloadEncrypted: true } });
  return { games, entries };
}

async function friendInputs(memberIds: string[], scope?: FriendScope) {
  const ids = await friendGameIds(memberIds, scope);
  // Each distinct game has at least one eligible contribution.
  if (ids.length > ENTRY_LIMIT) return null;
  const result: Awaited<ReturnType<typeof friendInputPage>> = { games: [], entries: [] };
  for (let start = 0; start < ids.length; start += GAME_LIMIT) {
    const remaining = ENTRY_LIMIT - result.entries.length;
    const page = await friendInputPage(ids.slice(start, start + GAME_LIMIT).map(row => row.id), memberIds, remaining, scope);
    if (page.entries.length > remaining) return null;
    result.games.push(...page.games);
    result.entries.push(...page.entries);
  }
  return { ...result, windowed: ids[0]?.windowed ?? false };
}

async function scopedFriendInputs(memberIds: string[], scope?: FriendScope) {
  const full = await friendInputs(memberIds, scope);
  if (full || !scope || memberIds.length === 1) return { inputs: full, incomplete: !full };
  return { inputs: await friendInputs([scope.viewer]), incomplete: true };
}

/** D7: load each current friend's own posts, including games the viewer never joined. */
export async function readFriendGameSeries(memberIds: string[], timing = new ProgressReadTiming(), scope?: FriendScope): Promise<FriendGameSeries> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const db = getPrisma();
    const { inputs, incomplete } = await scopedFriendInputs(memberIds, scope);
    if (!inputs) return { incomplete: true, amounts: new Map(), measures: new Map(), pending: [], tasks: new Map() };
    const { games, entries, windowed } = inputs;
    timing.counts.games = games.length;
    timing.counts.entries = entries.length;
    const typedEntries = entries.filter(entry => entry.kind === "reps" || entry.kind === "route");
    const plain = await openGameTexts([
      ...games.map(game => ({ memberId: game.wordsOwnerMemberId, table: "game" as const,
        rowId: game.id, field: "terms_words", value: game.termsWordsEncrypted })),
      ...typedEntries.map(entry => ({ memberId: entry.memberId, table: "game_entry" as const,
        rowId: entry.id, field: "payload", value: entry.payloadEncrypted })),
    ]);
    const gameData = new Map(games.map((game, index) => [game.id,
      { game, terms: parseStoredTerms(game.terms), words: parseTermWords(plain[index]!) }]));
    const payloads = new Map(typedEntries.map((entry, index) => [entry.id, plain[games.length + index]]));
    const tasks = new Set<string>();
    const prepared = entries.map(entry => {
      const { game, terms, words } = gameData.get(entry.gameId)!;
      const player = game.players.find(player => player.memberId === entry.memberId)!;
      const version = termsForDay(terms, entry.dayIndex), text = effectiveTermWords(words, version.n);
      const task = text.tasks.find(task => task.seat === player.seat)?.text ?? text.defaultTask!;
      const lookup = progressLookup(entry.memberId, "task", [normalizeTask(task), version.checkInKind ?? "photo"]);
      if (entry.kind !== "reps" && entry.kind !== "route") tasks.add(lookup);
      return { entry, lookup, date: addDaysToIsoDate(player.dayOne!.toISOString().slice(0, 10), entry.dayIndex),
        payload: payloads.get(entry.id) ?? null,
        task: { lookup, text: task, kind: version.checkInKind ?? "photo", inferred: null } as ProgressTask };
    });
    const rows = await db.gameProgressTaskMeasure.findMany({ where: { memberId: { in: memberIds }, lookup: { in: [...tasks.keys()] } },
      take: tasks.size, select: { memberId: true, lookup: true, measureEncrypted: true } });
    const opened = await openProgressMany<InferredMeasure>(rows.map(row => ({ memberId: row.memberId,
      table: "game_progress_task_measure", rowId: row.lookup, field: "measure", value: row.measureEncrypted })));
    const cached = new Map(rows.map((row, index) => [row.lookup, opened[index]]));
    const stateLookups = new Map<string, string>();
    for (const item of prepared) {
      item.task.inferred = cached.get(item.lookup) ?? null;
      if (item.entry.kind === "reps" || item.entry.kind === "route") continue;
      const id = taskMeasureId(item.task);
      stateLookups.set(progressLookup(item.entry.memberId, "measure", [id]), id);
    }
    const stateRows = await db.gameProgressMeasure.findMany({ where: { memberId: { in: memberIds }, lookup: { in: [...stateLookups.keys()] } },
      take: stateLookups.size, select: { memberId: true, lookup: true, stateEncrypted: true } });
    const openedStates = await openProgressMany<MeasureState>(stateRows.map(row => ({ memberId: row.memberId,
      table: "game_progress_measure", rowId: row.lookup, field: "state", value: row.stateEncrypted })));
    const states = new Map<string, Map<string, MeasureState>>();
    stateRows.forEach((row, index) => {
      const own = states.get(row.memberId) ?? new Map<string, MeasureState>();
      own.set(stateLookups.get(row.lookup)!, openedStates[index]); states.set(row.memberId, own);
    });
    const result: FriendGameSeries = { incomplete, ...(windowed && { windowed: true }), amounts: new Map(), measures: new Map(), pending: [], tasks: new Map() };
    const pending = new Map<string, PendingProgressTask>();
    // Retakes have the same obligation key; only the latest surviving attempt counts.
    const surviving = new Map<string, typeof prepared[number]>();
    for (const item of prepared) {
      const key = `${item.entry.gameId}:${item.entry.memberId}:${item.entry.dayIndex}`;
      if ((surviving.get(key)?.entry.attempt ?? 0) < item.entry.attempt) surviving.set(key, item);
    }
    for (const { entry, date, payload, task } of surviving.values()) {
      const data = payload !== null && ["reps", "route"].includes(entry.kind) ? JSON.parse(payload) as GameEntryData : undefined;
      const contribution = entryContribution(entry.kind as GameEntryKind, data, task, states.get(entry.memberId) ?? new Map());
      if (contribution.pending) {
        pending.set(task.lookup, { ...task, memberId: entry.memberId });
        continue;
      }
      if (contribution.id.endsWith(".days")) continue;
      const amounts = result.amounts.get(entry.memberId) ?? [];
      amounts.push({ measureId: contribution.id, date, amount: contribution.amount });
      result.amounts.set(entry.memberId, amounts);
      result.measures.set(contribution.id, friendMeasure(contribution.id));
      keepLatestTask(result.tasks, entry.memberId, contribution.id, { date, text: task.text });
    }
    if (!incomplete) result.pending = [...pending.values()];
    return result;
  });
}

function keepLatestTask(tasks: FriendGameSeries["tasks"], memberId: string, measureId: string, task: { date: string; text: string }) {
  const own = tasks.get(memberId) ?? new Map<string, { date: string; text: string }>();
  if ((own.get(measureId)?.date ?? "") <= task.date) own.set(measureId, task);
  tasks.set(memberId, own);
}

export function friendMeasure(id: string): FriendMeasure {
  if (id === "steps" || id === "sleep") return { id, label: id === "steps" ? "Steps" : "Sleep", icon: id,
    noun: id, format: id === "steps" ? "count" : "duration" };
  const [name, unit] = id.split(".");
  if (!name) throw gameNotFound();
  const exercise = Object.entries(EXERCISES).find(([key]) => key === name)?.[1];
  return { id, label: exercise?.label ?? name[0].toUpperCase() + name.slice(1),
    icon: exercise?.icon ?? "dumbbell", noun: name,
    format: unit === "seconds" ? "duration" : unit === "meters" ? "distance" : unit === "days" ? "days" : "count" };
}
