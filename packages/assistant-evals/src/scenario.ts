import {
  cloneJsonValue,
  freezeJsonValue,
  type JsonValue,
} from "./json.js";
import {
  assertEvalIdentifier,
  assertNonEmptyString,
  assertPositiveInteger,
  normalizeIdentifierList,
} from "./identifiers.js";

export const EVAL_SCENARIO_SCHEMA = "murph.eval-scenario.v1" as const;

export type EvalScenarioRisk = "critical" | "high" | "quality";

export interface EvalScenario<TInput extends JsonValue = JsonValue> {
  readonly schema: typeof EVAL_SCENARIO_SCHEMA;
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly risk: EvalScenarioRisk;
  readonly suites: readonly string[];
  readonly tags: readonly string[];
  readonly timeoutMs?: number;
  readonly input: TInput;
}

export function defineEvalScenario<TInput extends JsonValue>(
  scenario: EvalScenario<TInput>,
): EvalScenario<TInput> {
  if (scenario.schema !== EVAL_SCENARIO_SCHEMA) {
    throw new TypeError(
      `scenario.schema must be ${JSON.stringify(EVAL_SCENARIO_SCHEMA)}.`,
    );
  }

  assertEvalIdentifier(scenario.id, "scenario.id");
  assertPositiveInteger(scenario.version, "scenario.version", 1_000_000);
  assertNonEmptyString(scenario.title, "scenario.title");
  assertNonEmptyString(scenario.description, "scenario.description");

  if (!isEvalScenarioRisk(scenario.risk)) {
    throw new TypeError(`Unsupported scenario risk: ${String(scenario.risk)}.`);
  }

  const suites = normalizeIdentifierList(scenario.suites, "scenario.suites");
  const tags = normalizeIdentifierList(scenario.tags, "scenario.tags", {
    allowEmpty: true,
  });

  if (scenario.timeoutMs !== undefined) {
    assertPositiveInteger(
      scenario.timeoutMs,
      "scenario.timeoutMs",
      60 * 60 * 1_000,
    );
  }

  const input = freezeJsonValue(
    cloneJsonValue(scenario.input, `scenario ${scenario.id} input`),
  );

  return Object.freeze({
    schema: EVAL_SCENARIO_SCHEMA,
    id: scenario.id,
    version: scenario.version,
    title: scenario.title.trim(),
    description: scenario.description.trim(),
    risk: scenario.risk,
    suites,
    tags,
    ...(scenario.timeoutMs === undefined
      ? {}
      : { timeoutMs: scenario.timeoutMs }),
    input,
  });
}

export function evalScenarioKey(
  scenario: Pick<EvalScenario, "id" | "version">,
): string {
  return `${scenario.id}@${scenario.version}`;
}

export function isEvalScenarioRisk(value: unknown): value is EvalScenarioRisk {
  return value === "critical" || value === "high" || value === "quality";
}
