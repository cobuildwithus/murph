import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const R1024_FUNCTION_TRANSPORT_FAST_LOOP_RUNNER_SCHEMA_VERSION =
  "murph-age-r1024-function-transport-fast-loop-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);

type R1024StepId =
  | "r1005-mhas-panel-source-card"
  | "r1006-mhas-panel-extension-runner-manifest"
  | "r1007-mhas-panel-extension-aggregate-receipt"
  | "r1009-mhas-function-panel-extension-result"
  | "r1011-mhas-function-domain-attribution"
  | "r1012-cross-source-function-consistency"
  | "r1013-biomarker-shadow-layer-state"
  | "r1015-new-data-acceleration-state"
  | "r1017-expanded-data-execution-state"
  | "r1018-score-bearing-model-signal-receipt"
  | "r1020-reviewgpt-model-direction-state"
  | "r1027-nshap-source-confirmation-scaffold"
  | "r614-nshap-activation-labels"
  | "r977-nshap-next-activation-probe"
  | "r992-nshap-function-cognition-scaffold"
  | "r993-nshap-existing-result-reducer"
  | "r997-strict-nshap-function-cognition-replay"
  | "r1021-fast-path-execution-state"
  | "r1022-nshap-bounded-harness-state"
  | "r1023-function-transport-candidate-manifest"
  | "r1028-historical-nshap-function-transport-packet"
  | "r1026-function-transport-aggregate-packet-validator"
  | "r1025-function-transport-result-reducer"
  | "r1083-function-missingness-calibration-adjudication";
type R1024StepStatus = "completed" | "failed" | "skipped";

export interface R1024FunctionTransportFastLoopRunnerOptions {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outputDir?: string;
  scriptRunnerArgs?: string[];
}

export interface R1024LoopPlanStep {
  args: string[];
  env: Record<string, string>;
  expectedArtifact: string;
  id: R1024StepId;
}

export interface R1024LoopPlan {
  command: string;
  productPromotionAuthorized: false;
  reviewGptOperatingMode: "fresh_aggregate_delta_or_architecture_fork_only";
  steps: R1024LoopPlanStep[];
}

export interface R1024LoopStepSummary {
  artifact: string | null;
  status: R1024StepStatus;
  stepId: R1024StepId;
}

export interface R1024LoopRunSummary {
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  reviewGptOperatingMode: "fresh_aggregate_delta_or_architecture_fork_only";
  schemaVersion: typeof R1024_FUNCTION_TRANSPORT_FAST_LOOP_RUNNER_SCHEMA_VERSION;
  status: "completed" | "blocked";
  steps: R1024LoopStepSummary[];
  summary: {
    conclusion:
      | "function_transport_fast_loop_manifest_refreshed"
      | "function_transport_fast_loop_blocked";
    nextLocalAction:
      | "complete_nshap_activation_then_execute_bounded_batch"
      | "repair_failed_function_transport_step";
  };
}

export type R1024StepExecutor = (
  step: R1024LoopPlanStep,
  context: { command: string; cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ exitCode: number; stdout: string }>;

export function buildR1024FunctionTransportFastLoopPlan(
  options: R1024FunctionTransportFastLoopRunnerOptions = {},
): R1024LoopPlan {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const runnerArgs = options.scriptRunnerArgs ?? ["exec", "tsx"];
  const step = (
    id: R1024StepId,
    script: string,
    expectedArtifact: string,
  ): R1024LoopPlanStep => ({
    args: [...runnerArgs, script],
    env: {
      MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
    },
    expectedArtifact,
    id,
  });

  return {
    command: options.command ?? "pnpm",
    productPromotionAuthorized: false,
    reviewGptOperatingMode: "fresh_aggregate_delta_or_architecture_fork_only",
    steps: [
      step(
        "r1005-mhas-panel-source-card",
        "scripts/murph-age/r1005-mhas-panel-source-card.ts",
        "r1005-mhas-panel-source-card.latest.json",
      ),
      step(
        "r1006-mhas-panel-extension-runner-manifest",
        "scripts/murph-age/r1006-mhas-panel-extension-runner-manifest.ts",
        "r1006-mhas-panel-extension-runner-manifest.latest.json",
      ),
      step(
        "r1007-mhas-panel-extension-aggregate-receipt",
        "scripts/murph-age/r1007-mhas-panel-extension-aggregate-receipt.ts",
        "r1007-mhas-panel-extension-aggregate-receipt.latest.json",
      ),
      step(
        "r1009-mhas-function-panel-extension-result",
        "scripts/murph-age/r1009-mhas-function-panel-extension-result.ts",
        "r1009-mhas-function-panel-extension-result.latest.json",
      ),
      step(
        "r1011-mhas-function-domain-attribution",
        "scripts/murph-age/r1011-mhas-function-domain-attribution.ts",
        "r1011-mhas-function-domain-attribution.latest.json",
      ),
      step(
        "r1012-cross-source-function-consistency",
        "scripts/murph-age/r1012-cross-source-function-consistency.ts",
        "r1012-cross-source-function-consistency.latest.json",
      ),
      step(
        "r1013-biomarker-shadow-layer-state",
        "scripts/murph-age/r1013-biomarker-shadow-layer-state.ts",
        "r1013-biomarker-shadow-layer-state.latest.json",
      ),
      step(
        "r1015-new-data-acceleration-state",
        "scripts/murph-age/r1015-new-data-acceleration-state.ts",
        "r1015-new-data-acceleration-state.latest.json",
      ),
      step(
        "r1017-expanded-data-execution-state",
        "scripts/murph-age/r1017-expanded-data-execution-state.ts",
        "r1017-expanded-data-execution-state.latest.json",
      ),
      step(
        "r1018-score-bearing-model-signal-receipt",
        "scripts/murph-age/r1018-score-bearing-model-signal-receipt.ts",
        "r1018-score-bearing-model-signal-receipt.latest.json",
      ),
      step(
        "r1020-reviewgpt-model-direction-state",
        "scripts/murph-age/r1020-reviewgpt-model-direction-state.ts",
        "r1020-reviewgpt-model-direction-state.latest.json",
      ),
      step(
        "r1027-nshap-source-confirmation-scaffold",
        "scripts/murph-age/r1027-nshap-source-confirmation-scaffold.ts",
        "r1027-nshap-source-confirmation-scaffold.latest.json",
      ),
      step(
        "r614-nshap-activation-labels",
        "scripts/murph-age/r614-nshap-activation-labels.ts",
        "r614-nshap-activation-labels.latest.json",
      ),
      step(
        "r977-nshap-next-activation-probe",
        "scripts/murph-age/r977-nshap-next-activation-probe.ts",
        "r977-nshap-next-activation-probe.latest.json",
      ),
      step(
        "r992-nshap-function-cognition-scaffold",
        "scripts/murph-age/r992-nshap-function-cognition-scaffold.ts",
        "r992-nshap-function-cognition-scaffold.latest.json",
      ),
      step(
        "r993-nshap-existing-result-reducer",
        "scripts/murph-age/r993-nshap-existing-result-reducer.ts",
        "r993-nshap-existing-result-reducer.latest.json",
      ),
      step(
        "r997-strict-nshap-function-cognition-replay",
        "scripts/murph-age/r997-strict-nshap-function-cognition-replay.ts",
        "r997-strict-nshap-function-cognition-replay.latest.json",
      ),
      step(
        "r1021-fast-path-execution-state",
        "scripts/murph-age/r1021-fast-path-execution-state.ts",
        "r1021-fast-path-execution-state.latest.json",
      ),
      step(
        "r1022-nshap-bounded-harness-state",
        "scripts/murph-age/r1022-nshap-bounded-harness-state.ts",
        "r1022-nshap-bounded-harness-state.latest.json",
      ),
      step(
        "r1023-function-transport-candidate-manifest",
        "scripts/murph-age/r1023-function-transport-candidate-manifest.ts",
        "r1023-function-transport-candidate-manifest.latest.json",
      ),
      step(
        "r1028-historical-nshap-function-transport-packet",
        "scripts/murph-age/r1028-historical-nshap-function-transport-packet.ts",
        "r1028-historical-nshap-function-transport-packet.latest.json",
      ),
      step(
        "r1026-function-transport-aggregate-packet-validator",
        "scripts/murph-age/r1026-function-transport-aggregate-packet-validator.ts",
        "r1026-function-transport-aggregate-packet-validator.latest.json",
      ),
      step(
        "r1025-function-transport-result-reducer",
        "scripts/murph-age/r1025-function-transport-result-reducer.ts",
        "r1025-function-transport-result-reducer.latest.json",
      ),
      step(
        "r1083-function-missingness-calibration-adjudication",
        "scripts/murph-age/r1083-function-missingness-calibration-adjudication.ts",
        "r1083-function-missingness-calibration-adjudication.latest.json",
      ),
    ],
  };
}

export async function runR1024FunctionTransportFastLoopRunner(
  options: R1024FunctionTransportFastLoopRunnerOptions = {},
  executeStep: R1024StepExecutor = spawnR1024Step,
): Promise<R1024LoopRunSummary> {
  const plan = buildR1024FunctionTransportFastLoopPlan(options);
  const cwd = options.cwd ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const steps: R1024LoopStepSummary[] = [];
  let blocked = false;

  for (const step of plan.steps) {
    if (blocked) {
      steps.push({ artifact: null, status: "skipped", stepId: step.id });
      continue;
    }

    const result = await executeStep(step, {
      command: plan.command,
      cwd,
      env: { ...baseEnv, ...step.env },
    });

    if (result.exitCode !== 0) {
      steps.push({ artifact: null, status: "failed", stepId: step.id });
      blocked = true;
      continue;
    }

    steps.push({
      artifact: artifactBasenameFromStdout(result.stdout) ?? step.expectedArtifact,
      status: "completed",
      stepId: step.id,
    });
  }

  return {
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    reviewGptOperatingMode: "fresh_aggregate_delta_or_architecture_fork_only",
    schemaVersion: R1024_FUNCTION_TRANSPORT_FAST_LOOP_RUNNER_SCHEMA_VERSION,
    status: blocked ? "blocked" : "completed",
    steps,
    summary: {
      conclusion: blocked
        ? "function_transport_fast_loop_blocked"
        : "function_transport_fast_loop_manifest_refreshed",
      nextLocalAction: blocked
        ? "repair_failed_function_transport_step"
        : "complete_nshap_activation_then_execute_bounded_batch",
    },
  };
}

async function spawnR1024Step(
  step: R1024LoopPlanStep,
  context: { command: string; cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(context.command, step.args, {
      cwd: context.cwd,
      env: context.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout });
    });
  });
}

function artifactBasenameFromStdout(stdout: string): string | null {
  const parsed = safeJson(stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const artifact = (parsed as { artifact?: unknown }).artifact;
  if (typeof artifact !== "string" || artifact.length === 0) return null;
  return path.basename(artifact);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1024FunctionTransportFastLoopRunner({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status !== "completed") process.exitCode = 1;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      reviewGptOperatingMode: "fresh_aggregate_delta_or_architecture_fork_only",
      schemaVersion: R1024_FUNCTION_TRANSPORT_FAST_LOOP_RUNNER_SCHEMA_VERSION,
      status: "blocked",
      steps: [],
      summary: {
        conclusion: "function_transport_fast_loop_blocked",
        nextLocalAction: "repair_failed_function_transport_step",
      },
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
