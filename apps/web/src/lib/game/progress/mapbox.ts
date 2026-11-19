import 'server-only';
import * as z from '@murphai/contracts/zod-runtime';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { cutPolyline, decodePolyline, distanceM, encodePolyline, greatCircle, MAP_SIZES, routeBbox, type Coordinate } from './route-geometry';
import { BANK } from './bank';
import type { MapQuery } from './contract';
import type { RouteLeg } from './state';

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const geocoding = z.object({ features: z.array(z.object({ geometry: z.object({ coordinates: coordinate }),
  properties: z.object({ name: z.string(), mapbox_id: z.string().max(200).optional(), place_formatted: z.string().max(300).optional() }) })) });
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
  // The picker returns a preview's endpoints on save. A checked loop has the same start and finish.
  const entry = from === to ? BANK.find(entry => entry.loop?.start === from) : undefined;
  const loop = entry?.loop;
  const origin = geocode(from);
  const [start, end] = await Promise.all([origin, loop ? origin : geocode(to)]);
  const stops = [start, ...(loop?.via ?? []), end];
  const result = await mapboxJson(`/directions/v5/mapbox/driving/${stops.map(point => point.join(',')).join(';')}`,
    { geometries: 'polyline', overview: 'simplified', steps: 'false' }, directions);
  if (result.code === 'NoRoute') {
    if (loop) throw unavailable();
    return { from, to, distanceM: distanceM(start, end), polyline: encodePolyline(greatCircle(start, end)), towns: [], straightLine: true };
  }
  const road = result.routes[0]!;
  const meters = entry?.at ?? road.distance, polyline = road.geometry;
  const points = decodePolyline(polyline);
  const towns: RouteLeg['towns'] = [];
  const sampleTown = async (i: number) => {
    const town = await reversePlace(cutPolyline(points, i / 7).walked.at(-1)!);
    return town && { ...town, atM: meters * i / 7 };
  };
  for (let i = 0; i < 8; i += 2) {
    const pair = await Promise.allSettled([sampleTown(i), sampleTown(i + 1)]);
    for (const sample of pair) {
      if (sample.status === 'rejected') throw sample.reason;
      const town = sample.value;
      if (town && !towns.some(existing => existing.name === town.name)) towns.push(town);
    }
  }
  return { ...(entry && { name: entry.name }), from, to, distanceM: meters, polyline, towns, straightLine: false };
}

/** The town (Mapbox place) a point is in: the public identity a poster is keyed and prompted by. */
export async function reversePlace(at: Coordinate): Promise<{ name: string; place: { id: string; label: string } | null } | null> {
  const response = await mapboxJson('/search/geocode/v6/reverse', {
    longitude: String(at[0]), latitude: String(at[1]), types: 'place', limit: '1', permanent: 'true',
  }, geocoding);
  const town = response.features[0]?.properties;
  if (!town) return null;
  return { name: town.name, place: town.mapbox_id ? { id: town.mapbox_id,
    label: town.place_formatted ? `${town.name}, ${town.place_formatted}` : town.name } : null };
}

/** Plain satellite of exactly `bbox` at `width` x `height` pixels: no overlays, logo or attribution. */
export async function satelliteImage(bbox: readonly number[], width: number, height: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const response = await mapboxRequest(`/styles/v1/mapbox/satellite-v9/static/[${bbox.join(',')}]/${width / 2}x${height / 2}@2x`,
    { padding: '0', attribution: 'false', logo: 'false' });
  return Buffer.from(await response.arrayBuffer());
}

/** The style's source is `mapbox-style.json`, uploaded by hand to the Mapbox account named in `MAPBOX_STYLE_ID`. */
export async function renderRouteMap(input: { polyline: string; progress: number; size: MapQuery['size'] }): Promise<Response> {
  const style = process.env.MAPBOX_STYLE_ID;
  if (!style) throw unavailable();
  const { width, height } = MAP_SIZES[input.size];
  const points = decodePolyline(input.polyline), bbox = routeBbox(points, width, height);
  const cut = cutPolyline(points, input.progress);
  const path = (color: string, coordinates: Coordinate[]) => `path-4+${color}-1(${encodeURIComponent(encodePolyline(coordinates.length === 1 ? [coordinates[0]!, coordinates[0]!] : coordinates))})`;
  const overlays = [path('CDBEA7', cut.remaining), path('5A6E32', cut.walked)].join(',');
  const response = await mapboxRequest(`/styles/v1/${style}/static/${overlays}/[${bbox.join(',')}]/${width}x${height}.png`, { padding: '0' });
  return new Response(response.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
