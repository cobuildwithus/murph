import {
  assertJsonValue,
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from "./json.js";
import {
  assertEvalIdentifier,
  assertNonEmptyString,
} from "./identifiers.js";
import type { EvalScenario } from "./scenario.js";

export interface EvalTargetContext<TInput extends JsonValue = JsonValue> {
  readonly runId: string;
  readonly caseId: string;
  readonly scenario: EvalScenario<TInput>;
  readonly trial: number;
  readonly signal: AbortSignal;
}

export interface EvalTargetExecution<
  TObservation extends JsonValue = JsonValue,
> {
  readonly observation: TObservation;
  readonly metrics?: Readonly<Record<string, number>>;
}

export interface EvalTarget<
  TInput extends JsonValue = JsonValue,
  TObservation extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly description: string;
  /**
   * Execute one isolated case. Implementations must honor `context.signal` and
   * settle only after case-owned resources have been released.
   */
  execute(
    context: EvalTargetContext<TInput>,
  ): Promise<EvalTargetExecution<TObservation>>;
}

export function defineEvalTarget<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  target: EvalTarget<TInput, TObservation>,
): EvalTarget<TInput, TObservation> {
  assertEvalIdentifier(target.id, "target.id");
  assertNonEmptyString(target.description, "target.description");

  if (typeof target.execute !== "function") {
    throw new TypeError("target.execute must be a function.");
  }

  return Object.freeze({
    id: target.id,
    description: target.description.trim(),
    execute: target.execute,
  });
}

export function normalizeEvalTargetExecution<
  TObservation extends JsonValue,
>(
  execution: EvalTargetExecution<TObservation>,
): EvalTargetExecution<TObservation> {
  assertJsonValue(execution.observation, "target observation");

  const observation = freezeJsonValue(
    cloneJsonValue(execution.observation, "target observation"),
  );
  const metrics = normalizeMetrics(execution.metrics);

  return Object.freeze({
    observation,
    ...(metrics ? { metrics } : {}),
  });
}

function normalizeMetrics(
  metrics: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  if (!metrics) {
    return undefined;
  }

  const normalized: Record<string, number> = {};
  for (const [name, value] of Object.entries(metrics)) {
    assertEvalIdentifier(name, `metric ${name}`);
    if (!Number.isFinite(value)) {
      throw new TypeError(`Metric ${name} must be finite.`);
    }
    normalized[name] = value;
  }

  return Object.freeze(normalized);
}
