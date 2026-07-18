import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  createEvalScenarioRegistry,
  defineEvalProgram,
  defineEvalScenario,
  defineEvalTarget,
  runEvalProgram,
} from "../src/index.js";

function createProgram(input?: {
  onActiveChange?: (active: number) => void;
}) {
  let active = 0;

  const registry = createEvalScenarioRegistry([
    defineEvalScenario({
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.alpha",
      version: 1,
      title: "Alpha",
      description: "First scenario.",
      risk: "critical",
      suites: ["onboarding-smoke"],
      tags: ["entry"],
      input: { message: "alpha" },
    }),
    defineEvalScenario({
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.beta",
      version: 2,
      title: "Beta",
      description: "Second scenario.",
      risk: "quality",
      suites: ["onboarding-full"],
      tags: ["resume"],
      input: { message: "beta" },
    }),
  ]);

  const createTarget = (id: string) =>
    defineEvalTarget({
      id,
      description: `Target ${id}.`,
      async execute({ scenario, trial }) {
        active += 1;
        input?.onActiveChange?.(active);
        await delay(5);
        active -= 1;
        input?.onActiveChange?.(active);
        return {
          observation: {
            scenarioId: scenario.id,
            targetId: id,
            trial,
          },
          metrics: {
            turns: trial,
          },
        };
      },
    });

  return defineEvalProgram({
    id: "onboarding",
    description: "Onboarding program.",
    registry,
    targets: [createTarget("murph.base"), createTarget("murph.candidate")],
  });
}

describe("eval matrix runner", () => {
  it("runs scenario × target × trial matrices with bounded concurrency and stable output order", async () => {
    let maximumActive = 0;
    const program = createProgram({
      onActiveChange(active) {
        maximumActive = Math.max(maximumActive, active);
      },
    });

    const run = await runEvalProgram({
      program,
      trials: 3,
      concurrency: 2,
      runId: "eval-test",
    });

    expect(run.summary).toEqual({
      total: 12,
      completed: 12,
      failed: 0,
      timedOut: 0,
      aborted: 0,
    });
    expect(maximumActive).toBe(2);
    expect(run.cases.map((result) => result.caseId)).toEqual([
      "onboarding.alpha@1::murph.base::trial-1",
      "onboarding.alpha@1::murph.base::trial-2",
      "onboarding.alpha@1::murph.base::trial-3",
      "onboarding.alpha@1::murph.candidate::trial-1",
      "onboarding.alpha@1::murph.candidate::trial-2",
      "onboarding.alpha@1::murph.candidate::trial-3",
      "onboarding.beta@2::murph.base::trial-1",
      "onboarding.beta@2::murph.base::trial-2",
      "onboarding.beta@2::murph.base::trial-3",
      "onboarding.beta@2::murph.candidate::trial-1",
      "onboarding.beta@2::murph.candidate::trial-2",
      "onboarding.beta@2::murph.candidate::trial-3",
    ]);
  });

  it("filters scenarios and targets before building the matrix", async () => {
    const run = await runEvalProgram({
      program: createProgram(),
      filter: {
        suites: ["onboarding-smoke"],
        targetIds: ["murph.candidate"],
      },
      trials: 2,
      runId: "eval-filtered",
    });

    expect(run.selection.scenarioIds).toEqual(["onboarding.alpha"]);
    expect(run.selection.targetIds).toEqual(["murph.candidate"]);
    expect(run.cases).toHaveLength(2);
  });

  it("isolates target failures and reports timeouts without dropping later cases", async () => {
    const registry = createEvalScenarioRegistry([
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.failure",
        version: 1,
        title: "Failure",
        description: "Failure isolation.",
        risk: "critical",
        suites: ["onboarding-smoke"],
        tags: [],
        timeoutMs: 10,
        input: { message: "failure" },
      }),
    ]);

    const failed = defineEvalTarget({
      id: "murph.failed",
      description: "Throws.",
      async execute() {
        throw new Error("expected target failure");
      },
    });
    const timedOut = defineEvalTarget({
      id: "murph.timeout",
      description: "Waits for cancellation.",
      async execute({ signal }) {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        });
        throw new Error("Unreachable timeout target completion.");
      },
    });

    const run = await runEvalProgram({
      program: defineEvalProgram({
        id: "onboarding-failures",
        description: "Failure cases.",
        registry,
        targets: [failed, timedOut],
      }),
      concurrency: 2,
      runId: "eval-failures",
    });

    expect(run.cases.map((result) => result.status)).toEqual([
      "failed",
      "timed-out",
    ]);
    expect(run.cases[0]).toMatchObject({
      status: "failed",
      error: {
        message: "Eval target failed.",
      },
    });
    expect(run.summary).toEqual({
      total: 2,
      completed: 0,
      failed: 1,
      timedOut: 1,
      aborted: 0,
    });
  });

  it("records risk and timeout selection while ignoring observer failures", async () => {
    const run = await runEvalProgram({
      program: createProgram(),
      filter: {
        risks: ["quality"],
      },
      defaultTimeoutMs: 2_000,
      runId: "eval-quality",
      onEvent() {
        throw new Error("observer failures are non-blocking");
      },
    });

    expect(run.selection).toMatchObject({
      scenarioIds: ["onboarding.beta"],
      targetIds: ["murph.base", "murph.candidate"],
      risks: ["quality"],
      defaultTimeoutMs: 2_000,
    });
    expect(run.summary.completed).toBe(2);
  });

  it("marks every selected case aborted when the run signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));

    const run = await runEvalProgram({
      program: createProgram(),
      filter: {
        scenarioIds: ["onboarding.alpha"],
        targetIds: ["murph.base"],
      },
      trials: 2,
      signal: controller.signal,
      runId: "eval-aborted",
    });

    expect(run.cases.map((result) => result.status)).toEqual([
      "aborted",
      "aborted",
    ]);
    expect(run.cases[0]).toMatchObject({
      status: "aborted",
      error: {
        message: "Eval run aborted.",
      },
    });
  });

  it("keeps the worker slot until an aborted target finishes cleanup", async () => {
    let firstCaseCleanedUp = false;
    let secondCaseObservedCleanup = false;
    const registry = createEvalScenarioRegistry([
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.cleanup-alpha",
        version: 1,
        title: "Cleanup alpha",
        description: "Times out and cleans up.",
        risk: "critical",
        suites: ["onboarding-smoke"],
        tags: [],
        timeoutMs: 10,
        input: {},
      }),
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.cleanup-beta",
        version: 1,
        title: "Cleanup beta",
        description: "Must wait for alpha cleanup.",
        risk: "critical",
        suites: ["onboarding-smoke"],
        tags: [],
        timeoutMs: 1_000,
        input: {},
      }),
    ]);
    const target = defineEvalTarget({
      id: "murph.cleanup",
      description: "Delayed cancellation cleanup.",
      async execute({ scenario, signal }) {
        if (scenario.id === "onboarding.cleanup-alpha") {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          await delay(25);
          firstCaseCleanedUp = true;
          throw signal.reason;
        }

        secondCaseObservedCleanup = firstCaseCleanedUp;
        return { observation: {} };
      },
    });

    const run = await runEvalProgram({
      program: defineEvalProgram({
        id: "onboarding-cleanup",
        description: "Cleanup ordering.",
        registry,
        targets: [target],
      }),
      concurrency: 1,
      runId: "eval-cleanup",
    });

    expect(run.cases.map((result) => result.status)).toEqual([
      "timed-out",
      "completed",
    ]);
    expect(secondCaseObservedCleanup).toBe(true);
  });

  it("waits for active target cleanup before settling an aborted run", async () => {
    let signalTargetStarted: () => void = () => undefined;
    const targetStarted = new Promise<void>((resolve) => {
      signalTargetStarted = resolve;
    });
    let releaseCleanup: () => void = () => undefined;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let executionCount = 0;
    const baseProgram = createProgram();
    const target = defineEvalTarget({
      id: "murph.abort-cleanup",
      description: "Controlled cancellation cleanup.",
      async execute({ signal }) {
        executionCount += 1;
        signalTargetStarted();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await cleanupReleased;
        throw signal.reason;
      },
    });
    const controller = new AbortController();
    const runPromise = runEvalProgram({
      program: defineEvalProgram({
        id: "onboarding-abort-cleanup",
        description: "Active abort cleanup.",
        registry: baseProgram.registry,
        targets: [target],
      }),
      filter: { scenarioIds: ["onboarding.alpha"] },
      trials: 2,
      concurrency: 1,
      signal: controller.signal,
      runId: "eval-abort-cleanup",
    });

    await targetStarted;
    controller.abort(new Error("private cancellation detail"));
    let runSettled = false;
    void runPromise.then(() => {
      runSettled = true;
    });
    await delay(10);

    expect(runSettled).toBe(false);
    releaseCleanup();
    const run = await runPromise;
    expect(run.cases.map((result) => result.status)).toEqual([
      "aborted",
      "aborted",
    ]);
    expect(executionCount).toBe(1);
    expect(JSON.stringify(run)).not.toContain("private cancellation detail");
  });

  it("does not persist raw target failure details", async () => {
    const registry = createEvalScenarioRegistry([
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.private-error",
        version: 1,
        title: "Private error",
        description: "Failure details stay local.",
        risk: "critical",
        suites: ["onboarding-smoke"],
        tags: [],
        input: {},
      }),
    ]);
    const target = defineEvalTarget({
      id: "murph.private-error",
      description: "Throws private details.",
      async execute() {
        throw new Error("private path and credential must not persist");
      },
    });

    const run = await runEvalProgram({
      program: defineEvalProgram({
        id: "onboarding-private-error",
        description: "Private error handling.",
        registry,
        targets: [target],
      }),
      runId: "eval-private-error",
    });

    expect(JSON.stringify(run)).not.toContain("credential must not persist");
    expect(run.cases[0]).toMatchObject({
      status: "failed",
      error: {
        name: "Error",
        message: "Eval target failed.",
      },
    });
  });

  it("rejects invalid runner bounds, run ids, targets, and empty selections", async () => {
    const program = createProgram();

    await expect(
      runEvalProgram({ program, trials: 0, runId: "invalid-trials" }),
    ).rejects.toThrow("trials must be an integer");
    await expect(
      runEvalProgram({ program, concurrency: 65, runId: "invalid-workers" }),
    ).rejects.toThrow("concurrency must be an integer");
    await expect(
      runEvalProgram({ program, runId: "Invalid Run" }),
    ).rejects.toThrow("runId must use lowercase");
    await expect(
      runEvalProgram({
        program,
        filter: { targetIds: ["murph.missing"] },
        runId: "invalid-target",
      }),
    ).rejects.toThrow("Unknown eval target id");
    await expect(
      runEvalProgram({
        program,
        filter: {
          scenarioIds: ["onboarding.alpha"],
          risks: ["quality"],
        },
        runId: "empty-selection",
      }),
    ).rejects.toThrow("did not produce any cases");
  });
});
