import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  repoRoot,
} from "../../../scripts/dev-hosted-local/constants.ts";
import {
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
} from "../../../scripts/dev-hosted-local/runtime.ts";
import {
  ForegroundCommandSignalError,
  runForegroundCommand,
} from "./process.ts";

export type HostedLocalE2eScenarioName =
  | "all"
  | "active-turn-latency"
  | "checkpoint-baseline"
  | "codex-container-continuity"
  | "codex-gateway-prefix"
  | "container-continuity"
  | "device-connect"
  | "idle-checkpoint-deferred-progress"
  | "mailbox-platform-env"
  | "linq-first-contact"
  | "linq-delivery"
  | "linq-scheduled-reminder"
  | "linq-webhook"
  | "runner-warm-reuse"
  | "snapshot-stress"
  | "stuck-invocation-recovery"
  | "telegram"
  | "telegram-first-contact"
  | "vault-persistence";

export interface HostedLocalE2eScenario {
  aliases?: readonly HostedLocalE2eScenarioName[];
  file: string;
  manualOnly?: boolean;
  name: Exclude<HostedLocalE2eScenarioName, "all">;
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
    file: "apps/cloudflare/test/hosted-local-device-connect-e2e.test.ts",
    name: "device-connect",
  },
  {
    file: "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    name: "idle-checkpoint-deferred-progress",
  },
  {
    file: "apps/cloudflare/test/hosted-local-mailbox-platform-env-e2e.test.ts",
    name: "mailbox-platform-env",
  },
  {
    aliases: ["linq-delivery"],
    file: "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    name: "linq-first-contact",
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    name: "linq-scheduled-reminder",
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
      await prepareHostedLocalRunnerBaseImage({ env: suiteEnv });
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
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: suiteEnv,
        ignoreErrors: true,
      });
      await cleanupHostedRunnerImages({
        cwd: repoRoot,
        env: suiteEnv,
        ignoreErrors: true,
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
    cwd: repoRoot,
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
    cwd: repoRoot,
    env: input.env,
    forwardProcessSignals: ["SIGINT", "SIGTERM"],
    label: "Hosted local runner base image preparation",
  });
  input.env.MURPH_DEV_SKIP_RUNNER_DOCKER_BASE = "1";
}

async function runHostedLocalVitest(input: {
  env: NodeJS.ProcessEnv;
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
      "--no-coverage",
    ],
    command: "pnpm",
    cwd: repoRoot,
    env: input.env,
    forwardProcessSignals: ["SIGINT", "SIGTERM"],
    label: "Hosted local full-stack e2e suite",
  });
}

function buildHostedLocalE2eSuiteEnv(input: {
  env: NodeJS.ProcessEnv;
  injectSkipRunnerBundleEnv: boolean;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS:
      input.env.HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?.trim() || "120000",
    MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]:
      input.env[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim()
      || input.env.MURPH_HOSTED_LOCAL_RUN_ID?.trim()
      || `hosted-local-e2e-${randomUUID()}`,
  };
  if (input.injectSkipRunnerBundleEnv) {
    env.MURPH_DEV_SKIP_RUNNER_BUNDLE = "1";
  }
  delete env.MURPH_DEV_CF_WRANGLER_LOG_LEVEL;
  return env;
}
