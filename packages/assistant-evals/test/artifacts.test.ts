import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EVAL_SCENARIO_SCHEMA,
  defineEvalProgram,
  defineEvalScenario,
  defineEvalTarget,
  runEvalProgram,
  writeEvalRunArtifact,
} from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true }),
    ),
  );
});

describe("eval run artifacts", () => {
  it("atomically writes one JSON run containing several cases", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "murph-assistant-evals-"));
    cleanupPaths.push(directory);

    const scenarios = [
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.one",
        version: 1,
        title: "One",
        description: "First.",
        risk: "critical",
        suites: ["onboarding-smoke"],
        tags: [],
        input: { value: 1 },
      }),
      defineEvalScenario({
        schema: EVAL_SCENARIO_SCHEMA,
        id: "onboarding.two",
        version: 1,
        title: "Two",
        description: "Second.",
        risk: "quality",
        suites: ["onboarding-smoke"],
        tags: [],
        input: { value: 2 },
      }),
    ];
    const target = defineEvalTarget({
      id: "murph.current",
      description: "Current target.",
      async execute({ scenario }) {
        return {
          observation: {
            scenarioId: scenario.id,
          },
        };
      },
    });
    const run = await runEvalProgram({
      program: defineEvalProgram({
        id: "onboarding",
        description: "Onboarding.",
        scenarios,
        targets: [target],
      }),
      runId: "artifact-test",
    });

    const outputPath = path.join(directory, "nested", "run.json");
    await expect(writeEvalRunArtifact({ run, outputPath })).resolves.toBe(
      outputPath,
    );

    const rawParsed = JSON.parse(await readFile(outputPath, "utf8")) as {
      runId: string;
      cases: unknown[];
    };
    expect(rawParsed.runId).toBe("artifact-test");
    expect(rawParsed.cases).toHaveLength(2);

    const [directoryStats, artifactStats] = await Promise.all([
      stat(path.dirname(outputPath)),
      stat(outputPath),
    ]);
    expect(directoryStats.mode & 0o777).toBe(0o700);
    expect(artifactStats.mode & 0o777).toBe(0o600);
  });
});
