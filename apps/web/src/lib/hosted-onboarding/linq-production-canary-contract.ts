/** Immutable synthetic outcome for the single server-configured canary identity. */
export const LINQ_PRODUCTION_CANARY_GOAL_TITLE = "Walk twenty minutes before lunch";

export type LinqProductionCanaryOutcome = {
  ready: boolean;
  totalGoalCount: number;
  matchingGoalCount: number;
  /** Distinct matching IDs with canonical bank/goal provenance and valid goal IDs. */
  matchingGoalIdCount: number;
};
