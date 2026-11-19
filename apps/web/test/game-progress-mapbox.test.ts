import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PlaceNotFound, previewRoute, resolveRoute, resolveRouteGeometry, renderRouteMap, reversePlace, satelliteImage, type FoundPlace } from '../src/lib/game/progress/mapbox';
import { decodePolyline, encodePolyline, routeBbox } from '../src/lib/game/progress/route-geometry';
const polyline = encodePolyline([[-117.16, 32.72], [-118.24, 34.05], [-122.42, 37.77]]);
const feature = (name: string, coordinates: [number, number]) => ({ features: [{ properties: { name }, geometry: { coordinates } }] });
const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); vi.stubEnv('MAPBOX_ACCESS_TOKEN', 'synthetic-token'); vi.stubEnv('MAPBOX_STYLE_ID', 'synthetic/style'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
function respond(code: string, status = 200, reverse = async () => Response.json(feature('Town', [-118, 34]))) {
  mockFetch.mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith('/forward')) return Response.json(feature('City', url.searchParams.get('q') === 'Start' ? [-117.16, 32.72] : [-122.42, 37.77]));
    if (url.pathname.endsWith('/reverse')) return reverse();
    return Response.json({ code, routes: [{ distance: 800000, geometry: polyline }] }, { status });
  });
}
describe('Progress Mapbox boundary', () => {
  it('keeps a town\'s public place id and full name, and null when Mapbox has none', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ features: [{ geometry: { coordinates: [-117.27, 32.96] },
      properties: { name: 'Del Mar', mapbox_id: 'dplace-dm', place_formatted: 'California, United States' } }] }));
    expect(await reversePlace([-117.27, 32.96])).toEqual({ name: 'Del Mar', place: { id: 'dplace-dm', label: 'Del Mar, California, United States' } });
    mockFetch.mockResolvedValueOnce(Response.json(feature('Somewhere', [0, 0])));
    expect(await reversePlace([0, 0])).toEqual({ name: 'Somewhere', place: null });
    expect((mockFetch.mock.calls[0]![0] as URL).searchParams.get('types')).toBe('place');
  });
  it('asks for plain satellite of exactly the frame, with no overlays, logo or attribution', async () => {
    mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71])));
    await satelliteImage([-118.5, 32.5, -117, 34.2], 1536, 1024, new AbortController().signal);
    const url = mockFetch.mock.calls[0]![0] as URL;
    expect(decodeURIComponent(url.pathname)).toBe('/styles/v1/mapbox/satellite-v9/static/[-118.5,32.5,-117,34.2]/768x512@2x');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ padding: '0', attribution: 'false', logo: 'false' });
  });
  it('keeps the first occurrence in sample order with two reverse geocodes in flight', async () => {
    const names = ['Start', 'Valley', 'Start', 'Ridge', 'Valley', 'Lake', 'Lake', 'End'];
    let next = 0, active = 0, peak = 0;
    const completed: number[] = [];
    respond('Ok', 200, async () => {
      const index = next++;
      peak = Math.max(peak, ++active);
      if (index % 2 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      completed.push(index);
      active--;
      return Response.json(feature(names[index]!, [-118, 34]));
    });
    const route = await resolveRoute('Start', 'End');
    expect(next).toBe(8);
    expect(peak).toBe(2);
    expect(completed[0]).toBe(1);
    expect(route.towns).toEqual([0, 1, 3, 5, 7].map(i => ({ name: names[i], atM: 800000 * i / 7, place: null })));
  });
  it('resolves both ends, driving geometry and exactly eight place samples', async () => {
    respond('Ok');
    const result = await resolveRoute('Start', 'End');
    expect(result).toMatchObject({ distanceM: 800000, polyline, straightLine: false, towns: [{ name: 'Town', atM: 0 }] });
    const urls = mockFetch.mock.calls.map(call => call[0] as URL);
    expect(urls).toHaveLength(11);
    expect(urls[2]!.pathname).toContain('/mapbox/driving/');
    expect(urls[2]!.searchParams.get('overview')).toBe('simplified');
    expect(urls.slice(3).every(url => url.searchParams.get('types') === 'place')).toBe(true);
    expect(urls[0]!.searchParams.get('permanent')).toBe('true');
    expect(JSON.stringify(result)).not.toContain('synthetic-token');
  });
  it('routes the Iceland loop through ordered waypoints and uses the checked length for its towns', async () => {
    respond('Ok');
    const name = 'Reykjavík, Iceland';
    const route = await resolveRoute(name, name);
    expect(route).toMatchObject({ name: 'Around Iceland', distanceM: 1322000, straightLine: false, polyline });
    const urls = mockFetch.mock.calls.map(call => call[0] as URL);
    expect(urls.filter(url => url.pathname.endsWith('/forward'))).toHaveLength(1);
    const stops = urls[1]!.pathname.split('/').at(-1)!.split(';');
    expect(stops).toEqual([stops[0], '-18.09,65.68', '-14.4,65.26', '-14.22,65.03', '-15.21,64.27', '-19.01,63.42', stops[0]]);
    respond('NoRoute');
    await expect(resolveRoute(name, name)).rejects.toMatchObject({ httpStatus: 503, retryable: true });
  });
  it('uses great-circle geometry only for explicit NoRoute', async () => {
    respond('NoRoute');
    const result = await resolveRoute('Start', 'End');
    expect(result.straightLine).toBe(true); expect(result.towns).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.distanceM).toBeGreaterThan(700000); expect(result.distanceM).toBeLessThan(800000);
  });
  it.each([['NoSegment', 200], ['InvalidInput', 422], ['NoRoute', 503], ['Ok', 401]])('returns retryable 503 for %s / HTTP %s', async (code, status) => {
    respond(code, status);
    await expect(resolveRoute('Start', 'End')).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
  it('needs the style id', async () => {
    vi.stubEnv('MAPBOX_STYLE_ID', '');
    await expect(renderRouteMap({ polyline, progress: 0, size: 'card' })).rejects.toMatchObject({ message: 'The map could not load. Try again.' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('does not expose provider text, request URLs or transport credentials', async () => {
    mockFetch.mockRejectedValue(new Error('private body and synthetic-token'));
    await expect(resolveRoute('Start', 'End')).rejects.toMatchObject({ message: 'The map could not load. Try again.', cause: undefined });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { size: 'card', width: 708, height: 405, progress: 0 },
    { size: 'card', width: 708, height: 405, progress: 1 },
    { size: 'drawer', width: 708, height: 640, progress: 0.5 },
  ] as const)('streams a private $size PNG with both overlays at $progress', async ({ size, width, height, progress }) => {
    mockFetch.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
    const response = await renderRouteMap({ polyline, progress, size });
    const url = mockFetch.mock.calls[0]![0] as URL;
    expect(url.pathname).toContain('path-4+CDBEA7-1'); expect(url.pathname).toContain('path-4+5A6E32-1');
    expect(url.pathname).toContain(`/styles/v1/synthetic/style/static/`); expect(url.pathname).toContain(`/${width}x${height}.png`);
    const bbox = routeBbox(decodePolyline(polyline), width, height);
    expect(url.pathname).toContain(`[${bbox.join(',')}]`); expect(url.searchParams.get('padding')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(JSON.stringify([...response.headers])).not.toContain('synthetic-token');
  });
});

describe('Progress place fixes', () => {
  const lisbon = { name: 'Lisbon', mapbox_id: 'dplace-lis', place_formatted: 'Lisbon, Portugal' };
  const lisbonLabel = 'Lisbon, Lisbon, Portugal';
  const found = (properties: object, coordinates: [number, number]) => ({ properties, geometry: { coordinates } });
  /** Start is found; "Lisbn" is not, its close spellings are Lisbon and a namesake, and its qualified label finds `kept`. */
  function places(kept = found(lisbon, [-9.14, 38.72])) {
    mockFetch.mockImplementation(async (url: URL) => {
      const q = url.searchParams.get('q');
      if (url.pathname.endsWith('/forward')) {
        if (q === 'Start') return Response.json({ features: [found({ name: 'Start' }, [-117.16, 32.72])] });
        if (q === lisbonLabel) return Response.json({ features: [kept] });
        if (url.searchParams.get('autocomplete') === 'true') return Response.json({ features: [found(lisbon, [-9.14, 38.72]),
          found({ name: 'Lisbon', mapbox_id: 'dplace-lis-nd', place_formatted: 'North Dakota, United States' }, [-97.68, 46.44])] });
        return Response.json({ features: [] });
      }
      if (url.pathname.endsWith('/reverse')) return Response.json(feature('Town', [-118, 34]));
      return Response.json({ code: 'Ok', routes: [{ distance: 800000, geometry: polyline }] });
    });
  }
  const forwards = () => mockFetch.mock.calls.map(call => call[0] as URL).filter(url => url.pathname.endsWith('/forward'));

  it('looks a slip up once among close spellings and saves the fixed place under its qualified label', async () => {
    places();
    const fix = vi.fn(async (_typed: string, candidates: readonly FoundPlace[]) => candidates[0]!);
    const preview = await previewRoute('Start', 'Lisbn', fix);
    expect(fix).toHaveBeenCalledExactlyOnceWith('Lisbn', [
      { at: [-9.14, 38.72], id: 'dplace-lis', name: 'Lisbon', label: lisbonLabel },
      { at: [-97.68, 46.44], id: 'dplace-lis-nd', name: 'Lisbon', label: 'Lisbon, North Dakota, United States' }]);
    expect(preview.fixed).toEqual({ typed: 'Lisbn', showing: 'Lisbon' });
    expect(preview.query).toEqual({ from: 'Start', to: lisbonLabel });
    expect(preview.leg).toMatchObject({ from: 'Start', to: 'Lisbon' });
    const near = forwards().find(url => url.searchParams.get('autocomplete') === 'true')!;
    expect(near.searchParams.get('permanent')).toBeNull(); expect(near.searchParams.get('limit')).toBe('5');
    expect(forwards().find(url => url.searchParams.get('q') === lisbonLabel)!.searchParams.get('permanent')).toBe('true');
    // The save looks the label up directly: no close spellings, no fixer, same short name.
    mockFetch.mockClear();
    expect(await resolveRoute('Start', lisbonLabel)).toMatchObject({ from: 'Start', to: 'Lisbon' });
    expect(forwards().map(url => url.searchParams.get('autocomplete'))).toEqual(['false', 'false']);
  });

  it.each([
    ['picks none', async () => null],
    ['fails', async () => { throw new Error('decisions down'); }],
  ])('names the typed words when the fixer %s', async (_, fixer) => {
    places();
    const fix = vi.fn(fixer);
    await expect(previewRoute('Start', 'Lisbn', fix).catch(error => { if (error instanceof PlaceNotFound) return error.typed; throw error; }))
      .resolves.toBe('Lisbn');
  });

  it('refuses a pick whose qualified label finds a different place', async () => {
    places(found({ name: 'Lisbon', mapbox_id: 'dplace-other', place_formatted: 'Lisbon, Portugal' }, [-9.14, 38.72]));
    await expect(previewRoute('Start', 'Lisbn', async (_typed, candidates) => candidates[0]!)).rejects.toBeInstanceOf(PlaceNotFound);
  });

  it('skips the fixer with no close spellings, and never fixes without one', async () => {
    mockFetch.mockImplementation(async (url: URL) => url.searchParams.get('q') === 'Start'
      ? Response.json({ features: [found({ name: 'Start' }, [-117.16, 32.72])] }) : Response.json({ features: [] }));
    const fix = vi.fn(async () => null);
    await expect(previewRoute('Start', 'Grandmas house', fix)).rejects.toMatchObject({ typed: 'Grandmas house' });
    expect(fix).not.toHaveBeenCalled();
    mockFetch.mockClear();
    await expect(resolveRoute('Start', 'Grandmas house')).rejects.toMatchObject({ httpStatus: 404, code: 'PROGRESS_PLACE_NOT_FOUND' });
    expect(forwards().every(url => url.searchParams.get('autocomplete') === 'false')).toBe(true);
  });

  it('keeps two towns of one name and drops one place sampled twice', async () => {
    const towns = [['Springfield', 'dplace-a'], ['Springfield', 'dplace-b'], ['Springfield', 'dplace-b'], ['Hill', null]];
    let next = 0;
    respond('Ok', 200, async () => {
      const [name, id] = towns[Math.min(next++, towns.length - 1)]!;
      return Response.json({ features: [found({ name, ...(id && { mapbox_id: id, place_formatted: 'Illinois, United States' }) }, [-118, 34])] });
    });
    const route = await resolveRoute('Start', 'End');
    expect(route.towns.map(town => [town.name, town.place?.id ?? null])).toEqual([['Springfield', 'dplace-a'], ['Springfield', 'dplace-b'], ['Hill', null]]);
  });

  it('draws a preview picture from the road alone, with no town lookups', async () => {
    respond('Ok');
    expect(await resolveRouteGeometry('Start', 'End')).toMatchObject({ polyline, straightLine: false });
    expect(mockFetch.mock.calls.map(call => (call[0] as URL).pathname).filter(path => path.endsWith('/reverse'))).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
