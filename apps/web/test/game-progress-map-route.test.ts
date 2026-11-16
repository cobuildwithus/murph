import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), series: vi.fn(), resolve: vi.fn(), render: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/game/progress/series', async original => ({ ...await original<typeof import('../src/lib/game/progress/series')>(), readGameSeries: mocks.series }));
vi.mock('@/src/lib/game/progress/mapbox', () => ({ resolveRoute: mocks.resolve, renderRouteMap: mocks.render }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({
  $transaction: (run: (tx: object) => Promise<void>) => run({ synthetic: true }),
}) }));
import { GET } from '../app/api/game/v1/progress/map/route';
import { encodePolyline } from '../src/lib/game/progress/route-geometry';
import { routeLegs } from '../src/lib/game/progress/route-progress';
import { MURPH_MAP_STYLE } from '../src/lib/game/progress/routes';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
const leg = { from: 'London', to: 'Paris', distanceM: 1000, startTotal: 0, straightLine: false, towns: [], polyline: encodePolyline([[0, 50], [2, 49]]) };
const snapshot = () => ({ incomplete: false, states: new Map([['walk.meters', { legs: [leg] }]]), awards: [],
  measures: [{ id: 'walk.meters', amounts: [{ date: '2026-11-01', amount: 500 }] }] });
const request = (query: string) => new Request(`https://example.test/api/game/v1/progress/map?${query}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'owner' } });
  mocks.series.mockResolvedValue(snapshot()); mocks.resolve.mockResolvedValue(leg);
  mocks.render.mockImplementation(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
});
describe('Progress map HTTP contract', () => {
  it.each(['card', 'drawer'])('uses the owner’s frozen leg and rechecks authority for %s', async size => {
    const response = await GET(request(`measure=walk.meters&size=${size}`));
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(mocks.series).toHaveBeenCalledWith('owner', expect.any(Date));
    expect(mocks.render).toHaveBeenCalledWith({ polyline: leg.polyline, progress: 0.5, size, style: MURPH_MAP_STYLE });
    expect(mocks.current.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]!);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('renders an awarded finish fully after the current total shrinks', async () => {
    const candidate = routeLegs({ measureId: 'walk.meters', legs: [leg], points: [['2026-11-01', 1000]] })[0]!;
    mocks.series.mockResolvedValue({ ...snapshot(), awards: [{ ...candidate, id: 'award', createdAt: new Date(), seenAt: null }] });
    expect((await GET(request('measure=walk.meters&size=card'))).status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ progress: 1 }));
  });
  it.each(['card', 'drawer'])('previews two places at %s without reading or changing measure state', async size => {
    const response = await GET(request(`from=London&to=New%20York&size=${size}`));
    expect(response.status).toBe(200); expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('London', 'New York');
    expect(mocks.series).not.toHaveBeenCalled(); expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ progress: 0, size }));
  });
  it.each(['measure=walk.meters&w=708&h=405', 'measure=walk.meters&size=poster',
    'from=London&to=Paris&size=poster', 'measure=walk.meters', 'from=London&to=Paris',
    'measure=walk.meters&size=card&w=708', 'measure=walk.meters&from=London&to=Paris&size=card'])('rejects invalid or mixed queries: %s', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.series).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('renders nothing from an incomplete collection or absent measure', async () => {
    mocks.series.mockResolvedValue({ ...snapshot(), incomplete: true });
    expect((await GET(request('measure=walk.meters&size=card'))).status).toBe(503);
    mocks.series.mockResolvedValue({ ...snapshot(), measures: [] });
    expect((await GET(request('measure=walk.meters&size=card'))).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('does not render after live authority is revoked', async () => {
    mocks.current.mockRejectedValue(hostedOnboardingError({ code: 'UNAUTHENTICATED', httpStatus: 401, message: 'Sign in to continue.' }));
    expect((await GET(request('measure=walk.meters&size=card'))).status).toBe(401);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('returns a fixed private 503 for dependency failures', async () => {
    mocks.resolve.mockRejectedValue(new Error('private-provider-body'));
    const response = await GET(request('from=London&to=Paris&size=card'));
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: { code: 'PROGRESS_UNAVAILABLE', message: 'Progress could not load. Try again.', retryable: true } });
    expect(mocks.resolve).toHaveBeenCalledTimes(1); expect(mocks.render).not.toHaveBeenCalled();
  });
});
