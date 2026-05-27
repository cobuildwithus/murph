import type { GoalMetricTarget } from "@murphai/health-metrics";

export interface QueryProjectionStatus {
  dbPath: string;
  exists: boolean;
  schemaVersion: string | null;
  builtAt: string | null;
  entityCount: number;
  searchDocumentCount: number;
  fresh: boolean;
}

export interface RebuildQueryProjectionResult extends QueryProjectionStatus {
  rebuilt: true;
}

export interface QueryMetricPointFilters {
  biomarkerKey?: string;
  from?: string;
  limit?: number | null;
  metricKey?: string;
  to?: string;
}

export interface QueryMetricTarget {
  goalId: string;
  id: string;
  target: GoalMetricTarget;
}

export type QueryMetricTargetRow = QueryMetricTarget;
