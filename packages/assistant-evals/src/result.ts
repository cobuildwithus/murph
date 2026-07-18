import type { JsonValue } from "./json.js";
import type { EvalArtifactRef } from "./target.js";

export const EVAL_CASE_RESULT_SCHEMA = "murph.eval-case-result.v1" as const;
export const EVAL_RUN_RESULT_SCHEMA = "murph.eval-run-result.v1" as const;

export type EvalCaseStatus = "aborted" | "completed" | "failed" | "timed-out";

export interface EvalCaseError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

interface EvalCaseResultBase {
  readonly schema: typeof EVAL_CASE_RESULT_SCHEMA;
  readonly caseId: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly targetId: string;
  readonly trial: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: EvalCaseStatus;
}

export interface CompletedEvalCaseResult<
  TObservation extends JsonValue = JsonValue,
> extends EvalCaseResultBase {
  readonly status: "completed";
  readonly observation: TObservation;
  readonly metrics: Readonly<Record<string, number>>;
  readonly artifacts: readonly EvalArtifactRef[];
}

export interface IncompleteEvalCaseResult extends EvalCaseResultBase {
  readonly status: "aborted" | "failed" | "timed-out";
  readonly error: EvalCaseError;
}

export type EvalCaseResult<TObservation extends JsonValue = JsonValue> =
  | CompletedEvalCaseResult<TObservation>
  | IncompleteEvalCaseResult;

export interface EvalRunSelection {
  readonly scenarioIds: readonly string[];
  readonly suites: readonly string[];
  readonly tags: readonly string[];
  readonly targetIds: readonly string[];
  readonly risks: readonly string[];
  readonly trials: number;
  readonly concurrency: number;
  readonly defaultTimeoutMs: number;
}

export interface EvalRunSummary {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly aborted: number;
}

export interface EvalRunResult<TObservation extends JsonValue = JsonValue> {
  readonly schema: typeof EVAL_RUN_RESULT_SCHEMA;
  readonly runId: string;
  readonly programId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly selection: EvalRunSelection;
  readonly summary: EvalRunSummary;
  readonly cases: readonly EvalCaseResult<TObservation>[];
}
