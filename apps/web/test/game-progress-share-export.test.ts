import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ many: vi.fn(), find: vi.fn(), read: vi.fn(), open: vi.fn(), auth: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => ({ gameProgressShare: { findMany: mocks.many, findUnique: mocks.find } }) }));
vi.mock('../src/lib/game/progress/media-store', async original => ({ ...await original<object>(), progressMediaStore: () => ({ readProgressPic: mocks.read }) }));
vi.mock('../src/lib/hosted-crypto/secure-box', () => ({ openHostedUserSecureBoxBytes: mocks.open }));
import { prepareProgressShareExport } from '../src/lib/game/progress/share-export';
const row = { awardLookup: 'opaque-award', storageKey: 'progress/reserved.jpg', status: 'ready', createdAt: new Date('2026-11-01'), failureCode: null };
beforeEach(() => { vi.resetAllMocks(); mocks.many.mockResolvedValue([row]); mocks.find.mockResolvedValue({ status: 'ready', failureCode: null }); mocks.read.mockResolvedValue({ envelope: 'sealed' }); });
describe('account share export', () => {
  it('exports only owned metadata and JPEG, with share AAD and revalidation after decryption', async () => {
    const bytes = new Uint8Array([1, 2, 3]); mocks.open.mockResolvedValue(bytes);
    const records = (await prepareProgressShareExport('owner', mocks.auth))();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.many).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: 'owner' }, take: 10_001 }));
    const result = await records.next();
    expect(JSON.parse(result.value!)).toEqual({ progressShare: { awardId: 'opaque-award', createdAt: row.createdAt.toISOString(), status: 'ready', failureCode: null, jpegBase64: 'AQID' } });
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', aad: { purpose: 'game-progress', table: 'game_progress_share', rowId: row.storageKey, field: 'bytes' } }));
    expect(mocks.auth).toHaveBeenCalledTimes(2); expect(bytes).toEqual(new Uint8Array(3));
    expect(result.value).not.toContain(row.storageKey); expect(result.value).not.toContain('owner');
  });
  it.each(['failed', 'retired', 'generating'])('exports %s metadata without fetching bytes', async status => {
    mocks.find.mockResolvedValue({ status });
    const records = (await prepareProgressShareExport('owner', mocks.auth))();
    expect(JSON.parse((await records.next()).value!)).toMatchObject({ progressShare: { status, jpegBase64: null } });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['retired', 'session'])('a %s change during decrypt releases no image and clears bytes', async phase => {
    const bytes = new Uint8Array([1]); mocks.open.mockResolvedValue(bytes);
    if (phase === 'retired') mocks.find.mockResolvedValueOnce({ status: 'ready' }).mockResolvedValueOnce({ status: 'retired' });
    else mocks.auth.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('PRIVATE_AUTH_SENTINEL'));
    const records = (await prepareProgressShareExport('owner', mocks.auth))();
    await expect(records.next()).rejects.toMatchObject({ httpStatus: 503 });
    expect(bytes[0]).toBe(0);
  });
  it('cap overflow performs no media effects', async () => {
    mocks.many.mockResolvedValue(Array.from({ length: 10_001 }, () => row));
    await expect(prepareProgressShareExport('owner', mocks.auth)).rejects.toMatchObject({ code: 'PROGRESS_SHARE_EXPORT_INCOMPLETE' });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each([0, 10_000])('bounds %i retained attempts to serial reads without media effects', async count => {
    mocks.many.mockResolvedValue(Array.from({ length: count }, (_, i) => ({ ...row, awardLookup: `award-${i}` })));
    let active = 0, peak = 0;
    mocks.find.mockImplementation(async () => {
      active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
      return { status: 'retired', failureCode: null };
    });
    const records = (await prepareProgressShareExport('owner', mocks.auth))();
    let exported = 0;
    for await (const record of records) { expect(record).toContain('"jpegBase64":null'); exported++; }
    expect(exported).toBe(count); expect(mocks.many).toHaveBeenCalledOnce();
    expect(mocks.find).toHaveBeenCalledTimes(count); expect(mocks.auth).toHaveBeenCalledTimes(count);
    expect(peak).toBe(count ? 1 : 0); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('missing media fails visibly without exporting a partial picture', async () => {
    mocks.read.mockResolvedValue(null);
    const records = (await prepareProgressShareExport('owner', mocks.auth))();
    await expect(records.next()).rejects.toMatchObject({ code: 'PROGRESS_SHARE_EXPORT_UNAVAILABLE' });
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
