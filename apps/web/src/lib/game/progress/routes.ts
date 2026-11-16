import 'server-only';
import type { Day, Goals } from './contract';
import type { StoredAward } from './awards';
import { patchMeasureState, type BeforeProgressMutation } from './state';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { resolveRoute } from './mapbox';
import { MAP_HEIGHT, MAP_WIDTH, milesText, replaceRouteLeg, routeMeters } from './route-progress';
import routesByTimeZone from './bank/routes-tz.json';

export { routeLegs, routeView } from './route-progress';

/** The reader resolves firstRouteId through the checked bank and calls this only when legs are absent. */
export async function setFirstRoute(memberId: string, measureId: string, from: string, to: string, beforeMutationTx: BeforeProgressMutation) {
  const route = await resolveRoute(from, to);
  return patchMeasureState(memberId, measureId, previous => ({
    legs: previous.legs ?? [{ ...route, startTotal: 0 }],
  }), beforeMutationTx);
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
  return patchMeasureState(memberId, measureId, previous => ({ goal: { from, to },
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

export async function routeGoalPreview(from: string, to: string): Promise<NonNullable<Goals['route']>> {
  const route = await resolveRoute(from, to);
  return { from, to, distanceText: milesText(route.distanceM), straightLine: route.straightLine,
    map: `/api/game/v1/progress/map?${new URLSearchParams({ from, to, w: String(MAP_WIDTH), h: String(MAP_HEIGHT) })}` };
}
