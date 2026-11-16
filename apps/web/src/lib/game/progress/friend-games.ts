import "server-only";
import { addDaysToIsoDate } from "@murphai/contracts";
import { getPrisma } from "../../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import type { GameEntryData, GameEntryKind } from "../contract";
import { openGameTexts } from "../crypto";
import { effectiveTermWords, parseStoredTerms, parseTermWords, termsForDay } from "../rules";
import { openProgressMany, progressLookup } from "./crypto";
import { EXERCISES, type DayAmount } from "./registry";
import type { FriendMeasure } from "./friends";

import { normalizeTask, type InferredMeasure } from "./infer";
import { entryContribution, taskMeasureId, type ProgressTask, GAME_LIMIT, ENTRY_LIMIT } from "./series";
import type { MeasureState } from "./state";

export interface FriendGameSeries {
  incomplete: boolean;
  amounts: Map<string, DayAmount[]>;
  measures: Map<string, FriendMeasure>;
}

/** D7: load each current friend's own posts, including games the viewer never joined. */
export async function readFriendGameSeries(memberIds: string[]): Promise<FriendGameSeries> {
  return runWithHostedDomainRootUnwrapCache(async () => {
    const db = getPrisma();
    const games = await db.game.findMany({ where: { status: { in: ["live", "settled", "void"] },
      players: { some: { memberId: { in: memberIds } } } }, take: GAME_LIMIT + 1,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
        id: true, terms: true, termsWordsEncrypted: true, wordsOwnerMemberId: true,
        players: { where: { memberId: { in: memberIds } }, take: 10, select: { memberId: true, seat: true, dayOne: true } },
      } });
    const empty: FriendGameSeries = { incomplete: true, amounts: new Map(), measures: new Map() };
    if (games.length > GAME_LIMIT) return empty;
    const entries = await db.gameEntry.findMany({ where: { gameId: { in: games.map(game => game.id) },
      memberId: { in: memberIds }, attempt: { gt: 0 }, withdrawnAt: null, OR: [{ incomplete: false }, { incomplete: null }] },
      take: ENTRY_LIMIT + 1, orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: { id: true, memberId: true, gameId: true, kind: true, dayIndex: true, attempt: true, payloadEncrypted: true } });
    if (entries.length > ENTRY_LIMIT) return empty;
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
    const result: FriendGameSeries = { incomplete: false, amounts: new Map(), measures: new Map() };
    // Retakes have the same obligation key; only the latest surviving attempt counts.
    const surviving = new Map<string, typeof prepared[number]>();
    for (const item of prepared) {
      const key = `${item.entry.gameId}:${item.entry.memberId}:${item.entry.dayIndex}`;
      if ((surviving.get(key)?.entry.attempt ?? 0) < item.entry.attempt) surviving.set(key, item);
    }
    for (const { entry, date, payload, task } of surviving.values()) {
      const data = payload !== null && ["reps", "route"].includes(entry.kind) ? JSON.parse(payload) as GameEntryData : undefined;
      const contribution = entryContribution(entry.kind as GameEntryKind, data, task, states.get(entry.memberId) ?? new Map());
      if (contribution.pending) { result.incomplete = true; continue; }
      if (contribution.id.endsWith(".days")) continue;
      const amounts = result.amounts.get(entry.memberId) ?? [];
      amounts.push({ measureId: contribution.id, date, amount: contribution.amount });
      result.amounts.set(entry.memberId, amounts);
      result.measures.set(contribution.id, friendMeasure(contribution.id));
    }
    return result;
  });
}

export function friendMeasure(id: string): FriendMeasure {
  if (id === "steps" || id === "sleep") return { id, label: id === "steps" ? "Steps" : "Sleep", icon: id,
    noun: id, format: id === "steps" ? "count" : "duration" };
  const [name, unit] = id.split(".");
  const exercise = Object.entries(EXERCISES).find(([key]) => key === name)?.[1];
  return { id, label: exercise?.label ?? name[0].toUpperCase() + name.slice(1),
    icon: exercise?.icon ?? "dumbbell", noun: name,
    format: unit === "seconds" ? "duration" : unit === "meters" ? "distance" : unit === "days" ? "days" : "count" };
}
