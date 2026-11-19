import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), art: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({ gamePlaceArt: { findFirst: mocks.art } }) }));
import { GET } from '../app/api/game/v1/progress/art/[key]/route';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';

const get = (key: string) => GET(new Request(`https://example.test/api/game/v1/progress/art/${encodeURIComponent(key)}`), { params: Promise.resolve({ key }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'member-ava' } }); mocks.art.mockResolvedValue(null); });
describe('shared place art HTTP contract', () => {
  it('serves ready art to a signed-in member, cached for good', async () => {
    mocks.art.mockResolvedValue({ bytes: new Uint8Array([255, 216, 255]) });
    const response = await get('poster:v1:dplace-dm');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
    expect(mocks.art).toHaveBeenCalledWith({ where: { key: 'poster:v1:dplace-dm', status: 'ready' }, select: { bytes: true } });
  });
  it.each(['poster:v1:dplace-missing', 'progress/abc.jpg', 'poster:v2:x', 'map:v1:card:has space'])('answers 404 for %s', async key => {
    expect((await get(key)).status).toBe(404);
  });
  it('never serves a postcard story as an image, even a saved one', async () => {
    mocks.art.mockResolvedValue({ bytes: new TextEncoder().encode('{"title":"River mills town"}') });
    expect((await get('story:v1:dplace-dm')).status).toBe(404);
    expect(mocks.art).not.toHaveBeenCalled();
  });
  it('needs a signed-in member', async () => {
    mocks.auth.mockRejectedValue(hostedOnboardingError({ code: 'AUTH_REQUIRED', httpStatus: 401, message: 'Sign in.' }));
    expect((await get('poster:v1:dplace-dm')).status).toBe(401);
    expect(mocks.art).not.toHaveBeenCalled();
  });
});
