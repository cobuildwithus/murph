import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ edit: vi.fn(), generate: vi.fn(), satellite: vi.fn(), reverse: vi.fn(), rows: vi.fn(), ensure: vi.fn(),
  patch: vi.fn(), after: [] as (() => Promise<void>)[] }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (job: () => Promise<void>) => { mocks.after.push(job); } }));
vi.mock('openai', () => {
  class APIError extends Error { constructor(readonly code: string) { super(code); } }
  return { default: class { static APIError = APIError; images = { edit: mocks.edit, generate: mocks.generate }; }, toFile: async (bytes: Buffer) => bytes };
});
vi.mock('../src/lib/game/progress/mapbox', () => ({ satelliteImage: mocks.satellite, reversePlace: mocks.reverse }));
vi.mock('../src/lib/game/progress/place-art', async original => ({ ...await original<typeof import('../src/lib/game/progress/place-art')>(),
  readArtRows: mocks.rows, ensureArt: mocks.ensure }));
vi.mock('../src/lib/game/progress/state', async original => ({ ...await original<typeof import('../src/lib/game/progress/state')>(), patchMeasureState: mocks.patch }));
vi.mock('../src/lib/prisma', () => ({ getPrisma: () => ({}) }));
import { coastAgreement } from '../src/lib/game/progress/coast-check';
import { drawRouteOnPainting, makePaintedMap, makePoster, mapKey, mapPaintable, posterKey } from '../src/lib/game/progress/place-art-make';
import { attachRouteArt } from '../src/lib/game/progress/route-art';
import { routeView } from '../src/lib/game/progress/route-progress';
import { encodePolyline, expandBbox, routeBbox } from '../src/lib/game/progress/route-geometry';
import type { RouteLeg } from '../src/lib/game/progress/state';

const sea = { r: 20, g: 70, b: 140 }, land = { r: 150, g: 140, b: 80 };
/** Sea on the left `coast` share of the frame, land to the right. */
async function coastImage(width: number, height: number, coast: number) {
  const left = Math.round(width * coast);
  return sharp({ create: { width, height, channels: 3, background: land } })
    .composite([{ input: await sharp({ create: { width: left, height, channels: 3, background: sea } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
}
const b64 = (bytes: Buffer) => ({ data: [{ b64_json: bytes.toString('base64') }] });
const polyline = encodePolyline([[-117.16, 32.72], [-117.27, 32.96], [-118.24, 34.05]]);
const mile = 1609.344;
const leg: RouteLeg = { from: 'San Diego', to: 'Los Angeles', distanceM: 125 * mile, polyline, straightLine: false, startTotal: 0, towns: [
  { name: 'San Diego', atM: 0, place: { id: 'dplace-sd', label: 'San Diego, California, United States' } },
  { name: 'Del Mar', atM: 20 * mile, place: { id: 'dplace-dm', label: 'Del Mar, California, United States' } },
  { name: 'Irvine', atM: 70 * mile, place: null },
  { name: 'Los Angeles', atM: 125 * mile, place: { id: 'dplace-la', label: 'Los Angeles, California, United States' } },
] };
const steps = (miles: number, on = '2026-11-10') => [[on, miles * 2000] as [string, number]];
beforeEach(() => { vi.resetAllMocks(); mocks.after.length = 0; mocks.rows.mockResolvedValue(new Map()); mocks.ensure.mockResolvedValue(new Map()); });

describe('painted maps', () => {
  it('paints the frame grown to the edit canvas and keeps it only where the coast lines up', async () => {
    const photo = await coastImage(1536, 1024, 0.4);
    mocks.satellite.mockResolvedValue(photo);
    mocks.edit.mockResolvedValue(b64(photo));
    const painted = await makePaintedMap(polyline, 'card', new AbortController().signal);
    expect(await sharp(painted).metadata()).toMatchObject({ width: 708, height: 405, format: 'jpeg' });
    const [bbox, width, height] = mocks.satellite.mock.calls[0]!;
    expect([width, height]).toEqual([1536, 1024]);
    expect(bbox).toEqual(expandBbox(routeBbox([[-117.16, 32.72], [-117.27, 32.96], [-118.24, 34.05]], 708, 405), 1.5));
    expect(mocks.edit.mock.calls[0]![0]).toMatchObject({ model: 'gpt-image-2.6-flare', size: '1536x1024', quality: 'high' });
    expect(mocks.edit.mock.calls[0]![0].prompt).not.toMatch(/miyazaki|ghibli/iu);
  });

  it('refuses a painting whose coast moved', async () => {
    mocks.satellite.mockResolvedValue(await coastImage(1024, 1024, 0.4));
    mocks.edit.mockResolvedValue(b64(await coastImage(1024, 1024, 0.47)));
    await expect(makePaintedMap(polyline, 'drawer', new AbortController().signal)).rejects.toMatchObject({ code: 'drifted' });
  });

  it('reads an inland frame as lined up, and a mirrored coast as not', async () => {
    const inland = await sharp({ create: { width: 400, height: 300, channels: 3, background: land } }).png().toBuffer();
    expect(await coastAgreement(inland, await coastImage(400, 300, 0.5), 4 / 3)).toBe(1);
    const coast = await coastImage(400, 300, 0.3), mirrored = await sharp(coast).flop().png().toBuffer();
    expect(await coastAgreement(coast, coast, 4 / 3)).toBe(1);
    expect(await coastAgreement(coast, mirrored, 4 / 3)).toBeLessThanOrEqual(0.5);
  });

  it('reads the photo\'s near-black deep ocean as sea', async () => {
    const water = (width: number, color: { r: number; g: number; b: number }) => sharp({ create: { width, height: 300, channels: 3, background: color } }).png().toBuffer();
    // Deep ocean far out, lighter water by the shore, then land; painted as one blue sea.
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: land } }).composite([
      { input: await water(200, { r: 5, g: 10, b: 16 }), left: 0, top: 0 }, { input: await water(60, { r: 20, g: 50, b: 110 }), left: 200, top: 0 }]).png().toBuffer();
    expect(await coastAgreement(photo, await coastImage(400, 300, 0.65), 4 / 3)).toBeGreaterThan(0.9);
  });

  it('draws the walked and remaining line over the painting at the map size', async () => {
    const painting = await sharp({ create: { width: 708, height: 640, channels: 3, background: land } }).jpeg().toBuffer();
    const drawn = await drawRouteOnPainting(painting, polyline, 0.5, 'drawer');
    expect(await sharp(drawn).metadata()).toMatchObject({ width: 708, height: 640 });
    expect((await sharp(drawn).stats()).channels[0]!.max).toBe(255);
  });

  it('paints regional legs only, keyed by geometry and size', () => {
    expect(mapPaintable(leg)).toBe(true);
    expect(mapPaintable({ ...leg, distanceM: 12_000 })).toBe(false);
    expect(mapPaintable({ ...leg, straightLine: true })).toBe(false);
    expect(mapKey(polyline, 'card')).toMatch(/^map:v1:card:[A-Za-z0-9_-]{43}$/u);
    expect(mapKey(polyline, 'card')).not.toBe(mapKey(polyline, 'drawer'));
    expect(mapKey(polyline, 'card')).not.toContain('San Diego');
  });

  it('asks for a poster by the place name alone', async () => {
    mocks.generate.mockResolvedValue(b64(await sharp({ create: { width: 64, height: 96, channels: 3, background: sea } }).jpeg().toBuffer()));
    await makePoster('Del Mar, California, United States', new AbortController().signal);
    const request = mocks.generate.mock.calls[0]![0];
    expect(request).toMatchObject({ size: '1024x1536', quality: 'medium' });
    expect(request.prompt).toContain('travel poster illustration of Del Mar, California, United States');
    expect(request.prompt).toMatch(/No text/u);
  });
});

describe('route art on the Steps read', () => {
  it('starts the card map, the last passed and next posters, the drawer map, then earlier posters, and shows their states', async () => {
    const route = routeView('steps', { legs: [leg] }, steps(30), [], 'us')!;
    const startedAt = new Date();
    mocks.ensure.mockImplementation(async jobs => new Map(jobs.slice(0, 2).map((job: { key: string }) => [job.key, { key: job.key, status: 'making', startedAt }])));
    mocks.rows.mockResolvedValue(new Map([[posterKey('dplace-sd'), { key: posterKey('dplace-sd'), status: 'ready', startedAt }]]));
    await attachRouteArt([{ id: 'steps', route }], new Map([['steps', { legs: [leg] }]]), { memberId: 'member-ava', beforeMutationTx: async () => {} });
    expect(mocks.ensure.mock.calls[0]![0].map((job: { key: string }) => job.key))
      .toEqual([mapKey(polyline, 'card'), posterKey('dplace-dm'), mapKey(polyline, 'drawer'), posterKey('dplace-sd')]);
    expect(route.towns.map(town => town.poster?.state ?? null)).toEqual(['ready', 'making', null, null]);
    expect(route.towns[0]!.poster).toEqual({ state: 'ready', path: '/api/game/v1/progress/art/poster%3Av1%3Adplace-sd' });
    expect(route.towns[1]!.stepsText).toBe('60,000 steps');
    expect(route.drawerTowns[1]!.poster?.state).toBe('making');
    expect(route.mapArt).toMatchObject({ state: 'making', typicalSeconds: 14 });
    expect(route.drawerMapArt).toBeNull();
    expect(mocks.after).toHaveLength(0);
  });

  it('reports a ready painting without its path, since the map path serves it', async () => {
    const route = routeView('steps', { legs: [leg] }, steps(5), [], 'us')!;
    mocks.rows.mockResolvedValue(new Map([[mapKey(polyline, 'card'), { key: mapKey(polyline, 'card'), status: 'ready', startedAt: new Date() }]]));
    await attachRouteArt([{ id: 'steps', route }], new Map([['steps', { legs: [leg] }]]));
    expect(route.mapArt).toEqual({ state: 'ready' });
    expect(route.drawerMapArt).toBeNull();
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it('looks up the public places of an older leg once, after the response', async () => {
    const older: RouteLeg = { ...leg, towns: leg.towns.map(({ name, atM }) => ({ name, atM })) };
    const route = routeView('steps', { legs: [older] }, steps(5), [], 'us')!;
    mocks.reverse.mockImplementation(async () => ({ name: 'X', place: { id: 'dplace-x', label: 'X, California, United States' } }));
    await attachRouteArt([{ id: 'steps', route }], new Map([['steps', { legs: [older] }]]), { memberId: 'member-ava', beforeMutationTx: async () => {} });
    expect(route.towns.every(town => town.poster === null)).toBe(true);
    await Promise.all(mocks.after.map(job => job()));
    expect(mocks.reverse).toHaveBeenCalledTimes(4);
    const update = mocks.patch.mock.calls[0]![2]({ legs: [older] });
    expect(update.legs[0].towns.map((town: RouteLeg['towns'][number]) => town.place?.id)).toEqual(['dplace-x', 'dplace-x', 'dplace-x', 'dplace-x']);
    // A route changed in the meantime keeps its own towns.
    expect(mocks.patch.mock.calls[0]![2]({ legs: [{ ...older, polyline: 'other' }] })).toEqual({});
  });

  it('gives the map a new link each time a painting comes in', async () => {
    const link = async (sizes: ('card' | 'drawer')[]) => {
      const route = routeView('steps', { legs: [leg] }, steps(5), [], 'us')!;
      mocks.rows.mockResolvedValue(new Map(sizes.map(size => [mapKey(polyline, size), { key: mapKey(polyline, size), status: 'ready', startedAt: new Date() }])));
      await attachRouteArt([{ id: 'steps', route }], new Map([['steps', { legs: [leg] }]]));
      return route.map;
    };
    const plain = routeView('steps', { legs: [leg] }, steps(5), [], 'us')!.map;
    const card = await link(['card']), both = await link(['card', 'drawer']);
    expect(await link([])).toBe(plain);
    expect(new Set([plain, card, both]).size).toBe(3);
    expect(card).toMatch(/^\/api\/game\/v1\/progress\/map\?measure=steps&size=card&v=[\w-]{12}$/);
  });

  it('leaves the plain map when the art store cannot be read', async () => {
    const route = routeView('steps', { legs: [leg] }, steps(5), [], 'us')!;
    mocks.rows.mockRejectedValue(new Error('db down'));
    await attachRouteArt([{ id: 'steps', route }], new Map([['steps', { legs: [leg] }]]), { memberId: 'member-ava', beforeMutationTx: async () => {} });
    expect(route.mapArt).toBeNull();
    expect(route.towns.every(town => town.poster === null)).toBe(true);
  });
});
