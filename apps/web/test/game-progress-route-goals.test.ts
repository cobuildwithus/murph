import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ find: vi.fn(), write: vi.fn(), seal: vi.fn(), resolve: vi.fn(), authorize: vi.fn() }));
const db = { gameProgressMeasure: { findUnique: mocks.find, updateMany: mocks.write, createMany: mocks.write },
  $transaction: (run: (tx: object) => Promise<unknown>) => run(db) };
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => db }));
vi.mock('../src/lib/game/progress/crypto', () => ({ progressLookup: () => 'lookup',
  openProgress: async (_target: object, value: string) => JSON.parse(value), sealProgress: mocks.seal }));
vi.mock('../src/lib/game/progress/mapbox', () => ({ resolveRoute: mocks.resolve }));
import { routePlaces, setFirstRoute, setRouteGoal } from '../src/lib/game/progress/routes';
import { routeAwardKey } from '../src/lib/game/progress/route-progress';

const leg = { from: 'A', to: 'B', distanceM: 100, polyline: 'synthetic', towns: [], straightLine: false, startTotal: 0 };
const next = { ...leg, from: 'B', to: 'C', distanceM: 200 };
const context = () => ({ points: [['2026-11-02', 120]] as [string, number][], awards: [], incomplete: false, beforeMutationTx: mocks.authorize });
beforeEach(() => { vi.resetAllMocks(); mocks.write.mockResolvedValue({ count: 1 }); mocks.seal.mockResolvedValue('sealed-next'); mocks.resolve.mockResolvedValue(next); });

describe('Progress route goal mutation', () => {
  it('freezes the automatic first route without claiming the member picked it', async () => {
    mocks.find.mockResolvedValue(null);
    const first = await setFirstRoute('owner', 'walk.meters', next, mocks.authorize);
    expect(first).toEqual({ legs: [{ ...next, startTotal: 0 }] });
    // A manual goal saved while Mapbox was resolving wins over the automatic choice.
    mocks.find.mockResolvedValue({ stateEncrypted: JSON.stringify({ goal: { from: 'A', to: 'B' }, legs: [leg] }) });
    expect(await setFirstRoute('owner', 'walk.meters', next, mocks.authorize))
      .toEqual({ goal: { from: 'A', to: 'B' }, legs: [leg] });
  });
  it('rolls over the state observed after Mapbox, preserving completed legs and other fields', async () => {
    const previous = JSON.stringify({ legs: [leg], baseline: { value: 10, from: '2026-10-01', to: '2026-10-28' } });
    mocks.resolve.mockImplementation(async () => { mocks.find.mockResolvedValue({ stateEncrypted: previous }); return next; });
    const result = await setRouteGoal('owner', 'walk.meters', 'B', 'C', context());
    expect(result).toEqual({ goal: { from: 'B', to: 'C' }, baseline: { value: 10, from: '2026-10-01', to: '2026-10-28' },
      legs: [leg, { ...next, startTotal: 120 }] });
    expect(mocks.write).toHaveBeenCalledWith({ where: { memberId: 'owner', lookup: 'lookup', stateEncrypted: previous }, data: { stateEncrypted: 'sealed-next' } });
    expect(mocks.resolve.mock.invocationCallOrder[0]).toBeLessThan(mocks.authorize.mock.invocationCallOrder[0]!);
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0]!);
  });
  it('keeps an awarded completion when the canonical total shrinks', async () => {
    mocks.find.mockResolvedValue({ stateEncrypted: JSON.stringify({ legs: [leg] }) });
    const result = await setRouteGoal('owner', 'walk.meters', 'B', 'C', { ...context(), points: [['2026-11-03', 80]],
      awards: [{ key: routeAwardKey('walk.meters', leg, 0), kind: 'route', measureId: 'walk.meters', subjectMemberId: null,
        on: '2026-11-02', data: {}, id: 'award', createdAt: new Date('2026-11-02'), seenAt: null }] });
    expect(result.legs).toEqual([leg, { ...next, startTotal: 80 }]);
  });
  it('returns a conflict once if another writer changes the observed ciphertext', async () => {
    mocks.find.mockResolvedValue({ stateEncrypted: '{}' }); mocks.write.mockResolvedValue({ count: 0 });
    await expect(setRouteGoal('owner', 'walk.meters', 'B', 'C', context())).rejects.toMatchObject({ code: 'GAME_PROGRESS_STATE_CONFLICT', retryable: true });
    expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it('does not freeze a rollover from an incomplete input', async () => {
    await expect(setRouteGoal('owner', 'walk.meters', 'B', 'C', { ...context(), incomplete: true })).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([
    ['London to Paris', { from: 'London', to: 'Paris' }], ['5k', null], ['To the Moon', null],
  ])('uses only two-place bank routes: %s', (name, expected) => expect(routePlaces(name)).toEqual(expected));
});
