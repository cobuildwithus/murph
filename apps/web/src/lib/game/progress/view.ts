import "server-only";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import { termsForDay } from "../rules";
import type { Medal, Moment, Progress, Rung } from "./contract";
import { readAwards, settleAwards, markAwardsSeen, type StoredAward } from "./awards";
import { ACHIEVEMENTS, HEALTH, type AchievementContext } from "./registry";
import { measureLadder, measureRungs, projection, roundValues } from "./goals";
import { formatAmount, formatNumber } from "./format";
import { cumulativePoints, readGameSeries, scheduleInference, type MeasureSeries } from "./series";
import { bestRun, calendarMonths, currentRun, gameDays, obligationDays, type StreakDay } from "./streak";
import type { BeforeProgressMutation, MeasureState } from "./state";
import { BANK } from "./bank";
import { firstRouteId, routePlaces, routeView, setFirstRoute } from "./routes";
import { resolveRoute } from "./mapbox";
import { picturePin, readProgressPics } from "./pics";

export function achievementContext(measures: readonly MeasureSeries[], states: ReadonlyMap<string, MeasureState>, days: readonly StreakDay[]): AchievementContext {
  return { days, measures: measures.map(measure => {
    const points = cumulativePoints(measure.amounts);
    const total = points.at(-1)?.[1] ?? 0;
    return { id: measure.id, unit: measure.unit, noun: measure.noun, pending: measure.pending, points,
      rungs: measureRungs(measure, states.get(measure.id) ?? {}),
      legs: states.get(measure.id)?.legs ?? [],
      rounds: roundValues(total, measure.unit).filter(at => at <= total).map(at => {
        const amount = formatAmount(at, measure.unit);
        const title = measure.unit === "seconds" ? `${formatNumber(at / 3600, "compact")} ${at === 3600 ? "hour" : "hours"}`
          : measure.unit === "days" ? `${amount.text} days` : amount.text;
        return { at, face: { number: amount.text }, title, detail: measure.unit === "days" ? measure.label.toLowerCase() : measure.noun };
      }),
    };
  }) };
}

export function visibleAwards(awards: readonly StoredAward[], healthAuthority: boolean): StoredAward[] {
  return awards.filter(award => healthAuthority || !(award.kind.startsWith("health") || (award.measureId !== null && award.measureId in HEALTH)));
}

export function medalView(award: StoredAward, gold: boolean): Medal {
  return { id: award.id, kind: award.kind, gold, earnedOn: award.on,
    face: award.data.face as Medal["face"], title: award.data.title as string, detail: award.data.detail as string,
    open: { page: award.data.page as Medal["open"]["page"], measureId: award.measureId } };
}

function momentWords(kind: Moment["kind"], group: readonly StoredAward[], gold: boolean): Pick<Moment, "title" | "line"> {
  const first = group[0];
  const title = first.data.title as string;
  const detail = first.data.detail as string;
  if (kind === "bigDay") {
    const count = group.length < 10 ? ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][group.length] : formatNumber(group.length, "compact");
    return { title: `${count} wins in one day`, line: null };
  }
  if (kind === "goal" || kind === "held") return { title, line: (first.data.rung as Rung).blurb };
  if (kind === "route") return { title, line: detail };
  if (first.kind.startsWith("health")) return { title: `${title} ${detail}`,
    line: gold ? "Your best since you joined. It's your newest medal, so it's the gold one on Prizes." : "Your best since you joined." };
  if (first.kind === "streak") return { title: `${title} in a row`, line: "Your best run yet." };
  return { title: `${title} ${detail}`, line: null };
}

/** A moment is an earned date, grouping every unseen crossing on that day. */
export function momentsView(awards: readonly StoredAward[], measures: Progress["measures"]): Moment[] {
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
    return { id: `day:${on}`, kind, ...momentWords(kind, group, first === awards[0]), medalIds: group.map(award => award.id), measureId: sameMeasure ? first.measureId : null,
      nextGoal: sameMeasure ? measures.find(measure => measure.id === first.measureId)?.ladder?.next ?? null : null };
  });
}

export function measureView(measure: MeasureSeries, state: MeasureState, awards: readonly StoredAward[], today: string): Progress["measures"][number] {
  const points = cumulativePoints(measure.amounts);
  const todayValue = measure.amounts.filter(day => day.date === today).reduce((sum, day) => sum + day.amount, 0);
  return { id: measure.id, label: measure.label, noun: measure.noun, icon: measure.icon,
    format: measure.unit === "seconds" ? "duration" : measure.unit === "meters" ? "distance" : measure.unit === "days" ? "days" : "count",
    source: "games", pending: measure.pending, gameOn: measure.gameOn, needsPerDay: measure.needsPerDay,
    total: formatAmount(points.at(-1)?.[1] ?? 0, measure.unit, "full"), today: todayValue > 0 ? formatAmount(todayValue, measure.unit) : null,
    points, projection: projection(measure, today), ladder: measureLadder(measure, state, awards),
    route: routeView(measure.id, state, points, awards), pics: [] };
}

async function healthAuthority(memberId: string): Promise<boolean> {
  try {
    await assertBrowserVaultMemberAuthority({ memberId, prisma: getPrisma() });
    return true;
  } catch (error) {
    // A current authority denial removes health facts, without hiding game totals.
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) return false;
    throw error;
  }
}

export async function readProgress(memberId: string, beforeMutationTx: BeforeProgressMutation): Promise<Progress> {
  const db = getPrisma();
  const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId }, select: { timeZone: true, createdAt: true } });
  const clock = new Date();
  const today = formatTimeZoneDateTimeParts(clock, profile.timeZone).dayKey;
  const joinedOn = formatTimeZoneDateTimeParts(profile.createdAt, profile.timeZone).dayKey;
  const snapshot = await readGameSeries(memberId, clock);
  const pictures = await readProgressPics(memberId);
  snapshot.incomplete ||= pictures.incomplete;
  const days = obligationDays(snapshot.games, memberId) ?? [];
  if (!snapshot.incomplete) {
    const firstRoutes = snapshot.measures.filter(measure => !measure.pending
      && (measure.unit === "meters" || measure.unit === "steps") && !snapshot.states.get(measure.id)?.legs);
    if (firstRoutes.length) {
      const places = routePlaces(BANK.find(entry => entry.id === firstRouteId(profile.timeZone))!.name)!;
      // Mapbox down: the page still loads without a map; the next read sets the first route.
      const route = await resolveRoute(places.from, places.to).catch(() => null);
      if (route) for (const measure of firstRoutes) snapshot.states.set(measure.id,
        await setFirstRoute(memberId, measure.id, route, beforeMutationTx));
    }
    const context = achievementContext(snapshot.measures, snapshot.states, days);
    await settleAwards(memberId, ACHIEVEMENTS.flatMap(evaluate => evaluate(context)), beforeMutationTx);
    scheduleInference(memberId, snapshot.pending, beforeMutationTx);
  }
  const stored = snapshot.incomplete ? snapshot.awards : await readAwards(memberId);
  const awards = visibleAwards(stored, await healthAuthority(memberId));
  const measures = snapshot.measures.map(measure => {
    const view = measureView(measure, snapshot.states.get(measure.id) ?? {}, awards, today);
    view.pics = pictures.pics.filter(pic => pic.measureId === measure.id).map(pic => picturePin(pic, view.points, profile.timeZone));
    return view;
  });
  // Two units of the same exercise need distinct pills (row 15).
  for (const measure of measures) if (measure.format === "duration" && measures.some(other => other.id !== measure.id && other.label === measure.label)) measure.label += " minutes";
  const obligations = snapshot.games.flatMap(game => {
    const day = gameDays(game, memberId)?.find(day => !day.ended);
    if (!day) return [];
    const task = game.tasks.get(termsForDay(game.state.game.terms, day.dayIndex).n)!;
    return [{ id: game.state.game.id, label: task.text, icon: "dumbbell", done: day.done }];
  });
  const medals = awards.map((award, index) => medalView(award, index === 0));
  const shelf: string[] = [];
  const kinds = new Set<string>();
  for (const medal of medals) {
    const key = `${medal.kind}:${medal.open.measureId ?? ""}`;
    if (kinds.has(key)) continue;
    kinds.add(key); shelf.push(medal.id);
    if (shelf.length === 6) break;
  }
  return { joinedOn, today, incomplete: snapshot.incomplete, measures,
    streak: { current: currentRun(days), best: bestRun(days),
      today: obligations.length === 0 ? "none" : obligations.every(day => day.done) ? "done" : "pending",
      obligations, months: calendarMonths(days, joinedOn, today) },
    medals, shelf, moments: momentsView(awards, measures), picCount: pictures.pics.length };
}

export async function seeMoments(memberId: string, momentIds: readonly string[], beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const awards = visibleAwards(await readAwards(memberId), await healthAuthority(memberId));
  const requested = new Set(momentIds);
  const ids = awards.filter(award => requested.has(`day:${award.on}`)).map(award => award.id);
  await markAwardsSeen(memberId, ids, beforeMutationTx);
}

export { healthView, healthMetricView, type HealthMetricInput } from "./health-view";
