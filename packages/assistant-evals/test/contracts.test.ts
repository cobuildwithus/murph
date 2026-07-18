import { describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  assertJsonValue,
  cloneJsonValue,
  createEvalScenarioRegistry,
  defineEvalProgram,
  defineEvalScenario,
  defineEvalTarget,
  evalScenarioKey,
  freezeJsonValue,
  isEvalProgram,
  normalizeEvalTargetExecution,
} from "../src/index.js";

describe("assistant eval contracts", () => {
  it("accepts JSON trees, shared references, cloning, and recursive freezing", () => {
    const shared = { value: 1 };
    const input = {
      first: shared,
      second: shared,
      list: [true, null, "value"],
    };

    expect(() => assertJsonValue(input, "input")).not.toThrow();
    const cloned = cloneJsonValue(input);
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(input);
    expect(cloned.first).not.toBe(shared);

    const frozen = freezeJsonValue(cloned);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.first)).toBe(true);
    expect(Object.isFrozen(frozen.list)).toBe(true);
  });

  it("rejects values outside the finite plain JSON boundary", () => {
    expect(() => assertJsonValue(Number.NaN)).toThrow("finite JSON numbers");
    expect(() => assertJsonValue(undefined)).toThrow("JSON-serializable");
    expect(() => assertJsonValue(new Date())).toThrow("plain JSON objects");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertJsonValue(circular)).toThrow("circular references");
  });

  it("normalizes immutable versioned scenarios without retaining mutable input", () => {
    const source = {
      message: "hello",
      nested: { value: 1 },
    };
    const scenario = defineEvalScenario({
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.welcome",
      version: 2,
      title: "  Welcome  ",
      description: "  Fresh onboarding welcome.  ",
      risk: "critical",
      suites: ["onboarding-smoke", "onboarding-full"],
      tags: ["entry"],
      timeoutMs: 1_000,
      input: source,
    });

    source.nested.value = 2;
    expect(scenario.title).toBe("Welcome");
    expect(scenario.description).toBe("Fresh onboarding welcome.");
    expect(scenario.input.nested.value).toBe(1);
    expect(Object.isFrozen(scenario.input)).toBe(true);
    expect(evalScenarioKey(scenario)).toBe("onboarding.welcome@2");
  });

  it("rejects malformed scenario definitions", () => {
    const valid = {
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.valid",
      version: 1,
      title: "Valid",
      description: "Valid scenario.",
      risk: "quality",
      suites: ["onboarding-full"],
      tags: [],
      input: {},
    };

    expect(() =>
      Reflect.apply(defineEvalScenario, undefined, [
        { ...valid, schema: "murph.eval-scenario.v0" },
      ]),
    ).toThrow("scenario.schema");
    expect(() =>
      Reflect.apply(defineEvalScenario, undefined, [
        { ...valid, risk: "severe" },
      ]),
    ).toThrow("Unsupported scenario risk");
    expect(() =>
      Reflect.apply(defineEvalScenario, undefined, [
        { ...valid, suites: [] },
      ]),
    ).toThrow("scenario.suites");
    expect(() =>
      Reflect.apply(defineEvalScenario, undefined, [
        { ...valid, timeoutMs: 0 },
      ]),
    ).toThrow("scenario.timeoutMs");
  });

  it("normalizes target observations, metrics, and safe artifact references", () => {
    const artifactWithLocalDetail = {
      kind: "episode",
      path: "cases/welcome/episode.json",
      mediaType: "application/json",
      sha256: "a".repeat(64),
      localAbsolutePath: "/private/eval-transcript.json",
    };
    const execution = normalizeEvalTargetExecution({
      observation: {
        response: "hello",
      },
      metrics: {
        turns: 1,
      },
      artifacts: [artifactWithLocalDetail],
    });

    expect(Object.isFrozen(execution)).toBe(true);
    expect(execution.metrics).toEqual({ turns: 1 });
    expect(execution.artifacts).toEqual([
      {
        kind: "episode",
        path: "cases/welcome/episode.json",
        mediaType: "application/json",
        sha256: "a".repeat(64),
      },
    ]);

    expect(() =>
      normalizeEvalTargetExecution({
        observation: {},
        metrics: { turns: Number.POSITIVE_INFINITY },
      }),
    ).toThrow("must be finite");
    expect(() =>
      normalizeEvalTargetExecution({
        observation: {},
        artifacts: [{ kind: "episode", path: "../private.json" }],
      }),
    ).toThrow("safe POSIX-relative artifact path");
    expect(() =>
      normalizeEvalTargetExecution({
        observation: {},
        artifacts: [
          { kind: "episode", path: "cases/episode.json", sha256: "bad" },
        ],
      }),
    ).toThrow("SHA-256");
  });

  it("defines stable programs and rejects duplicate or missing targets", () => {
    const registry = createEvalScenarioRegistry([
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.program",
        version: 1,
        title: "Program",
        description: "Program scenario.",
        risk: "quality",
        suites: ["onboarding-full"],
        tags: [],
        input: {},
      }),
    ]);
    const target = defineEvalTarget({
      id: "murph.current",
      description: "Current target.",
      async execute() {
        return { observation: {} };
      },
    });
    const program = defineEvalProgram({
      id: "onboarding",
      description: "  Onboarding program.  ",
      registry,
      targets: [target],
    });

    expect(program.description).toBe("Onboarding program.");
    expect(isEvalProgram(program)).toBe(true);
    expect(isEvalProgram(null)).toBe(false);
    expect(isEvalProgram({})).toBe(false);

    expect(() =>
      defineEvalProgram({
        id: "onboarding-empty",
        description: "Empty.",
        registry,
        targets: [],
      }),
    ).toThrow("requires at least one target");
    expect(() =>
      defineEvalProgram({
        id: "onboarding-duplicate",
        description: "Duplicate.",
        registry,
        targets: [target, target],
      }),
    ).toThrow("duplicate target ids");
  });

  it("renormalizes structurally composed program inputs at the public boundary", () => {
    const scenarioInput = { message: "before" };
    const registry = createEvalScenarioRegistry([
      {
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.composed",
        version: 1,
        title: "  Composed scenario  ",
        description: "  Composed outside the factory.  ",
        risk: "quality",
        suites: ["onboarding-full"],
        tags: [],
        input: scenarioInput,
      },
    ]);
    const target = {
      id: "murph.composed",
      description: "  Composed target.  ",
      async execute() {
        return { observation: {} };
      },
    };
    const program = defineEvalProgram({
      id: "onboarding-composed",
      description: "Composed program.",
      registry,
      targets: [target],
    });

    scenarioInput.message = "after";
    target.description = "Changed target.";

    expect(program.registry.require("onboarding.composed")).toMatchObject({
      title: "Composed scenario",
      input: { message: "before" },
    });
    expect(program.targets[0]?.description).toBe("Composed target.");
  });
});
