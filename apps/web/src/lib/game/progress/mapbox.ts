import 'server-only';
import * as z from '@murphai/contracts/zod-runtime';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { cutPolyline, decodePolyline, distanceM, encodePolyline, greatCircle, MAP_SIZES, routeBbox, type Coordinate } from './route-geometry';
import type { MapQuery } from './contract';

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const geocoding = z.object({ features: z.array(z.object({ geometry: z.object({ coordinates: coordinate }), properties: z.object({ name: z.string() }) })) });
const directions = z.discriminatedUnion('code', [
  z.object({ code: z.literal('NoRoute') }),
  z.object({ code: z.literal('Ok'), routes: z.array(z.object({ distance: z.number().positive(), geometry: z.string().min(2) })).min(1) }),
]);
const timeoutMs = 10_000;

function unavailable() {
  return hostedOnboardingError({ code: 'PROGRESS_MAP_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'The map could not load. Try again.' });
}

/** URLs and provider errors remain inside this boundary, including the token. */
async function mapboxRequest(path: string, query: Record<string, string>): Promise<Response> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw unavailable();
  const url = new URL(`https://api.mapbox.com${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  url.searchParams.set('access_token', token);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    return response;
  } catch { throw unavailable(); }
}

async function mapboxJson<T>(path: string, query: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const response = await mapboxRequest(path, query);
  try { return schema.parse(await response.json()); }
  catch { throw unavailable(); }
}

async function geocode(place: string): Promise<Coordinate> {
  const result = await mapboxJson('/search/geocode/v6/forward', { q: place, limit: '1', autocomplete: 'false', permanent: 'true' }, geocoding);
  const match = result.features[0];
  if (!match) throw hostedOnboardingError({ code: 'PROGRESS_PLACE_NOT_FOUND', httpStatus: 404, message: 'That place was not found. Try a nearby city.' });
  return match.geometry.coordinates;
}

/** Only an explicit NoRoute is a straight line. NoSegment, transport and shape failures are 503s. */
export async function resolveRoute(from: string, to: string) {
  const [start, end] = await Promise.all([geocode(from), geocode(to)]);
  const result = await mapboxJson(`/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}`,
    { geometries: 'polyline', overview: 'simplified', steps: 'false' }, directions);
  const straightLine = result.code === 'NoRoute';
  const meters = result.code === 'NoRoute' ? distanceM(start, end) : result.routes[0]!.distance;
  const polyline = result.code === 'NoRoute' ? encodePolyline(greatCircle(start, end)) : result.routes[0]!.geometry;
  const points = decodePolyline(polyline);
  const towns: { name: string; atM: number }[] = [];
  // Sequential requests keep the whole resolve to at most two concurrent provider calls.
  for (let i = 0; !straightLine && i < 8; i++) {
    const at = cutPolyline(points, i / 7).walked.at(-1)!;
    const response = await mapboxJson('/search/geocode/v6/reverse', {
      longitude: String(at[0]), latitude: String(at[1]), types: 'place', limit: '1', permanent: 'true',
    }, geocoding);
    const town = response.features[0];
    if (town && !towns.some(existing => existing.name === town.properties.name)) towns.push({ name: town.properties.name, atM: meters * i / 7 });
  }
  return { from, to, distanceM: meters, polyline, towns, straightLine };
}

export async function renderRouteMap(input: { polyline: string; progress: number; size: MapQuery['size']; style: string }): Promise<Response> {
  const { width, height } = MAP_SIZES[input.size];
  const points = decodePolyline(input.polyline), bbox = routeBbox(points, width, height);
  const cut = cutPolyline(points, input.progress);
  const path = (color: string, coordinates: Coordinate[]) => `path-4+${color}-1(${encodeURIComponent(encodePolyline(coordinates.length === 1 ? [coordinates[0]!, coordinates[0]!] : coordinates))})`;
  const overlays = [path('CDBEA7', cut.remaining), path('5A6E32', cut.walked)].join(',');
  const response = await mapboxRequest(`/styles/v1/${input.style}/static/${overlays}/[${bbox.join(',')}]/${width}x${height}.png`, { padding: '0' });
  return new Response(response.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
