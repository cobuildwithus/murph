import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1033Safe,
  R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION,
  runR1033NhanesLabActivityRunnerScaffold,
} from "./r1033-nhanes-lab-activity-runner-scaffold.ts";

describe("R1033 NHANES lab/activity runner scaffold", () => {
  it("blocks cleanly when local source inputs are absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1033-"));
    try {
      const { output } = await runR1033NhanesLabActivityRunnerScaffold({
        createdAt: "2026-05-13T23:00:00.000Z",
        env: {},
        outputDir: path.join(tmp, "out"),
      });

      expect(output.schemaVersion).toBe(R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-scaffold-no-row-parsing");
      expect(output.summary).toEqual({
        candidateFamilyCount: 10,
        conclusion: "blocked_missing_local_source_inputs_no_row_parsing",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1033: false,
      });
      expect(output.executionReadiness.blockedBy).toEqual([
        "MURPH_AGE_NHANES_DEMOGRAPHICS_FILE",
        "MURPH_AGE_NHANES_BODY_BP_FILE",
        "MURPH_AGE_NHANES_LABS_FILE",
        "MURPH_AGE_NHANES_ACTIVITY_FILE",
        "MURPH_AGE_NHANES_MORTALITY_FILE",
      ]);
      expect(output.nextLocalAction).toBe("provide_required_nhanes_env_files_then_rerun_readiness");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        outcomeScoringPerformed: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        rowParsingPerformedByR1033: false,
        rowValuesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("becomes ready only after required local inputs exist without storing paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1033-ready-"));
    try {
      const files = await writeLocalInputs(tmp);
      const { output, outputPath } = await runR1033NhanesLabActivityRunnerScaffold({
        createdAt: "2026-05-13T23:00:00.000Z",
        env: files.env,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.executionReadiness.conclusion).toBe("ready_for_local_private_row_materialization_no_scoring_yet");
      expect(output.executionReadiness.blockedBy).toEqual([]);
      expect(output.executionReadiness.requiredInputStatuses.every((status) => status.status === "available")).toBe(true);
      expect(output.nextLocalAction).toBe("implement_private_row_materializer_and_aggregate_evaluator");
      expect(output.rowMaterializationContract.allowedCacheRoot).toBe(".runtime/cache/research/murph-age/nhanes-lab-activity");
      expect(output.benchmarkCard.evidenceLabel).toBe("public_bridge_same_family_not_consumer_wearable_validation");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await import("node:fs/promises").then(({ readFile }) => readFile(outputPath, "utf8"));
      for (const filePath of files.paths) {
        expect(persisted).not.toContain(filePath);
      }
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if a mutated scaffold claims row parsing or product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1033-unsafe-"));
    try {
      const { output } = await runR1033NhanesLabActivityRunnerScaffold({
        env: {},
        outputDir: path.join(tmp, "out"),
      });
      const unsafe = {
        ...output,
        summary: {
          ...output.summary,
          rowParsingPerformedByR1033: true,
        },
      };

      expect(() => assertR1033Safe(unsafe as never)).toThrow("R1033 NHANES lab/activity runner scaffold failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1033-cli-"));
    try {
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1033-nhanes-lab-activity-runner-scaffold.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        blockedByCount: 5,
        candidateFamilyCount: 10,
        conclusion: "blocked_missing_local_source_inputs_no_row_parsing",
        nextLocalAction: "provide_required_nhanes_env_files_then_rerun_readiness",
        packetId: "r1033-nhanes-lab-activity-runner-scaffold",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1033: false,
        schemaVersion: R1033_NHANES_LAB_ACTIVITY_RUNNER_SCAFFOLD_SCHEMA_VERSION,
        status: "research-local-scaffold-no-row-parsing",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeLocalInputs(tmp: string): Promise<{ env: NodeJS.ProcessEnv; paths: string[] }> {
  const names = [
    "demographics.json",
    "body-bp.json",
    "labs.json",
    "activity.json",
    "mortality.json",
  ];
  const paths = names.map((name) => path.join(tmp, name));
  await Promise.all(paths.map((filePath) => writeFile(filePath, "{}\n")));
  return {
    env: {
      MURPH_AGE_NHANES_ACTIVITY_FILE: paths[3],
      MURPH_AGE_NHANES_BODY_BP_FILE: paths[1],
      MURPH_AGE_NHANES_DEMOGRAPHICS_FILE: paths[0],
      MURPH_AGE_NHANES_LABS_FILE: paths[2],
      MURPH_AGE_NHANES_MORTALITY_FILE: paths[4],
    },
    paths,
  };
}
