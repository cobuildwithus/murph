import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { resolveRoute, renderRouteMap } from '../src/lib/game/progress/mapbox';
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
    expect(route.towns).toEqual([0, 1, 3, 5, 7].map(i => ({ name: names[i], atM: 800000 * i / 7 })));
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
  it('draws one picture for progress its link rounds together', async () => {
    mockFetch.mockImplementation(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
    await renderRouteMap({ polyline, progress: 0.4, size: 'card' });
    await renderRouteMap({ polyline, progress: 0.4002, size: 'card' });
    const [first, second] = mockFetch.mock.calls.map(([url]) => String(url));
    expect(second).toBe(first);
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
