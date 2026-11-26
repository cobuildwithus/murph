import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), art: vi.fn(), transaction: vi.fn(), after: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({ gamePlaceArt: { findFirst: mocks.art }, $transaction: mocks.transaction }) }));
import { GET } from '../app/api/game/v1/progress/art/[key]/route';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';

const get = (key: string) => GET(new Request(`https://example.test/api/game/v1/progress/art/${encodeURIComponent(key)}`), { params: Promise.resolve({ key }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'member-ava' } }); mocks.art.mockResolvedValue(null); });
describe('shared place art HTTP contract', () => {
  it.each([
    'poster:v1:dplace-dm', 'map:v1:card:fixture', 'area:v1:15/4095/16384', 'area:v1:15/32767/16384', 'area:v1:1/0/0',
  ])('serves ready %s to a signed-in member, cached for good', async key => {
    mocks.art.mockResolvedValue({ bytes: new Uint8Array([255, 216, 255]) });
    const response = await get(key);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]));
    expect(mocks.art).toHaveBeenCalledWith({ where: { key, status: 'ready' }, select: { bytes: true } });
  });
  it('leaves a missing area unclaimed and schedules no work', async () => {
    const key = 'area:v1:15/4095/16384';
    expect((await get(key)).status).toBe(404);
    expect(mocks.art).toHaveBeenCalledWith({ where: { key, status: 'ready' }, select: { bytes: true } });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each([
    'area:v1:16/0/0', 'area:v1:0/0/0', 'area:v1:15/32768/16384', 'area:v1:15/4095/32767',
    'area:v1:15/-1/0', 'area:v1:15/0.5/0', 'area:v1:15/01/0', 'area:v2:15/0/0', 'area:v1:15/0/0/1',
  ])('rejects invalid area key %s before looking up art', async key => {
    expect((await get(key)).status).toBe(404);
    expect(mocks.art).not.toHaveBeenCalled();
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
