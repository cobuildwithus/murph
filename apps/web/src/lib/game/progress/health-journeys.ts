import "server-only";
import type { ClientUnits } from "../../companion/client-info";
import { BANK } from "./bank";
import { roundTotals, ladderRungs } from "./achievements";
import { achievementContext, measureView } from "./view";
import { cumulativePoints, type MeasureSeries } from "./series";
import type { MeasureState, BeforeProgressMutation } from "./state";
import { firstRouteId, routePlaces, routeLegs, setFirstRoute } from "./routes";
import { resolveRoute } from "./mapbox";
import { healthSums } from "./health";
import type { HealthMetricInput } from "./health-view";
import type { StoredAward } from "./awards";
import { formatNumber } from "./format";

export function healthJourneyMeasure(id: "steps" | "sleep", amounts: MeasureSeries["amounts"], awards: readonly StoredAward[]): MeasureSeries | null {
  if (amounts.length === 0 && !awards.some(award => award.measureId === id && ["total", "time", "route"].includes(award.kind))) return null;
  return { id, name: id, label: id === "steps" ? "Steps" : "Sleep", noun: id === "steps" ? "steps" : "slept",
    icon: id, unit: id === "steps" ? "steps" : "seconds", ftPerRep: 1, pending: false, gameOn: false, needsPerDay: false, amounts };
}

/** The shared ladder and route owners consume the same retained health amounts. */
export async function healthJourneys(input: {
  memberId: string; metrics: HealthMetricInput[]; states: Map<string, MeasureState>; awards: readonly StoredAward[];
  joinedOn: string; today: string; timeZone: string; beforeMutationTx: BeforeProgressMutation;
}) {
  const measures: MeasureSeries[] = input.metrics.flatMap(metric => {
    if (metric.id !== "steps" && metric.id !== "sleep") return [];
    const amounts = healthSums(metric.id, metric.daily, input.joinedOn, input.today);
    return healthJourneyMeasure(metric.id, amounts, input.awards) ?? [];
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
  return journeys.measures.map(measure => healthJourneyView(measure, journeys.states.get(measure.id) ?? {}, awards, today, units));
}

export function healthJourneyView(measure: MeasureSeries, state: MeasureState, awards: StoredAward[], today: string, units: ClientUnits) {
  const view = measureView(measure, state, awards, today, units);
  if (view.route && measure.id === "steps") {
    view.route.walkedText = `about ${view.route.walkedText}`;
    view.route.totalText = `about ${view.route.totalText}`;
  }
  return { ...view, source: "wearable" as const,
    total: measure.id === "sleep" && view.total.value >= 86400
      ? { ...view.total, text: `${formatNumber(view.total.value / 86400, "full", 1)} days` }
      : view.total };
}
