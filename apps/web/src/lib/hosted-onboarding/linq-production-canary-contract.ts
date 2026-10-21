export type LinqProductionCanaryOutcome = {
  ready: boolean;
  totalGoalCount: number;
  /** Active Goals, independent of the title chosen during the conversation. */
  matchingGoalCount: number;
  /** Distinct matching IDs with canonical bank/goal provenance and valid goal IDs. */
  matchingGoalIdCount: number;
  /** Bounded recent server evidence, never an exact failed-turn correlation. */
  diagnostics?: LinqProductionCanaryDiagnostics;
};

export const LINQ_PRODUCTION_CANARY_DIAGNOSTIC_WINDOW_MS = 10 * 60_000;
export const LINQ_PRODUCTION_CANARY_DIAGNOSTIC_STALE_MS = 2 * 60_000;
export const LINQ_PRODUCTION_CANARY_DIAGNOSTIC_TRACE_LIMIT = 3;

export type LinqProductionCanaryDiagnostics = {
  status: "empty" | "observed" | "ambiguous" | "unavailable";
  failedTurnMatched: false;
  truncated: boolean;
  traces: LinqProductionCanaryLatencyTrace[];
};

export type LinqProductionCanaryLatencyTrace = {
  /** Furthest observed boundary, not a claim about the cause of a failed turn. */
  stage: "instant_reply" | "pre_runtime" | "runtime_provider" | "delivery_observation";
  stale: boolean;
  incomplete: boolean;
  /** Ages are relative to the server sample; absent durations are unknown. */
  ageMs?: number;
  ingressMs?: number;
  preRuntimeMs?: number;
  runtimeToProviderMs?: number;
  /** Includes runtime/reply preparation; this is not pure upstream model time. */
  providerToDeliveryMs?: number;
  acceptedToDeliveryAttemptMs?: number;
  deliveryAcceptMs?: number;
  deliveryReceiptMs?: number;
  deliveredAgeMs?: number;
};
