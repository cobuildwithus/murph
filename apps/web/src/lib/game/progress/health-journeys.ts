import "server-only";
import type { ClientUnits } from "../../companion/client-info";
import { BANK } from "./bank";
import { roundTotals, ladderRungs } from "./achievements";
import { achievementContext, measureView } from "./view";
import { cumulativePoints, type MeasureSeries } from "./series";
import type { MeasureState, BeforeProgressMutation } from "./state";
import { firstRouteId, routePlaces, routeLegs, routeView, setFirstRoute } from "./routes";
import { resolveRoute } from "./mapbox";
import { healthSums } from "./health";
import type { HealthMetricInput } from "./health-view";
import type { StoredAward } from "./awards";
import { formatNumber } from "./format";

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
    const state = await setFirstRoute(input.memberId, "steps", leg, input.beforeMutationTx);
    input.states.set("steps", state);
  }
  const context = achievementContext(measures, input.states);
  // Hours slept is no medal; sleep counts only on its journeys.
  const candidates = [...roundTotals(context).filter(candidate => candidate.measureId !== "sleep"), ...ladderRungs(context),
    ...measures.flatMap(measure => routeLegs({ measureId: measure.id,
      legs: input.states.get(measure.id)?.legs ?? [], points: cumulativePoints(measure.amounts) }))];
  return { measures, states: input.states, candidates };
}

export function healthJourneyViews(journeys: Awaited<ReturnType<typeof healthJourneys>>, awards: StoredAward[], today: string, units: ClientUnits) {
  return journeys.measures.map(measure => {
    const state = journeys.states.get(measure.id) ?? {};
    const view = measureView(measure, state, awards, today, units);
    const route = routeView(measure.id, state, view.points, awards, units);
    if (route && measure.id === "steps") route.walkedText = `about ${route.walkedText}`;
    return { ...view, source: "wearable" as const, route,
      total: measure.id === "sleep" && view.total.value >= 86400
        ? { ...view.total, text: `${formatNumber(view.total.value / 86400, "full", 1)} days` }
        : view.total };
  });
}
