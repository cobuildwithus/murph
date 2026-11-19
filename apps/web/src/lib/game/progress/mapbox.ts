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

/** A place Mapbox found: its public id, its name, and its qualified label ("Newark, Delaware, United States"). */
export interface FoundPlace { at: Coordinate; id: string | null; name: string; label: string }
type Feature = z.infer<typeof geocoding>['features'][number];
const foundPlace = ({ geometry, properties }: Feature): FoundPlace => ({ at: geometry.coordinates, id: properties.mapbox_id ?? null,
  name: properties.name, label: properties.place_formatted ? `${properties.name}, ${properties.place_formatted}` : properties.name });

/** Typed words nothing matched, in the goals preview: it names them instead of failing. */
export class PlaceNotFound extends Error {
  constructor(readonly typed: string) { super('Place not found.'); }
}
const placeNotFound = () => hostedOnboardingError({ code: 'PROGRESS_PLACE_NOT_FOUND', httpStatus: 404, message: 'That place was not found. Try a nearby city.' });

/** Picks the place typed words meant from Mapbox's close spellings, or none. Only the goals preview has one. */
export type PlaceFixer = (typed: string, candidates: readonly FoundPlace[]) => Promise<FoundPlace | null>;

async function lookUp(place: string): Promise<FoundPlace | null> {
  const result = await mapboxJson('/search/geocode/v6/forward', { q: place, limit: '1', autocomplete: 'false', permanent: 'true' }, geocoding);
  return result.features[0] ? foundPlace(result.features[0]) : null;
}

const samePlace = (a: FoundPlace, b: FoundPlace) => a.id && b.id ? a.id === b.id : distanceM(a.at, b.at) <= 2_000;

/**
 * The place typed words name. A miss with a fixer asks Mapbox for close spellings (not kept, so not permanent),
 * the fixer picks one, and the permanent lookup of its qualified label must find that same place.
 */
async function geocode(place: string, fix?: PlaceFixer): Promise<{ place: FoundPlace; fixed: boolean }> {
  const found = await lookUp(place);
  if (found) return { place: found, fixed: false };
  if (!fix) throw placeNotFound();
  const near = await mapboxJson('/search/geocode/v6/forward', { q: place, limit: '5', autocomplete: 'true' }, geocoding);
  // A fixer that fails is a miss: the slip is shown as not found, never as an outage.
  const pick = near.features.length ? await fix(place, near.features.map(foundPlace)).catch(() => null) : null;
  const kept = pick && await lookUp(pick.label);
  if (!pick || !kept || !samePlace(kept, pick)) throw new PlaceNotFound(place);
  return { place: kept, fixed: true };
}

/** What a leg calls a place: its short name when the words were its qualified label (a fixed place, saved), else the words. */
const legName = (words: string, place: FoundPlace) => words.toLowerCase() === place.label.toLowerCase() ? place.name : words;

/**
 * The road between two places, or the straight line over an ocean. Only an explicit NoRoute is a straight line;
 * NoSegment, transport and shape failures are 503s. `query` holds the words that find each place again (a fixed
 * place's qualified label), so a preview's map and its save look up the same places with no fixer.
 */
export async function resolveRouteGeometry(from: string, to: string, fix?: PlaceFixer) {
  // The picker returns a preview's endpoints on save. A checked loop has the same start and finish.
  const entry = from === to ? BANK.find(entry => entry.loop?.start === from) : undefined;
  const loop = entry?.loop;
  const origin = geocode(from, fix);
  const [start, end] = await Promise.all([origin, loop ? origin : geocode(to, fix)]);
  const query = { from: start.fixed ? start.place.label : from, to: end.fixed ? end.place.label : to };
  const fixed = start.fixed ? { typed: from, showing: start.place.name } : end.fixed ? { typed: to, showing: end.place.name } : null;
  const names = { entry, query, fixed, from: legName(query.from, start.place), to: legName(query.to, end.place) };
  const stops = [start.place.at, ...(loop?.via ?? []), end.place.at];
  const result = await mapboxJson(`/directions/v5/mapbox/driving/${stops.map(point => point.join(',')).join(';')}`,
    { geometries: 'polyline', overview: 'simplified', steps: 'false' }, directions);
  if (result.code === 'NoRoute') {
    if (loop) throw unavailable();
    return { ...names, distanceM: distanceM(start.place.at, end.place.at), polyline: encodePolyline(greatCircle(start.place.at, end.place.at)), straightLine: true };
  }
  const road = result.routes[0]!;
  return { ...names, distanceM: entry?.at ?? road.distance, polyline: road.geometry, straightLine: false };
}

/** The route and the towns along it, sampled at eighths of the road: what a leg keeps. */
export async function resolveRoute(from: string, to: string): Promise<Omit<RouteLeg, 'startTotal'>> {
  return (await previewRoute(from, to)).leg;
}

/** A route for the goals preview: its leg, the words that find its places again, and a fixed place's words. */
export async function previewRoute(from: string, to: string, fix?: PlaceFixer) {
  const { entry, query, fixed, ...geometry } = await resolveRouteGeometry(from, to, fix);
  const base = { ...(entry && { name: entry.name }), from: geometry.from, to: geometry.to, distanceM: geometry.distanceM,
    polyline: geometry.polyline, straightLine: geometry.straightLine };
  if (geometry.straightLine) return { leg: { ...base, towns: [] }, query, fixed };
  const meters = geometry.distanceM, polyline = geometry.polyline;
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
      // Two towns of one name are two towns; one place sampled twice is one.
      const same = (existing: RouteLeg['towns'][number]) => town && existing.place && town.place ? existing.place.id === town.place.id : existing.name === town?.name;
      if (town && !towns.some(same)) towns.push(town);
    }
  }
  return { leg: { ...base, towns }, query, fixed };
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
