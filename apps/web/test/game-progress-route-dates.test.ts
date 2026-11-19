import { describe, expect, it } from 'vitest';
import { placeRegion } from '../src/lib/game/progress/place-region';
import { routeAwardKey, routeView } from '../src/lib/game/progress/route-progress';
import { encodePolyline } from '../src/lib/game/progress/route-geometry';
import { progressSchema } from '../src/lib/game/progress/contract';
import type { StoredAward } from '../src/lib/game/progress/awards';

const MILE = 1609.344;
const polyline = encodePolyline([[0, 0], [1, 0]]);
const leg = { from: 'Ava Town', to: 'Leo City', distanceM: 100 * MILE, polyline, straightLine: false, startTotal: 0,
  towns: [{ name: 'Middle', atM: 40 * MILE, place: { id: 'dplace-mid', label: 'Middle, Delaware, United States' } }] };
/** A mile a day from Oct 1. */
const daily = (days: number, from = 0): [string, number][] => Array.from({ length: days }, (_, i) =>
  [new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), (from + i + 1) * MILE]);
const routeSchema = progressSchema.shape.measures.element.shape.route.unwrap();
const award = (key: string, on: string): StoredAward => ({ key, kind: 'route', measureId: 'walk.meters', subjectMemberId: null, on, data: {},
  id: 'award', createdAt: new Date(on), seenAt: null }) as StoredAward;

describe('Progress route dates and words', () => {
  it('starts a first leg on its first counted day and counts the same days as its miles', () => {
    const points = daily(48);
    const view = routeView('walk.meters', { legs: [leg] }, points, [], 'us', '2026-11-17')!;
    expect(view).toMatchObject({ startedOn: '2026-10-01', daysText: 'in 48 days', remainingText: '52 mi left' });
    // A mile a day over the last 30: 52 more days from today.
    expect(view.etaOn).toBe('2027-01-08');
    expect(view.chart).toMatchObject({ unit: 'mi', distance: 100 });
    expect(view.chart!.points[0]).toEqual(['2026-10-01', 1]);
    expect(view.chart!.points.at(-1)).toEqual(['2026-11-17', 48]);
    expect(routeSchema.safeParse(view).success).toBe(true);
  });

  it('says one day on the first day, and in kilometers for metric readers', () => {
    const view = routeView('walk.meters', { legs: [leg] }, [['2026-11-19', 2_000]], [], 'metric', '2026-11-19')!;
    expect(view).toMatchObject({ startedOn: '2026-11-19', daysText: 'in 1 day', etaOn: null });
    expect(view.chart).toEqual({ unit: 'km', distance: 160.93, points: [['2026-11-19', 2]] });
  });

  it('starts a later leg on its saved day, at zero', () => {
    const points = daily(48);
    const later = { ...leg, startTotal: 30 * MILE, startedOn: '2026-10-29' };
    const view = routeView('walk.meters', { legs: [leg, later] }, points, [], 'us', '2026-11-17')!;
    expect(view).toMatchObject({ startedOn: '2026-10-29', daysText: 'in 20 days', remainingText: '82 mi left' });
    expect(view.chart!.points[0]).toEqual(['2026-10-29', 0]);
    expect(view.chart!.points.at(-1)).toEqual(['2026-11-17', 18]);
  });

  it('dates an older later leg by the day the total reached its start, and gives none when the series no longer does', () => {
    const later = { ...leg, startTotal: 30 * MILE };
    expect(routeView('walk.meters', { legs: [leg, later] }, daily(48), [], 'us', '2026-11-17')!.startedOn).toBe('2026-10-30');
    const shrunk = routeView('walk.meters', { legs: [leg, later] }, daily(10), [], 'us', '2026-11-17')!;
    expect(shrunk).toMatchObject({ startedOn: null, daysText: null, chart: null });
    expect(routeSchema.safeParse(shrunk).success).toBe(true);
  });

  it('holds an earned finish from its day, even after the series shrinks', () => {
    const points: [string, number][] = [['2026-10-01', 50 * MILE], ['2026-10-05', 80 * MILE], ['2026-10-09', 60 * MILE]];
    const view = routeView('walk.meters', { legs: [leg] }, points, [award(routeAwardKey('walk.meters', leg, 0), '2026-10-07')], 'us', '2026-10-09')!;
    expect(view).toMatchObject({ remainingText: null, etaOn: null, finishedOn: '2026-10-07' });
    expect(view.chart!.points).toEqual([['2026-10-01', 50], ['2026-10-05', 80], ['2026-10-07', 100]]);
  });

  it('names each town with its state or country', () => {
    const view = routeView('walk.meters', { legs: [leg] }, daily(48), [], 'us', '2026-11-17')!;
    expect(view.drawerTowns[0]).toMatchObject({ name: 'Middle', at: 40, region: 'Delaware', regionCode: 'DE', passedOn: '2026-11-09' });
  });

  it.each([
    ['Newark, Delaware, United States', 'Delaware', 'DE'],
    ['Kingston, Ontario, Canada', 'Ontario', 'ON'],
    ['Gaspé, Québec, Canada', 'Québec', 'QC'],
    ['Washington, District of Columbia, United States', 'District of Columbia', 'DC'],
    ['Porto, Porto, Portugal', 'Portugal', null],
    ['Somewhere, United States', 'United States', null],
    ['Atlantis, Lost Province, Canada', 'Lost Province', null],
    ['Nowhere', null, null],
    [undefined, null, null],
  ])('reads %s as %s (%s)', (label, region, regionCode) => {
    expect(placeRegion(label)).toEqual({ region, regionCode });
  });
});
