import "server-only";
import { BANK } from "./bank";
import { roundTotals, ladderRungs } from "./achievements";
import { achievementContext, measureView } from "./view";
import { cumulativePoints, type MeasureSeries } from "./series";
import { patchMeasureState, type MeasureState, type BeforeProgressMutation } from "./state";
import { firstRouteId, routePlaces, routeLegs, routeView } from "./routes";
import { resolveRoute } from "./mapbox";
import { healthSums } from "./health";
import type { HealthMetricInput } from "./health-view";
import type { StoredAward } from "./awards";

/** The shared ladder and route owners consume the same retained health amounts. */
export async function healthJourneys(input: {
  memberId: string; metrics: HealthMetricInput[]; states: Map<string, MeasureState>; awards: readonly StoredAward[];
  joinedOn: string; today: string; timeZone: string; beforeMutationTx: BeforeProgressMutation;
}) {
  const measures: MeasureSeries[] = input.metrics.flatMap(metric => {
    if (metric.id !== "steps" && metric.id !== "sleep") return [];
    const amounts = healthSums(metric.id, metric.daily, input.joinedOn, input.today);
    if (amounts.length === 0 && !input.awards.some(award => award.measureId === metric.id
      && ["total", "time", "route"].includes(award.kind))) return [];
    return [{ id: metric.id, name: metric.id, label: metric.id === "steps" ? "Steps" : "Sleep",
      noun: metric.id === "steps" ? "steps" : "slept", icon: metric.id,
      unit: metric.id === "steps" ? "steps" : "seconds", ftPerRep: 1,
      pending: false, gameOn: false, needsPerDay: false, amounts }];
  });
  if (measures.some(measure => measure.id === "steps") && !input.states.get("steps")?.legs?.length) {
    const route = BANK.find(entry => entry.id === firstRouteId(input.timeZone))!;
    const places = routePlaces(route.name)!;
    const leg = await resolveRoute(places.from, places.to);
    const state = await patchMeasureState(input.memberId, "steps", previous => ({
      legs: previous.legs?.length ? previous.legs : [{ ...leg, startTotal: 0 }],
    }), input.beforeMutationTx);
    input.states.set("steps", state);
  }
  const context = achievementContext(measures, input.states, []);
  const candidates = [...roundTotals(context), ...ladderRungs(context),
    ...measures.flatMap(measure => routeLegs({ measureId: measure.id,
      legs: input.states.get(measure.id)?.legs ?? [], points: cumulativePoints(measure.amounts) }))];
  return { measures, states: input.states, candidates };
}

export function healthJourneyViews(journeys: Awaited<ReturnType<typeof healthJourneys>>, awards: StoredAward[], today: string) {
  return journeys.measures.map(measure => {
    const state = journeys.states.get(measure.id) ?? {};
    const view = measureView(measure, state, awards, today);
    const route = routeView(measure.id, state, view.points, awards);
    if (route && measure.id === "steps") route.walkedText = `about ${route.walkedText}`;
    return { ...view, source: "wearable" as const, route,
      total: measure.id === "sleep" && view.total.value >= 86400
        ? { ...view.total, text: `${(view.total.value / 86400).toLocaleString("en-US", { maximumFractionDigits: 1 })} days` }
        : view.total };
  });
}
