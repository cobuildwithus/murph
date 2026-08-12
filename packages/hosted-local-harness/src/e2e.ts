import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  removeHostedLocalWebAuthorityFromProcessEnvironment,
  sanitizeHostedLocalGenericEnvironment,
} from "./authority-env.ts";
import {
  ForegroundCommandSignalError,
  runForegroundCommand,
} from "./process.ts";
import { hostedLocalHarnessRepoRoot } from "./repo.ts";
import {
  HOSTED_STRIPE_BILLING_LIVE_SCENARIO,
  partitionHostedStripeBillingLiveEnvironment,
} from "./stripe-billing-live-config.ts";

const HOSTED_RUNNER_LOCAL_BUILD_ID_ENV = "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID";
const HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV =
  "MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED";
const HEALTH_COMMONS_GENERATED_PREPARED_ENV = "MURPH_HEALTH_COMMONS_GENERATED_PREPARED";
const SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS = 60_000;
const HOSTED_LOCAL_E2E_TEST_CONTROLS_ENV =
  "MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS";
const FINAL_RUNNER_CLEANUP_TIMEOUT_MS = 60_000;
const JUNCTION_WEARABLE_LIVE_ENV = "MURPH_E2E_JUNCTION_WEARABLE_LIVE";
const JUNCTION_WEARABLE_RETIRED_ENV_KEYS = [
  "MURPH_E2E_OURA_PASSWORD",
] as const;
const JUNCTION_WEARABLE_LIVE_ENV_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_REGION",
  JUNCTION_WEARABLE_LIVE_ENV,
  "MURPH_E2E_JUNCTION_OURA_MEMBER_ID",
  "MURPH_E2E_JUNCTION_WEARABLE_SOURCES",
  "MURPH_E2E_JUNCTION_WHOOP_MEMBER_ID",
  "MURPH_E2E_OURA_EMAIL",
  "MURPH_E2E_OURA_OTP",
  "MURPH_E2E_WHOOP_EMAIL",
  "MURPH_E2E_WHOOP_OTP",
  "MURPH_E2E_WHOOP_PASSWORD",
  "MURPH_E2E_WEARABLE_HEADLESS",
  "MURPH_E2E_WEARABLE_TIMEOUT_MS",
] as const;

interface HostedLocalE2eRunnerCleanupOptions {
  ignoreRunnerCleanupErrors: boolean;
  removeRunnerImages: boolean;
  runnerCleanupTimeoutMs: number;
}

export type HostedLocalE2eScenarioName =
  | "all"
  | "active-turn-latency"
  | "canonical-receipt-lost-ack-recovery"
  | "checkpoint-baseline"
  | "cold-start-benchmark"
  | "codex-container-continuity"
  | "codex-gateway-prefix"
  | "codex-image-media-delivery"
  | "codex-long-thread"
  | "computer-handoff-linq-roundtrip"
  | "container-continuity"
  | "device-connect"
  | "device-sync-junction-wearable-direct-resource-replay"
  | "device-sync-wake"
  | "direct-r2-presigned-put"
  | "family-sponsored-group-roundtrip"
  | "group-email-newsletter"
  | "group-sleep-source-sharing"
  | "foreground-reply-priority"
  | "hosted-web-browser-smoke"
  | "idle-checkpoint-deferred-progress"
  | "junction-link-connect"
  | "junction-wearable-fixture"
  | "mailbox-platform-env"
  | "linq-first-contact"
  | "linq-group-ios-app-download"
  | "linq-group-route-drift"
  | "linq-home-line-reroute-retry"
  | "linq-unknown-first-contact-fallback"
  | "openai-egress-authority"
  | "provider-egress-token-bridge"
  | "retell-call-result-roundtrip"
  | "retryable-outbox-foreground-restart"
  | "shutdown-checkpoint-conversation-ahead"
  | "warm-reuse-egress"
  | "linq-delivery"
  | "linq-lost-active-operation"
  | "linq-onboarding-followup"
  | "linq-first-contact-test-controls"
  | "linq-scheduled-reminder"
  | "linq-same-wake-batching"
  | "linq-webhook"
  | "linq-webhook-audio"
  | "runner-warm-reuse"
  | "snapshot-publication-fallback"
  | "snapshot-stress"
  | "stripe-billing-browser-matrix"
  | "stuck-invocation-recovery"
  | "timezone-injection"
  | "usage-limit-ambiguous-send"
  | "temporal-orchestration"
  | "telegram"
  | "telegram-first-contact"
  | "telegram-scheduled-reminder"
  | "vault-file-approval-resume"
  | "vault-persistence";

export type HostedLocalE2eScenarioSelection = string | readonly string[];

export interface HostedLocalE2eScenario {
  aliases?: readonly HostedLocalE2eScenarioName[];
  file: string;
  dedicatedVitestProcess?: boolean;
  manualOnly?: boolean;
  name: Exclude<HostedLocalE2eScenarioName, "all">;
  requiresParserToolchain?: boolean;
  /**
   * Run one matching suite per Vitest process when a scenario needs multiple
   * process-scoped full-stack profiles from the same test file.
   */
  vitestProcessTestNamePatterns?: readonly [string, ...string[]];
  /**
   * Normal hosted E2E scenarios run the production Worker/Runner/UserRunner
   * graph. Set this only for deliberate fault-injection scenarios that need
   * hosted-local test RPCs such as active-operation drop, activity expiry, or
   * stuck-invocation setup.
   */
  testControls?: boolean;
}

export const hostedLocalE2eScenarios: readonly HostedLocalE2eScenario[] = [
  {
    file: "apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts",
    manualOnly: true,
    name: "active-turn-latency",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts",
    name: "checkpoint-baseline",
  },
  {
    file: "apps/cloudflare/test/hosted-local-cold-start-benchmark-e2e.test.ts",
    manualOnly: true,
    name: "cold-start-benchmark",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts",
    manualOnly: true,
    name: "container-continuity",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts",
    manualOnly: true,
    name: "codex-container-continuity",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-gateway-prefix-e2e.test.ts",
    manualOnly: true,
    name: "codex-gateway-prefix",
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
    dedicatedVitestProcess: true,
    file: "apps/cloudflare/test/hosted-local-web-browser-smoke-e2e.test.ts",
    manualOnly: true,
    name: "hosted-web-browser-smoke",
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
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-direct-r2-presigned-put-e2e.test.ts",
    name: "direct-r2-presigned-put",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-canonical-receipt-lost-ack-recovery-e2e.test.ts",
    name: "canonical-receipt-lost-ack-recovery",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts",
    name: "idle-checkpoint-deferred-progress",
    testControls: true,
  },
  {
    dedicatedVitestProcess: true,
    file: "apps/cloudflare/test/hosted-local-group-email-newsletter-e2e.test.ts",
    name: "group-email-newsletter",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-group-sleep-source-sharing-e2e.test.ts",
    name: "group-sleep-source-sharing",
  },
  {
    file: "apps/cloudflare/test/hosted-local-junction-link-connect-e2e.test.ts",
    name: "junction-link-connect",
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
    file: "apps/cloudflare/test/hosted-local-timezone-injection-e2e.test.ts",
    name: "timezone-injection",
  },
  {
    aliases: ["linq-delivery"],
    file: "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    name: "linq-first-contact",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-linq-group-ios-app-download-e2e.test.ts",
    manualOnly: true,
    name: "linq-group-ios-app-download",
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts",
    name: "linq-group-route-drift",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-linq-home-line-reroute-retry-e2e.test.ts",
    name: "linq-home-line-reroute-retry",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-family-sponsored-group-roundtrip-e2e.test.ts",
    name: "family-sponsored-group-roundtrip",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-linq-unknown-first-contact-fallback-e2e.test.ts",
    name: "linq-unknown-first-contact-fallback",
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
    name: "linq-first-contact-test-controls",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-lost-active-operation-e2e.test.ts",
    manualOnly: true,
    name: "linq-lost-active-operation",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts",
    name: "linq-onboarding-followup",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-openai-egress-authority-e2e.test.ts",
    name: "openai-egress-authority",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-provider-egress-token-bridge-e2e.test.ts",
    name: "provider-egress-token-bridge",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-warm-reuse-egress-e2e.test.ts",
    name: "warm-reuse-egress",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts",
    name: "linq-scheduled-reminder",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts",
    name: "telegram-scheduled-reminder",
    dedicatedVitestProcess: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-webhook-audio-e2e.test.ts",
    name: "linq-webhook-audio",
    requiresParserToolchain: true,
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
    name: "linq-webhook",
    requiresParserToolchain: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-linq-same-wake-batching-e2e.test.ts",
    name: "linq-same-wake-batching",
  },
  {
    file: "apps/cloudflare/test/hosted-local-runner-warm-auth-recovery-e2e.test.ts",
    manualOnly: true,
    name: "runner-warm-reuse",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-snapshot-stress-e2e.test.ts",
    manualOnly: true,
    name: "snapshot-stress",
    testControls: true,
  },
  {
    dedicatedVitestProcess: true,
    file:
      "apps/cloudflare/test/hosted-local-stripe-billing-browser-e2e.test.ts",
    manualOnly: true,
    name: HOSTED_STRIPE_BILLING_LIVE_SCENARIO,
  },
  {
    file: "apps/cloudflare/test/hosted-local-stuck-invocation-recovery-e2e.test.ts",
    manualOnly: true,
    name: "stuck-invocation-recovery",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts",
    manualOnly: true,
    name: "vault-persistence",
    testControls: true,
  },
  {
    aliases: ["telegram"],
    file: "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
    name: "telegram-first-contact",
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-snapshot-publication-fallback-e2e.test.ts",
    name: "snapshot-publication-fallback",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-computer-handoff-linq-roundtrip-e2e.test.ts",
    name: "computer-handoff-linq-roundtrip",
  },
  {
    file: "apps/cloudflare/test/hosted-local-retell-call-result-roundtrip-e2e.test.ts",
    name: "retell-call-result-roundtrip",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-usage-limit-ambiguous-send-e2e.test.ts",
    name: "usage-limit-ambiguous-send",
  },
  {
    file: "apps/cloudflare/test/hosted-local-codex-image-media-delivery-e2e.test.ts",
    name: "codex-image-media-delivery",
    testControls: true,
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-retryable-outbox-foreground-restart-e2e.test.ts",
    name: "retryable-outbox-foreground-restart",
    testControls: true,
  },
  {
    file:
      "apps/cloudflare/test/hosted-local-shutdown-checkpoint-conversation-ahead-e2e.test.ts",
    name: "shutdown-checkpoint-conversation-ahead",
    testControls: true,
  },
  {
    file: "apps/cloudflare/test/hosted-local-vault-file-approval-resume-e2e.test.ts",
    name: "vault-file-approval-resume",
    testControls: true,
  },
  {
    dedicatedVitestProcess: true,
    file: "apps/cloudflare/test/hosted-local-foreground-reply-priority-e2e.test.ts",
    name: "foreground-reply-priority",
    testControls: true,
    vitestProcessTestNamePatterns: [
      "^hosted local foreground reply priority e2e",
      "^hosted local foreground checkpoint ordering e2e",
    ],
  },
] as const;

export interface HostedLocalE2eSuiteInput {
  env?: NodeJS.ProcessEnv;
  injectSkipRunnerBundleEnv?: boolean;
  prepareRunnerBundle?: boolean;
  scenario?: HostedLocalE2eScenarioSelection;
}

export interface HostedLocalE2eSuiteResult {
  terminationSignal: NodeJS.Signals | null;
}

export function resolveHostedLocalE2eScenarios(
  selection: HostedLocalE2eScenarioSelection | null | undefined,
): readonly HostedLocalE2eScenario[] {
  const requestedNames = (typeof selection === "string" ? [selection] : selection ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const normalizedNames = requestedNames.length > 0 ? requestedNames : ["all"];

  if (normalizedNames.includes("all")) {
    if (normalizedNames.length > 1) {
      throw new Error("The hosted-local E2E 'all' selection cannot be combined with named scenarios.");
    }
    return hostedLocalE2eScenarios.filter((scenario) => scenario.manualOnly !== true);
  }

  const resolved: HostedLocalE2eScenario[] = [];
  const seenNames = new Set<HostedLocalE2eScenario["name"]>();
  for (const normalized of normalizedNames) {
    const scenario = hostedLocalE2eScenarios.find(
      (entry) => entry.name === normalized
        || entry.aliases?.some((alias) => alias === normalized),
    );
    if (!scenario) {
      throw new Error(
        [
          `Unsupported hosted-local E2E scenario: ${JSON.stringify(normalized)}`,
          `Supported scenarios: all, ${hostedLocalE2eScenarios
            .flatMap((entry) => [entry.name, ...(entry.aliases ?? [])])
            .join(", ")}`,
        ].join("\n"),
      );
    }
    if (seenNames.has(scenario.name)) {
      throw new Error(
        `Duplicate hosted-local E2E scenario selection: ${JSON.stringify(normalized)}`,
      );
    }
    seenNames.add(scenario.name);
    resolved.push(scenario);
  }
  return resolved;
}

export function listHostedLocalE2eScenarios(): readonly HostedLocalE2eScenario[] {
  return hostedLocalE2eScenarios;
}

function partitionLiveWearableEnvironment(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): {
  genericEnv: NodeJS.ProcessEnv;
  vitestEnvOverlay: NodeJS.ProcessEnv;
} {
  if (input.env[JUNCTION_WEARABLE_LIVE_ENV] !== "1") {
    return { genericEnv: input.env, vitestEnvOverlay: {} };
  }
  if (input.scenarios.length !== 1 || input.scenarios[0]?.name !== "device-connect") {
    throw new Error(
      "Run the live Junction wearable browser proof by itself: pnpm hosted-local e2e device-connect.",
    );
  }

  const genericEnv = { ...input.env };
  const vitestEnvOverlay: NodeJS.ProcessEnv = {};
  for (const key of JUNCTION_WEARABLE_RETIRED_ENV_KEYS) {
    delete genericEnv[key];
  }
  for (const key of JUNCTION_WEARABLE_LIVE_ENV_KEYS) {
    const value = genericEnv[key];
    if (value !== undefined) {
      vitestEnvOverlay[key] = value;
    }
    delete genericEnv[key];
  }
  return { genericEnv, vitestEnvOverlay };
}

export async function runHostedLocalE2eSuite(
  input: HostedLocalE2eSuiteInput = {},
): Promise<HostedLocalE2eSuiteResult> {
  const env = sanitizeHostedLocalGenericEnvironment(input.env ?? process.env);
  removeHostedLocalWebAuthorityFromProcessEnvironment();
  const scenarios = resolveHostedLocalE2eScenarios(input.scenario ?? "all");
  const liveWearableEnvironment = partitionLiveWearableEnvironment({ env, scenarios });
  const liveStripeEnvironment = partitionHostedStripeBillingLiveEnvironment({
    environment: liveWearableEnvironment.genericEnv,
    selectedScenarioNames: scenarios.map((scenario) => scenario.name),
  });
  const prepareRunnerBundle = input.prepareRunnerBundle !== false;
  const injectSkipRunnerBundleEnv = input.injectSkipRunnerBundleEnv !== false;
  const suiteEnv = buildHostedLocalE2eSuiteEnv({
    env: liveStripeEnvironment.genericEnvironment,
    injectSkipRunnerBundleEnv,
  });
  let terminationSignal: NodeJS.Signals | null = null;
  const onSigint = (): void => {
    terminationSignal ??= "SIGINT";
  };
  const onSigterm = (): void => {
    terminationSignal ??= "SIGTERM";
  };
  const onSighup = (): void => {
    terminationSignal ??= "SIGHUP";
  };
  const assertWorkAdmission = (): void => {
    if (terminationSignal) {
      throw new ForegroundCommandSignalError(
        "Hosted local E2E suite",
        terminationSignal,
      );
    }
  };
  const runAdmittedStep = async (run: () => Promise<void>): Promise<void> => {
    assertWorkAdmission();
    await run();
    assertWorkAdmission();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  if (process.platform !== "win32") {
    process.on("SIGHUP", onSighup);
  }

  try {
    try {
      if (prepareRunnerBundle) {
        await runAdmittedStep(async () => {
          await prepareHostedLocalRunnerBundle({ env: suiteEnv, scenarios });
        });
      }
      assertWorkAdmission();
      prepareHostedLocalRunnerSmokeEnv(suiteEnv);
      await runAdmittedStep(async () => {
        await prepareHostedLocalRunnerBaseImage({ env: suiteEnv });
      });
      await runAdmittedStep(async () => {
        await prepareHostedLocalWebGeneratedArtifacts({
          assertWorkAdmission,
          env: suiteEnv,
          scenarios,
        });
      });
      await runAdmittedStep(async () => {
        await runHostedLocalVitest({
          assertWorkAdmission,
          env: suiteEnv,
          scenarios,
          vitestEnvOverlay: {
            ...liveWearableEnvironment.vitestEnvOverlay,
            ...liveStripeEnvironment.scenarioEnvironment,
          },
        });
      });
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
        process.exitCode = foregroundSignalExitCode(terminationSignal);
      }
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (process.platform !== "win32") {
        process.off("SIGHUP", onSighup);
      }
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
    label: "Hosted local runner base image preparation",
  });
  input.env.MURPH_DEV_SKIP_RUNNER_DOCKER_BASE = "1";
}

function prepareHostedLocalRunnerSmokeEnv(env: NodeJS.ProcessEnv): void {
  // The suite owns final current-build image cleanup, so every non-isolated
  // stack in this invocation can reuse the same proved image and smoke proof.
  env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV] = "1";
}

async function prepareHostedLocalWebGeneratedArtifacts(input: {
  assertWorkAdmission: () => void;
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): Promise<void> {
  if (input.scenarios.length <= 1) {
    return;
  }

  if (input.env[HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV] !== "1") {
    input.assertWorkAdmission();
    await runForegroundCommand({
      args: ["--dir", "apps/web", "prisma:generate"],
      command: "pnpm",
      cwd: hostedLocalHarnessRepoRoot,
      env: input.env,
      label: "Hosted local web Prisma client preparation",
    });
    input.env[HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV] = "1";
  }

  if (input.env[HEALTH_COMMONS_GENERATED_PREPARED_ENV] !== "1") {
    input.assertWorkAdmission();
    await runForegroundCommand({
      args: ["health-commons:generate"],
      command: "pnpm",
      cwd: hostedLocalHarnessRepoRoot,
      env: input.env,
      label: "Hosted local Health Commons generation",
    });
    input.env[HEALTH_COMMONS_GENERATED_PREPARED_ENV] = "1";
  }
}

async function runHostedLocalVitest(input: {
  assertWorkAdmission: () => void;
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
  vitestEnvOverlay: NodeJS.ProcessEnv;
}): Promise<void> {
  if (input.scenarios.length === 1) {
    const [scenario] = input.scenarios;
    await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
      ignoreRunnerCleanupErrors: false,
      removeRunnerImages: false,
      runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
    });
    input.assertWorkAdmission();
    try {
      await runHostedLocalVitestForScenarios({
        env: { ...input.env, ...input.vitestEnvOverlay },
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
  input.assertWorkAdmission();
  try {
    const batches = buildHostedLocalVitestBatches(input.scenarios);
    for (let index = 0; index < batches.length; index += 1) {
      const scenarios = batches[index] ?? [];
      input.assertWorkAdmission();
      await runHostedLocalVitestForScenarios({
        env: {
          ...buildHostedLocalVitestBatchEnv({
            env: input.env,
            scenarios,
          }),
          ...input.vitestEnvOverlay,
        },
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
        input.assertWorkAdmission();
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
    if (scenario.dedicatedVitestProcess || scenario.testControls === true) {
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
  if (!input.scenarios.some((scenario) =>
    scenario.dedicatedVitestProcess || scenario.testControls === true
  )) {
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
  const testNamePatterns = input.scenarios.length === 1
    ? input.scenarios[0]?.vitestProcessTestNamePatterns ?? [null]
    : [null];

  for (let index = 0; index < testNamePatterns.length; index += 1) {
    const testNamePattern = testNamePatterns[index] ?? null;
    await runForegroundCommand({
      args: [
        "exec",
        "vitest",
        "run",
        "--config",
        "apps/cloudflare/vitest.e2e.config.ts",
        ...input.scenarios.map((scenario) => scenario.file),
        ...(testNamePattern ? ["--testNamePattern", testNamePattern] : []),
        ...(input.scenarios.length > 1 ? ["--bail", "1"] : []),
        "--no-coverage",
      ],
      command: "pnpm",
      cwd: hostedLocalHarnessRepoRoot,
      env: buildHostedLocalVitestScenarioEnv({
        env: input.env,
        scenarios: input.scenarios,
      }),
      label: testNamePatterns.length > 1
        ? `${input.label} process ${index + 1}/${testNamePatterns.length}`
        : input.label,
    });
    if (index < testNamePatterns.length - 1) {
      await cleanupHostedLocalE2eRunnerArtifacts(input.env, {
        ignoreRunnerCleanupErrors: false,
        removeRunnerImages: false,
        runnerCleanupTimeoutMs: SCENARIO_RUNNER_CLEANUP_TIMEOUT_MS,
      });
    }
  }
}

function foregroundSignalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
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
    TEMPORAL_DEV_HEADLESS:
      input.env.TEMPORAL_DEV_HEADLESS?.trim()
      || "1",
    NEXT_DIST_DIR_MODE:
      input.env.NEXT_DIST_DIR_MODE?.trim()
      || "smoke",
    NEXT_DIST_DIR_SUFFIX:
      input.env.NEXT_DIST_DIR_SUFFIX?.trim()
      || `e2e-${suffix}`,
  };
}

function buildHostedLocalVitestScenarioEnv(input: {
  env: NodeJS.ProcessEnv;
  scenarios: readonly HostedLocalE2eScenario[];
}): NodeJS.ProcessEnv {
  const testControlsRequired = input.scenarios.some((scenario) =>
    scenario.testControls === true
  );
  if (!testControlsRequired && input.env[HOSTED_LOCAL_E2E_TEST_CONTROLS_ENV] !== "1") {
    return input.env;
  }
  const env = { ...input.env };
  if (testControlsRequired) {
    env[HOSTED_LOCAL_E2E_TEST_CONTROLS_ENV] = "1";
  } else {
    delete env[HOSTED_LOCAL_E2E_TEST_CONTROLS_ENV];
  }
  return env;
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
    cleanupHostedRunnerContainers,
    cleanupHostedRunnerImages,
  } =
    await import("./dev-hosted-local/runtime.ts");
  const {
    cleanupHostedLocalMinioBuildContainersBestEffort,
    cleanupHostedLocalMinioE2eContainersBestEffort,
  } =
    await import("./dev-hosted-local/minio.ts");

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
