export type LinqProductionCanaryOutcome = {
  ready: boolean;
  totalGoalCount: number;
  /** Active Goals, independent of the title chosen during the conversation. */
  matchingGoalCount: number;
  /** Distinct matching IDs with canonical bank/goal provenance and valid goal IDs. */
  matchingGoalIdCount: number;
};
