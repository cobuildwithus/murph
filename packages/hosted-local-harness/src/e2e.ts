import process from "node:process";

import { repoRoot } from "../../../scripts/dev-hosted-local/constants.ts";
import { cleanupHostedRunnerContainers } from "../../../scripts/dev-hosted-local/runtime.ts";
import { runForegroundCommand } from "./process.ts";

export type HostedLocalE2eScenarioName =
  | "all"
  | "checkpoint-baseline"
  | "codex-gateway-prefix"
  | "device-connect"
  | "mailbox-platform-env"
  | "linq-first-contact"
  | "linq-delivery"
  | "linq-scheduled-reminder"
  | "linq-webhook"
  | "telegram"
  | "telegram-first-contact";

export interface HostedLocalE2eScenario {
  aliases?: readonly HostedLocalE2eScenarioName[];
  file: string;
  manualOnly?: boolean;
  name: Exclude<HostedLocalE2eScenarioName, "all">;
  requiresParserToolchain?: boolean;
}

export const hostedLocalE2eScenarios: readonly HostedLocalE2eScenario[] = [
  {
    file: "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    name: "checkpoint-baseline",
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
): Promise<void> {
  const env = input.env ?? process.env;
  const scenarios = resolveHostedLocalE2eScenarios(input.scenario ?? "all");
  const prepareRunnerBundle = input.prepareRunnerBundle !== false;
  const injectSkipRunnerBundleEnv = input.injectSkipRunnerBundleEnv !== false;
  const vitestEnv = buildHostedLocalVitestEnv({
    env,
    injectSkipRunnerBundleEnv,
  });

  try {
    if (prepareRunnerBundle) {
      await prepareHostedLocalRunnerBundle({ env, scenarios });
    }
    await runHostedLocalVitest({ env: vitestEnv, scenarios });
  } finally {
    await cleanupHostedRunnerContainers({
      cwd: repoRoot,
      env: vitestEnv,
      ignoreErrors: true,
    });
  }
}

async function prepareHostedLocalRunnerBundle(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY:
      input.env.MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY ?? "1",
  };
  if (input.scenarios.some((scenario) => scenario.requiresParserToolchain)) {
    env.MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN = "1";
  }
  await runForegroundCommand({
    args: ["--dir", "apps/cloudflare", "runner:bundle:hosted-local"],
    command: "pnpm",
    cwd: repoRoot,
    env,
    label: "Hosted local runner bundle preparation",
  });
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
    label: "Hosted local full-stack e2e suite",
  });
}

function buildHostedLocalVitestEnv(input: {
  env: NodeJS.ProcessEnv;
  injectSkipRunnerBundleEnv: boolean;
}): NodeJS.ProcessEnv {
  if (!input.injectSkipRunnerBundleEnv) {
    return input.env;
  }

  const env: NodeJS.ProcessEnv = {
    ...input.env,
    MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
  };
  delete env.MURPH_DEV_CF_WRANGLER_LOG_LEVEL;
  return env;
}
