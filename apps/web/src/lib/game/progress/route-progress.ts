import { createHash } from 'node:crypto';
import type { ClientUnits } from '../../companion/client-info';
import type { Day, MapQuery, Route } from './contract';
import type { Candidate } from './registry';
import type { MeasureState, RouteLeg } from './state';
import type { StoredAward } from './awards';
import { cutPolyline, decodePolyline, MAP_SIZES, mapProgress, routeBbox, townPosition } from './route-geometry';
import { formatAmount, formatNumber } from './format';
import { placeRegion } from './place-region';
export const routeMeters = (measureId: string, amount: number) => measureId === 'steps' || measureId.endsWith('.steps') ? amount / 2000 * 1609.344 : amount;
type Points = readonly [Day, number][];
const crossingDay = (points: Points, at: number) => points.find(point => point[1] >= at)?.[0] ?? null;
const dayNumber = (day: Day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const addDays = (day: Day, days: number): Day => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** Days the rest takes at the last 30 days' pace (fewer since the first day); null with under a week of pace or none. */
export function routeEtaDays(meters: Points, remainingM: number, today: Day): number | null {
  const last = meters.filter(([day]) => day <= today).at(-1);
  if (!last || remainingM <= 0) return null;
  const end = dayNumber(today);
  const window = Math.min(30, end - dayNumber(meters[0]![0]) + 1);
  const before = meters.filter(([day]) => dayNumber(day) <= end - window).at(-1)?.[1] ?? 0;
  const perDay = (last[1] - before) / window;
  if (window < 7 || perDay <= 0) return null;
  return Math.ceil(remainingM / perDay);
}

/** How long the rest takes at that pace: "10 weeks". */
export function routeEtaText(days: number | null): string | null {
  if (days === null) return null;
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks <= 104 ? `${weeks} weeks` : `${Math.round(days / 365)} years`;
}

/** A distance unit's meters, as the chart counts it. */
const unitMeters = (units: ClientUnits) => units === 'metric' ? 1000 : 1609.344;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** A route's map version: the road, how far along it the map draws, and which sizes have a painting ready. */
export const mapVersion = (polyline: string, progress: number, painted: readonly ('card' | 'drawer')[] = []) =>
  createHash('sha256').update([polyline, mapProgress(progress), ...painted].join('\n')).digest('base64url').slice(0, 12);

/** A route's map link. A new route, more walked or a painting coming in is a new version (`v`), so the app never keeps an old picture. */
export function routeMapLink(measureId: string, polyline: string, progress: number, painted: readonly ('card' | 'drawer')[] = []) {
  return `/api/game/v1/progress/map?${new URLSearchParams({ measure: measureId, size: 'card', v: mapVersion(polyline, progress, painted) })}`;
}
export const routeAwardKey = (measureId: string, leg: RouteLeg, index: number) => `route:${JSON.stringify([measureId, index, leg.from, leg.to, leg.distanceM, leg.startTotal])}`;

/** Named loops keep their label on both the medal and the finished-routes list. */
export function routeAwardName(award: StoredAward, fallback: string): string {
  return typeof award.data.name === 'string' ? award.data.name : fallback;
}

export function completedRouteLegs(measureId: string, legs: readonly RouteLeg[], totalM: number, earned: ReadonlySet<string>) {
  return legs.filter((leg, i) => i < legs.length - 1 || earned.has(routeAwardKey(measureId, leg, i)) || totalM >= leg.startTotal + leg.distanceM);
}

/** Completed legs survive corrections; changing a goal only replaces the unfinished leg. A later leg keeps the day it started. */
export function replaceRouteLeg(measureId: string, legs: readonly RouteLeg[], next: Omit<RouteLeg, 'startTotal' | 'startedOn'>, total: number, earned: ReadonlySet<string>, today: Day): RouteLeg[] {
  const finished = completedRouteLegs(measureId, legs, total, earned);
  return [...finished, finished.length ? { ...next, startTotal: total, startedOn: today } : { ...next, startTotal: 0 }];
}

/** Corrections before a saved start count as opening distance on that day. */
function pointsFromStart(meters: Points, start: Day | undefined): Points {
  if (!start) return meters;
  const opening = meters.filter(([day]) => day <= start).at(-1);
  return [...(opening ? [[start, opening[1]] as [Day, number]] : []), ...meters.filter(([day]) => day > start)];
}

export function routeLegs(ctx: { measureId: string; legs: readonly RouteLeg[]; points: Points }): Candidate[] {
  const points: [Day, number][] = ctx.points.map(([day, amount]) => [day, routeMeters(ctx.measureId, amount)]);
  return ctx.legs.flatMap((leg, index) => {
    const on = crossingDay(pointsFromStart(points, leg.startedOn), leg.startTotal + leg.distanceM);
    return on ? [{ key: routeAwardKey(ctx.measureId, leg, index), kind: 'route', measureId: ctx.measureId, subjectMemberId: null, on,
      data: { ...(leg.name && { name: leg.name }), from: leg.from, to: leg.to, distanceM: leg.distanceM, startTotal: leg.startTotal, page: 'totals' } }] : [];
  });
}

/** Map labels share the renderer's viewport. Preview towns have no earned crossing dates. */
export function routeTowns(leg: RouteLeg, meters: Points, size: MapQuery['size'], units: ClientUnits, measureId?: string): Route['towns'] {
  const { width, height } = MAP_SIZES[size];
  const geometry = decodePolyline(leg.polyline), bbox = routeBbox(geometry, width, height);
  const walked = Math.max(0, (meters.at(-1)?.[1] ?? 0) - leg.startTotal);
  return leg.towns.map((town, index) => {
    const passedOn = crossingDay(meters, leg.startTotal + town.atM);
    const ahead = formatAmount(town.atM - walked, 'meters', 'full', units).text;
    // Steps on this route by the end of the day you got there.
    const stepsOn = measureId === 'steps' && passedOn ? meters.find(point => point[0] === passedOn)?.[1] : undefined;
    return { name: town.name, atText: `${units === 'metric' ? 'km' : 'mile'} ${formatAmount(town.atM, 'meters', 'full', units).text.split(' ')[0]}`,
      at: round(town.atM / unitMeters(units), 2), ...placeRegion(town.place?.label),
      aheadText: passedOn ? null : `${ahead} ${index === leg.towns.length - 1 ? 'to go' : 'away'}`,
      ...townPosition(cutPolyline(geometry, town.atM / leg.distanceM).walked.at(-1)!, bbox), passedOn,
      poster: null, stepsText: stepsOn === undefined ? null : `${formatNumber(Math.round((stepsOn - leg.startTotal) / 1609.344 * 2000), 'full')} steps` };
  });
}

function routeHere(leg: RouteLeg, progress: number, size: MapQuery['size']): Route['here'] {
  const { width, height } = MAP_SIZES[size];
  const geometry = decodePolyline(leg.polyline);
  return townPosition(cutPolyline(geometry, progress).walked.at(-1)!, routeBbox(geometry, width, height));
}

/**
 * The day a leg started. A later leg saves its own; the first starts on its series' first counted day (imported runs
 * and the Steps window included, never sign-up); an older later leg on the day the total reached its start. Null
 * when what's left of the series can't say.
 */
function legStart(legs: readonly RouteLeg[], index: number, meters: Points): Day | null {
  const leg = legs[index]!;
  if (leg.startedOn) return leg.startedOn;
  if (index === 0) return meters[0]?.[0] ?? null;
  return leg.startTotal > 0 ? crossingDay(meters, leg.startTotal) : null;
}

/** "In N days" counts from the start day through today: the same days as the miles walked on the leg. */
function legDates(startedOn: Day | null, meters: Points, today: Day, remainingM: number, finished: boolean) {
  const days = startedOn === null ? null : Math.max(1, dayNumber(today) - dayNumber(startedOn) + 1);
  const etaDays = finished ? null : routeEtaDays(meters, remainingM, today);
  return { startedOn, etaText: routeEtaText(etaDays), etaOn: etaDays === null ? null : addDays(today, etaDays),
    daysText: days === null ? null : `in ${formatNumber(days, 'full')} ${days === 1 ? 'day' : 'days'}` };
}

/**
 * The leg's own running total for the app's line, from its start day, in the member's distance unit. An earned
 * finish holds from its day on, as the map and headline say, even after the series it was earned on shrinks.
 */
function legChart(leg: RouteLeg, meters: Points, startedOn: Day, earnedOn: Day | null, units: ClientUnits): NonNullable<Route['chart']> {
  const per = unitMeters(units);
  const along = (total: number) => Math.min(leg.distanceM, Math.max(0, total - leg.startTotal));
  const days = new Map<Day, number>([[startedOn, 0]]);
  for (const [day, total] of meters) if (day >= startedOn && (!earnedOn || day < earnedOn)) days.set(day, along(total));
  if (earnedOn && earnedOn >= startedOn) days.set(earnedOn, leg.distanceM);
  return { unit: units === 'metric' ? 'km' : 'mi', distance: round(leg.distanceM / per, 2),
    points: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]): [Day, number] => [day, round(value / per, 2)]) };
}

/** Label coordinates belong to the linked card PNG; display that image without cropping. */
export function routeView(measureId: string, state: MeasureState, points: Points, awards: readonly StoredAward[], units: ClientUnits,
  today: Day = points.at(-1)?.[0] ?? new Date().toISOString().slice(0, 10)): Route | null {
  const legs = state.legs ?? [], leg = legs.at(-1);
  if (!leg) return null;
  const completions = awards.filter(award => award.kind === 'route' && award.measureId === measureId);
  const earned = completions.find(award => award.key === routeAwardKey(measureId, leg, legs.length - 1));
  const earnedOn = earned?.on ?? null;
  const meters: [Day, number][] = points.map(([day, amount]) => [day, routeMeters(measureId, amount)]);
  const total = meters.at(-1)?.[1] ?? 0;
  const walked = earnedOn ? leg.distanceM : Math.min(leg.distanceM, Math.max(0, total - leg.startTotal));
  const map = routeMapLink(measureId, leg.polyline, walked / leg.distanceM);
  const startedOn = legStart(legs, legs.length - 1, meters);
  const legMeters = pointsFromStart(meters, leg.startedOn);
  return { name: leg.name ?? `${leg.from} to ${leg.to}`, distanceText: formatAmount(leg.distanceM, 'meters', 'full', units).text,
    ...legDates(startedOn, meters, today, leg.distanceM - walked, earnedOn !== null),
    remainingText: earnedOn ? null : `${formatAmount(leg.distanceM - walked, 'meters', 'full', units).text} left`,
    chart: startedOn === null ? null : legChart(leg, legMeters, startedOn, earnedOn, units),
    walkedText: formatAmount(walked, 'meters', 'compact', units).text, totalText: formatAmount(total, 'meters', 'compact', units).text,
    progress: walked / leg.distanceM, straightLine: leg.straightLine,
    here: routeHere(leg, walked / leg.distanceM, 'card'), drawerHere: routeHere(leg, walked / leg.distanceM, 'drawer'),
    finishedOn: earnedOn, shareAwardId: earned?.id ?? null, map, goalPicked: state.goal !== undefined,
    completed: completions.map(award => ({ name: routeAwardName(award, `${award.data.from} to ${award.data.to}`), finishedOn: award.on, shareAwardId: award.id })),
    towns: routeTowns(leg, legMeters, 'card', units, measureId), drawerTowns: routeTowns(leg, legMeters, 'drawer', units, measureId), mapArt: null, drawerMapArt: null };
}
