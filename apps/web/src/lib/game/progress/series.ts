import "server-only";
import { ProgressReadTiming } from "./read-timing";

import { after } from "next/server";
import type { GameEntryData, GameEntryKind, GameRepsData, GameRouteData } from "../contract";
import { openGameTexts } from "../crypto";
import { effectiveTermWords, completedEntry, dayIndexAt, indexGameEntries, liveEntry, termsForDay, type StoredTerms, type TermWords } from "../rules";
import { hasGameIdentity } from "../roster";
import { getPrisma } from "../../prisma";
import { runWithFreshHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { openProgressMany, progressLookup, sealProgressMany } from "./crypto";
import { inferTask, inferenceClient, normalizeTask, type InferredMeasure, type TaskInput } from "./infer";
import { EXERCISES, READERS, type DayAmount } from "./registry";
import type { BeforeProgressMutation, MeasureState } from "./state";
import { gameDays, type GameDaysSource } from "./game-days";
import { readAwards } from "./awards";

export interface ProgressTask extends TaskInput { lookup: string; inferred: InferredMeasure | null }
export interface PendingProgressTask extends ProgressTask { memberId: string }
export interface ProgressGame extends GameDaysSource { tasks: Map<number, ProgressTask>; payloads: Map<string, GameEntryData> }
export interface MeasureSeries {
  id: string; name: string; label: string; noun: string; icon: string;
  unit: "reps" | "seconds" | "meters" | "steps" | "days";
  ftPerRep: number; pending: boolean; gameOn: boolean; needsPerDay: boolean;
  amounts: DayAmount[];
}

const factors = { reps: 1, seconds: 1, minutes: 60, hours: 3600, meters: 1, km: 1000, miles: 1609.344, steps: 1, days: 1 };

const taskDaysId = (task: ProgressTask) => `h${task.lookup.slice(-12)}.days`;

export function taskMeasureId(task: ProgressTask): string {
  const inferred = task.inferred;
  const name = inferred?.name ?? `h${task.lookup.slice(-12)}`;
  if (!inferred || inferred.unit === "days" || inferred.quantity === null) return taskDaysId(task);
  const unit = ["minutes", "hours"].includes(inferred.unit) ? "seconds" : ["km", "miles"].includes(inferred.unit) ? "meters" : inferred.unit;
  return `${name}.${unit}`;
}

export function describeMeasure(id: string, name: string, label: string): Omit<MeasureSeries, "amounts" | "pending" | "gameOn" | "needsPerDay"> {
  const unit = id.split(".")[1] as MeasureSeries["unit"];
  const exercise = Object.hasOwn(EXERCISES, name) ? EXERCISES[name as keyof typeof EXERCISES] : undefined;
  const noun = unit === "days" ? "days" : unit === "seconds" ? name === "planks" ? "planked" : `of ${exercise?.label.toLowerCase() ?? label.toLowerCase()}`
    : unit === "meters" ? name === "run" ? "run" : "walked" : exercise?.label.toLowerCase() ?? name;
  return { id, name, label: exercise?.label ?? label, noun, icon: exercise?.icon ?? "dumbbell", unit, ftPerRep: exercise?.ftPerRep ?? 1 };
}

type Contribution = Pick<MeasureSeries, "id" | "name" | "pending" | "needsPerDay"> & { amount: number };

function taskContribution(task: ProgressTask, states: ReadonlyMap<string, MeasureState>): Contribution {
  const id = taskMeasureId(task);
  const name = task.inferred?.name ?? id.split(".")[0];
  const perDay = states.get(id)?.perDay;
  if (perDay !== undefined) return { id: `${name}.reps`, name, amount: perDay, pending: false, needsPerDay: false };
  const pending = task.inferred === null;
  const amount = task.inferred?.quantity === null || task.inferred === null ? 1 : task.inferred.quantity * factors[task.inferred.unit];
  return { id, name, amount, pending, needsPerDay: !pending && id.endsWith(".days") };
}

/** Entry kind and sealed payload are written together by the existing game boundary. */
export function entryContribution(kind: GameEntryKind, payload: GameEntryData | undefined, task: ProgressTask, states: ReadonlyMap<string, MeasureState>): Contribution {
  if (kind === "reps") {
    const reps = payload as GameRepsData;
    return { id: READERS[0].measureId(reps), name: reps.exercise, amount: READERS[0].amount(reps), pending: false, needsPerDay: false };
  }
  if (kind === "route") {
    const route = payload as GameRouteData;
    return { id: READERS[1].measureId(route), name: route.activity, amount: READERS[1].amount(route), pending: false, needsPerDay: false };
  }
  return taskContribution(task, states);
}

/** The entry owns its quantity; task inference is used only without a typed payload. */
export function gameSeries(games: readonly ProgressGame[], memberId: string, states: ReadonlyMap<string, MeasureState>): MeasureSeries[] {
  const measures = new Map<string, MeasureSeries>();
  const live = new Set<string>();
  for (const game of games) {
    const player = game.state.players.find(player => player.memberId === memberId)!;
    const today = dayIndexAt(player, game.now)!;
    const gameOn = game.state.game.status === "live" && !player.leftAt && today >= 0 && today < game.state.game.lengthDays;
    if (gameOn) live.add(taskContribution(game.tasks.get(termsForDay(game.state.game.terms, today).n)!, states).id);
    const entries = indexGameEntries(game.state.entries);
    for (const day of gameDays(game, memberId) ?? []) {
      const entry = completedEntry(entries, memberId, day.dayIndex);
      if (!entry) continue;
      const task = game.tasks.get(termsForDay(game.state.game.terms, day.dayIndex).n)!;
      const { id, name, amount, pending, needsPerDay } = entryContribution(entry.kind, game.payloads.get(entry.id), task, states);
      let series = measures.get(id);
      if (!series) {
        series = { ...describeMeasure(id, name, task.text), pending, needsPerDay, gameOn: false, amounts: [] };
        measures.set(id, series);
      }
      series.pending ||= pending;
      series.needsPerDay ||= needsPerDay;
      series.gameOn ||= gameOn;
      series.amounts.push({ measureId: id, date: day.date, amount });
    }
  }
  return [...measures.values()].map(measure => ({ ...measure, gameOn: measure.gameOn || live.has(measure.id) }));
}

export interface TodayCheckIn { gameId: string; dayIndex: number; measureId: string; name: string; text: string; date: string;
  needsPerDay: boolean;
  /** The entry it counted, once it's in. */
  entryId: string | null;
  /** What the check-in will add; null once it's in. */
  adds: number | null }

/** Each live game's check-in today and the measure it adds to. Before it's in, `adds` is what a photo or
 * words post adds; one that brings its own count (reps, a route) adds that instead, which only the app knows.
 * A task Murph is still reading promises nothing, and nor does a post its player said they didn't finish. */
export function todayCheckIns(games: readonly ProgressGame[], memberId: string, states: ReadonlyMap<string, MeasureState>): TodayCheckIn[] {
  return games.flatMap(game => {
    const player = game.state.players.find(player => player.memberId === memberId)!;
    const today = dayIndexAt(player, game.now)!;
    const day = game.state.game.status === "live" && !player.leftAt ? gameDays(game, memberId)?.find(day => day.dayIndex === today) : undefined;
    if (!day) return [];
    const task = game.tasks.get(termsForDay(game.state.game.terms, today).n)!;
    const entries = indexGameEntries(game.state.entries);
    const entry = completedEntry(entries, memberId, today);
    if (!entry && liveEntry(entries, memberId, today)) return [];
    const contribution = entry ? entryContribution(entry.kind, game.payloads.get(entry.id), task, states) : taskContribution(task, states);
    if (contribution.pending) return [];
    return [{ gameId: game.state.game.id, dayIndex: today, measureId: contribution.id, name: contribution.name, text: task.text,
      date: day.date, needsPerDay: contribution.needsPerDay, entryId: entry?.id ?? null, adds: entry ? null : contribution.amount }];
  });
}

export function cumulativePoints(amounts: readonly DayAmount[]): [string, number][] {
  const days = new Map<string, number>();
  for (const amount of amounts) days.set(amount.date, (days.get(amount.date) ?? 0) + amount.amount);
  let total = 0;
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => [date, total += amount]);
}

/** Own history survives departure and a game's voiding. */
export async function readGameSeries(memberId: string, clock: Date, timing = new ProgressReadTiming(), stateIds: readonly string[] = []) {
  const db = getPrisma();
  const games = await db.game.findMany({
    where: { players: { some: { memberId, dayOne: { not: null } } }, status: { in: ["live", "settled", "void"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdBy: true, status: true, maxPlayers: true, lengthDays: true, terms: true,
      termsWordsEncrypted: true, wordsOwnerMemberId: true, startsOn: true, settledAt: true, devClockOffsetMs: true,
      events: { where: { type: { in: ["cancelled", "blocked"] } }, orderBy: { id: "desc" }, take: 1, select: { createdAt: true } },
      players: { take: 10, select: { memberId: true, seat: true, dayOne: true, timeZone: true, joinedAt: true, leftAt: true } } },
  });
  timing.counts.games = games.length;
  const entries = await db.gameEntry.findMany({ where: { memberId, gameId: { in: games.map(game => game.id) } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: { id: true, gameId: true, memberId: true, dayIndex: true, attempt: true, kind: true, incomplete: true,
      receivedAt: true, withdrawnAt: true, payloadEncrypted: true },
  });
  timing.counts.entries = entries.length;
  const typed = entries.filter(entry => entry.attempt > 0 && !entry.incomplete && !entry.withdrawnAt && ["reps", "route"].includes(entry.kind));
  const plain = await openGameTexts([
    ...games.map(game => ({ memberId: game.wordsOwnerMemberId, table: "game" as const, rowId: game.id, field: "terms_words", value: game.termsWordsEncrypted })),
    ...typed.map(entry => ({ memberId, table: "game_entry" as const, rowId: entry.id, field: "payload", value: entry.payloadEncrypted })),
  ]);
  const payloads = new Map(typed.map((entry, i) => [entry.id, JSON.parse(plain[games.length + i]!) as GameEntryData]));
  const tasks = new Map<string, ProgressTask>();
  const facts: ProgressGame[] = games.map((game, i) => {
    const words = JSON.parse(plain[i]!) as TermWords;
    // service.ts persists decideNewTerms/applyChangeTermsTx's StoredTerms through
    // toPrismaJsonObject; Prisma erases that type, not the validated write contract.
    const terms = game.terms as unknown as StoredTerms;
    const player = game.players.filter(hasGameIdentity).find(player => player.memberId === memberId)!;
    const ending = game.events[0];
    // Departure timestamps already use the game's clock; events use the database clock.
    const departedAt = game.players.flatMap(player => player.leftAt ? [player.leftAt] : []).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const versions = new Map<number, ProgressTask>();
    for (const version of terms.versions) {
      const effective = effectiveTermWords(words, version.n);
      const text = effective.tasks.find(task => task.seat === player.seat)?.text ?? effective.defaultTask!;
      const kind = version.checkInKind ?? "photo";
      const lookup = progressLookup(memberId, "task", [normalizeTask(text), kind]);
      const task: ProgressTask = { lookup, text, kind, inferred: null };
      tasks.set(lookup, task); versions.set(version.n, task);
    }
    return { tasks: versions, payloads,
      now: new Date(clock.getTime() + Number(game.devClockOffsetMs ?? 0)),
      settledAt: game.settledAt ? new Date(game.settledAt.getTime() + Number(game.devClockOffsetMs ?? 0)) : null,
      endedAt: game.status === "void" ? ending ? new Date(ending.createdAt.getTime() + Number(game.devClockOffsetMs ?? 0)) : departedAt : null,
      state: { game: { id: game.id, createdBy: game.createdBy, seats: game.maxPlayers, status: game.status as GameDaysSource["state"]["game"]["status"],
        lengthDays: game.lengthDays, terms, startsOn: game.startsOn?.toISOString().slice(0, 10) ?? null, inviteExpiresAt: null },
      players: [{ ...player, dayOne: player.dayOne!.toISOString().slice(0, 10) }],
      entries: entries.filter(entry => entry.gameId === game.id).map(entry => ({ ...entry, kind: entry.kind as GameEntryKind, mediaKeys: [], blurHash: null })) },
    };
  });
  const cached = await db.gameProgressTaskMeasure.findMany({ where: { memberId, lookup: { in: [...tasks.keys()] } }, select: { lookup: true, measureEncrypted: true } });
  const inferred = await openProgressMany<InferredMeasure>(cached.map(row => ({ memberId, table: "game_progress_task_measure", rowId: row.lookup, field: "measure", value: row.measureEncrypted })));
  const byLookup = new Map(cached.map((row, i) => [row.lookup, inferred[i]]));
  for (const game of facts) for (const task of game.tasks.values()) task.inferred = byLookup.get(task.lookup) ?? null;
  const ids = new Set(facts.flatMap(game => [...game.tasks.values()].flatMap(task => [taskMeasureId(task), `${task.inferred?.name ?? `h${task.lookup.slice(-12)}`}.reps`])));
  for (const payload of payloads.values()) {
    if ("count" in payload) ids.add(READERS[0].measureId(payload));
    else if ("distanceM" in payload) ids.add(READERS[1].measureId(payload));
  }
  const awards = await timing.measure("awards", () => readAwards(memberId));
  const savedMeasures = new Set(awards.flatMap(award => award.measureId && ["landmark", "time", "route"].includes(award.kind)
    && ["reps", "seconds", "meters", "steps"].includes(award.measureId.split(".")[1]) ? [award.measureId] : []));
  for (const id of [...savedMeasures, ...stateIds]) ids.add(id);
  const lookups = new Map([...ids].map(id => [progressLookup(memberId, "measure", [id]), id]));
  const stateRows = await db.gameProgressMeasure.findMany({ where: { memberId, lookup: { in: [...lookups.keys()] } }, select: { lookup: true, stateEncrypted: true } });
  const openedStates = await openProgressMany<MeasureState>(stateRows.map(row => ({ memberId, table: "game_progress_measure", rowId: row.lookup, field: "state", value: row.stateEncrypted })));
  const states = new Map(stateRows.map((row, i) => [lookups.get(row.lookup)!, openedStates[i]]));
  const untyped = new Set<string>();
  for (const game of facts) {
    const entries = indexGameEntries(game.state.entries);
    for (const day of gameDays(game, memberId) ?? []) {
      const entry = completedEntry(entries, memberId, day.dayIndex);
      if (entry && entry.kind !== "reps" && entry.kind !== "route") untyped.add(game.tasks.get(termsForDay(game.state.game.terms, day.dayIndex).n)!.lookup);
    }
  }
  const pending = [...tasks.values()].filter(task => untyped.has(task.lookup) && !byLookup.has(task.lookup));
  const measures = gameSeries(facts, memberId, states);
  // Even removal of the final post preserves completed ladders/routes and their editable goal.
  for (const id of savedMeasures) if (!measures.some(measure => measure.id === id)) {
    const name = id.split(".")[0];
    measures.push({ ...describeMeasure(id, name, name), pending: false, gameOn: false, needsPerDay: false, amounts: [] });
  }
  const successors = measureSuccessors(tasks.values(), states, measures);
  return { states, measures, successors, awards, pending, checkIns: todayCheckIns(facts, memberId, states) };
}

function measureSuccessors(tasks: Iterable<ProgressTask>, states: ReadonlyMap<string, MeasureState>, measures: readonly MeasureSeries[]) {
  const successors = new Map<string, string>();
  const shown = new Set(measures.map(measure => measure.id));
  for (const task of tasks) {
    const previous = taskDaysId(task);
    const current = taskContribution(task, states).id;
    if (current !== previous && shown.has(current)) successors.set(previous, current);
  }
  return successors;
}

/** Deduplicated, sequential provider work after the response; one batched cache insert. */
export function scheduleInference(pending: readonly PendingProgressTask[], beforeMutationTx: BeforeProgressMutation): void {
  if (!pending.length) return;
  after(async () => {
    if (!process.env.OPENAI_API_KEY) return;
    const client = inferenceClient();
    const resolved = new Map<string, { task: ProgressTask; inferred: InferredMeasure }[]>();
    for (const task of pending) {
      const inferred = await inferTask({ text: normalizeTask(task.text), kind: task.kind }, client);
      if (inferred) {
        const own = resolved.get(task.memberId) ?? [];
        own.push({ task, inferred }); resolved.set(task.memberId, own);
      }
    }
    if (!resolved.size) return;
    await runWithFreshHostedDomainRootUnwrapCache(async () => {
      const data: { memberId: string; lookup: string; measureEncrypted: string }[] = [];
      for (const [memberId, tasks] of resolved) {
        const sealed = await sealProgressMany(memberId, tasks.map(({ task, inferred }) => ({ table: "game_progress_task_measure", rowId: task.lookup, field: "measure", value: inferred })));
        data.push(...tasks.map(({ task }, i) => ({ memberId, lookup: task.lookup, measureEncrypted: sealed[i] })));
      }
      await getPrisma().$transaction(async tx => {
        await beforeMutationTx(tx);
        await tx.gameProgressTaskMeasure.createMany({ skipDuplicates: true, data });
      });
    });
  });
}
