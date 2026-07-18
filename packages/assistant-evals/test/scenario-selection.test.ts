import { describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  defineEvalScenario,
  normalizeEvalScenarios,
  selectEvalScenarios,
} from "../src/index.js";

function createScenario(input: {
  id: string;
  suites: readonly string[];
  tags: readonly string[];
  risk?: "critical" | "high" | "quality";
}) {
  return defineEvalScenario({
    schema: EVAL_SCENARIO_SCHEMA,
    id: input.id,
    version: 1,
    title: input.id,
    description: `Scenario ${input.id}.`,
    risk: input.risk ?? "critical",
    suites: input.suites,
    tags: input.tags,
    input: {
      message: input.id,
    },
  });
}

describe("eval scenario selection", () => {
  it("normalizes scenarios in stable id order and composes filters", () => {
    const scenarios = normalizeEvalScenarios([
      createScenario({
        id: "onboarding.resume",
        suites: ["onboarding-full"],
        tags: ["resume"],
        risk: "quality",
      }),
      createScenario({
        id: "onboarding.welcome",
        suites: ["onboarding-smoke", "onboarding-full"],
        tags: ["entry", "welcome"],
      }),
      createScenario({
        id: "onboarding.consent",
        suites: ["onboarding-smoke"],
        tags: ["consent", "entry"],
      }),
    ]);

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "onboarding.consent",
      "onboarding.resume",
      "onboarding.welcome",
    ]);
    expect(
      selectEvalScenarios(scenarios, { suites: ["onboarding-smoke"] }).map(
        (scenario) => scenario.id,
      ),
    ).toEqual(["onboarding.consent", "onboarding.welcome"]);
    expect(
      selectEvalScenarios(scenarios, { tags: ["entry", "welcome"] }).map(
        (scenario) => scenario.id,
      ),
    ).toEqual(["onboarding.welcome"]);
    expect(
      selectEvalScenarios(scenarios, { risks: ["critical"] }).map(
        (scenario) => scenario.id,
      ),
    ).toEqual([
      "onboarding.consent",
      "onboarding.welcome",
    ]);
    expect(
      selectEvalScenarios(
        scenarios,
        {
          scenarioIds: ["onboarding.resume", "onboarding.welcome"],
        },
      ).map((scenario) => scenario.id),
    ).toEqual(["onboarding.resume", "onboarding.welcome"]);
  });

  it("rejects duplicate and unknown scenario ids", () => {
    const scenario = createScenario({
      id: "onboarding.welcome",
      suites: ["onboarding-smoke"],
      tags: [],
    });

    expect(() => normalizeEvalScenarios([scenario, scenario])).toThrow(
      "duplicate scenario ids",
    );

    const scenarios = normalizeEvalScenarios([scenario]);
    expect(() =>
      selectEvalScenarios(scenarios, {
        scenarioIds: ["onboarding.missing"],
      }),
    ).toThrow("Unknown eval scenario id");
  });
});
