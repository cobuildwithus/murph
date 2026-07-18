#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { writeEvalRunArtifact } from "./artifacts.js";
import {
  defineEvalProgram,
  isEvalProgram,
  type EvalProgram,
} from "./program.js";
import type { EvalRunResult } from "./result.js";
import { selectEvalScenarios } from "./scenario-selection.js";
import type { EvalScenarioRisk } from "./scenario.js";
import { runEvalProgram, type EvalRunFilter } from "./runner.js";

export type EvalCliCommand =
  | {
      readonly kind: "help";
    }
  | {
      readonly kind: "list";
      readonly programPath: string;
      readonly filter: EvalRunFilter;
    }
  | {
      readonly kind: "run";
      readonly programPath: string;
      readonly filter: EvalRunFilter;
      readonly trials: number;
      readonly defaultTimeoutMs?: number;
      readonly outputPath?: string;
    };

export function parseEvalCliArgs(argv: readonly string[]): EvalCliCommand {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  const kind = args[0];
  if (kind !== "list" && kind !== "run") {
    throw new Error(`Unknown eval command: ${kind}.`);
  }

  const options = parseOptions(args.slice(1));
  const programPath = requireSingleOption(options, "program");
  const filter: EvalRunFilter = {
    scenarioIds: options.get("scenario") ?? [],
    suites: options.get("suite") ?? [],
    tags: options.get("tag") ?? [],
    targetIds: options.get("target") ?? [],
    risks: parseRiskOptions(options.get("risk") ?? []),
  };

  if (kind === "list") {
    rejectOptions(options, [
      "program",
      "scenario",
      "suite",
      "tag",
      "target",
      "risk",
    ]);
    return {
      kind,
      programPath,
      filter,
    };
  }

  rejectOptions(options, [
    "program",
    "scenario",
    "suite",
    "tag",
    "target",
    "risk",
    "trials",
    "timeout-ms",
    "output",
  ]);

  return {
    kind,
    programPath,
    filter,
    trials: parsePositiveIntegerOption(options, "trials", 1),
    defaultTimeoutMs: parseOptionalPositiveIntegerOption(options, "timeout-ms"),
    outputPath: optionalSingleOption(options, "output"),
  };
}

export interface EvalCliServices {
  readonly signal?: AbortSignal;
  loadProgram(programPath: string): Promise<EvalProgram>;
  resolvePath(...parts: string[]): string;
  writeRunArtifact(input: {
    readonly run: EvalRunResult;
    readonly outputPath: string;
  }): Promise<string>;
  writeStderr(text: string): void;
  writeStdout(text: string): void;
}

export async function runEvalCli(
  argv: readonly string[],
  services: EvalCliServices = defaultEvalCliServices,
): Promise<number> {
  const command = parseEvalCliArgs(argv);
  if (command.kind === "help") {
    services.writeStdout(`${buildHelpText()}\n`);
    return 0;
  }

  const program = await services.loadProgram(command.programPath);

  if (command.kind === "list") {
    const scenarios = selectEvalScenarios(program.scenarios, {
      scenarioIds: command.filter.scenarioIds,
      suites: command.filter.suites,
      tags: command.filter.tags,
      risks: command.filter.risks,
    });
    const targetIds = selectListTargetIds(program, command.filter.targetIds);

    for (const scenario of scenarios) {
      services.writeStdout(
        `${scenario.id}\t${scenario.risk}\t${scenario.suites.join(",")}\t${scenario.title}\n`,
      );
    }
    services.writeStdout(`targets\t${targetIds.join(",")}\n`);
    return 0;
  }

  const run = await runEvalProgram({
    program,
    filter: command.filter,
    trials: command.trials,
    ...(command.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: command.defaultTimeoutMs }),
    onCaseCompleted(result) {
      services.writeStderr(
        `[assistant-evals] ${result.status} ${result.caseId}\n`,
      );
    },
    signal: services.signal,
  });

  const outputPath = command.outputPath
    ? services.resolvePath(command.outputPath)
    : services.resolvePath(
        ".artifacts",
        "assistant-evals",
        run.runId,
        "run.json",
      );
  await services.writeRunArtifact({ run, outputPath });

  services.writeStdout(
    `${JSON.stringify({
      runId: run.runId,
      programId: run.programId,
      summary: run.summary,
    })}\n`,
  );

  return run.summary.failed + run.summary.timedOut + run.summary.aborted === 0
    ? 0
    : 1;
}

const defaultEvalCliServices: EvalCliServices = {
  loadProgram: loadEvalProgram,
  resolvePath: (...parts) => path.resolve(...parts),
  writeRunArtifact: writeEvalRunArtifact,
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  writeStdout: (text) => {
    process.stdout.write(text);
  },
};

export async function loadEvalProgram(programPath: string): Promise<EvalProgram> {
  const moduleUrl = pathToFileURL(path.resolve(programPath)).href;
  const loadedModule: unknown = await import(moduleUrl);
  const candidate = readDefaultExport(loadedModule);

  if (!isEvalProgram(candidate)) {
    throw new TypeError(
      `Eval program module ${programPath} must default-export a valid eval program.`,
    );
  }

  return defineEvalProgram(candidate);
}

export function formatEvalCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let redacted = message;

  for (const [localPath, placeholder] of [
    [process.cwd(), "<REPO_DIR>"],
    [homedir(), "<HOME_DIR>"],
  ] as const) {
    redacted = redacted
      .split(pathToFileURL(localPath).href)
      .join(placeholder)
      .split(localPath)
      .join(placeholder);
  }

  return `[assistant-evals] ${redacted}\n`;
}

function readDefaultExport(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  if (!("default" in value)) {
    return undefined;
  }

  return value.default;
}

function selectListTargetIds(
  program: EvalProgram,
  requestedTargetIds: readonly string[] | undefined,
): readonly string[] {
  const requested = requestedTargetIds ?? [];
  if (requested.length === 0) {
    return program.targets.map((target) => target.id);
  }

  const available = new Set(program.targets.map((target) => target.id));
  const unknown = requested.filter((targetId) => !available.has(targetId));
  if (unknown.length > 0) {
    throw new Error(`Unknown eval target ids: ${unknown.join(", ")}.`);
  }

  return requested;
}

function parseRiskOptions(values: readonly string[]): readonly EvalScenarioRisk[] {
  return values.map((value) => {
    if (value === "critical" || value === "high" || value === "quality") {
      return value;
    }
    throw new Error(`Unknown eval risk: ${value}.`);
  });
}

function parseOptions(argv: readonly string[]): Map<string, string[]> {
  const options = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected eval argument: ${String(token)}.`);
    }

    const name = token.slice(2);
    if (name.length === 0) {
      throw new Error("Eval option names must not be empty.");
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Eval option --${name} requires a value.`);
    }
    index += 1;

    const existing = options.get(name) ?? [];
    existing.push(value);
    options.set(name, existing);
  }

  return options;
}

function rejectOptions(
  options: ReadonlyMap<string, readonly string[]>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = [...options.keys()].filter((name) => !allowedSet.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown eval option${unknown.length === 1 ? "" : "s"}: ${unknown.map((name) => `--${name}`).join(", ")}.`);
  }
}

function requireSingleOption(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): string {
  const value = optionalSingleOption(options, name);
  if (!value) {
    throw new Error(`Eval option --${name} is required.`);
  }
  return value;
}

function optionalSingleOption(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): string | undefined {
  const values = options.get(name);
  if (!values || values.length === 0) {
    return undefined;
  }
  if (values.length !== 1) {
    throw new Error(`Eval option --${name} may be supplied only once.`);
  }
  return values[0];
}

function parsePositiveIntegerOption(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
  fallback: number,
): number {
  return parseOptionalPositiveIntegerOption(options, name) ?? fallback;
}

function parseOptionalPositiveIntegerOption(
  options: ReadonlyMap<string, readonly string[]>,
  name: string,
): number | undefined {
  const raw = optionalSingleOption(options, name);
  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Eval option --${name} must be a positive integer.`);
  }
  return value;
}

function buildHelpText(): string {
  return [
    "Murph assistant eval primitives",
    "",
    "Usage:",
    "  pnpm eval:assistant -- list --program <module> [filters]",
    "  pnpm eval:assistant -- run --program <module> [filters] [options]",
    "",
    "Each run executes selected scenarios × selected targets × trials.",
    "",
    "Filters (repeatable):",
    "  --scenario <id>   Select exact scenario ids",
    "  --suite <id>      Select scenarios in any requested suite",
    "  --tag <id>        Require every requested tag",
    "  --target <id>     Select exact target ids",
    "  --risk <level>    Select critical, high, or quality scenarios",
    "",
    "Run options:",
    "  --trials <n>      Trials per scenario/target pair (default: 1)",
    "  --timeout-ms <n>  Default per-case timeout",
    "  --output <path>   Run artifact path",
  ].join("\n");
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Eval run interrupted."));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  runEvalCli(process.argv.slice(2), {
    ...defaultEvalCliServices,
    signal: controller.signal,
  })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(formatEvalCliError(error));
      process.exitCode = 1;
    })
    .finally(() => {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    });
}
