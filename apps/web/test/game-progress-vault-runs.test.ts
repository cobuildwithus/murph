import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ patch: vi.fn(), authority: vi.fn(), series: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => ({}) }));
vi.mock('../src/lib/game/progress/state', () => ({ patchMeasureState: mocks.patch }));
vi.mock('../src/lib/browser-vault/authority', () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock('../src/lib/game/progress/series', async original => ({ ...await original<typeof import('../src/lib/game/progress/series')>(), readGameSeries: mocks.series }));
import { countRunsFromJoin, mergeVaultRuns, readOwnSeries, RUN_MEASURE_ID, saveVaultRuns, type OwnSeries } from '../src/lib/game/progress/vault-runs';
import { routeAwardKey } from '../src/lib/game/progress/route-progress';
import { withGameEarnedDay } from '../src/lib/game/progress/awards';
import { visibleAwards } from '../src/lib/game/progress/view';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
import type { MeasureState, RouteLeg } from '../src/lib/game/progress/state';
import type { MeasureSeries } from '../src/lib/game/progress/series';
import type { Candidate } from '../src/lib/game/progress/registry';

const run = (amounts: [string, number][]): MeasureSeries => ({ id: RUN_MEASURE_ID, name: 'run', label: 'Run', noun: 'of run', icon: 'run', unit: 'meters',
  ftPerRep: 1, pending: false, gameOn: true, needsPerDay: false, amounts: amounts.map(([date, amount]) => ({ measureId: RUN_MEASURE_ID, date, amount })) });
const before = vi.fn();
beforeEach(() => { vi.resetAllMocks(); mocks.authority.mockResolvedValue(undefined); });

describe('vault runs in Running', () => {
  it('takes each day\'s larger total, summing a day\'s game check-ins first', () => {
    const measures = [run([['2026-11-10', 3000], ['2026-11-10', 2000], ['2026-11-11', 4000]])];
    expect(mergeVaultRuns(measures, [['2026-11-10', 6000], ['2026-11-11', 3000], ['2026-11-12', 8000]])).toBe(true);
    expect(measures[0].amounts.map(day => [day.date, day.amount])).toEqual([['2026-11-10', 6000], ['2026-11-11', 4000], ['2026-11-12', 8000]]);
  });

  it('gives a vault-only runner a Running measure and leaves others alone without days', () => {
    const measures: MeasureSeries[] = [];
    expect(mergeVaultRuns(measures, [])).toBe(false);
    expect(measures).toEqual([]);
    mergeVaultRuns(measures, [['2026-11-12', 5000]]);
    expect(measures[0]).toMatchObject({ id: 'run.meters', unit: 'meters', gameOn: false, amounts: [{ date: '2026-11-12', amount: 5000 }] });
  });

  it('merges saved vault runs only while health consent holds', async () => {
    const snapshot = () => ({ measures: [run([['2026-11-10', 1000]])], awards: [], pending: [],
      states: new Map([[RUN_MEASURE_ID, { vaultRuns: { savedAt: 's1', days: [['2026-11-10', 9000]] } }]]) });
    mocks.series.mockResolvedValue(snapshot());
    const own = await readOwnSeries('ava', new Date());
    expect(mocks.series).toHaveBeenCalledWith('ava', expect.any(Date), expect.anything(), [RUN_MEASURE_ID]);
    expect(own.vaultRunsMerged).toBe(true);
    expect(own.measures[0].amounts[0].amount).toBe(9000);
    mocks.series.mockResolvedValue(snapshot());
    mocks.authority.mockRejectedValue(hostedOnboardingError({ code: 'BROWSER_VAULT_FORBIDDEN', httpStatus: 403, message: 'no' }));
    const revoked = await readOwnSeries('ava', new Date());
    expect(revoked.vaultRunsMerged).toBe(false);
    expect(revoked.measures[0].amounts[0].amount).toBe(1000);
  });

  it('marks Running awards earned with vault runs as health, and hides them without consent', () => {
    const award: Candidate = { key: 'k', kind: 'route', measureId: RUN_MEASURE_ID, subjectMemberId: null, on: '2026-11-12', data: { from: 'A' } };
    const marked = withGameEarnedDay(award, undefined);
    expect(marked.data).toEqual({ from: 'A', health: true });
    const stored = (candidate: Candidate) => ({ ...candidate, id: candidate.key, createdAt: new Date(), seenAt: null });
    expect(visibleAwards([stored(marked), stored(award)], false).map(a => a.key)).toEqual(['k']);
    expect(visibleAwards([stored(marked), stored(award)], false)[0].data.health).toBeUndefined();
    expect(visibleAwards([stored(marked)], true)).toHaveLength(1);
  });

  it('saves run days once per replica and clears them on a newer empty replica', async () => {
    let state: MeasureState = {};
    mocks.patch.mockImplementation(async (_member, _measure, patch) => { state = patch(state); });
    const savedAt = '2026-11-12T17:00:00Z';
    await saveVaultRuns('ava', savedAt, null, before);
    expect(mocks.patch).not.toHaveBeenCalled();
    await saveVaultRuns('ava', savedAt, { days: [] }, before);
    expect(state).toEqual({});
    await saveVaultRuns('ava', savedAt, { days: [{ date: '2026-11-12', km: 5.25 }] }, before);
    expect(state.vaultRuns).toEqual({ savedAt, days: [['2026-11-12', 5250]] });
    const saved = state;
    await saveVaultRuns('ava', savedAt, { days: [] }, before);
    expect(state).toBe(saved);
    const newer = '2026-11-12T18:00:00Z';
    await saveVaultRuns('ava', newer, { days: [] }, before);
    expect(state.vaultRuns).toEqual({ savedAt: newer, days: [] });
  });

  it('counts vault runs from the saved join day, and every vault run without one', async () => {
    const days: [string, number][] = [['2026-01-03', 7000], ['2026-10-20', 4000], ['2026-10-21', 5000]];
    const snapshot = (state: MeasureState) => ({ measures: [], awards: [], pending: [], states: new Map([[RUN_MEASURE_ID, state]]) });
    mocks.series.mockResolvedValue(snapshot({ vaultRuns: { savedAt: 's1', days }, runsFrom: '2026-10-21' }));
    const since = await readOwnSeries('ava', new Date());
    expect(since.measures[0].amounts.map(day => [day.date, day.amount])).toEqual([['2026-10-21', 5000]]);
    mocks.series.mockResolvedValue(snapshot({ vaultRuns: { savedAt: 's1', days } }));
    expect((await readOwnSeries('ava', new Date())).measures[0].amounts).toHaveLength(3);
    mocks.series.mockResolvedValue(snapshot({ vaultRuns: { savedAt: 's1', days: [['2026-01-03', 7000]] }, runsFrom: '2026-10-21' }));
    const none = await readOwnSeries('ava', new Date());
    expect([none.vaultRunsMerged, none.measures]).toEqual([false, []]);
  });

  describe('counting runs from the join day', () => {
    const leg = (over: Partial<RouteLeg> = {}): RouteLeg => ({ from: 'Austin', to: 'San Antonio', distanceM: 129_000, polyline: 'p', towns: [],
      straightLine: false, startTotal: 0, ...over });
    const own = (state: MeasureState | undefined, total = 20_000, over: Partial<OwnSeries> = {}): OwnSeries => ({
      measures: total ? [run([['2026-11-10', total]])] : [], awards: [], pending: [], checkIns: [], successors: new Map(),
      states: new Map(state ? [[RUN_MEASURE_ID, state]] : []), vaultRunsMerged: Boolean(state?.vaultRuns?.days.length), gameRunning: undefined,
      ...over } as unknown as OwnSeries);
    let saved: MeasureState;
    const keep = (state: MeasureState) => {
      saved = state;
      mocks.patch.mockImplementation(async (_member, _measure, patch) => {
        const changes = patch(saved);
        saved = changes === saved ? saved : { ...saved, ...changes };
        return saved;
      });
    };

    it('marks Running with no route yet, and Running on an unfinished first route', async () => {
      keep({});
      expect(await countRunsFromJoin('ava', own({}), '2026-10-21', before)).toBe(true);
      expect(saved.runsFrom).toBe('2026-10-21');
      keep({ legs: [leg()] });
      expect(await countRunsFromJoin('ava', own({ legs: [leg()] }), '2026-10-21', before)).toBe(true);
      expect(saved).toEqual({ legs: [leg()], runsFrom: '2026-10-21' });
    });

    it('leaves routes whose saved start counted every run, and finished first routes, counting every run', async () => {
      const later = { legs: [leg(), leg({ from: 'San Antonio', to: 'Houston', startTotal: 140_000, startedOn: '2026-11-01' })] };
      const stored = (key: string) => ({ key, kind: 'route', measureId: RUN_MEASURE_ID, subjectMemberId: null, on: '2026-11-02', data: {},
        id: key, createdAt: new Date(), seenAt: null });
      const cases: OwnSeries[] = [
        own(later),
        own({ legs: [leg()] }, 20_000, { awards: [stored(routeAwardKey(RUN_MEASURE_ID, leg(), 0))] }),
        own({ legs: [leg()] }, 130_000),
        own({ legs: [leg({ startedOn: '2026-11-01' })] }),
        own({ legs: [leg()], runsFrom: '2026-10-21' }),
        own(undefined, 0),
      ];
      for (const snapshot of cases) expect(await countRunsFromJoin('ava', snapshot, '2026-10-21', before)).toBe(false);
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('waits while vault runs are hidden, skips legs that changed, and lets a write conflict pass', async () => {
      const hidden = own({ vaultRuns: { savedAt: 's1', days: [['2026-01-03', 7000]] } }, 20_000, { vaultRunsMerged: false });
      expect(await countRunsFromJoin('ava', hidden, '2026-10-21', before)).toBe(false);
      expect(mocks.patch).not.toHaveBeenCalled();
      keep({ legs: [leg(), leg({ startTotal: 140_000, startedOn: '2026-11-01' })] });
      expect(await countRunsFromJoin('ava', own({ legs: [leg()] }), '2026-10-21', before)).toBe(false);
      expect(saved.runsFrom).toBeUndefined();
      mocks.patch.mockRejectedValue(hostedOnboardingError({ code: 'GAME_PROGRESS_STATE_CONFLICT', httpStatus: 503, message: 'again' }));
      expect(await countRunsFromJoin('ava', own({ legs: [leg()] }), '2026-10-21', before)).toBe(false);
      mocks.patch.mockRejectedValue(new Error('down'));
      await expect(countRunsFromJoin('ava', own({ legs: [leg()] }), '2026-10-21', before)).rejects.toThrow('down');
    });
  });
});
