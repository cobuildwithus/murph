import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ find: vi.fn(), many: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), read: vi.fn(), put: vi.fn(), purge: vi.fn(), open: vi.fn(), seal: vi.fn(), auth: vi.fn() }));
const db = { gameProgressPic: { findFirst: mocks.find, findMany: mocks.many, createMany: mocks.create, updateMany: mocks.update, deleteMany: mocks.remove },
  $transaction: (run: (tx: object) => Promise<unknown>) => run(db) };
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => db }));
vi.mock('../src/lib/game/progress/crypto', () => ({ sealProgress: async () => 'sealed-meta', openProgress: async () => ({ measureId: 'pushups.reps' }), openProgressMany: async () => [] }));
vi.mock('../src/lib/hosted-crypto/secure-box', () => ({ openHostedUserSecureBoxBytes: mocks.open, sealHostedUserSecureBoxBytes: mocks.seal }));
vi.mock('../src/lib/hosted-execution/control', () => ({ readHostedExecutionControlClientIfConfigured: () => ({ readProgressPic: mocks.read, putProgressPic: mocks.put, purgeRuntimeResource: mocks.purge }) }));
import { picturePin, putProgressPic, readProgressPic, deleteProgressPic, deleteProgressPicsForAccount } from '../src/lib/game/progress/pics';
const id = '11111111-1111-4111-8111-111111111111';
const storageKey = `progress/${'a'.repeat(32)}.jpg`;
const row = { id, storageKey, takenAt: new Date('2026-11-02T12:00:00Z'), metaEncrypted: 'sealed-meta' };
beforeEach(() => { vi.resetAllMocks(); mocks.seal.mockResolvedValue('sealed-bytes'); mocks.open.mockResolvedValue(new Uint8Array([1, 2])); });
describe('Progress picture ownership and deletion', () => {
  it.each([
    ['2026-11-01T02:00:00Z', '2026-10-31', 0],
    ['2026-11-02T02:00:00Z', '2026-11-01', 40],
    ['2026-11-03T02:00:00Z', '2026-11-02', 60],
  ])('places the %s capture on its local-day total', (takenAt, takenOn, at) => {
    expect(picturePin({ id, takenAt: new Date(takenAt) }, [['2026-11-01', 40], ['2026-11-02', 60]], 'America/New_York'))
      .toEqual({ id, takenOn, at });
  });
  it('account deletion retires every key, including retired rows, before dropping ownership', async () => {
    mocks.many.mockResolvedValue([{ id, storageKey }]);
    await deleteProgressPicsForAccount(['owner'], db);
    expect(mocks.many).toHaveBeenCalledWith({ where: { memberId: 'owner' }, select: { id: true, storageKey: true }, orderBy: { id: 'asc' }, take: 10001 });
    expect(mocks.purge.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
    mocks.purge.mockRejectedValueOnce(new Error('unavailable')); mocks.remove.mockClear();
    await expect(deleteProgressPicsForAccount(['owner'], db)).rejects.toMatchObject({ httpStatus: 503, retryable: true, cause: undefined });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects an incomplete account-cleanup collection before any purge or deletion', async () => {
    mocks.many.mockResolvedValue(Array.from({ length: 10001 }, (_, i) => ({ id: String(i), storageKey })));
    await expect(deleteProgressPicsForAccount(['owner'], db)).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    expect(mocks.purge).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('gives a different owner exactly the missing-picture result without fetching or opening bytes', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(readProgressPic('other', id)).rejects.toMatchObject({ httpStatus: 404 });
    expect(mocks.find).toHaveBeenCalledWith({ where: { id, memberId: 'other', retiredAt: null }, select: { storageKey: true } });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it('opens with owner/key AAD and rechecks liveness before returning', async () => {
    mocks.find.mockResolvedValue(row); mocks.read.mockResolvedValue({ envelope: 'sealed-bytes' });
    expect(await readProgressPic('owner', id)).toEqual(new Uint8Array([1, 2]));
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', scope: 'game-progress',
      aad: { purpose: 'game-progress', table: 'game_progress_pic', rowId: storageKey, field: 'bytes' } }));
    mocks.find.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(readProgressPic('owner', id)).rejects.toMatchObject({ httpStatus: 404 });
  });
  it('retires the row before the permanent Worker tombstone, including repeated deletes', async () => {
    mocks.find.mockResolvedValue(row);
    await deleteProgressPic('owner', id, mocks.auth);
    await deleteProgressPic('owner', id, mocks.auth);
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]!);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.purge.mock.invocationCallOrder[0]!);
    expect(mocks.purge).toHaveBeenCalledWith({ userId: 'owner', resource: { kind: 'game_progress_pic', objectKey: expect.stringContaining('/progress/') } });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('cannot retire another owner’s picture', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(deleteProgressPic('other', id, mocks.auth)).rejects.toMatchObject({ httpStatus: 404 });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.purge).not.toHaveBeenCalled();
  });
  it('propagates a failed tombstone so delete cannot claim success', async () => {
    mocks.find.mockResolvedValue(row); mocks.purge.mockRejectedValue(new Error('storage unavailable'));
    await expect(deleteProgressPic('owner', id, mocks.auth)).rejects.toMatchObject({ httpStatus: 503, retryable: true, cause: undefined });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('uses the existing immutable key on upload replay and never uploads for a retired/colliding UUID', async () => {
    mocks.find.mockResolvedValue(row);
    const input = { id, measureId: 'pushups.reps', takenAt: row.takenAt.toISOString() };
    await putProgressPic('owner', input, new Uint8Array([1, 2]), mocks.auth);
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', mediaId: storageKey, envelope: 'sealed-bytes' }));
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]!);
    mocks.find.mockResolvedValue(null); mocks.put.mockClear();
    await expect(putProgressPic('owner', input, new Uint8Array([1, 2]), mocks.auth)).rejects.toMatchObject({ httpStatus: 409 });
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
