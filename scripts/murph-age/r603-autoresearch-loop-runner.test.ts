import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildR603AutoresearchLoopPlan,
  R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION,
  runR603AutoresearchLoopRunner,
  type R603StepExecutor,
} from "./r603-autoresearch-loop-runner.ts";

describe("R603 autoresearch loop runner", () => {
  it("builds a proposal-only child-process plan for existing aggregate Murph Age commands", () => {
    const outputDir = path.join("private", "local", "model-runs");
    const plan = buildR603AutoresearchLoopPlan({
      outputDir,
      scriptRunnerArgs: ["exec", "tsx"],
    });

    expect(plan.productPromotionAuthorized).toBe(false);
    expect(plan.command).toBe("pnpm");
    expect(plan.steps.map((step) => step.id)).toEqual([
      "r399-midus2-biomarker-increment",
      "r399-midus-refresher-biomarker-increment",
      "r602-small-candidate-packet",
      "r399-layering-readiness",
    ]);
    expect(plan.steps.map((step) => step.args.at(-1))).toEqual([
      "scripts/murph-age/r399-midus2-biomarker-increment.ts",
      "scripts/murph-age/r399-midus2-biomarker-increment.ts",
      "scripts/murph-age/r602-small-candidate-batch-packet.ts",
      "scripts/murph-age/r399-layering-readiness.ts",
    ]);
    expect(plan.steps[0]?.env).toMatchObject({
      MURPH_AGE_MIDUS_COHORT: "midus2",
      MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
    });
    expect(plan.steps[1]?.env).toMatchObject({
      MURPH_AGE_MIDUS_COHORT: "midus-refresher",
      MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
    });
    expect(plan.steps[2]?.env.MURPH_AGE_MIDUS2_INCREMENT_PATH).toBe(
      path.join(outputDir, "r399-midus2-biomarker-increment.latest.json"),
    );
    expect(plan.steps[2]?.env.MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH).toBe(
      path.join(outputDir, "r399-midus-refresher-biomarker-increment.latest.json"),
    );
    expect(plan.steps[3]?.env.MURPH_AGE_MIDUS2_OUTPUT_PATH).toBe(
      path.join(outputDir, "r399-midus2-biomarker-increment.latest.json"),
    );
    expect(plan.steps[3]?.env.MURPH_AGE_MIDUS_REFRESHER_OUTPUT_PATH).toBe(
      path.join(outputDir, "r399-midus-refresher-biomarker-increment.latest.json"),
    );
  });

  it("runs the plan through an injectable executor and returns only metadata", async () => {
    const privateOutputDir = path.join("tmp", "private-output");
    const seen: string[] = [];
    const executeStep: R603StepExecutor = async (step) => {
      seen.push(step.id);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          artifact: path.join(privateOutputDir, step.expectedArtifact),
          status: "research-local-aggregate-only",
        }),
      };
    };

    const summary = await runR603AutoresearchLoopRunner({
      cwd: "repo",
      env: {},
      outputDir: privateOutputDir,
    }, executeStep);

    expect(seen).toEqual([
      "r399-midus2-biomarker-increment",
      "r399-midus-refresher-biomarker-increment",
      "r602-small-candidate-packet",
      "r399-layering-readiness",
    ]);
    expect(summary).toEqual({
      productPromotionAuthorized: false,
      schemaVersion: R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION,
      status: "completed",
      steps: [
        {
          artifact: "r399-midus2-biomarker-increment.latest.json",
          status: "completed",
          stepId: "r399-midus2-biomarker-increment",
        },
        {
          artifact: "r399-midus-refresher-biomarker-increment.latest.json",
          status: "completed",
          stepId: "r399-midus-refresher-biomarker-increment",
        },
        {
          artifact: "r602-small-candidate-batch-packet.latest.json",
          status: "completed",
          stepId: "r602-small-candidate-packet",
        },
        {
          artifact: "r399-layering-readiness.latest.json",
          status: "completed",
          stepId: "r399-layering-readiness",
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain(privateOutputDir);
    expect(JSON.stringify(summary)).not.toContain("ReviewGPT");
    expect(JSON.stringify(summary)).not.toContain("row");
  });

  it("marks later steps skipped after the first child-process failure without exposing stderr", async () => {
    const executeStep: R603StepExecutor = async (step) => ({
      exitCode: step.id === "r602-small-candidate-packet" ? 1 : 0,
      stdout: JSON.stringify({ artifact: step.expectedArtifact }),
    });

    const summary = await runR603AutoresearchLoopRunner({ env: {} }, executeStep);

    expect(summary.status).toBe("blocked");
    expect(summary.steps).toEqual([
      {
        artifact: "r399-midus2-biomarker-increment.latest.json",
        status: "completed",
        stepId: "r399-midus2-biomarker-increment",
      },
      {
        artifact: "r399-midus-refresher-biomarker-increment.latest.json",
        status: "completed",
        stepId: "r399-midus-refresher-biomarker-increment",
      },
      {
        artifact: null,
        status: "failed",
        stepId: "r602-small-candidate-packet",
      },
      {
        artifact: null,
        status: "skipped",
        stepId: "r399-layering-readiness",
      },
    ]);
  });
});
