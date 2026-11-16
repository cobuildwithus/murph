import type { Day, Route } from './contract';
import type { Candidate } from './registry';
import type { MeasureState, RouteLeg } from './state';
import type { StoredAward } from './awards';
import { cutPolyline, decodePolyline, routeBbox, townPosition } from './route-geometry';

export const MAP_WIDTH = 708;
export const MAP_HEIGHT = 354;
export const milesText = (meters: number) => `${Math.round(meters / 1609.344).toLocaleString('en-US')} miles`;
export const routeMeters = (measureId: string, amount: number) => measureId === 'steps' ? amount / 2000 * 1609.344 : amount;
type Points = readonly [Day, number][];
const crossingDay = (points: Points, at: number) => points.find(point => point[1] >= at)?.[0] ?? null;
export const routeAwardKey = (measureId: string, leg: RouteLeg) => `route:${JSON.stringify([measureId, leg.from, leg.to, leg.distanceM, leg.startTotal])}`;

/** Completed legs survive corrections; changing a goal only replaces the unfinished leg. */
export function replaceRouteLeg(measureId: string, legs: readonly RouteLeg[], next: Omit<RouteLeg, 'startTotal'>, total: number, earned: ReadonlySet<string>): RouteLeg[] {
  const finished = legs.filter((leg, i) => i < legs.length - 1 || earned.has(routeAwardKey(measureId, leg)) || total >= leg.startTotal + leg.distanceM);
  return [...finished, { ...next, startTotal: finished.length ? total : 0 }];
}

export function routeLegs(ctx: { measureId: string; legs: readonly RouteLeg[]; points: Points }): Candidate[] {
  const points: [Day, number][] = ctx.points.map(([day, amount]) => [day, routeMeters(ctx.measureId, amount)]);
  return ctx.legs.flatMap(leg => {
    const on = crossingDay(points, leg.startTotal + leg.distanceM);
    return on ? [{ key: routeAwardKey(ctx.measureId, leg), kind: 'route', measureId: ctx.measureId, subjectMemberId: null, on,
      data: { from: leg.from, to: leg.to, distanceM: leg.distanceM, startTotal: leg.startTotal,
        face: { drawing: 'route' }, title: leg.to, detail: `${milesText(leg.distanceM)} from ${leg.from}`, page: 'totals' } }] : [];
  });
}

/** Label coordinates belong to the exact 2:1 PNG linked here; display that image without cropping. */
export function routeView(measureId: string, state: MeasureState, points: Points, awards: readonly StoredAward[]): Route | null {
  const legs = state.legs ?? [], leg = legs.at(-1);
  if (!leg) return null;
  const completions = awards.filter(award => award.kind === 'route' && award.measureId === measureId);
  const earnedOn = completions.find(award => award.key === routeAwardKey(measureId, leg))?.on ?? null;
  const meters: [Day, number][] = points.map(([day, amount]) => [day, routeMeters(measureId, amount)]);
  const total = meters.at(-1)?.[1] ?? 0;
  const walked = earnedOn ? leg.distanceM : Math.min(leg.distanceM, Math.max(0, total - leg.startTotal));
  const geometry = decodePolyline(leg.polyline), bbox = routeBbox(geometry, MAP_WIDTH, MAP_HEIGHT);
  const map = `/api/game/v1/progress/map?${new URLSearchParams({ measure: measureId, w: String(MAP_WIDTH), h: String(MAP_HEIGHT) })}`;
  return { name: `${leg.from} to ${leg.to}`, distanceText: milesText(leg.distanceM), walkedText: milesText(walked),
    progress: walked / leg.distanceM, straightLine: leg.straightLine,
    finishedOn: earnedOn, map, goalPicked: state.goal !== undefined,
    completed: completions.map(award => ({ name: `${award.data.from} to ${award.data.to}`, finishedOn: award.on })),
    towns: leg.towns.map(town => ({ name: town.name, atText: `mile ${Math.round(town.atM / 1609.344)}`,
      ...townPosition(cutPolyline(geometry, town.atM / leg.distanceM).walked.at(-1)!, bbox),
      passedOn: crossingDay(meters, leg.startTotal + town.atM) })) };
}
