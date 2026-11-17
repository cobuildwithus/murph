import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProgressSharesForAccount } from '../src/lib/game/progress/share-cleanup';

const mocks = vi.hoisted(() => ({ purge: vi.fn() }));
vi.mock('../src/lib/game/progress/media-store', () => ({ purgeProgressMedia: mocks.purge }));
beforeEach(() => { vi.resetAllMocks(); });

describe('Progress share cleanup bounds', () => {
  it.each([0, 1, 10_000])('purges %i reserved keys serially after retirement, retaining rows until cascade', async count => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: count }, (_, i) => ({ storageKey: `progress/${i}.jpg` })));
    const updateMany = vi.fn();
    let active = 0, peak = 0;
    mocks.purge.mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; });
    await deleteProgressSharesForAccount(['owner'], { gameProgressShare: { findMany, updateMany } });
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({ where: { memberId: 'owner' }, select: { storageKey: true }, orderBy: { awardLookup: 'asc' }, take: 10_001 });
    expect(updateMany).toHaveBeenCalledWith({ where: { memberId: 'owner' }, data: { status: 'retired' } });
    expect(mocks.purge).toHaveBeenCalledTimes(count);
    expect(peak).toBe(count ? 1 : 0);
    if (count) expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.purge.mock.invocationCallOrder[0]!);
  });

  it('admits the complete account collection before retiring or purging any member', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ storageKey: 'progress/reserved.jpg' }])
      .mockResolvedValueOnce(Array.from({ length: 10_001 }, () => ({ storageKey: 'progress/reserved.jpg' })));
    const updateMany = vi.fn();
    await expect(deleteProgressSharesForAccount(['owner', 'group-owner'], { gameProgressShare: { findMany, updateMany } }))
      .rejects.toMatchObject({ code: 'PROGRESS_SHARE_DELETION_INCOMPLETE', httpStatus: 503 });
    expect(updateMany).not.toHaveBeenCalled(); expect(mocks.purge).not.toHaveBeenCalled();
  });

  it('surfaces purge failure and retains the failed key for a later explicit deletion', async () => {
    const keys = [{ storageKey: 'progress/one.jpg' }, { storageKey: 'progress/two.jpg' }];
    const db = { gameProgressShare: { findMany: vi.fn().mockResolvedValue(keys), updateMany: vi.fn() } };
    mocks.purge.mockRejectedValueOnce(new Error('synthetic cleanup failure'));
    await expect(deleteProgressSharesForAccount(['owner'], db)).rejects.toThrow('synthetic cleanup failure');
    expect(mocks.purge).toHaveBeenCalledTimes(1);
    await deleteProgressSharesForAccount(['owner'], db);
    expect(mocks.purge.mock.calls.map(call => call[1])).toEqual(['progress/one.jpg', 'progress/one.jpg', 'progress/two.jpg']);
  });
});
