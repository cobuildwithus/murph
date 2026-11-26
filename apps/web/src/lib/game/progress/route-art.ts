import 'server-only';
import { after } from 'next/server';
import type { Route } from './contract';
import { reversePlace } from './mapbox';
import { artState, ensureArt, readArtRows, type ArtJob, type ArtState } from './place-art';
import { makePaintedMap, makePoster, mapKey, mapPaintable, posterKey } from './place-art-make';
import { cutPolyline, decodePolyline } from './route-geometry';
import { routeMapLink } from './route-progress';
import { patchMeasureState, readMeasureStates, type BeforeProgressMutation, type MeasureState, type RouteLeg } from './state';

type Shown = { id: string; route: Route | null };

/** A shared card freezes the immutable painting. The live map link follows the requesting member's route. */
export async function readPaintedRouteArt(memberId: string, measures: readonly string[], signal: AbortSignal) {
  const states = await readMeasureStates(memberId, measures, signal);
  const keys = measures.flatMap(id => {
    const leg = states.get(id)?.legs?.at(-1);
    return leg && mapPaintable(leg) ? [mapKey(leg.polyline, 'card')] : [];
  });
  const rows = await readArtRows(keys);
  for (const key of keys) {
    const art = artState(rows.get(key), 'map');
    if (art?.state === 'ready') return art.path;
  }
  return null;
}

function current(measures: readonly Shown[], states: ReadonlyMap<string, MeasureState>) {
  return measures.flatMap(measure => {
    const leg = measure.route && states.get(measure.id)?.legs?.at(-1);
    return measure.route && leg && leg.towns.length === measure.route.towns.length ? [{ id: measure.id, route: measure.route, leg }] : [];
  });
}

/**
 * Fills each shown route's poster and painted-map states from the shared art
 * rows. With `ensure` (the Steps read), it also starts the art the member is
 * about to see: the painted maps and the posters of the last place passed and
 * the next one. Art is optional: any failure leaves the plain map and no poster.
 */
export async function attachRouteArt(measures: readonly Shown[], states: ReadonlyMap<string, MeasureState>,
  ensure?: { memberId: string; beforeMutationTx: BeforeProgressMutation }) {
  const items = current(measures, states);
  if (!items.length) return;
  const keys = items.flatMap(({ leg }) => [
    ...leg.towns.flatMap(town => town.place ? [posterKey(town.place.id)] : []),
    ...(mapPaintable(leg) ? [mapKey(leg.polyline, 'card'), mapKey(leg.polyline, 'drawer')] : []),
  ]);
  try {
    let rows = await readArtRows(keys);
    if (ensure) {
      const jobs = items.flatMap(({ id, route, leg }) => {
        if (id === 'steps' && leg.towns.some(town => town.place === undefined)) schedulePlaces(ensure.memberId, leg, ensure.beforeMutationTx);
        return artJobs(route, leg);
      });
      rows = new Map([...rows, ...await ensureArt(jobs, rows)]);
    }
    for (const { id, route, leg } of items) {
      const poster = (index: number) => {
        const place = leg.towns[index]?.place;
        return place ? artState(rows.get(posterKey(place.id)), 'poster') : null;
      };
      route.towns = route.towns.map((town, index) => ({ ...town, poster: poster(index) }));
      route.drawerTowns = route.drawerTowns.map((town, index) => ({ ...town, poster: poster(index) }));
      if (mapPaintable(leg)) {
        route.mapArt = mapState(artState(rows.get(mapKey(leg.polyline, 'card')), 'map'));
        route.drawerMapArt = mapState(artState(rows.get(mapKey(leg.polyline, 'drawer')), 'map'));
        // A painting that came in is a new picture at the same path: a new link, so the app fetches it.
        const painted = (['card', 'drawer'] as const).filter(size => (size === 'card' ? route.mapArt : route.drawerMapArt)?.state === 'ready');
        if (painted.length) route.map = routeMapLink(id, leg.polyline, route.progress, painted);
      }
    }
  } catch { /* The page shows the plain map. */ }
}

/** A ready painting is what the map path serves; the app only needs to know it is one. */
const mapState = (state: ArtState) => state?.state === 'ready' ? { state: 'ready' as const } : state;

/** The card map, the last place passed and the next, the drawer map, then the earlier places passed, newest first. */
function artJobs(route: Route, leg: RouteLeg): ArtJob[] {
  const passed = route.towns.filter(town => town.passedOn !== null).length - 1;
  const place = (index: number) => leg.towns[index]?.place ? [leg.towns[index]!.place!] : [];
  const earlier = Array.from({ length: Math.max(0, passed) }, (_, i) => passed - 1 - i).flatMap(place);
  const map = (size: 'card' | 'drawer'): ArtJob[] => mapPaintable(leg)
    ? [{ key: mapKey(leg.polyline, size), kind: 'map', make: signal => makePaintedMap(leg.polyline, size, signal) }] : [];
  const posters = (places: { id: string; label: string }[]) =>
    places.map((place): ArtJob => ({ key: posterKey(place.id), kind: 'poster', make: signal => makePoster(place.label, signal) }));
  return [...map('card'), ...posters([...place(passed), ...place(passed + 1)]), ...map('drawer'), ...posters(earlier)];
}

/** Legs from before posters learn their towns' public places once, after the response. */
function schedulePlaces(memberId: string, leg: RouteLeg, beforeMutationTx: BeforeProgressMutation) {
  after(async () => {
    try {
    const points = decodePolyline(leg.polyline);
    const places = await Promise.all(leg.towns.map(async town => town.place !== undefined ? town
      : { ...town, place: (await reversePlace(cutPolyline(points, town.atM / leg.distanceM).walked.at(-1)!))?.place ?? null }));
    await patchMeasureState(memberId, 'steps', previous => {
      const legs = previous.legs ?? [];
      const last = legs.at(-1);
      // A route changed meanwhile keeps its own towns.
      if (!last || last.polyline !== leg.polyline) return {};
      return { legs: [...legs.slice(0, -1), { ...last, towns: places }] };
    }, beforeMutationTx);
    } catch { /* The next Steps read tries again. */ }
  });
}
