import { GOAL_ILLUSTRATION_ROUTE_IDS } from "./goal-illustrations.generated";

export function resolveGoalIllustrationSrc(routeId: string): string | null {
  return GOAL_ILLUSTRATION_ROUTE_IDS.has(routeId)
    ? `/design-assets/goals/${routeId}.svg`
    : null;
}
