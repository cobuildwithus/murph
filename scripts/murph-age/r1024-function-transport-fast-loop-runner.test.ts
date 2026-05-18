import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildR1024FunctionTransportFastLoopPlan,
  R1024_FUNCTION_TRANSPORT_FAST_LOOP_RUNNER_SCHEMA_VERSION,
  runR1024FunctionTransportFastLoopRunner,
  type R1024StepExecutor,
} from "./r1024-function-transport-fast-loop-runner.ts";

describe("R1024 function transport fast loop runner", () => {
  it("builds the MHAS-to-NSHAP manifest refresh plan without product promotion", () => {
    const outputDir = path.join("private", "function-transport");
    const plan = buildR1024FunctionTransportFastLoopPlan({
      outputDir,
      scriptRunnerArgs: ["exec", "tsx"],
    });

    expect(plan.command).toBe("pnpm");
    expect(plan.productPromotionAuthorized).toBe(false);
    expect(plan.reviewGptOperatingMode).toBe("fresh_aggregate_delta_or_architecture_fork_only");
    expect(plan.steps.map((step) => step.id)).toEqual([
      "r1005-mhas-panel-source-card",
      "r1006-mhas-panel-extension-runner-manifest",
      "r1007-mhas-panel-extension-aggregate-receipt",
      "r1009-mhas-function-panel-extension-result",
      "r1011-mhas-function-domain-attribution",
      "r1012-cross-source-function-consistency",
      "r1013-biomarker-shadow-layer-state",
      "r1015-new-data-acceleration-state",
      "r1017-expanded-data-execution-state",
      "r1018-score-bearing-model-signal-receipt",
      "r1020-reviewgpt-model-direction-state",
      "r1027-nshap-source-confirmation-scaffold",
      "r614-nshap-activation-labels",
      "r977-nshap-next-activation-probe",
      "r992-nshap-function-cognition-scaffold",
      "r993-nshap-existing-result-reducer",
      "r997-strict-nshap-function-cognition-replay",
      "r1021-fast-path-execution-state",
      "r1022-nshap-bounded-harness-state",
      "r1023-function-transport-candidate-manifest",
      "r1028-historical-nshap-function-transport-packet",
      "r1026-function-transport-aggregate-packet-validator",
      "r1025-function-transport-result-reducer",
      "r1083-function-missingness-calibration-adjudication",
    ]);
    expect(plan.steps.at(-1)?.args.at(-1)).toBe(
      "scripts/murph-age/r1083-function-missingness-calibration-adjudication.ts",
    );
    expect(plan.steps.every((step) => step.env.MURPH_AGE_RESEARCH_OUTPUT_DIR === outputDir)).toBe(true);
  });

  it("runs the plan through an injectable executor and returns only pathless metadata", async () => {
    const privateOutputDir = path.join("tmp", "private-function-output");
    const seen: string[] = [];
    const executeStep: R1024StepExecutor = async (step) => {
      seen.push(step.id);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          artifact: path.join(privateOutputDir, step.expectedArtifact),
          status: "research-local-aggregate-only",
        }),
      };
    };

    const summary = await runR1024FunctionTransportFastLoopRunner({
      cwd: "repo",
      env: {},
      outputDir: privateOutputDir,
    }, executeStep);

    expect(seen).toEqual([
      "r1005-mhas-panel-source-card",
      "r1006-mhas-panel-extension-runner-manifest",
      "r1007-mhas-panel-extension-aggregate-receipt",
      "r1009-mhas-function-panel-extension-result",
      "r1011-mhas-function-domain-attribution",
      "r1012-cross-source-function-consistency",
      "r1013-biomarker-shadow-layer-state",
      "r1015-new-data-acceleration-state",
      "r1017-expanded-data-execution-state",
      "r1018-score-bearing-model-signal-receipt",
      "r1020-reviewgpt-model-direction-state",
      "r1027-nshap-source-confirmation-scaffold",
      "r614-nshap-activation-labels",
      "r977-nshap-next-activation-probe",
      "r992-nshap-function-cognition-scaffold",
      "r993-nshap-existing-result-reducer",
      "r997-strict-nshap-function-cognition-replay",
      "r1021-fast-path-execution-state",
      "r1022-nshap-bounded-harness-state",
      "r1023-function-transport-candidate-manifest",
      "r1028-historical-nshap-function-transport-packet",
      "r1026-function-transport-aggregate-packet-validator",
      "r1025-function-transport-result-reducer",
      "r1083-function-missingness-calibration-adjudication",
    ]);
    expect(summary.status).toBe("completed");
    expect(summary.summary).toEqual({
      conclusion: "function_transport_fast_loop_manifest_refreshed",
      nextLocalAction: "complete_nshap_activation_then_execute_bounded_batch",
    });
    expect(summary.steps.at(-1)).toEqual({
      artifact: "r1083-function-missingness-calibration-adjudication.latest.json",
      status: "completed",
      stepId: "r1083-function-missingness-calibration-adjudication",
    });
    expect(JSON.stringify(summary)).not.toContain(privateOutputDir);
    expect(JSON.stringify(summary)).not.toContain("row");
  });

  it("skips later steps after the first failure", async () => {
    const executeStep: R1024StepExecutor = async (step) => ({
      exitCode: step.id === "r1018-score-bearing-model-signal-receipt" ? 1 : 0,
      stdout: JSON.stringify({ artifact: step.expectedArtifact }),
    });

    const summary = await runR1024FunctionTransportFastLoopRunner({ env: {} }, executeStep);

    expect(summary.status).toBe("blocked");
    expect(summary.summary).toEqual({
      conclusion: "function_transport_fast_loop_blocked",
      nextLocalAction: "repair_failed_function_transport_step",
    });
    expect(summary.steps.slice(0, 10)).toEqual([
      {
        artifact: "r1005-mhas-panel-source-card.latest.json",
        status: "completed",
        stepId: "r1005-mhas-panel-source-card",
      },
      {
        artifact: "r1006-mhas-panel-extension-runner-manifest.latest.json",
        status: "completed",
        stepId: "r1006-mhas-panel-extension-runner-manifest",
      },
      {
        artifact: "r1007-mhas-panel-extension-aggregate-receipt.latest.json",
        status: "completed",
        stepId: "r1007-mhas-panel-extension-aggregate-receipt",
      },
      {
        artifact: "r1009-mhas-function-panel-extension-result.latest.json",
        status: "completed",
        stepId: "r1009-mhas-function-panel-extension-result",
      },
      {
        artifact: "r1011-mhas-function-domain-attribution.latest.json",
        status: "completed",
        stepId: "r1011-mhas-function-domain-attribution",
      },
      {
        artifact: "r1012-cross-source-function-consistency.latest.json",
        status: "completed",
        stepId: "r1012-cross-source-function-consistency",
      },
      {
        artifact: "r1013-biomarker-shadow-layer-state.latest.json",
        status: "completed",
        stepId: "r1013-biomarker-shadow-layer-state",
      },
      {
        artifact: "r1015-new-data-acceleration-state.latest.json",
        status: "completed",
        stepId: "r1015-new-data-acceleration-state",
      },
      {
        artifact: "r1017-expanded-data-execution-state.latest.json",
        status: "completed",
        stepId: "r1017-expanded-data-execution-state",
      },
      {
        artifact: null,
        status: "failed",
        stepId: "r1018-score-bearing-model-signal-receipt",
      },
    ]);
    expect(summary.steps[10]).toEqual({
      artifact: null,
      status: "skipped",
      stepId: "r1020-reviewgpt-model-direction-state",
    });
  });
});
