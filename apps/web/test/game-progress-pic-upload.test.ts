import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), series: vi.fn(), put: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/game/progress/vault-runs', async original => ({ ...await original<typeof import('../src/lib/game/progress/vault-runs')>(), readOwnSeries: mocks.series }));
vi.mock('@/src/lib/game/progress/pics', async original => ({ ...await original<typeof import('../src/lib/game/progress/pics')>(), putProgressPic: mocks.put }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({ gameProfile: { findUniqueOrThrow: async () => ({ timeZone: 'America/New_York' }) } }) }));
import { POST } from '../app/api/game/v1/progress/pics/route';
const id = '11111111-1111-4111-8111-111111111111';
const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
const query = { id, measureId: 'pushups.reps', takenAt: '2026-11-03T02:00:00Z' };
const request = (params: Record<string, string>, contentType = 'image/jpeg') => new Request(`https://example.test/api/game/v1/progress/pics?${new URLSearchParams(params)}`,
  { method: 'POST', headers: { 'Content-Type': contentType }, body: new Uint8Array(bytes) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'owner' } });
  mocks.series.mockResolvedValue({ incomplete: false, measures: [{ id: 'pushups.reps', amounts: [
    { date: '2026-11-01', amount: 40 }, { date: '2026-11-02', amount: 20 }, { date: '2026-11-03', amount: 50 },
  ] }] });
  mocks.put.mockImplementation(async (_member, _input, _bytes, authorize) => authorize({ synthetic: true }));
});
describe('Progress JPEG upload HTTP contract', () => {
  it('returns a pin from the canonical cumulative series on the capture’s local day', async () => {
    const response = await POST(request(query));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, pic: { id, takenOn: '2026-11-02', at: 60 } });
    expect(mocks.put).toHaveBeenCalledWith('owner', query, expect.any(Uint8Array), expect.any(Function));
    expect(mocks.current).toHaveBeenCalledWith({ member: { id: 'owner' } }, { synthetic: true });
  });
  it('does not upload against an incomplete series', async () => {
    mocks.series.mockResolvedValue({ incomplete: true, measures: [] });
    const response = await POST(request(query));
    expect(response.status).toBe(503); expect((await response.json()).error.retryable).toBe(true);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('does not associate bytes with an absent or foreign measure', async () => {
    const response = await POST(request({ ...query, measureId: 'abs.seconds' }));
    expect(response.status).toBe(404); expect(mocks.put).not.toHaveBeenCalled();
  });
  it.each([{ ...query, id: 'bad' }, { ...query, takenAt: 'yesterday' }])('rejects malformed metadata before reading or storing', async params => {
    expect((await POST(request(params))).status).toBe(400);
    expect(mocks.series).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('rejects non-JPEG input before reads and effects', async () => {
    expect((await POST(request(query, 'image/png'))).status).toBe(400);
    expect(mocks.series).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('returns one private retryable failure without provider content', async () => {
    mocks.put.mockRejectedValue(new Error('private-provider-body'));
    const response = await POST(request(query));
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: { code: 'PROGRESS_UNAVAILABLE', message: 'Progress could not load. Try again.', retryable: true } });
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });
});
