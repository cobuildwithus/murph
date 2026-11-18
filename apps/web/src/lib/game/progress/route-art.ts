import 'server-only';
import { after } from 'next/server';
import type { Route } from './contract';
import { reversePlace } from './mapbox';
import { artState, ensureArt, readArtRows, type ArtJob, type ArtState } from './place-art';
import { makePaintedMap, makePoster, mapKey, mapPaintable, posterKey } from './place-art-make';
import { cutPolyline, decodePolyline } from './route-geometry';
import { patchMeasureState, type BeforeProgressMutation, type MeasureState, type RouteLeg } from './state';

type Shown = { id: string; route: Route | null };

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
    for (const { route, leg } of items) {
      const poster = (index: number) => {
        const place = leg.towns[index]?.place;
        return place ? artState(rows.get(posterKey(place.id)), 'poster') : null;
      };
      route.towns = route.towns.map((town, index) => ({ ...town, poster: poster(index) }));
      route.drawerTowns = route.drawerTowns.map((town, index) => ({ ...town, poster: poster(index) }));
      if (mapPaintable(leg)) {
        route.mapArt = making(artState(rows.get(mapKey(leg.polyline, 'card')), 'map'));
        route.drawerMapArt = making(artState(rows.get(mapKey(leg.polyline, 'drawer')), 'map'));
      }
    }
  } catch { /* The page shows the plain map. */ }
}

/** A ready painting is already what the map path serves. */
const making = (state: ArtState) => state?.state === 'making' ? state : null;

/** The card map first, then the last place passed and the next, then the drawer map. */
function artJobs(route: Route, leg: RouteLeg): ArtJob[] {
  const passed = route.towns.filter(town => town.passedOn !== null).length - 1;
  const places = [passed, passed + 1].flatMap(index => leg.towns[index]?.place ? [leg.towns[index]!.place!] : []);
  const map = (size: 'card' | 'drawer'): ArtJob[] => mapPaintable(leg)
    ? [{ key: mapKey(leg.polyline, size), kind: 'map', make: signal => makePaintedMap(leg.polyline, size, signal) }] : [];
  return [...map('card'),
    ...places.map((place): ArtJob => ({ key: posterKey(place.id), kind: 'poster', make: signal => makePoster(place.label, signal) })),
    ...map('drawer')];
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
