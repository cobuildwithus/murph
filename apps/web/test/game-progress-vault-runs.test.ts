import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ patch: vi.fn(), authority: vi.fn(), series: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => ({}) }));
vi.mock('../src/lib/game/progress/state', () => ({ patchMeasureState: mocks.patch }));
vi.mock('../src/lib/browser-vault/authority', () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock('../src/lib/game/progress/series', async original => ({ ...await original<typeof import('../src/lib/game/progress/series')>(), readGameSeries: mocks.series }));
import { mergeVaultRuns, readOwnSeries, RUN_MEASURE_ID, saveVaultRuns } from '../src/lib/game/progress/vault-runs';
import { withGameEarnedDay } from '../src/lib/game/progress/awards';
import { visibleAwards } from '../src/lib/game/progress/view';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
import type { MeasureState } from '../src/lib/game/progress/state';
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
    const snapshot = () => ({ measures: [run([['2026-11-10', 1000]])], awards: [], incomplete: false, pending: [],
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
});
