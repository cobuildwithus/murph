import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION =
  "murph-age-r603-autoresearch-loop-runner.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_OUTPUT_DIR = DEFAULT_MODEL_RUNS_DIR;

type R603StepId =
  | "r399-midus2-biomarker-increment"
  | "r399-midus-refresher-biomarker-increment"
  | "r602-small-candidate-packet"
  | "r399-layering-readiness";

type R603StepStatus = "completed" | "failed" | "skipped";

export interface R603AutoresearchLoopRunnerOptions {
  command?: string;
  createdAt?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outputDir?: string;
  scriptRunnerArgs?: string[];
}

export interface R603LoopPlanStep {
  args: string[];
  env: Record<string, string>;
  expectedArtifact: string;
  id: R603StepId;
}

export interface R603LoopPlan {
  command: string;
  productPromotionAuthorized: false;
  steps: R603LoopPlanStep[];
}

export interface R603LoopStepSummary {
  artifact: string | null;
  status: R603StepStatus;
  stepId: R603StepId;
}

export interface R603LoopRunSummary {
  productPromotionAuthorized: false;
  schemaVersion: typeof R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION;
  status: "completed" | "blocked";
  steps: R603LoopStepSummary[];
}

export type R603StepExecutor = (
  step: R603LoopPlanStep,
  context: { command: string; cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ exitCode: number; stdout: string }>;

export function buildR603AutoresearchLoopPlan(
  options: R603AutoresearchLoopRunnerOptions = {},
): R603LoopPlan {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const runnerArgs = options.scriptRunnerArgs ?? ["exec", "tsx"];
  const midus2Artifact = "r399-midus2-biomarker-increment.latest.json";
  const midusRefresherArtifact = "r399-midus-refresher-biomarker-increment.latest.json";

  return {
    command: options.command ?? "pnpm",
    productPromotionAuthorized: false,
    steps: [
      {
        args: [...runnerArgs, "scripts/murph-age/r399-midus2-biomarker-increment.ts"],
        env: {
          MURPH_AGE_MIDUS_COHORT: "midus2",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
        expectedArtifact: midus2Artifact,
        id: "r399-midus2-biomarker-increment",
      },
      {
        args: [...runnerArgs, "scripts/murph-age/r399-midus2-biomarker-increment.ts"],
        env: {
          MURPH_AGE_MIDUS_COHORT: "midus-refresher",
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
        expectedArtifact: midusRefresherArtifact,
        id: "r399-midus-refresher-biomarker-increment",
      },
      {
        args: [...runnerArgs, "scripts/murph-age/r602-small-candidate-batch-packet.ts"],
        env: {
          MURPH_AGE_MIDUS2_INCREMENT_PATH: path.join(outputDir, midus2Artifact),
          MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH: path.join(outputDir, midusRefresherArtifact),
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
        expectedArtifact: "r602-small-candidate-batch-packet.latest.json",
        id: "r602-small-candidate-packet",
      },
      {
        args: [...runnerArgs, "scripts/murph-age/r399-layering-readiness.ts"],
        env: {
          MURPH_AGE_MIDUS2_OUTPUT_PATH: path.join(outputDir, midus2Artifact),
          MURPH_AGE_MIDUS_REFRESHER_OUTPUT_PATH: path.join(outputDir, midusRefresherArtifact),
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
        expectedArtifact: "r399-layering-readiness.latest.json",
        id: "r399-layering-readiness",
      },
    ],
  };
}

export async function runR603AutoresearchLoopRunner(
  options: R603AutoresearchLoopRunnerOptions = {},
  executeStep: R603StepExecutor = spawnR603Step,
): Promise<R603LoopRunSummary> {
  const plan = buildR603AutoresearchLoopPlan(options);
  const cwd = options.cwd ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const steps: R603LoopStepSummary[] = [];
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
    productPromotionAuthorized: false,
    schemaVersion: R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION,
    status: blocked ? "blocked" : "completed",
    steps,
  };
}

async function spawnR603Step(
  step: R603LoopPlanStep,
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
  runR603AutoresearchLoopRunner({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status !== "completed") process.exitCode = 1;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      productPromotionAuthorized: false,
      schemaVersion: R603_AUTORESEARCH_LOOP_RUNNER_SCHEMA_VERSION,
      status: "blocked",
      steps: [],
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
