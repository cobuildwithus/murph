import { describe, expect, it } from 'vitest';
import { replaceRouteLeg, routeAwardKey, routeLegs, routeView } from '../src/lib/game/progress/route-progress';
import { cutPolyline, decodePolyline, encodePolyline, MAP_SIZES, routeBbox, townPosition } from '../src/lib/game/progress/route-geometry';
import { medalView } from '../src/lib/game/progress/view';
import { medalSchema } from '../src/lib/game/progress/contract';
const leg = { from: 'A', to: 'B', distanceM: 100, polyline: encodePolyline([[0, 0], [1, 0]]), towns: [{ name: 'B', atM: 100 }], straightLine: false, startTotal: 0 };
const next = { ...leg, from: 'B', to: 'C', distanceM: 200 };
describe('Progress route legs', () => {
  it.each([0, 25, 100, 150])('places the current dot at the walked cut with %s meters', total => {
    const geometry = [[0, 50], [0.2, 49.5], [2, 49]] as [number, number][];
    const route = { ...leg, polyline: encodePolyline(geometry) };
    const view = routeView('walk.meters', { legs: [route] }, [['2026-11-01', total]], [], 'us')!;
    const cut = cutPolyline(geometry, Math.min(1, total / 100)).walked.at(-1)!;
    for (const [size, here] of [['card', view.here], ['drawer', view.drawerHere]] as const) {
      const { width, height } = MAP_SIZES[size];
      expect(here).toEqual(townPosition(cut, routeBbox(geometry, width, height)));
      expect(here.x).toBeGreaterThanOrEqual(0); expect(here.x).toBeLessThanOrEqual(1);
      expect(here.y).toBeGreaterThanOrEqual(0); expect(here.y).toBeLessThanOrEqual(1);
    }
    expect(view.here).not.toEqual(view.drawerHere);
  });
  it.each([
    { miles: 8.4, text: '8.4 mi', atText: 'mile 8.4' },
    { miles: 116.4, text: '116 mi', atText: 'mile 116' },
    { miles: 31240, text: '31.2k mi', atText: 'mile 31.2k' },
  ])('uses shared formatting and the matching viewport at $miles miles', ({ miles, text, atText }) => {
    const distanceM = miles * 1609.344;
    const route = { ...leg, distanceM, towns: [{ name: 'B', atM: distanceM }], polyline: encodePolyline([[0, 50], [2, 49]]) };
    const points: [string, number][] = [['2026-11-01', distanceM]];
    const view = routeView('walk.meters', { legs: [route] }, points, [], 'us')!;
    expect(view).toMatchObject({ distanceText: text, walkedText: text, map: '/api/game/v1/progress/map?measure=walk.meters&size=card' });
    for (const [size, towns] of [['card', view.towns], ['drawer', view.drawerTowns]] as const) {
      const { width, height } = MAP_SIZES[size];
      const geometry = decodePolyline(route.polyline);
      expect(towns).toEqual([{ name: 'B', atText, passedOn: '2026-11-01',
        ...townPosition(geometry.at(-1)!, routeBbox(geometry, width, height)) }]);
    }
    expect(view.towns[0].x).not.toBe(view.drawerTowns[0].x);
    const award = routeLegs({ measureId: 'walk.meters', legs: [route], points })[0];
    expect(medalView({ ...award, id: 'award', createdAt: new Date(), seenAt: null }, false, 'us').detail).toBe(`${text} from A`);
  });
  it.each([
    { total: 80, earned: [], count: 1, start: 0 },
    { total: 120, earned: [], count: 2, start: 120 },
    { total: 80, earned: [0], count: 2, start: 80 },
  ])('rolls over at $total, preserving earned legs $earned', ({ total, earned, count, start }) => {
    const result = replaceRouteLeg('walk.meters', [leg], next, total, new Set(earned.map(() => routeAwardKey('walk.meters', leg, 0))));
    expect(result).toHaveLength(count); expect(result.at(-1)!.startTotal).toBe(start);
    if (count === 2) expect(result[0]).toEqual(leg);
  });
  it('dates every completion on its crossing day, with stable keys independent of the read date', () => {
    const legs = [leg, { ...next, startTotal: 120 }];
    const points: [string, number][] = [['2026-11-01', 90], ['2026-11-02', 120], ['2026-11-09', 320]];
    const awards = routeLegs({ measureId: 'walk.meters', legs, points });
    expect(awards.map(award => [award.key, award.on])).toEqual([[routeAwardKey('walk.meters', legs[0]!, 0), '2026-11-02'], [routeAwardKey('walk.meters', legs[1]!, 1), '2026-11-09']]);
    expect(routeLegs({ measureId: 'walk.meters', legs, points })).toEqual(awards);
    for (const award of awards) expect(medalSchema.safeParse(medalView({ ...award, id: 'award', createdAt: new Date(), seenAt: null }, false, 'us')).success).toBe(true);
  });
  it('does not transfer an old goal award to a replacement in the same leg slot', () => {
    const award = routeLegs({ measureId: 'walk.meters', legs: [leg], points: [['2026-11-02', 100]] })[0]!;
    const view = routeView('walk.meters', { goal: { route: { from: 'B', to: 'C' } }, legs: [next] }, [['2026-11-02', 100]],
      [{ ...award, id: 'award', createdAt: new Date('2026-11-02'), seenAt: null }], 'us')!;
    expect(view.finishedOn).toBeNull(); expect(view.progress).toBe(0.5);
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-02' }]);
    expect(routeAwardKey('walk.meters', next, 0)).not.toBe(award.key);
  });
  it('does not reuse an old completion when a repeated leg starts at the same corrected total', () => {
    const award = routeLegs({ measureId: 'walk.meters', legs: [leg], points: [['2026-11-01', 100]] })[0]!;
    const legs = replaceRouteLeg('walk.meters', [leg], leg, 0, new Set([award.key]));
    const view = routeView('walk.meters', { legs }, [['2026-11-02', 0]],
      [{ ...award, id: 'award', createdAt: new Date('2026-11-01'), seenAt: null }], 'us')!;
    expect(legs).toHaveLength(2); expect(view.finishedOn).toBeNull(); expect(view.progress).toBe(0);
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-01' }]);
    const repeated = routeLegs({ measureId: 'walk.meters', legs, points: [['2026-11-02', 0], ['2026-11-03', 100]] });
    expect(repeated[1]!.key).not.toBe(award.key); expect(repeated[1]!.on).toBe('2026-11-03');
  });
  it('converts Steps separately and keeps a recorded completion after totals shrink', () => {
    const mile = { ...leg, distanceM: 1609.344, towns: [{ name: 'B', atM: 1609.344 }] };
    expect(routeLegs({ measureId: 'steps', legs: [mile], points: [['2026-11-02', 2000]] })).toHaveLength(1);
    expect(routeLegs({ measureId: 'walk.meters', legs: [mile], points: [['2026-11-02', 1000]] })).toEqual([]);
    const candidate = routeLegs({ measureId: 'steps', legs: [mile], points: [['2026-11-02', 2000]] })[0]!;
    const view = routeView('steps', { legs: [mile] }, [['2026-11-03', 10]],
      [{ ...candidate, id: 'award', createdAt: new Date('2026-11-02'), seenAt: null }], 'us')!;
    expect(view.progress).toBe(1); expect(view.finishedOn).toBe('2026-11-02');
    expect(view.here).toMatchObject({ x: view.towns[0].x, y: view.towns[0].y });
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-02' }]);
    expect(view.goalPicked).toBe(false);
    expect(view.map).toMatch(/^\/api\/game\/v1\/progress\/map\?/u);
  });
});
