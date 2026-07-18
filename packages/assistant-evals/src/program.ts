import {
  assertEvalIdentifier,
  assertNonEmptyString,
  compareEvalIdentifiers,
} from "./identifiers.js";
import type { JsonValue } from "./json.js";
import { normalizeEvalScenarios } from "./scenario-selection.js";
import type { EvalScenario } from "./scenario.js";
import { defineEvalTarget, type EvalTarget } from "./target.js";

export interface EvalProgram<
  TInput extends JsonValue = JsonValue,
  TObservation extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly description: string;
  readonly scenarios: readonly EvalScenario<TInput>[];
  readonly targets: readonly EvalTarget<TInput, TObservation>[];
}

export function defineEvalProgram<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  program: EvalProgram<TInput, TObservation>,
): EvalProgram<TInput, TObservation> {
  assertEvalIdentifier(program.id, "program.id");
  assertNonEmptyString(program.description, "program.description");

  if (program.targets.length === 0) {
    throw new TypeError("An eval program requires at least one target.");
  }

  const scenarios = normalizeEvalScenarios(program.scenarios);
  const sortedTargets = program.targets
    .map((target) => defineEvalTarget(target))
    .sort((left, right) => compareEvalIdentifiers(left.id, right.id));
  const targetIds = sortedTargets.map((target) => target.id);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new TypeError("An eval program must not contain duplicate target ids.");
  }

  return Object.freeze({
    id: program.id,
    description: program.description.trim(),
    scenarios,
    targets: Object.freeze(sortedTargets),
  });
}

export function isEvalProgram(value: unknown): value is EvalProgram {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.scenarios) &&
    Array.isArray(value.targets) &&
    value.scenarios.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
