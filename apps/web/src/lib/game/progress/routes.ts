import 'server-only';
import type { ClientUnits } from '../../companion/client-info';
import type { Day, Goals, Rung } from './contract';
import type { StoredAward } from './awards';
import { patchMeasureState, type BeforeProgressMutation } from './state';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { resolveRoute } from './mapbox';
import { replaceRouteLeg, routeMeters, routeTowns } from './route-progress';
import { formatAmount } from './format';
import routesByTimeZone from './bank/routes-tz.json';
import { BANK, search, type BankEntry } from './bank';
import type { RouteLeg } from './state';

export { routeLegs, routeView } from './route-progress';

/** The reader resolves firstRouteId through the checked bank and calls this only when legs are absent. */
export async function setFirstRoute(memberId: string, measureId: string, route: Omit<RouteLeg, 'startTotal'>, beforeMutationTx: BeforeProgressMutation) {
  return patchMeasureState(memberId, measureId, previous => ({
    legs: previous.legs ?? [{ ...route, startTotal: 0 }],
  }), beforeMutationTx);
}

/** Long bank entries require two named places; numeric and planetary goals are excluded. */
export async function readRouteGoals(query: string | undefined, unit: 'meters' | 'steps', total: number, units: ClientUnits): Promise<Goals> {
  const eligible = (entry: BankEntry) => entry.kind === 'route' && routePlaces(entry.name) !== null;
  const tile = (entry: BankEntry): Rung => ({ id: entry.id, name: entry.name, short: entry.short, tagline: entry.tagline, shareAwardId: null, drawing: null, at: unit === 'steps' ? entry.at / 1609.344 * 2000 : entry.at,
    atText: formatAmount(entry.at, 'meters', 'full', units).text, blurb: units === 'metric' ? entry.blurbMetric ?? entry.blurb : entry.blurb, where: entry.where, on: null, toGo: null });
  const tiles = BANK.filter(eligible).slice(0, 6).map(tile);
  if (!query) return { tiles, match: null, suggestions: [], note: null, route: null };
  const places = routePlaces(query);
  if (places) return { tiles, match: null, suggestions: [], note: null,
    route: await routeGoalPreview(places.from, places.to, routeMeters(unit, total), units) };
  return { tiles, match: null, suggestions: search(query).filter(eligible).slice(0, 4).map(tile), note: null, route: null };
}

/** BE1/BE2 supply their complete canonical series and live mutation authority. */
export async function setRouteGoal(memberId: string, measureId: string, from: string, to: string, context: {
  points: readonly [Day, number][];
  awards: readonly StoredAward[];
  incomplete: boolean;
  beforeMutationTx: BeforeProgressMutation;
}) {
  if (context.incomplete) throw hostedOnboardingError({ code: 'PROGRESS_INCOMPLETE', httpStatus: 503,
    retryable: true, message: 'Progress could not load completely. Try again.' });
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
