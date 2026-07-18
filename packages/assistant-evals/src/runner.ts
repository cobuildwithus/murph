import { randomUUID } from "node:crypto";

import {
  assertEvalIdentifier,
  assertPositiveInteger,
  normalizeIdentifierList,
} from "./identifiers.js";
import type { JsonValue } from "./json.js";
import type { EvalProgram } from "./program.js";
import type { EvalScenario, EvalScenarioRisk } from "./scenario.js";
import {
  EVAL_CASE_RESULT_SCHEMA,
  EVAL_RUN_RESULT_SCHEMA,
  type EvalCaseError,
  type EvalCaseResult,
  type EvalCaseStatus,
  type EvalRunResult,
  type EvalRunSummary,
} from "./result.js";
import {
  normalizeEvalTargetExecution,
  type EvalTarget,
} from "./target.js";

const DEFAULT_CASE_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_TRIALS = 100;
const MAX_CONCURRENCY = 64;

export interface EvalRunFilter {
  readonly scenarioIds?: readonly string[];
  readonly suites?: readonly string[];
  readonly tags?: readonly string[];
  readonly targetIds?: readonly string[];
  readonly risks?: readonly EvalScenarioRisk[];
}

export type EvalRunEvent<TObservation extends JsonValue = JsonValue> =
  | {
      readonly type: "run-started";
      readonly runId: string;
      readonly caseCount: number;
    }
  | {
      readonly type: "case-started";
      readonly runId: string;
      readonly caseId: string;
      readonly scenarioId: string;
      readonly targetId: string;
      readonly trial: number;
    }
  | {
      readonly type: "case-completed";
      readonly runId: string;
      readonly result: EvalCaseResult<TObservation>;
    }
  | {
      readonly type: "run-completed";
      readonly run: EvalRunResult<TObservation>;
    };

export interface RunEvalProgramOptions<
  TInput extends JsonValue,
  TObservation extends JsonValue,
> {
  readonly program: EvalProgram<TInput, TObservation>;
  readonly filter?: EvalRunFilter;
  readonly trials?: number;
  readonly concurrency?: number;
  readonly defaultTimeoutMs?: number;
  readonly runId?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly onEvent?: (event: EvalRunEvent<TObservation>) => void;
}

interface EvalCaseTask<
  TInput extends JsonValue,
  TObservation extends JsonValue,
> {
  readonly index: number;
  readonly caseId: string;
  readonly scenario: EvalScenario<TInput>;
  readonly target: EvalTarget<TInput, TObservation>;
  readonly trial: number;
}

export async function runEvalProgram<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  options: RunEvalProgramOptions<TInput, TObservation>,
): Promise<EvalRunResult<TObservation>> {
  const trials = options.trials ?? 1;
  const concurrency = options.concurrency ?? 1;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;
  assertPositiveInteger(trials, "trials", MAX_TRIALS);
  assertPositiveInteger(concurrency, "concurrency", MAX_CONCURRENCY);
  assertPositiveInteger(
    defaultTimeoutMs,
    "defaultTimeoutMs",
    60 * 60 * 1_000,
  );

  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? createEvalRunId(now());
  assertEvalIdentifier(runId, "runId");
  const scenarios = selectScenarios(options.program, options.filter);
  const targets = selectTargets(options.program, options.filter);
  const tasks = createTasks({ runId, scenarios, targets, trials });

  if (tasks.length === 0) {
    throw new Error("The eval selection did not produce any cases.");
  }

  const started = now();
  emitEvent(options.onEvent, {
    type: "run-started",
    runId,
    caseCount: tasks.length,
  });

  const results: Array<EvalCaseResult<TObservation> | undefined> =
    new Array(tasks.length);
  let nextTaskIndex = 0;

  const workerCount = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      const task = tasks[taskIndex];
      if (!task) {
        return;
      }

      emitEvent(options.onEvent, {
        type: "case-started",
        runId,
        caseId: task.caseId,
        scenarioId: task.scenario.id,
        targetId: task.target.id,
        trial: task.trial,
      });

      const result = await runCase({
        runId,
        task,
        defaultTimeoutMs,
        parentSignal: options.signal,
        now,
      });
      results[task.index] = result;

      emitEvent(options.onEvent, {
        type: "case-completed",
        runId,
        result,
      });
    }
  });

  await Promise.all(workers);

  const cases = Object.freeze(
    results.map((result, index) => {
      if (!result) {
        throw new Error(`Eval runner did not produce result ${index}.`);
      }
      return result;
    }),
  );
  const completed = now();
  const run = Object.freeze({
    schema: EVAL_RUN_RESULT_SCHEMA,
    runId,
    programId: options.program.id,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: elapsedMilliseconds(started, completed),
    selection: Object.freeze({
      scenarioIds: Object.freeze(scenarios.map((scenario) => scenario.id)),
      suites: Object.freeze([...(options.filter?.suites ?? [])]),
      tags: Object.freeze([...(options.filter?.tags ?? [])]),
      targetIds: Object.freeze(targets.map((target) => target.id)),
      risks: Object.freeze([...(options.filter?.risks ?? [])]),
      trials,
      concurrency,
      defaultTimeoutMs,
    }),
    summary: summarizeCases(cases),
    cases,
  }) satisfies EvalRunResult<TObservation>;

  emitEvent(options.onEvent, {
    type: "run-completed",
    run,
  });

  return run;
}

function selectScenarios<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  program: EvalProgram<TInput, TObservation>,
  filter: EvalRunFilter | undefined,
): readonly EvalScenario<TInput>[] {
  return program.registry.select({
    scenarioIds: filter?.scenarioIds,
    suites: filter?.suites,
    tags: filter?.tags,
    risks: filter?.risks,
  });
}

function selectTargets<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(
  program: EvalProgram<TInput, TObservation>,
  filter: EvalRunFilter | undefined,
): readonly EvalTarget<TInput, TObservation>[] {
  const requestedIds = normalizeIdentifierList(
    filter?.targetIds ?? [],
    "targetIds",
    { allowEmpty: true },
  );
  if (requestedIds.length === 0) {
    return program.targets;
  }

  const byId = new Map(program.targets.map((target) => [target.id, target]));
  const unknownIds = requestedIds.filter((id) => !byId.has(id));
  if (unknownIds.length > 0) {
    throw new Error(
      `Unknown eval target id${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}.`,
    );
  }

  return Object.freeze(
    requestedIds.map((id) => {
      const target = byId.get(id);
      if (!target) {
        throw new Error(`Unknown eval target id: ${id}.`);
      }
      return target;
    }),
  );
}

function createTasks<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(input: {
  readonly runId: string;
  readonly scenarios: readonly EvalScenario<TInput>[];
  readonly targets: readonly EvalTarget<TInput, TObservation>[];
  readonly trials: number;
}): readonly EvalCaseTask<TInput, TObservation>[] {
  const tasks: EvalCaseTask<TInput, TObservation>[] = [];

  for (const scenario of input.scenarios) {
    for (const target of input.targets) {
      for (let trial = 1; trial <= input.trials; trial += 1) {
        tasks.push({
          index: tasks.length,
          caseId: `${scenario.id}@${scenario.version}::${target.id}::trial-${trial}`,
          scenario,
          target,
          trial,
        });
      }
    }
  }

  return Object.freeze(tasks);
}

async function runCase<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(input: {
  readonly runId: string;
  readonly task: EvalCaseTask<TInput, TObservation>;
  readonly defaultTimeoutMs: number;
  readonly parentSignal?: AbortSignal;
  readonly now: () => Date;
}): Promise<EvalCaseResult<TObservation>> {
  const started = input.now();

  if (input.parentSignal?.aborted) {
    return buildIncompleteResult({
      input,
      started,
      status: "aborted",
      error: serializeError(input.parentSignal.reason, "Eval run aborted."),
    });
  }

  const timeoutMs = input.task.scenario.timeoutMs ?? input.defaultTimeoutMs;
  const controller = new AbortController();
  let interruptStatus: Exclude<EvalCaseStatus, "completed" | "failed"> | null =
    null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let removeParentAbortListener = () => undefined;

  const interrupt = new Promise<never>((_resolve, reject) => {
    const rejectInterrupted = (
      status: Exclude<EvalCaseStatus, "completed" | "failed">,
      error: Error,
    ) => {
      if (interruptStatus !== null) {
        return;
      }
      interruptStatus = status;
      controller.abort(error);
      reject(error);
    };

    timeout = setTimeout(() => {
      rejectInterrupted(
        "timed-out",
        new Error(`Eval case exceeded its ${timeoutMs}ms timeout.`),
      );
    }, timeoutMs);

    const parentSignal = input.parentSignal;
    if (parentSignal) {
      const onAbort = () => {
        rejectInterrupted(
          "aborted",
          normalizeAbortReason(parentSignal.reason),
        );
      };
      parentSignal.addEventListener("abort", onAbort, { once: true });
      removeParentAbortListener = () => {
        parentSignal.removeEventListener("abort", onAbort);
      };
    }
  });

  try {
    const executionPromise = input.task.target.execute({
      runId: input.runId,
      caseId: input.task.caseId,
      scenario: input.task.scenario,
      trial: input.task.trial,
      signal: controller.signal,
    });
    let execution: Awaited<typeof executionPromise>;
    try {
      execution = await Promise.race([executionPromise, interrupt]);
    } catch (error) {
      if (interruptStatus !== null) {
        // A timeout is not cleanup. Keep the worker slot until the target has
        // honored cancellation and released every case-owned resource.
        await executionPromise.catch(() => undefined);
      }
      throw error;
    }
    const normalized = normalizeEvalTargetExecution(execution);
    const completed = input.now();

    return Object.freeze({
      schema: EVAL_CASE_RESULT_SCHEMA,
      caseId: input.task.caseId,
      runId: input.runId,
      scenarioId: input.task.scenario.id,
      scenarioVersion: input.task.scenario.version,
      targetId: input.task.target.id,
      trial: input.task.trial,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: elapsedMilliseconds(started, completed),
      status: "completed",
      observation: normalized.observation,
      metrics: normalized.metrics ?? Object.freeze({}),
      artifacts: normalized.artifacts ?? Object.freeze([]),
    });
  } catch (error) {
    if (interruptStatus !== null) {
      return buildIncompleteResult({
        input,
        started,
        status: interruptStatus,
        error: serializeError(
          undefined,
          interruptStatus === "timed-out"
            ? "Eval case timed out."
            : "Eval run aborted.",
        ),
      });
    }

    return buildIncompleteResult({
      input,
      started,
      status: "failed",
      error: serializeError(error, "Eval target failed."),
    });
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    removeParentAbortListener();
  }
}

function buildIncompleteResult<
  TInput extends JsonValue,
  TObservation extends JsonValue,
>(input: {
  readonly input: {
    readonly runId: string;
    readonly task: EvalCaseTask<TInput, TObservation>;
    readonly now: () => Date;
  };
  readonly started: Date;
  readonly status: "aborted" | "failed" | "timed-out";
  readonly error: EvalCaseError;
}): EvalCaseResult<TObservation> {
  const completed = input.input.now();
  return Object.freeze({
    schema: EVAL_CASE_RESULT_SCHEMA,
    caseId: input.input.task.caseId,
    runId: input.input.runId,
    scenarioId: input.input.task.scenario.id,
    scenarioVersion: input.input.task.scenario.version,
    targetId: input.input.task.target.id,
    trial: input.input.task.trial,
    startedAt: input.started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: elapsedMilliseconds(input.started, completed),
    status: input.status,
    error: input.error,
  });
}

function summarizeCases(
  cases: readonly EvalCaseResult[],
): EvalRunSummary {
  let completed = 0;
  let failed = 0;
  let timedOut = 0;
  let aborted = 0;

  for (const result of cases) {
    switch (result.status) {
      case "completed":
        completed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "timed-out":
        timedOut += 1;
        break;
      case "aborted":
        aborted += 1;
        break;
    }
  }

  return Object.freeze({
    total: cases.length,
    completed,
    failed,
    timedOut,
    aborted,
  });
}

function serializeError(error: unknown, fallbackMessage: string): EvalCaseError {
  const code = error instanceof Error ? readErrorCode(error) : null;
  return Object.freeze({
    name: "Error",
    message: fallbackMessage,
    ...(code ? { code } : {}),
  });
}

function readErrorCode(error: Error): string | null {
  if (!("code" in error)) {
    return null;
  }

  const code = error.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
    ? code
    : null;
}

function normalizeAbortReason(reason: unknown): Error {
  void reason;
  return new Error("Eval run aborted.");
}

function elapsedMilliseconds(started: Date, completed: Date): number {
  return Math.max(0, completed.getTime() - started.getTime());
}

function createEvalRunId(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/gu, "");
  return `eval-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function emitEvent<TObservation extends JsonValue>(
  listener: ((event: EvalRunEvent<TObservation>) => void) | undefined,
  event: EvalRunEvent<TObservation>,
): void {
  if (!listener) {
    return;
  }

  try {
    listener(event);
  } catch {
    // Progress reporting is observational and must not change eval outcomes.
  }
}
