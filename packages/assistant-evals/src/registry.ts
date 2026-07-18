import {
  assertEvalIdentifier,
  compareEvalIdentifiers,
} from "./identifiers.js";
import type { JsonValue } from "./json.js";
import {
  defineEvalScenario,
  isEvalScenarioRisk,
  type EvalScenario,
  type EvalScenarioRisk,
} from "./scenario.js";

export interface EvalScenarioFilter {
  readonly scenarioIds?: readonly string[];
  readonly suites?: readonly string[];
  /** Every requested tag must be present on the scenario. */
  readonly tags?: readonly string[];
  readonly risks?: readonly EvalScenarioRisk[];
}

export interface EvalScenarioRegistry<TInput extends JsonValue = JsonValue> {
  readonly scenarios: readonly EvalScenario<TInput>[];
  get(id: string): EvalScenario<TInput> | undefined;
  require(id: string): EvalScenario<TInput>;
  select(filter?: EvalScenarioFilter): readonly EvalScenario<TInput>[];
}

export function createEvalScenarioRegistry<TInput extends JsonValue>(
  scenarios: readonly EvalScenario<TInput>[],
): EvalScenarioRegistry<TInput> {
  if (scenarios.length === 0) {
    throw new TypeError("An eval scenario registry requires at least one scenario.");
  }

  const sorted = scenarios
    .map((scenario) => defineEvalScenario(scenario))
    .sort((left, right) => compareEvalIdentifiers(left.id, right.id));
  const byId = new Map<string, EvalScenario<TInput>>();

  for (const scenario of sorted) {
    if (byId.has(scenario.id)) {
      throw new TypeError(`Duplicate eval scenario id: ${scenario.id}.`);
    }
    byId.set(scenario.id, scenario);
  }

  const frozenScenarios = Object.freeze(sorted);

  return Object.freeze({
    scenarios: frozenScenarios,
    get(id: string) {
      return byId.get(id);
    },
    require(id: string) {
      const scenario = byId.get(id);
      if (!scenario) {
        throw new Error(`Unknown eval scenario id: ${id}.`);
      }
      return scenario;
    },
    select(filter: EvalScenarioFilter = {}) {
      const requestedIds = normalizeFilterValues(
        filter.scenarioIds,
        "scenarioIds",
      );
      const requestedSuites = normalizeFilterValues(filter.suites, "suites");
      const requestedTags = normalizeFilterValues(filter.tags, "tags");
      const requestedRisks = normalizeRiskFilter(filter.risks);

      if (requestedIds.length > 0) {
        const unknownIds = requestedIds.filter((id) => !byId.has(id));
        if (unknownIds.length > 0) {
          throw new Error(
            `Unknown eval scenario id${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}.`,
          );
        }
      }

      const idSet = new Set(requestedIds);
      const riskSet = new Set(requestedRisks);
      return Object.freeze(
        frozenScenarios.filter((scenario) => {
          if (idSet.size > 0 && !idSet.has(scenario.id)) {
            return false;
          }

          if (
            requestedSuites.length > 0 &&
            !requestedSuites.some((suite) => scenario.suites.includes(suite))
          ) {
            return false;
          }

          if (riskSet.size > 0 && !riskSet.has(scenario.risk)) {
            return false;
          }

          return requestedTags.every((tag) => scenario.tags.includes(tag));
        }),
      );
    },
  });
}

function normalizeFilterValues(
  values: readonly string[] | undefined,
  label: string,
): readonly string[] {
  if (!values) {
    return [];
  }

  const normalized = values.map((value, index) => {
    assertEvalIdentifier(value, `${label}[${index}]`);
    return value;
  });

  return Object.freeze([...new Set(normalized)].sort(compareEvalIdentifiers));
}

function normalizeRiskFilter(
  values: readonly EvalScenarioRisk[] | undefined,
): readonly EvalScenarioRisk[] {
  if (!values) {
    return [];
  }

  const normalized = values.map((value, index) => {
    if (!isEvalScenarioRisk(value)) {
      throw new TypeError(`risks[${index}] is not a supported eval risk.`);
    }
    return value;
  });

  return Object.freeze([...new Set(normalized)].sort(compareEvalIdentifiers));
}
