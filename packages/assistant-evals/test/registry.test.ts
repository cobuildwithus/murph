import { describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  createEvalScenarioRegistry,
  defineEvalScenario,
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

describe("eval scenario registry", () => {
  it("stores many scenarios in stable id order and composes filters", () => {
    const registry = createEvalScenarioRegistry([
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

    expect(registry.scenarios.map((scenario) => scenario.id)).toEqual([
      "onboarding.consent",
      "onboarding.resume",
      "onboarding.welcome",
    ]);
    expect(
      registry
        .select({ suites: ["onboarding-smoke"] })
        .map((scenario) => scenario.id),
    ).toEqual(["onboarding.consent", "onboarding.welcome"]);
    expect(
      registry
        .select({ tags: ["entry", "welcome"] })
        .map((scenario) => scenario.id),
    ).toEqual(["onboarding.welcome"]);
    expect(
      registry
        .select({ risks: ["critical"] })
        .map((scenario) => scenario.id),
    ).toEqual([
      "onboarding.consent",
      "onboarding.welcome",
    ]);
    expect(
      registry
        .select({
          scenarioIds: ["onboarding.resume", "onboarding.welcome"],
        })
        .map((scenario) => scenario.id),
    ).toEqual(["onboarding.resume", "onboarding.welcome"]);
  });

  it("rejects duplicate and unknown scenario ids", () => {
    const scenario = createScenario({
      id: "onboarding.welcome",
      suites: ["onboarding-smoke"],
      tags: [],
    });

    expect(() => createEvalScenarioRegistry([scenario, scenario])).toThrow(
      "Duplicate eval scenario id",
    );

    const registry = createEvalScenarioRegistry([scenario]);
    expect(() =>
      registry.select({ scenarioIds: ["onboarding.missing"] }),
    ).toThrow("Unknown eval scenario id");
  });
});
