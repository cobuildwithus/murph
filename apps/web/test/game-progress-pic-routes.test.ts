import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/game/progress/pics', () => ({ readProgressPic: mocks.read, deleteProgressPic: mocks.remove }));
import { GET, DELETE } from '../app/api/game/v1/progress/pics/[id]/route';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
const id = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id }) };
const request = () => new Request(`https://example.test/api/game/v1/progress/pics/${id}`);
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'owner' } }); });
describe('Progress picture HTTP contract', () => {
  it('returns only owner bytes with private caching', async () => {
    mocks.read.mockResolvedValue(new Uint8Array([255, 216, 255]));
    const response = await GET(request(), context);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenCalledWith('owner', id);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([255, 216, 255]);
  });
  it('deletes only after authorization and returns the write contract', async () => {
    mocks.remove.mockImplementation(async (_member, _id, authorize) => authorize({ synthetic: true }));
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.current).toHaveBeenCalledWith({ member: { id: 'owner' } }, { synthetic: true });
  });
  it.each([GET, DELETE])('rejects malformed ids before effects', async route => {
    const response = await route(request(), { params: Promise.resolve({ id: 'bad' }) });
    expect(response.status).toBe(400); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('preserves the indistinguishable missing/foreign/retired result', async () => {
    mocks.read.mockRejectedValue(hostedOnboardingError({ code: 'PROGRESS_PIC_NOT_FOUND', httpStatus: 404, message: 'That picture is not available.' }));
    const response = await GET(request(), context);
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: { code: 'PROGRESS_PIC_NOT_FOUND' } });
  });
  it('returns one retryable 503 without leaking storage errors', async () => {
    mocks.read.mockRejectedValue(new Error('private-provider-body'));
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'PROGRESS_UNAVAILABLE', message: 'Progress could not load. Try again.', retryable: true } });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
