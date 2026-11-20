import "server-only";
import { ProgressReadTiming } from "./read-timing";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { gameHttpError } from "../http/errors";
import { getPrisma } from "../../prisma";
import type { Medal, Moment, Progress } from "./contract";
import { readAwards, settleAwards, markAwardsSeen, withGameEarnedDay, type StoredAward } from "./awards";
import { ACHIEVEMENTS, HEALTH, type AchievementContext } from "./registry";
import { measureLadder, measureRungs, projection, roundValues, rungFor } from "./goals";
import { formatAmount, formatNumber } from "./format";
import { cumulativePoints, describeMeasure, scheduleInference, type MeasureSeries, type TodayCheckIn } from "./series";
import { hasHealthAuthority, readOwnSeries, RUN_MEASURE_ID } from "./vault-runs";
import type { BeforeProgressMutation, MeasureState } from "./state";
import { routeAwardName } from "./route-progress";
import { BANK, type RungDefinition } from "./bank";
import type { ClientUnits } from "../../companion/client-info";
import { firstRouteId, routePlaces, routeView, setFirstRoute } from "./routes";
import { resolveRoute } from "./mapbox";
import { picturePin, readProgressPics } from "./pics";
import { healthAgeTitle } from "./health";

// Charts moved their day 0 to the app on Nov 19, 2026; anyone on it earlier starts a month before.
const CHARTS_FROM = "2026-10-19";

export function achievementContext(measures: readonly MeasureSeries[], states: ReadonlyMap<string, MeasureState>): AchievementContext {
  return { measures: measures.map(measure => {
    const points = cumulativePoints(measure.amounts);
    const total = points.at(-1)?.[1] ?? 0;
    return { id: measure.id, unit: measure.unit, noun: measure.unit === "days" ? measure.label.toLowerCase() : measure.noun, pending: measure.pending, points,
      rungs: measureRungs(measure, states.get(measure.id) ?? {}),
      legs: states.get(measure.id)?.legs ?? [],
      rounds: roundValues(total, measure).filter(at => at <= total),
    };
  }) };
}

function gameCandidates(snapshot: Awaited<ReturnType<typeof readOwnSeries>>) {
  const evaluate = (measures: MeasureSeries[]) => {
    const context = achievementContext(measures, snapshot.states);
    return ACHIEVEMENTS.flatMap(achievement => achievement(context));
  };
  const candidates = evaluate(snapshot.measures);
  if (!snapshot.vaultRunsMerged) return candidates;
  const gameDays = new Map(evaluate(snapshot.gameRunning ? [snapshot.gameRunning] : []).map(award => [award.key, award.on]));
  return candidates.map(award => award.measureId === RUN_MEASURE_ID
    ? withGameEarnedDay(award, gameDays.get(award.key)) : award);
}

export function visibleAwards(awards: readonly StoredAward[], healthAuthority: boolean): StoredAward[] {
  if (healthAuthority) return [...awards];
  const visible = awards.flatMap(award => {
    if (award.kind.startsWith("health") || (award.measureId !== null && award.measureId in HEALTH)) return [];
    if (award.data.health !== true) return [award];
    const on = award.data.gameEarnedOn;
    return award.measureId === RUN_MEASURE_ID && typeof on === "string" ? [{ ...award, on }] : [];
  });
  // Independent game crossings can differ from the private dates used for DB ordering.
  return visible.sort((a, b) => b.on.localeCompare(a.on) || b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

type MeasureLabel = Pick<Progress["measures"][number], "id" | "label">;

/** A friend pass says what it was in; a health number's medal opens Health. */
export function medalView(award: StoredAward, gold: boolean, units: ClientUnits, measures: readonly MeasureLabel[] = []): Medal {
  let face: Medal["face"], title: string, detail: string;
  if (award.kind === "landmark" || award.kind === "time") {
    const rung = rungFor(award.data.rung as RungDefinition, 0, award.on, units);
    face = rung.drawing === null ? { generic: true } : { drawing: rung.drawing };
    title = rung.name;
    // Both name their exercise: a pushups landmark and a pull-ups one can be the same tower.
    detail = award.kind === "time" ? `${rung.atText} ${award.data.noun}` : `${formatNumber(Math.ceil(rung.at), "compact")} ${award.data.noun}`;
  } else if (award.kind === "total" || award.kind === "days") {
    const value = award.data.value as number, unit = award.data.unit as MeasureSeries["unit"];
    const amount = formatAmount(value, unit, "compact", units);
    face = { number: amount.text };
    title = unit === "seconds" ? value < 3600 ? `${value / 60} ${value === 60 ? "minute" : "minutes"}`
      : `${formatNumber(value / 3600, "compact")} ${value === 3600 ? "hour" : "hours"}`
      : unit === "days" ? `${amount.text} days` : amount.text;
    detail = award.data.noun as string;
  } else if (award.kind === "route") {
    face = { drawing: "route" }; title = routeAwardName(award, award.data.to as string);
    detail = `${formatAmount(award.data.distanceM as number, "meters", "full", units).text} from ${award.data.from}`;
  } else {
    face = award.data.face as Medal["face"];
    title = award.kind === "healthAge" ? healthAgeTitle(award.data.percentile as number) : award.data.title as string;
    const label = award.kind === "friend" ? measures.find(measure => measure.id === award.measureId)?.label : undefined;
    detail = label ? `in ${label.toLowerCase()}, all time` : award.data.detail as string;
  }
  const page = award.measureId !== null && award.measureId in HEALTH ? "health" : award.data.page as Medal["open"]["page"];
  return { id: award.id, kind: award.kind, gold, earnedOn: award.on, face, title, detail, open: { page, measureId: award.measureId } };
}

/** Keep each exercise together; the first total is also its title-coin candidate. */
export function medalsView(awards: readonly StoredAward[], units: ClientUnits, measures: readonly MeasureLabel[] = []): Medal[] {
  const totals = new Map<string | null, StoredAward[]>();
  for (const award of awards) if (award.kind === "total" || award.kind === "days") {
    const group = totals.get(award.measureId) ?? [];
    group.push(award); totals.set(award.measureId, group);
  }
  for (const group of totals.values()) group.sort((a, b) => (b.data.value as number) - (a.data.value as number));
  return awards.flatMap(award => {
    if (award.kind !== "total" && award.kind !== "days") return [medalView(award, award === awards[0], units, measures)];
    const group = totals.get(award.measureId) ?? [];
    totals.delete(award.measureId);
    return group.map((item, index) => medalView(item, award === awards[0] && index === 0, units));
  });
}

function momentWords(kind: Moment["kind"], group: readonly StoredAward[], gold: boolean, units: ClientUnits, measures: readonly MeasureLabel[]): Pick<Moment, "title" | "line"> {
  const first = group[0];
  const { title, detail } = medalView(first, gold, units, measures);
  if (kind === "bigDay") {
    const count = group.length < 10 ? ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][group.length] : formatNumber(group.length, "compact");
    return { title: `${count} wins in one day`, line: null };
  }
  if (kind === "goal" || kind === "held") return { title, line: rungFor(first.data.rung as RungDefinition, 0, first.on, units).blurb };
  if (kind === "route") return { title, line: detail };
  if (first.kind.startsWith("health")) return { title: `${title}${first.kind === "healthAge" && first.data.percentile === 50 ? " of" : ""} ${detail}`,
    line: gold ? "Your best since you joined. It's your newest medal, so it's the gold one on Prizes." : "Your best since you joined." };
  return { title: `${title} ${detail}`, line: null };
}

/** A moment is an earned date, grouping every unseen crossing on that day. */
export function momentsView(awards: readonly StoredAward[], measures: Progress["measures"], units: ClientUnits): Moment[] {
  const groups = new Map<string, StoredAward[]>();
  for (const award of awards) {
    if (award.seenAt !== null) continue;
    const group = groups.get(award.on) ?? [];
    group.push(award); groups.set(award.on, group);
  }
  return [...groups].map(([on, group]) => {
    const first = group[0];
    const sameMeasure = group.every(award => award.measureId === first.measureId);
    const kind = group.length > 1 ? "bigDay" : first.kind === "landmark" ? "goal" : first.kind === "time" ? "held" : first.kind === "route" ? "route" : "medal";
    return { id: `day:${on}`, kind, ...momentWords(kind, group, first === awards[0], units, measures), medalIds: group.map(award => award.id), measureId: sameMeasure ? first.measureId : null,
      nextGoal: sameMeasure ? measures.find(measure => measure.id === first.measureId)?.ladder?.next ?? null : null };
  });
}

export function measureView(measure: MeasureSeries, state: MeasureState, awards: readonly StoredAward[], today: string, units: ClientUnits): Progress["measures"][number] {
  const points = cumulativePoints(measure.amounts);
  const todayValue = measure.amounts.filter(day => day.date === today).reduce((sum, day) => sum + day.amount, 0);
  return { id: measure.id, label: measure.label, noun: measure.noun, icon: measure.icon,
    format: measure.unit === "seconds" ? "duration" : measure.unit === "meters" ? "distance" : measure.unit === "days" ? "days" : "count",
    source: "games", pending: measure.pending, gameOn: measure.gameOn, needsPerDay: measure.needsPerDay,
    total: formatAmount(points.at(-1)?.[1] ?? 0, measure.unit, "full", units), today: todayValue > 0 ? formatAmount(todayValue, measure.unit, "compact", units) : null,
    points, projection: projection(measure, today, units), ladder: measureLadder(measure, state, awards, units),
    route: routeView(measure.id, state, points, awards, units, today), pics: [] };
}

/** Before today's check-in is in, the measure as the next read will show it: the same view with that day's
 * amount added. Vault runs count a day's larger of game and vault runs, so Running promises nothing then. */
export function checkInView(checkIn: TodayCheckIn, snapshot: { measures: readonly MeasureSeries[]; states: ReadonlyMap<string, MeasureState>; vaultRunsMerged: boolean },
  measures: readonly Progress["measures"][number][], awards: readonly StoredAward[], today: string, units: ClientUnits): Progress["checkIns"] {
  const shown = measures.find(measure => measure.id === checkIn.measureId);
  const entry = { gameId: checkIn.gameId, dayIndex: checkIn.dayIndex, measureId: checkIn.measureId, entryId: checkIn.entryId };
  if (checkIn.adds === null) return shown ? [{ ...entry, after: null }] : [];
  if (checkIn.measureId === RUN_MEASURE_ID && snapshot.vaultRunsMerged) return [];
  const series = snapshot.measures.find(measure => measure.id === checkIn.measureId)
    ?? { ...describeMeasure(checkIn.measureId, checkIn.name, checkIn.text), pending: false, gameOn: true, needsPerDay: checkIn.needsPerDay, amounts: [] };
  const after = measureView({ ...series, amounts: [...series.amounts, { measureId: checkIn.measureId, date: checkIn.date, amount: checkIn.adds }] },
    snapshot.states.get(checkIn.measureId) ?? {}, awards, today, units);
  return [{ ...entry, after: { ...after, label: shown?.label ?? after.label } }];
}

export async function readProgress(memberId: string, units: ClientUnits, beforeMutationTx: BeforeProgressMutation, timing = new ProgressReadTiming()): Promise<Progress> {
  const db = getPrisma();
  const profile = await timing.measure("profile", () => db.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true, createdAt: true } }));
  if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
  const clock = new Date();
  const today = formatTimeZoneDateTimeParts(clock, profile.timeZone).dayKey;
  // Day 0 of the charts: the day they started the app, and for everyone on it before then, Oct 19.
  const joinedOn = [formatTimeZoneDateTimeParts(profile.createdAt, profile.timeZone).dayKey, CHARTS_FROM].sort().at(-1)!;
  const snapshot = await timing.measure("gameSeries", () => readOwnSeries(memberId, clock, timing));
  const pictures = await timing.measure("pictures", () => readProgressPics(memberId));
  let attemptedInsert = false;
  if (!snapshot.incomplete) {
    const firstRoutes = snapshot.measures.filter(measure => !measure.pending
      && (measure.unit === "meters" || measure.unit === "steps") && !snapshot.states.get(measure.id)?.legs);
    if (firstRoutes.length) {
      const places = routePlaces(BANK.find(entry => entry.kind === "route" && entry.id === firstRouteId(profile.timeZone))!.name)!;
      // Mapbox down: the page still loads without a map; the next read sets the first route.
      const route = await timing.measure("journeys", () => resolveRoute(places.from, places.to)).catch(() => null);
      if (route) for (const measure of firstRoutes) snapshot.states.set(measure.id,
        await setFirstRoute(memberId, measure.id, route, beforeMutationTx));
    }
    if (snapshot.pending.length === 0) {
      attemptedInsert = await timing.measure("awards", () => settleAwards(memberId, gameCandidates(snapshot), beforeMutationTx,
        { awards: snapshot.awards, timeZone: profile.timeZone }));
    }
    scheduleInference(snapshot.pending.map(task => ({ ...task, memberId })), beforeMutationTx);
  }
  // Deleting a friend can cascade-delete their awards after the snapshot.
  const stored = attemptedInsert || snapshot.awards.some(award => award.subjectMemberId !== null)
    ? await timing.measure("awards", () => readAwards(memberId)) : snapshot.awards;
  const awards = visibleAwards(stored, await timing.measure("auth", () => hasHealthAuthority(memberId)));
  const destinations = awards.map(award => {
    const successor = award.measureId && snapshot.successors.get(award.measureId);
    return successor ? { ...award, measureId: successor } : award;
  });
  return timing.measure("render", () => {
    const byId = new Map(snapshot.measures.map(measure => [measure.id,
      measureView(measure, snapshot.states.get(measure.id) ?? {}, awards, today, units)]));
    for (const pic of pictures.pics) {
      const id = snapshot.successors.get(pic.measureId) ?? pic.measureId;
      let view = byId.get(id);
      if (!view) {
        // Picture metadata outlives the post. Only synthesize recognized game measure units.
        if (!/^[^.]+\.(reps|seconds|steps|meters|days)$/u.test(id)) continue;
        const task = snapshot.checkIns.find(checkIn => checkIn.measureId === id);
        const name = task?.name ?? id.split(".")[0];
        view = measureView({ ...describeMeasure(id, name, task?.text ?? name), amounts: [], pending: false,
          gameOn: Boolean(task), needsPerDay: false }, snapshot.states.get(id) ?? {}, awards, today, units);
        byId.set(id, view);
      }
      view.pics.push(picturePin(pic, view.points, profile.timeZone));
    }
    const measures = [...byId.values()];
    // Two units of the same exercise need distinct pills (row 15).
    for (const measure of measures) if (measure.format === "duration" && measures.some(other => other.id !== measure.id && other.label === measure.label)) measure.label += " minutes";
    const medals = medalsView(destinations, units, measures);
    const shelf: string[] = [];
    const kinds = new Set<string>();
    for (const medal of medals) {
      const key = `${medal.kind}:${medal.open.measureId ?? ""}`;
      if (kinds.has(key)) continue;
      kinds.add(key); shelf.push(medal.id);
      if (shelf.length === 6) break;
    }
    const checkIns = snapshot.checkIns.flatMap(checkIn => checkInView(checkIn, snapshot, measures, awards, today, units));
    return { joinedOn, today, incomplete: snapshot.incomplete || pictures.incomplete, contributionsIncomplete: snapshot.incomplete, picturesIncomplete: pictures.incomplete, measures,
      medals, shelf, moments: momentsView(destinations, measures, units), picCount: pictures.pics.length, checkIns };
  });
}

export async function seeMoments(memberId: string, momentIds: readonly string[], beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const awards = visibleAwards(await readAwards(memberId), await hasHealthAuthority(memberId));
  const requested = new Set(momentIds);
  const ids = awards.filter(award => requested.has(`day:${award.on}`)).map(award => award.id);
  await markAwardsSeen(memberId, ids, beforeMutationTx);
}
