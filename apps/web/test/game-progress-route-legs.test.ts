import { describe, expect, it } from 'vitest';
import { replaceRouteLeg, routeAwardKey, routeLegs, routeView } from '../src/lib/game/progress/route-progress';
import { encodePolyline } from '../src/lib/game/progress/route-geometry';
import { medalSchema } from '../src/lib/game/progress/contract';
const leg = { from: 'A', to: 'B', distanceM: 100, polyline: encodePolyline([[0, 0], [1, 0]]), towns: [{ name: 'B', atM: 100 }], straightLine: false, startTotal: 0 };
const next = { ...leg, from: 'B', to: 'C', distanceM: 200 };
describe('Progress route legs', () => {
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
    for (const award of awards) expect(medalSchema.safeParse({ id: 'award', kind: award.kind, gold: false,
      face: award.data.face, title: award.data.title, detail: award.data.detail, earnedOn: award.on,
      open: { page: award.data.page, measureId: award.measureId } }).success).toBe(true);
  });
  it('does not transfer an old goal award to a replacement in the same leg slot', () => {
    const award = routeLegs({ measureId: 'walk.meters', legs: [leg], points: [['2026-11-02', 100]] })[0]!;
    const view = routeView('walk.meters', { goal: { from: 'B', to: 'C' }, legs: [next] }, [['2026-11-02', 100]],
      [{ ...award, id: 'award', createdAt: new Date('2026-11-02'), seenAt: null }])!;
    expect(view.finishedOn).toBeNull(); expect(view.progress).toBe(0.5);
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-02' }]);
    expect(routeAwardKey('walk.meters', next, 0)).not.toBe(award.key);
  });
  it('does not reuse an old completion when a repeated leg starts at the same corrected total', () => {
    const award = routeLegs({ measureId: 'walk.meters', legs: [leg], points: [['2026-11-01', 100]] })[0]!;
    const legs = replaceRouteLeg('walk.meters', [leg], leg, 0, new Set([award.key]));
    const view = routeView('walk.meters', { legs }, [['2026-11-02', 0]],
      [{ ...award, id: 'award', createdAt: new Date('2026-11-01'), seenAt: null }])!;
    expect(legs).toHaveLength(2); expect(view.finishedOn).toBeNull(); expect(view.progress).toBe(0);
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-01' }]);
    const repeated = routeLegs({ measureId: 'walk.meters', legs, points: [['2026-11-02', 0], ['2026-11-03', 100]] });
    expect(repeated[1]!.key).not.toBe(award.key); expect(repeated[1]!.on).toBe('2026-11-03');
  });
  it('converts Steps separately and keeps a recorded completion after totals shrink', () => {
    const mile = { ...leg, distanceM: 1609.344 };
    expect(routeLegs({ measureId: 'steps', legs: [mile], points: [['2026-11-02', 2000]] })).toHaveLength(1);
    expect(routeLegs({ measureId: 'walk.meters', legs: [mile], points: [['2026-11-02', 1000]] })).toEqual([]);
    const candidate = routeLegs({ measureId: 'steps', legs: [mile], points: [['2026-11-02', 2000]] })[0]!;
    const view = routeView('steps', { legs: [mile] }, [['2026-11-03', 10]],
      [{ ...candidate, id: 'award', createdAt: new Date('2026-11-02'), seenAt: null }])!;
    expect(view.progress).toBe(1); expect(view.finishedOn).toBe('2026-11-02');
    expect(view.completed).toEqual([{ name: 'A to B', finishedOn: '2026-11-02' }]);
    expect(view.goalPicked).toBe(false);
    expect(view.map).toMatch(/^\/api\/game\/v1\/progress\/map\?/u);
  });
});
