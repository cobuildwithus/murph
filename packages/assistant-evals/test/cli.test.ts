import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  defineEvalProgram,
  defineEvalScenario,
  defineEvalTarget,
  type EvalRunResult,
} from "../src/index.js";
import {
  formatEvalCliError,
  loadEvalProgram,
  parseEvalCliArgs,
  runEvalCli,
  type EvalCliServices,
} from "../src/cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true }),
    ),
  );
});

describe("assistant eval CLI", () => {
  it("parses repeatable scenario filters and matrix options", () => {
    expect(
      parseEvalCliArgs([
        "--",
        "run",
        "--program",
        "programs/onboarding.ts",
        "--scenario",
        "onboarding.welcome",
        "--scenario",
        "onboarding.resume",
        "--target",
        "murph.current",
        "--trials",
        "3",
      ]),
    ).toEqual({
      kind: "run",
      programPath: "programs/onboarding.ts",
      filter: {
        scenarioIds: ["onboarding.welcome", "onboarding.resume"],
        suites: [],
        tags: [],
        targetIds: ["murph.current"],
        risks: [],
      },
      trials: 3,
      defaultTimeoutMs: undefined,
      outputPath: undefined,
    });
  });

  it("lists filtered scenarios and runs the selected scenario matrix", async () => {
    const program = createProgram();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Array<{ run: EvalRunResult; path: string }> = [];
    const services: EvalCliServices = {
      async loadProgram() {
        return program;
      },
      resolvePath(...parts) {
        return path.join("/resolved", ...parts);
      },
      async writeRunArtifact(input) {
        writes.push({ run: input.run, path: input.outputPath });
        return input.outputPath;
      },
      writeStderr(text) {
        stderr.push(text);
      },
      writeStdout(text) {
        stdout.push(text);
      },
    };

    await expect(
      runEvalCli(
        [
          "list",
          "--program",
          "program.ts",
          "--suite",
          "onboarding-smoke",
          "--risk",
          "critical",
        ],
        services,
      ),
    ).resolves.toBe(0);
    expect(stdout.join("")).toContain("onboarding.welcome\tcritical");
    expect(stdout.join("")).not.toContain("onboarding.resume");
    expect(stdout.join("")).toContain("targets\tmurph.current");

    stdout.length = 0;
    await expect(
      runEvalCli(
        [
          "run",
          "--program",
          "program.ts",
          "--suite",
          "onboarding-full",
          "--trials",
          "2",
          "--output",
          "custom/run.json",
        ],
        services,
      ),
    ).resolves.toBe(0);

    expect(writes[0]?.path).toBe("/resolved/custom/run.json");
    expect(writes[0]?.run.summary).toEqual({
      total: 4,
      completed: 4,
      failed: 0,
      timedOut: 0,
      aborted: 0,
    });
    expect(stderr).toHaveLength(4);
    expect(stdout.join("")).toContain('"programId":"onboarding"');
  });

  it("returns a failing exit code and writes the default artifact path", async () => {
    const baseProgram = createProgram();
    const failedTarget = defineEvalTarget({
      id: "murph.failed",
      description: "Failed target.",
      async execute() {
        throw new Error("expected failure");
      },
    });
    const program = defineEvalProgram({
      id: "onboarding-failed",
      description: "Failed onboarding.",
      scenarios: baseProgram.scenarios,
      targets: [failedTarget],
    });
    const writes: string[] = [];
    const services: EvalCliServices = {
      async loadProgram() {
        return program;
      },
      resolvePath: (...parts) => path.join("/resolved", ...parts),
      async writeRunArtifact(input) {
        writes.push(input.outputPath);
        return input.outputPath;
      },
      writeStderr() {},
      writeStdout() {},
    };

    await expect(
      runEvalCli(
        [
          "run",
          "--program",
          "program.ts",
          "--scenario",
          "onboarding.welcome",
        ],
        services,
      ),
    ).resolves.toBe(1);
    expect(writes[0]).toContain(
      "/resolved/.artifacts/assistant-evals/",
    );
    expect(writes[0]).toContain("/run.json");
  });

  it("prints help without loading a program", async () => {
    let loadCount = 0;
    const stdout: string[] = [];
    const services: EvalCliServices = {
      async loadProgram() {
        loadCount += 1;
        return createProgram();
      },
      resolvePath: (...parts) => parts.join("/"),
      async writeRunArtifact(input) {
        return input.outputPath;
      },
      writeStderr() {},
      writeStdout(text) {
        stdout.push(text);
      },
    };

    await expect(runEvalCli(["--help"], services)).resolves.toBe(0);
    expect(loadCount).toBe(0);
    expect(stdout.join("")).toContain("selected scenarios × selected targets");
  });

  it("loads a default-exported program module and rejects invalid modules", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "murph-eval-cli-"));
    cleanupPaths.push(directory);
    const validPath = path.join(directory, "valid.mjs");
    const invalidPath = path.join(directory, "invalid.mjs");

    await writeFile(
      validPath,
      `const scenario = {
  schema: "murph.eval-scenario.v1",
  id: "onboarding.loaded",
  version: 1,
  title: "Loaded",
  description: "Loaded scenario.",
  risk: "quality",
  suites: ["onboarding-full"],
  tags: [],
  input: {}
};
export default {
  id: "loaded",
  description: "Loaded program.",
  scenarios: [scenario],
  targets: [{
    id: "murph.loaded",
    description: "Loaded target.",
    async execute() { return { observation: {} }; }
  }]
};
`,
      "utf8",
    );
    await writeFile(invalidPath, "export default 42;\n", "utf8");

    await expect(loadEvalProgram(validPath)).resolves.toMatchObject({
      id: "loaded",
    });
    await expect(loadEvalProgram(invalidPath)).rejects.toThrow(
      "must default-export a valid eval program",
    );
  });

  it("rejects unknown options and missing values", () => {
    expect(() =>
      parseEvalCliArgs([
        "run",
        "--program",
        "program.ts",
        "--concurrency",
        "2",
      ]),
    ).toThrow("Unknown eval option");

    expect(() =>
      parseEvalCliArgs(["run", "--program"]),
    ).toThrow("requires a value");

    expect(() =>
      parseEvalCliArgs([
        "run",
        "--program",
        "program.ts",
        "--risk",
        "severe",
      ]),
    ).toThrow("Unknown eval risk");
  });

  it("redacts local filesystem roots from entrypoint errors", () => {
    const home = homedir();
    const error = new Error(
      `Could not import ${path.join(process.cwd(), "private", "program.ts")} or ${path.join(home, "private", "program.ts")}; source ${pathToFileURL(home).href}/private/program.ts.`,
    );

    const formatted = formatEvalCliError(error);

    expect(formatted).not.toContain(process.cwd());
    expect(formatted).not.toContain(home);
    expect(formatted).not.toContain(pathToFileURL(home).href);
    expect(formatted).toContain("<REPO_DIR>");
    expect(formatted).toContain("<HOME_DIR>");
    expect(formatted).toContain("[assistant-evals]");
  });
});

function createProgram() {
  const scenarios = [
    defineEvalScenario({
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.welcome",
      version: 1,
      title: "Welcome",
      description: "Fresh welcome.",
      risk: "critical",
      suites: ["onboarding-smoke", "onboarding-full"],
      tags: ["entry"],
      input: { message: "hello" },
    }),
    defineEvalScenario({
      schema: EVAL_SCENARIO_SCHEMA,
      id: "onboarding.resume",
      version: 1,
      title: "Resume",
      description: "Resume onboarding.",
      risk: "quality",
      suites: ["onboarding-full"],
      tags: ["resume"],
      input: { message: "continue" },
    }),
  ];
  const target = defineEvalTarget({
    id: "murph.current",
    description: "Current target.",
    async execute({ scenario, trial }) {
      return {
        observation: {
          scenarioId: scenario.id,
          trial,
        },
      };
    },
  });

  return defineEvalProgram({
    id: "onboarding",
    description: "Onboarding.",
    scenarios,
    targets: [target],
  });
}
