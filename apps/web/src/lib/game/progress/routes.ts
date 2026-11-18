import 'server-only';
import type { ClientUnits } from '../../companion/client-info';
import type { Day, Goals, MeasureGoal, Rung } from './contract';
import type { StoredAward } from './awards';
import { patchMeasureState, type BeforeProgressMutation } from './state';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { invalidGameRequest } from '../http/errors';
import { resolveRoute } from './mapbox';
import { replaceRouteLeg, routeMeters, routeTowns } from './route-progress';
import { formatAmount } from './format';
import routesByTimeZone from './bank/routes-tz.json';
import routesByRegion from './bank/routes-region.json';
import { gameAreaCode } from '../area-code';
import type { HostedMemberIdentityState } from '../../hosted-onboarding/hosted-member-identity-store';
import { BANK, search, type BankEntry } from './bank';
import type { RouteLeg } from './state';

export { routeLegs, routeView } from './route-progress';

/** The reader picks the first route and calls this only when legs are absent. */
export async function setFirstRoute(memberId: string, measureId: string, route: Omit<RouteLeg, 'startTotal'>, beforeMutationTx: BeforeProgressMutation) {
  return patchMeasureState(memberId, measureId, previous => ({
    legs: previous.legs ?? [{ ...route, startTotal: 0 }],
  }), beforeMutationTx);
}

function bankPlaces(entry: BankEntry) {
  return entry.loop ? { from: entry.loop.start, to: entry.loop.start } : routePlaces(entry.name);
}

/** Only bank entries with routable places appear in the picker. */
export async function readRouteGoals(query: string | undefined, unit: 'meters' | 'steps', total: number, units: ClientUnits): Promise<Goals> {
  const eligible = (entry: BankEntry) => entry.kind === 'route' && bankPlaces(entry) !== null;
  const tile = (entry: BankEntry): Rung => ({ id: entry.id, name: entry.name, short: entry.short, tagline: entry.tagline, shareAwardId: null, drawing: null, at: unit === 'steps' ? entry.at / 1609.344 * 2000 : entry.at,
    atText: formatAmount(entry.at, 'meters', 'full', units).text, blurb: units === 'metric' ? entry.blurbMetric ?? entry.blurb : entry.blurb, where: entry.where, on: null, toGo: null });
  const tiles = BANK.filter(eligible).slice(0, 6).map(tile);
  if (!query) return { tiles, match: null, suggestions: unit === 'steps' ? tiles : [], note: null, route: null };
  const matches = search(query).filter(eligible);
  const exact = matches.find(entry => entry.name.toLowerCase() === query.toLowerCase());
  const places = exact ? bankPlaces(exact) : routePlaces(query);
  if (places) return { tiles, match: null, suggestions: [], note: null,
    route: await routeGoalPreview(places.from, places.to, routeMeters(unit, total), units) };
  return { tiles, match: null, suggestions: matches.slice(0, 4).map(tile), note: null, route: null };
}

export function routeProgressIncomplete() {
  return hostedOnboardingError({ code: 'PROGRESS_INCOMPLETE', httpStatus: 503,
    retryable: true, message: 'Progress could not load completely. Try again.' });
}

/** BE1/BE2 supply their complete canonical series and live mutation authority. */
export async function setRouteGoal(memberId: string, measureId: string, goal: MeasureGoal, context: {
  points: readonly [Day, number][];
  awards: readonly StoredAward[];
  incomplete: boolean;
  beforeMutationTx: BeforeProgressMutation;
}) {
  if (context.incomplete) throw routeProgressIncomplete();
  const entry = 'rungId' in goal ? BANK.find(entry => entry.kind === 'route' && entry.id === goal.rungId) : null;
  const places = 'from' in goal ? goal : entry && bankPlaces(entry);
  if (!places) throw invalidGameRequest('Choose a route with two places.');
  const { from, to } = places;
  const next = await resolveRoute(from, to);
  const total = routeMeters(measureId, context.points.at(-1)?.[1] ?? 0);
  const earned = new Set(context.awards.map(award => award.key));
  return patchMeasureState(memberId, measureId, previous => ({ goal: { route: { from, to } },
    legs: replaceRouteLeg(measureId, previous.legs ?? [], next, total, earned) }), context.beforeMutationTx);
}

/** The curated table names checked bank routes, with no city or GPS lookup. */
export function firstRouteId(timeZone: string): string {
  return (routesByTimeZone as Record<string, string>)[timeZone] ?? routesByTimeZone.default;
}

type RegionRoute = { from: string; to: string; km: number };
const REGIONS: Record<string, readonly RegionRoute[]> = routesByRegion.regions;
const AREA_CODES: Record<string, string> = routesByRegion.areaCodes;
const COUNTRIES: Record<string, string> = routesByRegion.countries;
const FIRST_ROUTE_DAYS = 84;
const DEFAULT_MILES_PER_DAY = 3;

/** The verified number's NANP area code or calling code picks a region; the number goes no further. */
export function phoneRouteRegion(identity: Pick<HostedMemberIdentityState, 'phoneNumber' | 'phoneNumberVerifiedAt'> | null): string | null {
  if (!identity?.phoneNumberVerifiedAt) return null;
  const areaCode = gameAreaCode(identity);
  if (areaCode) return AREA_CODES[areaCode] ?? null;
  const digits = /^\+([2-9]\d{3,14})$/u.exec(identity.phoneNumber ?? '')?.[1];
  const code = digits && [3, 2, 1].map(length => digits.slice(0, length)).find(prefix => COUNTRIES[prefix]);
  return code ? COUNTRIES[code]! : null;
}

/** A regional route you'd finish in about 12 weeks at your pace, else the time-zone pick. */
export function firstRoutePlaces(timeZone: string, region: string | null, milesPerDay: number | null): { from: string; to: string } {
  const candidates = region ? REGIONS[region] : undefined;
  if (!candidates?.length) return routePlaces(BANK.find(entry => entry.kind === 'route' && entry.id === firstRouteId(timeZone))!.name)!;
  const pace = milesPerDay && milesPerDay > 0 ? milesPerDay : DEFAULT_MILES_PER_DAY;
  const miss = (route: RegionRoute) => Math.abs(route.km / 1.609344 / pace - FIRST_ROUTE_DAYS);
  const pick = candidates.reduce((best, route) => miss(route) < miss(best) ? route : best);
  return { from: pick.from, to: pick.to };
}

/** The same two endpoints drive typed and checked-bank route goals. */
export function routePlaces(name: string): { from: string; to: string } | null {
  const parts = name.split(' to ');
  return parts.length === 2 && parts.every(part => part.trim().length > 0) ? { from: parts[0]!.trim(), to: parts[1]!.trim() } : null;
}

export async function routeGoalPreview(from: string, to: string, totalM: number, units: ClientUnits): Promise<NonNullable<Goals['route']>> {
  const route = await resolveRoute(from, to);
  const current = formatAmount(totalM, 'meters', 'compact', units).text.split(' ')[0];
  const remaining = formatAmount(Math.max(0, route.distanceM - totalM), 'meters', 'compact', units).text.split(' ')[0];
  const detail = route.straightLine ? 'As the crow flies. No road crosses the ocean, so Murph counts the straight line.'
    : `By road. You're ${current} in, so ${remaining} to go.`;
  return { from, to, distanceText: formatAmount(route.distanceM, 'meters', 'full', units).text.replace(' mi', ' miles'), detail,
    straightLine: route.straightLine, towns: routeTowns({ ...route, startTotal: 0 }, [], 'card', units),
    map: `/api/game/v1/progress/map?${new URLSearchParams({ from, to, size: 'card' })}` };
}
