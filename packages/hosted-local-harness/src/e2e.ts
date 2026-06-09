import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  ForegroundCommandSignalError,
  runForegroundCommand,
} from "./process.ts";
import { hostedLocalHarnessRepoRoot } from "./repo.ts";

const HOSTED_RUNNER_LOCAL_BUILD_ID_ENV = "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID";
const HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV =
  "MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED";
const HEALTH_COMMONS_GENERATED_PREPARED_ENV = "MURPH_HEALTH_COMMONS_GENERATED_PREPARED";
const SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS = 60_000;
const FINAL_RUNNER_CLEANUP_TIMEOUT_MS = 60_000;

interface HostedLocalE2eRunnerCleanupOptions {
  ignoreRunnerCleanupErrors: boolean;
  removeRunnerImages: boolean;
  runnerCleanupTimeoutMs: number;
}

export type HostedLocalE2eScenarioName =
  | "all"
  | "active-turn-latency"
  | "checkpoint-baseline"
  | "codex-container-continuity"
  | "codex-gateway-prefix"
  | "codex-image-media-delivery"
  | "codex-long-thread"
  | "container-continuity"
  | "device-connect"
  | "device-sync-junction-wearable-direct-resource-replay"
  | "device-sync-wake"
  | "direct-r2-presigned-put"
  | "idle-checkpoint-deferred-progress"
  | "junction-wearable-fixture"
  | "mailbox-platform-env"
  | "linq-first-contact"
  | "linq-delivery"
  | "linq-onboarding-followup"
  | "linq-scheduled-reminder"
  | "linq-webhook"
  | "runner-warm-reuse"
  | "snapshot-stress"
  | "stuck-invocation-recovery"
  | "temporal-orchestration"
  | "telegram"
  | "telegram-first-contact"
  | "vault-persistence";

export interface HostedLocalE2eScenario {
  aliases?: readonly HostedLocalE2eScenarioName[];
  file: string;
  manualOnly?: boolean;
  name: Exclude<HostedLocalE2eScenarioName, "all">;
  processIsolation?: boolean;
  requiresParserToolchain?: boolean;
}

export const hostedLocalE2eScenarios: readonly HostedLocalE2eScenario[] = [
  {
    file: "apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts",
    manualOnly: true,
    name: "active-turn-latency",
  },
  {
    file: "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    name: "checkpoint-baseline",
  },
  {
    file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
    manualOnly: true,
    name: "container-continuity",
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts",
    manualOnly: true,
    name: "codex-container-continuity",
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-gateway-prefix-e2e.test.ts",
    manualOnly: true,
    name: "codex-gateway-prefix",
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-image-media-delivery-e2e.test.ts",
    name: "codex-image-media-delivery",
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-long-thread-e2e.test.ts",
    manualOnly: true,
    name: "codex-long-thread",
  },
  {
    file: "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
    name: "device-connect",
  },
  {
    file: "apps/cloudflare/test/hosted-local-device-sync-wake-e2e.test.ts",
    manualOnly: true,
    name: "device-sync-wake",
  },
  {
    file: "apps/cloudflare/test/hosted-local-device-sync-junction-wearable-direct-resource-replay-e2e.test.ts",
    manualOnly: true,
    name: "device-sync-junction-wearable-direct-resource-replay",
    processIsolation: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
    name: "direct-r2-presigned-put",
  },
  {
    file: "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    name: "idle-checkpoint-deferred-progress",
  },
  {
    file: "apps/cloudflare/test/hosted-local-junction-wearable-fixture-e2e.test.ts",
    manualOnly: true,
    name: "junction-wearable-fixture",
  },
  {
    file: "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
    name: "mailbox-platform-env",
  },
  {
    file: "apps/cloudflare/test/hosted-local-temporal-orchestration-e2e.test.ts",
    name: "temporal-orchestration",
  },
  {
    aliases: ["linq-delivery"],
    file: "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    name: "linq-first-contact",
  },
  {
    file: "apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts",
    name: "linq-onboarding-followup",
    processIsolation: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    name: "linq-scheduled-reminder",
    processIsolation: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    name: "linq-webhook",
    requiresParserToolchain: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-runner-warm-auth-recovery-e2e.test.ts",
    manualOnly: true,
    name: "runner-warm-reuse",
  },
  {
    file: "apps/cloudflare/test/hosted-local-snapshot-stress-e2e.test.ts",
    manualOnly: true,
    name: "snapshot-stress",
  },
  {
    file: "apps/cloudflare/test/hosted-local-stuck-invocation-recovery-e2e.test.ts",
    manualOnly: true,
    name: "stuck-invocation-recovery",
  },
  {
    file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
    manualOnly: true,
    name: "vault-persistence",
  },
  {
    aliases: ["telegram"],
    file: "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
    name: "telegram-first-contact",
  },
] as const;

export interface HostedLocalE2eSuiteInput {
  env?: NodeJS.ProcessEnv;
  injectSkipRunnerBundleEnv?: boolean;
  prepareRunnerBundle?: boolean;
  scenario?: HostedLocalE2eScenarioName | string;
}

export interface HostedLocalE2eSuiteResult {
  terminationSignal: NodeJS.Signals | null;
}

export function resolveHostedLocalE2eScenarios(
  scenarioName: HostedLocalE2eScenarioName | string | null | undefined,
): readonly HostedLocalE2eScenario[] {
  const normalized = (scenarioName?.trim() || "all") as HostedLocalE2eScenarioName;
  if (normalized === "all") {
    return hostedLocalE2eScenarios.filter((scenario) => scenario.manualOnly !== true);
  }
  const scenario = hostedLocalE2eScenarios.find(
    (entry) => entry.name === normalized || entry.aliases?.includes(normalized),
  );
  if (!scenario) {
    throw new Error(
      [
        `Unsupported hosted-local E2E scenario: ${JSON.stringify(scenarioName)}`,
        `Supported scenarios: all, ${hostedLocalE2eScenarios
          .flatMap((entry) => [entry.name, ...(entry.aliases ?? [])])
          .join(", ")}`,
      ].join("\n"),
    );
  }
  return [scenario];
}

export function listHostedLocalE2eScenarios(): readonly HostedLocalE2eScenario[] {
  return hostedLocalE2eScenarios;
}

export async function runHostedLocalE2eSuite(
  input: HostedLocalE2eSuiteInput = {},
): Promise<HostedLocalE2eSuiteResult> {
  const env = input.env ?? process.env;
  const scenarios = resolveHostedLocalE2eScenarios(input.scenario ?? "all");
  const prepareRunnerBundle = input.prepareRunnerBundle !== false;
  const injectSkipRunnerBundleEnv = input.injectSkipRunnerBundleEnv !== false;
  const suiteEnv = buildHostedLocalE2eSuiteEnv({
    env,
    injectSkipRunnerBundleEnv,
  });
  let terminationSignal: NodeJS.Signals | null = null;
  const onSigint = (): void => {
    terminationSignal ??= "SIGINT";
  };
  const onSigterm = (): void => {
    terminationSignal ??= "SIGTERM";
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    try {
      if (prepareRunnerBundle) {
        await prepareHostedLocalRunnerBundle({ env: suiteEnv, scenarios });
      }
      prepareHostedLocalRunnerSmokeEnv({ env: suiteEnv, scenarios });
      await prepareHostedLocalRunnerBaseImage({ env: suiteEnv });
      await prepareHostedLocalWebGeneratedArtifacts({ env: suiteEnv, scenarios });
      await runHostedLocalVitest({ env: suiteEnv, scenarios });
    } catch (error) {
      if (
        !terminationSignal
        || !(error instanceof ForegroundCommandSignalError)
        || error.commandSignal !== terminationSignal
      ) {
        throw error;
      }
    }
  } finally {
    try {
      await cleanupHostedLocalE2eRunnerArtifacts(suiteEnv, {
        ignoreRunnerCleanupErrors: true,
        removeRunnerImages: true,
        runnerCleanupTimeoutMs: FINAL_RUNNER_CLEANUP_TIMEOUT_MS,
      });
      if (terminationSignal) {
        process.exitCode = terminationSignal === "SIGINT" ? 130 : 143;
      }
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  }

  return { terminationSignal };
}

async function prepareHostedLocalRunnerBundle(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY:
      input.env.MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY ?? "1",
    MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS: "1",
  };
  if (input.scenarios.some((scenario) => scenario.requiresParserToolchain)) {
    env.MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN = "1";
  }
  await runForegroundCommand({
    args: ["--dir", "apps/cloudflare", "runner:bundle:hosted-local"],
    command: "pnpm",
    cwd: hostedLocalHarnessRepoRoot,
    env,
    forwardProcessSignals: ["SIGINT", "SIGTERM"],
    label: "Hosted local runner bundle preparation",
  });
}

async function prepareHostedLocalRunnerBaseImage(input: {
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  await runForegroundCommand({
    args: ["--dir", "apps/cloudflare", "runner:docker:base"],
    command: "pnpm",
    cwd: hostedLocalHarnessRepoRoot,
    env: input.env,
    forwardProcessSignals: ["SIGINT", "SIGTERM"],
    label: "Hosted local runner base image preparation",
  });
  input.env.MURPH_DEV_SKIP_RUNNER_DOCKER_BASE = "1";
}

function prepareHostedLocalRunnerSmokeEnv(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): void {
  if (input.scenarios.length <= 1) {
    return;
  }

  input.env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV] = "1";
}

async function prepareHostedLocalWebGeneratedArtifacts(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  if (input.scenarios.length <= 1) {
    return;
  }

  if (input.env[HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV] !== "1") {
    await runForegroundCommand({
      args: ["--dir", "apps/web", "prisma:generate"],
      command: "pnpm",
      cwd: hostedLocalHarnessRepoRoot,
      env: input.env,
      forwardProcessSignals: ["SIGINT", "SIGTERM"],
      label: "Hosted local web Prisma client preparation",
    });
    input.env[HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV] = "1";
  }

  if (input.env[HEALTH_COMMONS_GENERATED_PREPARED_ENV] !== "1") {
    await runForegroundCommand({
      args: ["health-commons:generate"],
      command: "pnpm",
      cwd: hostedLocalHarnessRepoRoot,
      env: input.env,
      forwardProcessSignals: ["SIGINT", "SIGTERM"],
      label: "Hosted local Health Commons generation",
    });
    input.env[HEALTH_COMMONS_GENERATED_PREPARED_ENV] = "1";
  }
}

async function runHostedLocalVitest(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  if (input.scenarios.length === 1) {
    const [scenario] = input.scenarios;
    await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
      ignoreRunnerCleanupErrors: false,
      removeRunnerImages: false,
      runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
    });
    try {
      await runHostedLocalVitestForScenarios({
        env: input.env,
        label: [
          "Hosted local full-stack e2e scenario",
          `1/${input.scenarios.length}`,
          scenario.name,
        ].join(" "),
        scenarios: [scenario],
      });
    } finally {
      await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
        ignoreRunnerCleanupErrors: true,
        removeRunnerImages: false,
        runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
      });
    }
    return;
  }

  await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
    ignoreRunnerCleanupErrors: false,
    removeRunnerImages: false,
    runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
  });
  try {
    const batches = buildHostedLocalVitestBatches(input.scenarios);
    for (let index = 0; index < batches.length; index += 1) {
      const scenarios = batches[index] ?? [];
      await runHostedLocalVitestForScenarios({
        env: buildHostedLocalVitestBatchEnv({
          env: input.env,
          scenarios,
        }),
        label: formatHostedLocalVitestBatchLabel({
          batchCount: batches.length,
          batchIndex: index,
          scenarios,
        }),
        scenarios,
      });
      if (index < batches.length - 1) {
        await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
          ignoreRunnerCleanupErrors: true,
          removeRunnerImages: false,
          runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
        });
      }
    }
  } finally {
    await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
      ignoreRunnerCleanupErrors: true,
      removeRunnerImages: false,
      runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
    });
  }
}

function buildHostedLocalVitestBatches(
  scenarios: readonly HostedLocalE2eScenario[],
): HostedLocalE2eScenario[][] {
  const batches: HostedLocalE2eScenario[][] = [];
  let currentBatch: HostedLocalE2eScenario[] = [];

  for (const scenario of scenarios) {
    if (scenario.processIsolation) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
      }
      batches.push([scenario]);
      continue;
    }

    currentBatch.push(scenario);
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function formatHostedLocalVitestBatchLabel(input: {
  batchCount: number;
  batchIndex: number;
  scenarios: readonly HostedLocalE2eScenario[];
}): string {
  const prefix = input.batchCount > 1
    ? `${input.batchIndex + 1}/${input.batchCount}`
    : "1/1";

  if (input.scenarios.length === 1) {
    return [
      "Hosted local full-stack e2e scenario",
      prefix,
      input.scenarios[0]?.name ?? "unknown",
    ].join(" ");
  }

  return [
    "Hosted local full-stack e2e suite",
    prefix,
  ].join(" ");
}

function buildHostedLocalVitestBatchEnv(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): NodeJS.ProcessEnv {
  if (!input.scenarios.some((scenario) => scenario.processIsolation)) {
    return input.env;
  }

  const env = { ...input.env };
  delete env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV];
  delete env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV];
  return env;
}

async function runHostedLocalVitestForScenarios(input: {
  env: NodeJS.ProcessEnv;
  label: string;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  await runForegroundCommand({
    args: [
      "exec",
      "vitest",
      "run",
      "--config",
      "apps/cloudflare/vitest.e2e.config.ts",
      ...input.scenarios.map((scenario) => scenario.file),
      ...(input.scenarios.length > 1 ? ["--bail", "1"] : []),
      "--no-coverage",
    ],
    command: "pnpm",
    cwd: hostedLocalHarnessRepoRoot,
    env: input.env,
    forwardProcessSignals: ["SIGINT", "SIGTERM"],
    label: input.label,
  });
}

function buildHostedLocalE2eSuiteEnv(input: {
  env: NodeJS.ProcessEnv;
  injectSkipRunnerBundleEnv: boolean;
}): NodeJS.ProcessEnv {
  const localBuildId =
    input.env[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim()
    || input.env.MURPH_HOSTED_LOCAL_RUN_ID?.trim()
    || `hosted-local-e2e-${randomUUID()}`;
  const e2eDefaults = buildHostedLocalE2eIsolationDefaults({
    env: input.env,
    localBuildId,
  });
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    ...e2eDefaults,
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: localBuildId,
  };
  if (input.injectSkipRunnerBundleEnv) {
    env.MURPH_DEV_SKIP_RUNNER_BUNDLE = "1";
  }
  delete env.MURPH_DEV_CF_WRANGLER_LOG_LEVEL;
  return env;
}

function buildHostedLocalE2eIsolationDefaults(input: {
  env: NodeJS.ProcessEnv;
  localBuildId: string;
}): NodeJS.ProcessEnv {
  const offset = buildHostedLocalE2ePortOffset(input.localBuildId);
  const suffix = buildHostedLocalE2eSafeSuffix(input.localBuildId);
  return {
    MURPH_DEV_CF_PERSIST_DIR:
      input.env.MURPH_DEV_CF_PERSIST_DIR?.trim()
      || `.tmp/hosted-local-e2e/${suffix}/wrangler`,
    MURPH_DEV_WEB_PORT:
      input.env.MURPH_DEV_WEB_PORT?.trim()
      || String(30_000 + offset),
    MURPH_DEV_WORKER_PORT:
      input.env.MURPH_DEV_WORKER_PORT?.trim()
      || String(40_000 + offset),
    NEXT_DIST_DIR_MODE:
      input.env.NEXT_DIST_DIR_MODE?.trim()
      || "smoke",
    NEXT_DIST_DIR_SUFFIX:
      input.env.NEXT_DIST_DIR_SUFFIX?.trim()
      || `e2e-${suffix}`,
  };
}

function buildHostedLocalE2ePortOffset(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = ((hash * 33) + char.charCodeAt(0)) >>> 0;
  }
  return hash % 10_000;
}

function buildHostedLocalE2eSafeSuffix(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 80) || "run";
}

async function cleanupHostedLocalE2eRunnerArtifacts(
  env: NodeJS.ProcessEnv,
  options: HostedLocalE2eRunnerCleanupOptions,
): Promise<void> {
  const {
    cleanupHostedLocalOrphanedWorkerdProcesses,
    cleanupHostedRunnerContainers,
    cleanupHostedRunnerImages,
  } =
    await import("./dev-hosted-local/runtime.ts");
  const {
    cleanupHostedLocalMinioBuildContainersBestEffort,
    cleanupHostedLocalMinioE2eContainersBestEffort,
  } =
    await import("./dev-hosted-local/minio.ts");

  cleanupHostedLocalOrphanedWorkerdProcesses();
  await cleanupHostedRunnerContainers({
    cwd: hostedLocalHarnessRepoRoot,
    env,
    ignoreErrors: options.ignoreRunnerCleanupErrors,
    scope: "current-build",
    timeoutMs: options.runnerCleanupTimeoutMs,
  });
  if (options.removeRunnerImages) {
    await cleanupHostedRunnerImages({
      cwd: hostedLocalHarnessRepoRoot,
      env,
      ignoreErrors: true,
      timeoutMs: options.runnerCleanupTimeoutMs,
    });
  }
  const buildId = env[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim();
  if (buildId) {
    await cleanupHostedLocalMinioBuildContainersBestEffort(env, buildId);
  }
  await cleanupHostedLocalMinioE2eContainersBestEffort(env);
}
