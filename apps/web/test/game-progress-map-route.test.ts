import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), series: vi.fn(), resolve: vi.fn(), render: vi.fn(),
  raw: vi.fn(), health: vi.fn(), profile: vi.fn(), state: vi.fn(), open: vi.fn(), awards: vi.fn(), art: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/game/progress/vault-runs', async original => ({ ...await original<typeof import('../src/lib/game/progress/vault-runs')>(), readOwnSeries: mocks.series }));
vi.mock('@/src/lib/game/progress/mapbox', () => ({ resolveRoute: mocks.resolve, renderRouteMap: mocks.render }));
vi.mock('@/src/lib/device-sync/companion-numbers', async original => ({ ...await original<typeof import('../src/lib/device-sync/companion-numbers')>(), readCompanionHealthSeries: mocks.raw }));
vi.mock('@/src/lib/browser-vault/authority', () => ({ assertBrowserVaultMemberAuthority: mocks.health }));
vi.mock('@/src/lib/game/progress/crypto', () => ({ openProgress: mocks.open,
  progressLookup: (_member: string, _purpose: string, parts: string[]) => parts.join(':') }));
vi.mock('@/src/lib/game/progress/awards', () => ({ readAwards: mocks.awards }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({
  gameProfile: { findUnique: mocks.profile }, gameProgressMeasure: { findUnique: mocks.state }, gamePlaceArt: { findFirst: mocks.art },
  $transaction: (run: (tx: object) => Promise<void>) => run({ synthetic: true }),
}) }));
import { GET } from '../app/api/game/v1/progress/map/route';
import { encodePolyline } from '../src/lib/game/progress/route-geometry';
import { routeLegs } from '../src/lib/game/progress/route-progress';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
const leg = { from: 'London', to: 'Paris', distanceM: 1000, startTotal: 0, straightLine: false, towns: [], polyline: encodePolyline([[0, 50], [2, 49]]) };
const snapshot = () => ({ incomplete: false, states: new Map([['walk.meters', { legs: [leg] }]]), awards: [],
  measures: [{ id: 'walk.meters', amounts: [{ date: '2026-11-01', amount: 500 }] }] });
const request = (query: string) => new Request(`https://example.test/api/game/v1/progress/map?${query}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'owner' } });
  mocks.series.mockResolvedValue(snapshot()); mocks.resolve.mockResolvedValue(leg);
  mocks.profile.mockResolvedValue({ createdAt: new Date('2026-11-01T12:00:00Z'), timeZone: 'UTC' });
  mocks.state.mockResolvedValue({ stateEncrypted: 'synthetic-sealed' }); mocks.awards.mockResolvedValue([]); mocks.art.mockResolvedValue(null);
  mocks.open.mockResolvedValue({ legs: [{ ...leg, distanceM: 1609.344 }] });
  mocks.raw.mockResolvedValue({ numbers: { steps: { daily: [
    { date: '2026-10-31', value: 10000 }, { date: '2026-11-01', value: 1000 },
  ] } } });
  mocks.render.mockImplementation(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
});
describe('Progress map HTTP contract', () => {
  it('serves the painted map with today\'s line when one is ready, else the plain map', async () => {
    const sharp = (await import('sharp')).default;
    mocks.art.mockResolvedValue({ bytes: await sharp({ create: { width: 708, height: 405, channels: 3, background: '#8aa060' } }).jpeg().toBuffer() });
    const painted = await GET(request('measure=walk.meters&size=card'));
    expect(painted.status).toBe(200);
    expect(painted.headers.get('content-type')).toBe('image/jpeg');
    expect(painted.headers.get('cache-control')).toBe('private, no-store');
    expect(await sharp(Buffer.from(await painted.arrayBuffer())).metadata()).toMatchObject({ width: 708, height: 405 });
    expect(mocks.art.mock.calls[0]![0]).toMatchObject({ where: { key: expect.stringMatching(/^map:v1:card:/u), status: 'ready' } });
    expect(mocks.render).not.toHaveBeenCalled();
    mocks.art.mockRejectedValue(new Error('db down'));
    expect((await GET(request('measure=walk.meters&size=card'))).headers.get('content-type')).toBe('image/png');
  });
  it.each(['card', 'drawer'])('uses settled Health Steps since joining on the %s map', async size => {
    const response = await GET(request(`measure=steps&size=${size}`));
    expect(response.status).toBe(200);
    expect(mocks.raw).toHaveBeenCalledExactlyOnceWith({ member: { id: 'owner' } }, expect.any(AbortSignal), ['steps']);
    expect(mocks.series).not.toHaveBeenCalled();
    expect(mocks.render).toHaveBeenCalledWith({ polyline: leg.polyline, progress: 0.5, size });
    expect(mocks.state).toHaveBeenCalledWith({ where: { memberId_lookup: { memberId: 'owner', lookup: 'steps' } }, select: { stateEncrypted: true } });
    expect(mocks.health).toHaveBeenCalledWith({ memberId: 'owner', prisma: { synthetic: true } });
    expect(mocks.health.mock.invocationCallOrder[0]).toBeLessThan(mocks.render.mock.invocationCallOrder[0]!);
  });
  it('refuses the Steps image when health authority is lost after the read', async () => {
    mocks.health.mockRejectedValue(hostedOnboardingError({ code: 'CONSENT_REQUIRED', httpStatus: 403, message: 'Consent required.' }));
    expect((await GET(request('measure=steps&size=card'))).status).toBe(403);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('does not turn a failed Steps read into an empty map', async () => {
    mocks.raw.mockRejectedValue(new Error('synthetic private input'));
    const response = await GET(request('measure=steps&size=card'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { retryable: true } });
    expect(mocks.raw).toHaveBeenCalledTimes(1); expect(mocks.render).not.toHaveBeenCalled();
  });
  it('draws as far along as the link\'s version says', async () => {
    // 400.2 of 1,000 m: the link's version rounds it to 0.4, so the picture does too.
    mocks.series.mockResolvedValue({ ...snapshot(), measures: [{ id: 'walk.meters', amounts: [{ date: '2026-11-01', amount: 400.2 }] }] });
    expect((await GET(request('measure=walk.meters&size=card'))).status).toBe(200);
    expect(mocks.render).toHaveBeenCalledWith({ polyline: leg.polyline, progress: 0.4, size: 'card' });
  });
  it('does not draw a Steps map with nothing walked before steps are read', async () => {
    mocks.raw.mockResolvedValue(null);
    const response = await GET(request('measure=steps&size=card'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'PROGRESS_INCOMPLETE', retryable: true } });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it.each(['card', 'drawer'])('uses the owner’s frozen leg and rechecks authority for %s', async size => {
    const response = await GET(request(`measure=walk.meters&size=${size}`));
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(mocks.series).toHaveBeenCalledWith('owner', expect.any(Date));
    expect(mocks.render).toHaveBeenCalledWith({ polyline: leg.polyline, progress: 0.5, size });
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
