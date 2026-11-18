import type { ClientUnits } from '../../companion/client-info';
import type { Day, MapQuery, Route } from './contract';
import type { Candidate } from './registry';
import type { MeasureState, RouteLeg } from './state';
import type { StoredAward } from './awards';
import { cutPolyline, decodePolyline, MAP_SIZES, routeBbox, townPosition } from './route-geometry';
import { formatAmount, formatNumber } from './format';
export const routeMeters = (measureId: string, amount: number) => measureId === 'steps' || measureId.endsWith('.steps') ? amount / 2000 * 1609.344 : amount;
type Points = readonly [Day, number][];
const crossingDay = (points: Points, at: number) => points.find(point => point[1] >= at)?.[0] ?? null;
const dayNumber = (day: Day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** How long the rest takes at the last 30 days' pace (fewer since the first day): "10 weeks". */
export function routeEta(meters: Points, remainingM: number): string | null {
  const last = meters.at(-1);
  if (!last || remainingM <= 0) return null;
  const window = Math.min(30, dayNumber(last[0]) - dayNumber(meters[0]![0]) + 1);
  const before = meters.filter(point => dayNumber(point[0]) <= dayNumber(last[0]) - window).at(-1)?.[1] ?? 0;
  const perDay = (last[1] - before) / window;
  if (window < 7 || perDay <= 0) return null;
  const days = Math.ceil(remainingM / perDay);
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks <= 104 ? `${weeks} weeks` : `${Math.round(days / 365)} years`;
}
export const routeAwardKey = (measureId: string, leg: RouteLeg, index: number) => `route:${JSON.stringify([measureId, index, leg.from, leg.to, leg.distanceM, leg.startTotal])}`;

/** Named loops keep their label on both the medal and the finished-routes list. */
export function routeAwardName(award: StoredAward, fallback: string): string {
  return typeof award.data.name === 'string' ? award.data.name : fallback;
}

/** Completed legs survive corrections; changing a goal only replaces the unfinished leg. */
export function replaceRouteLeg(measureId: string, legs: readonly RouteLeg[], next: Omit<RouteLeg, 'startTotal'>, total: number, earned: ReadonlySet<string>): RouteLeg[] {
  const finished = legs.filter((leg, i) => i < legs.length - 1 || earned.has(routeAwardKey(measureId, leg, i)) || total >= leg.startTotal + leg.distanceM);
  return [...finished, { ...next, startTotal: finished.length ? total : 0 }];
}

export function routeLegs(ctx: { measureId: string; legs: readonly RouteLeg[]; points: Points }): Candidate[] {
  const points: [Day, number][] = ctx.points.map(([day, amount]) => [day, routeMeters(ctx.measureId, amount)]);
  return ctx.legs.flatMap((leg, index) => {
    const on = crossingDay(points, leg.startTotal + leg.distanceM);
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

/** Label coordinates belong to the linked card PNG; display that image without cropping. */
export function routeView(measureId: string, state: MeasureState, points: Points, awards: readonly StoredAward[], units: ClientUnits): Route | null {
  const legs = state.legs ?? [], leg = legs.at(-1);
  if (!leg) return null;
  const completions = awards.filter(award => award.kind === 'route' && award.measureId === measureId);
  const earned = completions.find(award => award.key === routeAwardKey(measureId, leg, legs.length - 1));
  const earnedOn = earned?.on ?? null;
  const meters: [Day, number][] = points.map(([day, amount]) => [day, routeMeters(measureId, amount)]);
  const total = meters.at(-1)?.[1] ?? 0;
  const walked = earnedOn ? leg.distanceM : Math.min(leg.distanceM, Math.max(0, total - leg.startTotal));
  const map = `/api/game/v1/progress/map?${new URLSearchParams({ measure: measureId, size: 'card' })}`;
  return { name: leg.name ?? `${leg.from} to ${leg.to}`, distanceText: formatAmount(leg.distanceM, 'meters', 'full', units).text,
    walkedText: formatAmount(walked, 'meters', 'compact', units).text, totalText: formatAmount(total, 'meters', 'compact', units).text,
    progress: walked / leg.distanceM, straightLine: leg.straightLine, etaText: earnedOn ? null : routeEta(meters, leg.distanceM - walked),
    here: routeHere(leg, walked / leg.distanceM, 'card'), drawerHere: routeHere(leg, walked / leg.distanceM, 'drawer'),
    finishedOn: earnedOn, shareAwardId: earned?.id ?? null, map, goalPicked: state.goal !== undefined,
    completed: completions.map(award => ({ name: routeAwardName(award, `${award.data.from} to ${award.data.to}`), finishedOn: award.on, shareAwardId: award.id })),
    towns: routeTowns(leg, meters, 'card', units, measureId), drawerTowns: routeTowns(leg, meters, 'drawer', units, measureId), mapArt: null, drawerMapArt: null };
}
