import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  removeHostedLocalWebAuthorityFromProcessEnvironment,
  sanitizeHostedLocalGenericEnvironment,
} from "../authority-env.ts";
import {
  isHostedLocalUseOpenaiApiKey,
  MURPH_DEV_USE_OPENAI_API_KEY_ENV,
  resolveHostedLocalCodexSubscriptionAuthEnvValue,
  shouldSeedHostedLocalCodexSubscriptionAuth,
} from "./codex-subscription-auth.ts";
import { resolveHostedLocalDevConfig } from "./config.ts";
import {
  cloudflareDir,
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  DEFAULT_WEB_PORT,
  DEFAULT_WORKER_PERSIST_DIR,
  DEFAULT_WORKER_PORT,
  HOSTED_LOCAL_WORKTREE_ROOT,
  HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID_ENV,
  HOSTED_LOCAL_WORKTREE_SCOPE_ENV,
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  repoRoot,
  STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
  webDir,
} from "./constants.ts";
import {
  buildHostedRunnerLocalBuildId,
  buildHostedLocalDevOverrides,
  buildHostedLocalStateEnvFileText,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  includesWranglerLocalDevAiBinding,
  isHostedLocalTruthyEnvValue,
  resolveHostedLocalDatabaseUrl,
  resolveHostedLocalPersistentCryptoStatePath,
  readOptionalSimpleEnvFile,
  readHostedLocalStripeEnvFile,
  readSimpleEnvFile,
  requireEnvValue,
  resolveCloudflareLocalEnv,
  resolveHostedLocalClientWorkerHost,
  shouldSyncLocalDatabaseSchema,
  usesWranglerLocalDevTestRoutes,
  warnForMissingEnv,
} from "./environment.ts";
import {
  registerHostedLocalLinqWebhookSubscription,
  resolveHostedLocalLinqWebhookSetup,
  type HostedLocalLinqWebhookSetup,
} from "./linq-webhook-tunnel.ts";
import {
  cleanupHostedLocalMinioContainerBestEffort,
  maybeStartHostedLocalMinio,
  type HostedLocalMinioServer,
} from "./minio.ts";
import {
  assertHostedWebDevServerAvailable,
  assertPortAvailable,
  cleanupHostedRunnerContainerLocalState,
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
  collectDockerDevDiagnostics,
  redactHostedLocalDiagnosticText,
  resolveHostedLocalWorkerPortMode,
  runCommand,
  spawnChildProcess,
  spawnHostedLocalDockerEventsForensics,
  spawnStripeListenerWithSecretCapture,
  StripeCliMissingError,
  terminateChildProcess,
  terminateChildProcessAndWait,
  throwIfAbortSignalAborted,
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
  type HostedRunnerContainerCleanupScope,
} from "./runtime.ts";
import {
  HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS,
  writeHostedLocalStripeCheckoutDiagnostics,
} from "./stripe.ts";
import {
  buildHostedLocalTemporalRuntimeEnv,
  requireHostedLocalTemporalWorkerPackageDir,
  startHostedLocalTemporalRuntime,
  type HostedLocalTemporalRuntime,
} from "./temporal.ts";
import type {
  BufferedNamedChildProcess,
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
  NamedChildProcess,
} from "./types.ts";
import {
  ensureVercelLinkExists,
  parseHostedExecutionOidcIdentity,
  resolveVercelOidcToken,
} from "./vercel.ts";
import {
  resolveHostedWebDevDistDirName,
  shouldUseHostedWebProductionStart,
} from "./web-production-start.ts";

const HOSTED_WEB_HEALTH_PATH = "/api/internal/health";
const HOSTED_WEB_HEALTH_COMMONS_BRIDGE_FILES = [
  path.join(webDir, "src", "lib", "health-commons", "biomarker-detail.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-browse.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-detail.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-projections.ts"),
  path.join(webDir, "src", "lib", "health-commons", "generated-experiment-artifacts.ts"),
  path.join(webDir, "src", "lib", "health-commons", "measurement-method-detail.ts"),
];
const HOSTED_LOCAL_REQUIRED_ASSISTANT_PROVIDER = "openai";
const HOSTED_LOCAL_APP_SESSION_HMAC_KEY = Buffer.alloc(32, 8).toString("base64url");
const HOSTED_LOCAL_DEFAULT_WRANGLER_PERSIST_DIR_NAME = "wrangler-state";

export interface HostedLocalDevStack {
  config: HostedLocalDevConfig;
  /**
   * The app-session HMAC key the web process runs with, so test harnesses can
   * mint valid hosted app sessions in-process. The key is stripped from
   * `runtimeEnv` and only injected into the web child process env.
   */
  hostedAppSessionHmacKey: string;
  oidcIdentity: HostedExecutionOidcIdentity;
  oidcToken: string;
  processes: {
    cloudflare: BufferedNamedChildProcess | null;
    healthCommons: BufferedNamedChildProcess | null;
    linqTunnel: BufferedNamedChildProcess | null;
    minio: BufferedNamedChildProcess | null;
    stripe: BufferedNamedChildProcess | null;
    temporalServer: BufferedNamedChildProcess | null;
    temporalWorker: BufferedNamedChildProcess | null;
    web: BufferedNamedChildProcess | null;
  };
  ready: Promise<void>;
  kill(signal?: NodeJS.Signals): void;
  linqWebhookTargetUrl: string | null;
  runtimeEnv: NodeJS.ProcessEnv;
  workerRuntimeEnv: NodeJS.ProcessEnv | null;
  stderrTail(maxChars?: number): string;
  stdoutTail(maxChars?: number): string;
  stop(signal?: NodeJS.Signals): Promise<void>;
  waitForExit(): Promise<NamedChildProcess>;
  webBaseUrl: string | null;
  workerBaseUrl: string;
}

const STRIPE_WEBHOOK_FORWARD_PATH = "/api/hosted-onboarding/stripe/webhook";
const STRIPE_LISTENER_SECRET_CAPTURE_TIMEOUT_MS = 15_000;
const HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV = "HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN";
const HOSTED_LOCAL_PRESERVE_DOCKER_CONFIG_ENV = "MURPH_DEV_PRESERVE_DOCKER_CONFIG";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID";
const HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROOF_FILE =
  "runner-smoke-proved.json";
const HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV =
  "MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED";
const HEALTH_COMMONS_GENERATED_PREPARED_ENV = "MURPH_HEALTH_COMMONS_GENERATED_PREPARED";
const HOSTED_LOCAL_MINIO_MONITOR_INTERVAL_MS = 2_000;
const HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID_ENV =
  "MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID";
const HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD_SOURCE = path.join(
  "test",
  "support",
  "hosted-local-temporal-mailbox-signal-fault-preload.ts",
);
const HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD_OUTPUT =
  "hosted-local-temporal-mailbox-signal-fault-preload.js";
const MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN_ENV =
  "MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN";
const HOSTED_LOCAL_CODEX_MODEL_CATALOG_FILE =
  "codex-model-catalog.openai-flex.json";
const HOSTED_LOCAL_OPENAI_FLEX_MODEL_SLUG = "gpt-5.6-terra";
const HOSTED_LOCAL_OPENAI_FLEX_SERVICE_TIER = {
  id: "flex",
  name: "Flex",
  description: "Lower-cost flexible processing",
} as const;
const HOSTED_LOCAL_DEPLOY_SMOKE_MODEL_SLUG = "gpt-5.4-nano";
const HOSTED_LOCAL_DEPLOY_SMOKE_TEMPLATE_MODEL_SLUG = "gpt-5.4-mini";
const HOSTED_LOCAL_RUNNER_BUNDLE_ROOT = path.join(
  repoRoot,
  "apps",
  "cloudflare",
  ".deploy",
  "runner-bundle",
);
const HOSTED_LOCAL_CLOUDFLARE_SOURCE_SNAPSHOT_DIR = "cloudflare-source";
const HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE = "@murphai/";

type HostedLocalCloudflareSourceSnapshot = {
  cloudflareAppDir: string;
  workspaceRoot: string;
};

type HostedLocalWorkspacePackage = {
  dependencies: readonly string[];
  dir: string;
  externalDependencies: readonly string[];
  packageJsonPath: string;
};

export async function startHostedLocalDevStack(input: {
  abortSignal?: AbortSignal;
  env: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
  webProcessEnvOverrides?: NodeJS.ProcessEnv;
  webTemporalMailboxSignalFaultUserId?: string;
}): Promise<HostedLocalDevStack> {
  throwIfAbortSignalAborted(input.abortSignal);
  const inheritedStripeCliApiKey = input.env.STRIPE_API_KEY?.trim() || null;
  const initialEnv = sanitizeHostedLocalGenericEnvironment(input.env);
  delete initialEnv.STRIPE_API_KEY;
  removeHostedLocalWebAuthorityFromProcessEnvironment();
  const initialProcessEnv = { ...initialEnv } satisfies NodeJS.ProcessEnv;
  const config = resolveHostedLocalDevConfig(initialEnv);
  if (config.temporal.mode !== "disabled") {
    requireHostedLocalTemporalWorkerPackageDir(initialEnv);
  }
  assertHostedLocalWorktreeRuntimePreconditions(initialEnv);
  assertHostedLocalE2eIsolation(initialEnv, config);
  const tempDirOverride = initialEnv.MURPH_DEV_TEMP_DIR?.trim() || null;
  const providedVercelOidcToken = initialEnv.VERCEL_OIDC_TOKEN?.trim() || null;
  const hostedRunnerLocalBuildId = buildHostedRunnerLocalBuildId(
    initialEnv[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim() || randomUUID(),
  );
  const tsxTsconfigPath = path.join(repoRoot, "tsconfig.base.json");
  const workerBaseUrl =
    `${config.workerProtocol}://${resolveHostedLocalClientWorkerHost(config.workerHost)}:${config.workerPort}`;

  if (!config.skipVercelPull && !providedVercelOidcToken) {
    await ensureVercelLinkExists();
  }
  throwIfAbortSignalAborted(input.abortSignal);
  if (!config.skipWeb) {
    await assertHostedWebDevServerAvailable(initialEnv);
    await assertPortAvailable(
      config.webHost,
      config.webPort,
      [
        `Local hosted web port ${config.webPort} is already in use on ${config.webHost}.`,
        "Stop the existing listener or set MURPH_DEV_WEB_PORT to a free port before running `pnpm dev`.",
      ].join(" "),
    );
  }
  throwIfAbortSignalAborted(input.abortSignal);
  const workerPortMode = await resolveHostedLocalWorkerPortMode({
    allowReuseExisting: isHostedLocalWorkerReuseEnabled(initialEnv),
    host: config.workerHost,
    message: [
      `Local Cloudflare worker port ${config.workerPort} is already in use on ${config.workerHost}.`,
      "Stop the existing listener, set MURPH_DEV_WORKER_PORT to a free port, or set MURPH_DEV_REUSE_EXISTING_WORKER=1 if you intentionally want to reuse it.",
    ].join(" "),
    port: config.workerPort,
    protocol: config.workerProtocol,
  });
  throwIfAbortSignalAborted(input.abortSignal);
  const tempDir = tempDirOverride
    ? resolveHostedLocalTempDir(repoRoot, tempDirOverride)
    : await mkdtemp(path.join(os.tmpdir(), "murph-dev-env-"));
  if (tempDirOverride) {
    await rm(tempDir, { force: true, recursive: true });
    await mkdir(tempDir, { mode: 0o700, recursive: true });
  }
  await chmod(tempDir, 0o700);
  throwIfAbortSignalAborted(input.abortSignal);
  const workerPersistDir = resolveHostedLocalWorkerPersistDir({
    configuredPersistDir: config.workerPersistDir,
    env: initialEnv,
    tempDir,
  });

  const pulledEnvPath = path.join(tempDir, ".env.local");
  const workerEnvPath = path.join(tempDir, "cloudflare-worker.env");
  const workerDevVarsPath = path.join(tempDir, "cloudflare-worker.dev.vars");
  const workerDevVarsBackupPath = path.join(tempDir, "cloudflare-worker.dev.vars.backup");
  const hostedLocalStateDevVarsPath = path.join(tempDir, "hosted-local-state.dev.vars");
  const workerConfigPath = path.join(tempDir, "cloudflare-worker.local-dev.generated.json");
  const isolatedDockerConfigDir = shouldUseIsolatedDockerConfig(initialEnv)
    ? path.join(tempDir, "docker-config")
    : null;
  const repoEnvPath = path.join(repoRoot, ".env");
  const webEnvPath = path.join(webDir, ".env");
  const webLocalEnvPath = path.join(webDir, ".env.local");
  let restoreCloudflareDevVars = false;
  let hadExistingCloudflareDevVars = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const children: BufferedNamedChildProcess[] = [];
  let dockerEventsProcess: BufferedNamedChildProcess | null = null;
  let healthCommonsWatcher: BufferedNamedChildProcess | null = null;
  let linqTunnelProcess: BufferedNamedChildProcess | null = null;
  let linqWebhookSetup: HostedLocalLinqWebhookSetup | null = null;
  let minioServer: HostedLocalMinioServer | null = null;
  let minioProcess: BufferedNamedChildProcess | null = null;
  let stripeListener: BufferedNamedChildProcess | null = null;
  let temporalRuntime: HostedLocalTemporalRuntime | null = null;
  let workerRuntimeEnv: NodeJS.ProcessEnv | null = null;
  let workerProcessEnv: NodeJS.ProcessEnv | null = null;
  let hostedWebTestPreloadOutputDir: string | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let minioMonitor: HostedLocalMinioMonitor | null = null;

  try {
    if (!config.skipVercelPull && !providedVercelOidcToken) {
      await runCommand("vercel", ["env", "pull", pulledEnvPath, "--environment=development"], {
        cwd: webDir,
        env: initialProcessEnv,
        name: "setup",
        signal: input.abortSignal,
      });
    }

    const [repoEnv, webEnv, webLocalEnv, localStripeEnv] = await Promise.all([
      readOptionalSimpleEnvFile(repoEnvPath),
      readOptionalSimpleEnvFile(webEnvPath),
      readOptionalSimpleEnvFile(webLocalEnvPath),
      readHostedLocalStripeEnvFile(initialEnv),
    ]);
    const pulledEnv = (config.skipVercelPull || providedVercelOidcToken)
      ? {}
      : await readSimpleEnvFile(pulledEnvPath);
    throwIfAbortSignalAborted(input.abortSignal);
    const localStripeAuthorityEnv = pickHostedLocalStripeAuthorityEnv({
      inheritedEnv: initialEnv,
      localEnvFiles: [
        repoEnv,
        webEnv,
        webLocalEnv,
      ],
      localStripeEnv,
    });
    const localStripeIsolationOverlay =
      buildHostedLocalStripeBillingIsolationOverlay(localStripeAuthorityEnv);
    const rawVercelEnv: NodeJS.ProcessEnv = {
      ...repoEnv,
      ...pulledEnv,
      ...webEnv,
      ...webLocalEnv,
      ...localStripeIsolationOverlay,
      ...localStripeEnv,
      ...initialEnv,
    };
    const stripeCliApiKey =
      rawVercelEnv.STRIPE_API_KEY?.trim() || inheritedStripeCliApiKey;
    // STRIPE_API_KEY exists only to authenticate the harness-owned Stripe CLI
    // listener. The website uses STRIPE_SECRET_KEY, and no worker, web,
    // Temporal, or runner child should inherit the CLI-only credential.
    delete rawVercelEnv.STRIPE_API_KEY;
    const hostedAppSessionHmacKey =
      rawVercelEnv.HOSTED_APP_SESSION_HMAC_KEY?.trim()
      || HOSTED_LOCAL_APP_SESSION_HMAC_KEY;
    delete rawVercelEnv.HOSTED_APP_SESSION_HMAC_KEY;
    const inputNodeEnv = rawVercelEnv.NODE_ENV?.trim();
    const shouldPreserveTestNodeEnvForLocalTestMode =
      usesWranglerLocalDevTestRoutes(rawVercelEnv)
      || (
        inputNodeEnv === "test"
        && Boolean(rawVercelEnv[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]?.trim())
      );
    const vercelEnv = shouldUseRemoteHostedCryptoKeys(rawVercelEnv)
      ? rawVercelEnv
      : stripHostedCryptoMaterialEnv(rawVercelEnv);

    vercelEnv.DATABASE_URL = resolveHostedLocalDatabaseUrl({
      databaseUrlOverride: config.databaseUrlOverride,
      fallbackUrl: DEFAULT_DATABASE_URL,
      pulledDatabaseUrl: pulledEnv.DATABASE_URL,
      repoDatabaseUrl: repoEnv.DATABASE_URL,
      shellDatabaseUrl: initialEnv.DATABASE_URL,
      useVercelDatabaseUrl: config.useVercelDatabaseUrl,
    });
    vercelEnv.NODE_ENV = "development";
    const temporalEnvironmentOverlay = buildHostedLocalTemporalRuntimeEnv({
      config,
      env: vercelEnv,
    });
    requireHostedLocalAssistantProviderEnv(vercelEnv);
    // Interactive dev runs hosted Codex model turns on the local ChatGPT
    // subscription instead of the API key; the key stays for image generation.
    // MURPH_DEV_USE_OPENAI_API_KEY=1 is the explicit dev opt-out that bypasses
    // the subscription seed so assistant turns bill OPENAI_API_KEY (used when
    // the local Codex subscription is exhausted or unavailable).
    const useOpenaiApiKey = isHostedLocalUseOpenaiApiKey(initialEnv);
    const codexSubscriptionAuthEnvValue =
      workerPortMode === "start" &&
      shouldSeedHostedLocalCodexSubscriptionAuth({
        nodeEnv: inputNodeEnv,
        profileName: vercelEnv.MURPH_HOSTED_LOCAL_PROFILE,
        useOpenaiApiKey,
      })
        ? await resolveHostedLocalCodexSubscriptionAuthEnvValue(vercelEnv)
        : null;
    if (useOpenaiApiKey) {
      const stderrTarget = input.stderrTarget ?? process.stderr;
      stderrTarget.write(
        workerPortMode === "start"
          ? `[setup] ${MURPH_DEV_USE_OPENAI_API_KEY_ENV} is set: hosted Codex assistant turns will bill OPENAI_API_KEY for this dev run.\n`
          : `[setup] ${MURPH_DEV_USE_OPENAI_API_KEY_ENV} is set but ignored: this stack is reusing an existing worker, so the runner's existing auth mode stays in effect.\n`,
      );
    }
    linqWebhookSetup = await resolveHostedLocalLinqWebhookSetup({
      config,
      env: vercelEnv,
    });
    if (linqWebhookSetup?.shouldRegister) {
      const registrationResult = await registerHostedLocalLinqWebhookSubscription({
        env: vercelEnv,
        registrationCachePath: config.linqWebhookRegistrationCachePath,
        setup: linqWebhookSetup,
        stderrTarget: input.stderrTarget,
      });
      vercelEnv.LINQ_WEBHOOK_SECRET = registrationResult.webhookSecret;
      if (registrationResult.webhookSecretSource !== "configured") {
        await maybePersistHostedLocalLinqWebhookSecret({
          envPath: webLocalEnvPath,
          existingEnv: webLocalEnv,
          stderrTarget: input.stderrTarget,
          webhookSecret: registrationResult.webhookSecret,
        });
      }
    }
    const oidcToken = await resolveVercelOidcToken(vercelEnv);
    throwIfAbortSignalAborted(input.abortSignal);
    const oidcIdentity = parseHostedExecutionOidcIdentity(oidcToken);
    if (isolatedDockerConfigDir !== null) {
      await prepareIsolatedDockerConfig({
        configDir: isolatedDockerConfigDir,
        sourceEnv: initialEnv,
      });
    }
    throwIfAbortSignalAborted(input.abortSignal);
    const containerReachableHost = new URL(resolveContainerReachableWorkerOrigin(
      config,
      initialEnv,
    )).hostname;
    minioServer = workerPortMode === "start"
      ? await maybeStartHostedLocalMinio({
        buildId: hostedRunnerLocalBuildId,
        containerHost: containerReachableHost,
        env: {
          ...initialProcessEnv,
          ...(isolatedDockerConfigDir !== null ? { DOCKER_CONFIG: isolatedDockerConfigDir } : {}),
        },
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
        tempDir,
      })
      : null;
    if (minioServer !== null) {
      minioProcess = minioServer.process;
      // The Docker CLI can exit while the MinIO container keeps running healthy;
      // maybeStartHostedLocalMinio proves startup readiness, and the dev stack
      // keeps the sidecar healthy while the worker may retry delayed wakes.
      minioMonitor = startHostedLocalMinioMonitor({
        isStopped: () => stopped,
        onRestart: (restartedProcess) => {
          minioProcess = restartedProcess;
        },
        server: minioServer,
        stderrTarget: input.stderrTarget,
      });
    }
    throwIfAbortSignalAborted(input.abortSignal);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
      overrides: {
        ...vercelEnv,
        ...(minioServer?.env ?? {}),
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: containerReachableHost,
        ...(shouldPreserveTestNodeEnvForLocalTestMode ? { NODE_ENV: "test" } : {}),
        ...temporalEnvironmentOverlay,
      },
    });
    throwIfAbortSignalAborted(input.abortSignal);
    const localOverrides = buildHostedLocalDevOverrides(config, cloudflareDevVars, {
      retellWebhookPublicBaseUrl: linqWebhookSetup?.publicBaseUrl ?? null,
    });
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...vercelEnv,
      ...localOverrides,
      ...temporalEnvironmentOverlay,
      TSX_TSCONFIG_PATH: tsxTsconfigPath,
      VERCEL_OIDC_TOKEN: oidcToken,
      ...(isolatedDockerConfigDir !== null ? { DOCKER_CONFIG: isolatedDockerConfigDir } : {}),
    };
    // Subscription auth is worker/runner-scoped and harness-derived only: the
    // strip removes values inherited from the shell or env files, and trusted
    // harness-owned values are re-added afterward so web/temporal children
    // never see them.
    const hostedLocalCodexModelCatalogJson = workerPortMode === "start"
      ? await prepareHostedLocalCodexModelCatalog({
        catalogPath: path.join(tempDir, HOSTED_LOCAL_CODEX_MODEL_CATALOG_FILE),
        env: initialProcessEnv,
      })
      : null;
    const workerRuntimeSourceEnv: NodeJS.ProcessEnv = {
      ...stripHostedLocalHostOnlyCodexEnv({
        ...runtimeEnv,
        ...cloudflareDevVars,
        ...localOverrides,
        ...temporalEnvironmentOverlay,
      }),
      ...(hostedLocalCodexModelCatalogJson !== null
        ? { [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: hostedLocalCodexModelCatalogJson }
        : {}),
      ...(codexSubscriptionAuthEnvValue !== null
        ? { [HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV]: codexSubscriptionAuthEnvValue }
        : {}),
    };
    workerRuntimeEnv = workerPortMode === "start"
      ? {
        ...workerRuntimeSourceEnv,
        [HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID_ENV]: "1",
        [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: hostedRunnerLocalBuildId,
      }
      : null;
    workerProcessEnv = workerRuntimeEnv === null
      ? null
      : {
        ...workerRuntimeEnv,
        DOCKER_BUILDKIT: "1",
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      };
    if (workerRuntimeEnv !== null) {
      if (isolatedDockerConfigDir !== null && minioServer === null) {
        await prepareIsolatedDockerConfig({
          configDir: isolatedDockerConfigDir,
          sourceEnv: initialEnv,
        });
      }
      const workerEnvText = `${buildWranglerEnvFileText(workerRuntimeEnv)}\n`;
      const hostedLocalStateEnvText = `${buildHostedLocalStateEnvFileText(cloudflareDevVars)}\n`;
      const persistentCryptoStatePath =
        resolveHostedLocalPersistentCryptoStatePath(runtimeEnv);
      const shouldLinkGlobalCloudflareDevVars = shouldUseGlobalCloudflareDevVarsSymlink(runtimeEnv);
      if (persistentCryptoStatePath !== null) {
        await writePrivateTextFileAtomically(
          persistentCryptoStatePath,
          hostedLocalStateEnvText,
        );
      }
      await writeFile(workerEnvPath, workerEnvText, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(workerEnvPath, 0o600);
      await writeFile(workerDevVarsPath, workerEnvText, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(workerDevVarsPath, 0o600);
      await writeFile(hostedLocalStateDevVarsPath, hostedLocalStateEnvText, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(hostedLocalStateDevVarsPath, 0o600);
      if (shouldLinkGlobalCloudflareDevVars) {
        try {
          await rename(cloudflareDevVarsPath, workerDevVarsBackupPath);
          hadExistingCloudflareDevVars = true;
        } catch (error) {
          if (
            typeof error !== "object"
            || error === null
            || !("code" in error)
            || error.code !== "ENOENT"
          ) {
            throw error;
          }
        }
        restoreCloudflareDevVars = true;
        await symlink(workerDevVarsPath, cloudflareDevVarsPath);
      }
    }
    throwIfAbortSignalAborted(input.abortSignal);

    requireEnvValue(
      "DATABASE_URL",
      runtimeEnv.DATABASE_URL,
      "Set DATABASE_URL in the Vercel development environment, export it in your shell, or run local Postgres on 127.0.0.1:5432.",
    );
    requireEnvValue(
      "VERCEL_OIDC_TOKEN",
      runtimeEnv.VERCEL_OIDC_TOKEN,
      "Enable Vercel OIDC for the linked project and make sure the Vercel CLI is logged in.",
    );

    warnForMissingEnv("NEXT_PUBLIC_PRIVY_APP_ID", runtimeEnv.NEXT_PUBLIC_PRIVY_APP_ID);
    warnForMissingEnv("PRIVY_VERIFICATION_KEY", runtimeEnv.PRIVY_VERIFICATION_KEY);
    const stripeListenerWillCaptureSecret = !config.skipStripeListen && !config.skipWeb;
    writeHostedLocalStripeCheckoutDiagnostics({
      env: runtimeEnv,
      stderrTarget: input.stderrTarget,
      stripeListenerWillCaptureSecret,
    });
    throwIfAbortSignalAborted(input.abortSignal);

    await maybeGenerateHostedWebPrismaClient({
      abortSignal: input.abortSignal,
      env: runtimeEnv,
      stderrTarget: input.stderrTarget,
    });

    if (!config.skipPrismaMigrate) {
      if (shouldSyncLocalDatabaseSchema(runtimeEnv.DATABASE_URL)) {
        await runCommand("pnpm", [
          "--dir",
          "apps/web",
          "exec",
          "prisma",
          "db",
          "push",
          config.forceResetLocalDatabase ? "--force-reset" : "--accept-data-loss",
        ], {
          cwd: repoRoot,
          env: runtimeEnv,
          name: "setup",
          signal: input.abortSignal,
        });
      } else {
        await runCommand("pnpm", ["--dir", "apps/web", "prisma:migrate:deploy"], {
          cwd: repoRoot,
          env: runtimeEnv,
          name: "setup",
          signal: input.abortSignal,
        });
      }

      // The DB is now the hosted Linq home-line authority, so seed the
      // configured lines the same way the Vercel deploy does. Without this a
      // fresh local database has no assignable line and onboarding activation
      // fails closed with LINQ_CONVERSATION_PHONE_REQUIRED. Provider inventory
      // sync is skipped locally so startup needs no Linq API call. With no
      // configured conversation phones there is nothing to seed and the
      // script's pool-ready assertion would fail startup, so skip it: e2e
      // scenarios seed their own line inventory, and a dev stack without Linq
      // env keeps failing closed at activation exactly as before.
      const configuredLinqConversationPhones =
        runtimeEnv.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS?.trim() ?? "";
      if (configuredLinqConversationPhones.length > 0) {
        await runCommand("pnpm", [
          "--dir",
          "apps/web",
          "linq:sync-lines",
          "--",
          "--skip-provider-inventory",
        ], {
          cwd: repoRoot,
          env: runtimeEnv,
          name: "setup",
          signal: input.abortSignal,
        });
      } else {
        (input.stderrTarget ?? process.stderr).write(
          "[setup] No HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS configured; skipping hosted Linq line seeding.\n",
        );
      }
    }

    if (!config.skipWeb) {
      await maybeGenerateHostedWebHealthCommons({
        abortSignal: input.abortSignal,
        env: runtimeEnv,
        stderrTarget: input.stderrTarget,
      });
      await invalidateHostedWebHealthCommonsDevCache(runtimeEnv, input.stderrTarget);
    }

    if (workerRuntimeEnv !== null) {
      if (initialEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE !== "1") {
        const runnerBundleEnv: NodeJS.ProcessEnv = {
          ...(workerProcessEnv ?? workerRuntimeEnv),
          MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY:
            (workerProcessEnv ?? workerRuntimeEnv).MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY ?? "1",
          MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS: "1",
        };
        if (runnerBundleEnv[HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV] === "1") {
          runnerBundleEnv[MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN_ENV] = "1";
        }
        await runCommand("pnpm", ["--dir", "apps/cloudflare", "runner:bundle:hosted-local"], {
          cwd: repoRoot,
          env: runnerBundleEnv,
          name: "setup",
          signal: input.abortSignal,
        });
        if (workerProcessEnv !== null) {
          workerProcessEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE = "1";
        }
      }
      const cloudflareSourceSnapshot = await prepareHostedLocalCloudflareSourceSnapshot({
        abortSignal: input.abortSignal,
        tempDir,
      });
      await writeFile(
        workerConfigPath,
        `${JSON.stringify(
          buildWranglerLocalDevConfig(workerRuntimeEnv, {
            cloudflareAppDir: cloudflareSourceSnapshot.cloudflareAppDir,
            configDir: path.dirname(workerConfigPath),
            workspaceRoot: cloudflareSourceSnapshot.workspaceRoot,
          }),
          null,
          2,
        )}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      await chmod(workerConfigPath, 0o600);

      const runnerCleanupScope = resolvePreStartHostedRunnerContainerCleanupScope(initialEnv);
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerProcessEnv ?? workerRuntimeEnv,
        scope: runnerCleanupScope,
      });
      await cleanupHostedRunnerContainerLocalState({
        env: workerProcessEnv ?? workerRuntimeEnv,
        persistDir: workerPersistDir,
      });
    }
    throwIfAbortSignalAborted(input.abortSignal);

    // Wrangler prefers CLOUDFLARE_API_TOKEN over OAuth, and account-scoped
    // tokens cannot open the remote session backing the Workers AI binding.
    // Keep the token on the preparatory wrapper; apps/cloudflare strips it
    // only for the final `wrangler dev` command.
    const wranglerSpawnEnv = { ...(workerProcessEnv ?? workerRuntimeEnv) };
    if (
      workerRuntimeEnv !== null
      && includesWranglerLocalDevAiBinding(wranglerSpawnEnv)
      && wranglerSpawnEnv.CLOUDFLARE_API_TOKEN
    ) {
      wranglerSpawnEnv[STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV] = "1";
      (input.stderrTarget ?? process.stderr).write(
        "[cloudflare] `wrangler dev` will ignore CLOUDFLARE_API_TOKEN so OAuth backs the Workers AI remote session; run `wrangler login` once, or set MURPH_DEV_SKIP_WORKERS_AI=1 to start without Workers AI.\n",
      );
    }

    // Start docker lifecycle forensics before wrangler dev so the stream also
    // captures its container image builds and (buggy) duplicate-tag cleanup.
    // Kept out of `children`: a forensics hiccup must not fail the stack.
    // Gated to E2E-isolated runs (plus an explicit opt-in) because the stream
    // observes the whole Docker daemon: an ordinary local dev stack should not
    // log unrelated local container/image lifecycle metadata by default.
    dockerEventsProcess = workerRuntimeEnv === null
      || !shouldStreamHostedLocalDockerEventsForensics(initialEnv)
      ? null
      : spawnHostedLocalDockerEventsForensics(workerProcessEnv ?? workerRuntimeEnv, {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });

    const cloudflareProcess = workerRuntimeEnv === null
      ? null
      : spawnChildProcess("cloudflare", "pnpm", [
        "--dir",
        "apps/cloudflare",
        "worker:dev:prepared",
        "--",
        "--ip",
        config.workerHost,
        "--port",
        String(config.workerPort),
        "--config",
        workerConfigPath,
        "--local-protocol",
        config.workerProtocol,
        "--persist-to",
        workerPersistDir,
        "--env-file",
        workerEnvPath,
        ...resolveWranglerDebugArgs(initialEnv),
        ...buildWranglerVarArgs(wranglerSpawnEnv),
      ], wranglerSpawnEnv, {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (cloudflareProcess) {
      children.push(cloudflareProcess);
    } else {
      const stderrTarget = input.stderrTarget ?? process.stderr;
      stderrTarget.write(
        `[cloudflare] Reusing existing local Cloudflare worker at ${workerBaseUrl}; stop that process to force a fresh worker.\n`,
      );
      if (config.skipWeb) {
        keepAliveTimer = setInterval(() => {}, 2_147_483_647);
      }
    }
    throwIfAbortSignalAborted(input.abortSignal);

    if (linqWebhookSetup?.shouldStartTunnel) {
      linqTunnelProcess = spawnChildProcess("linq-tunnel", "cloudflared", [
        "tunnel",
        "--no-autoupdate",
        "--config",
        resolveRepoRelativeChildArg(requireLinqWebhookTunnelConfigPath(linqWebhookSetup)),
        "run",
        requireLinqWebhookTunnelName(linqWebhookSetup),
      ], buildCloudflaredProcessEnv(initialProcessEnv), {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
      children.push(linqTunnelProcess);
    }
    throwIfAbortSignalAborted(input.abortSignal);

    stripeListener = await maybeStartStripeWebhookListener({
      config,
      initialEnv: initialProcessEnv,
      pipeOutput: input.pipeOutput,
      repoEnv,
      runtimeEnv,
      stripeCliApiKey,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
    });
    if (stripeListener !== null) {
      const listenerChild = stripeListener;
      listenerChild.child.once("exit", (code, signal) => {
        if (stopped) {
          return;
        }
        const stderrTarget = input.stderrTarget ?? process.stderr;
        stderrTarget.write(
          [
            `[stripe] listener exited (code=${code ?? "unknown"}, signal=${signal ?? "none"}); `,
            "webhooks are no longer being forwarded to this dev server. ",
            "Restart `pnpm dev` to recover.\n",
          ].join(""),
        );
      });
    }
    throwIfAbortSignalAborted(input.abortSignal);

    healthCommonsWatcher = config.skipWeb || config.skipHealthCommonsWatch
      ? null
      : spawnChildProcess("health-commons", "pnpm", [
        "health-commons:generate:watch",
      ], {
        ...runtimeEnv,
        MURPH_HEALTH_COMMONS_WATCH_SKIP_INITIAL: "1",
      }, {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (healthCommonsWatcher) {
      children.push(healthCommonsWatcher);
    }
    throwIfAbortSignalAborted(input.abortSignal);

    const shouldUseWebProductionStart = config.skipWeb
      ? false
      : await shouldUseHostedWebProductionStart({ env: initialEnv });

    if (config.skipWeb && input.webTemporalMailboxSignalFaultUserId !== undefined) {
      throw new Error(
        "The Temporal mailbox signal fault preload requires the hosted Web process.",
      );
    }
    const webProcessSourceEnv: NodeJS.ProcessEnv = {
      ...runtimeEnv,
      ...(input.webProcessEnvOverrides ?? {}),
      HOSTED_APP_SESSION_HMAC_KEY: hostedAppSessionHmacKey,
      // Keep disabled mode fail-closed even when dev-local subsequently
      // loads apps/web/.env.local and .env into the child process.
      ...temporalEnvironmentOverlay,
    };
    if (input.webTemporalMailboxSignalFaultUserId !== undefined) {
      hostedWebTestPreloadOutputDir = path.join(
        webDir,
        ".test-dist",
        "hosted-local-preloads",
        randomUUID().toLowerCase(),
      );
    }
    const webProcessEnvironment = hostedWebTestPreloadOutputDir === null
      ? webProcessSourceEnv
      : await prepareHostedLocalTemporalMailboxSignalFaultPreload({
        abortSignal: input.abortSignal,
        env: webProcessSourceEnv,
        expectedUserId: input.webTemporalMailboxSignalFaultUserId ?? "",
        outputDir: hostedWebTestPreloadOutputDir,
      });

    const webProcess = config.skipWeb
      ? null
      : spawnChildProcess("web", "pnpm", buildHostedWebProcessArgs({
        config,
        shouldUseProductionStart: shouldUseWebProductionStart,
      }), buildHostedWebProcessEnv(
        webProcessEnvironment,
        shouldUseWebProductionStart,
      ), {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (webProcess) {
      children.push(webProcess);
    }
    throwIfAbortSignalAborted(input.abortSignal);

    const tlsProxyProcess = config.skipWeb
      ? null
      : maybeStartTlsProxy({
        pipeOutput: input.pipeOutput,
        runtimeEnv,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (tlsProxyProcess) {
      children.push(tlsProxyProcess);
    }
    throwIfAbortSignalAborted(input.abortSignal);

    const webBaseUrl = config.skipWeb ? null : `http://${config.webHost}:${config.webPort}`;
    const temporalRuntimeEnv = buildHostedLocalTemporalProcessEnv({
      cloudflareDevVars,
      runtimeEnv,
    });
    temporalRuntime = await startHostedLocalTemporalRuntime({
      abortSignal: input.abortSignal,
      cloudflareHostedControlBaseUrl: workerBaseUrl,
      config,
      env: temporalRuntimeEnv,
      hostedWebBaseUrl: webBaseUrl,
      pipeOutput: input.pipeOutput,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
    });
    if (temporalRuntime?.serverProcess) {
      children.push(temporalRuntime.serverProcess);
    }
    if (temporalRuntime?.workerProcess) {
      children.push(temporalRuntime.workerProcess);
    }
    throwIfAbortSignalAborted(input.abortSignal);

    const kill = (signal: NodeJS.Signals = "SIGTERM"): void => {
      const childSignal = resolveHostedLocalChildShutdownSignal(signal);
      killHostedLocalMinioMonitor();
      for (const { child } of children) {
        terminateChildProcess(child, childSignal);
      }
      if (minioServer !== null) {
        for (const { child } of minioServer.processes()) {
          terminateChildProcess(child, childSignal);
        }
      }
      if (stripeListener !== null) {
        terminateChildProcess(stripeListener.child, childSignal);
      }
      if (dockerEventsProcess !== null) {
        terminateChildProcess(dockerEventsProcess.child, childSignal);
      }
    };
    const cleanupTemporaryInputs = async (): Promise<void> => {
      if (restoreCloudflareDevVars) {
        await rm(cloudflareDevVarsPath, { force: true });
        if (hadExistingCloudflareDevVars) {
          await rename(workerDevVarsBackupPath, cloudflareDevVarsPath);
        }
      }
      await rm(workerConfigPath, { force: true });
      if (hostedWebTestPreloadOutputDir !== null) {
        await rm(hostedWebTestPreloadOutputDir, { force: true, recursive: true });
      }
      if (!tempDirOverride) {
        await rm(tempDir, { force: true, recursive: true });
      }
    };

    const stop = async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
      if (stopPromise) {
        return await stopPromise;
      }

      stopPromise = (async () => {
        if (stopped) {
          return;
        }

        stopped = true;
        if (keepAliveTimer !== null) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        await stopHostedLocalMinioMonitor();
        const childSignal = resolveHostedLocalChildShutdownSignal(signal);
        kill(childSignal);
        const terminationResults = await Promise.allSettled([
          ...children.map(({ child }) =>
            terminateChildProcessAndWait(child, { signal: childSignal })
          ),
          ...(minioServer === null
            ? []
            : minioServer.processes().map(({ child }) =>
              terminateChildProcessAndWait(child, { signal: childSignal })
            )),
          ...(stripeListener !== null
            ? [terminateChildProcessAndWait(stripeListener.child, { signal: childSignal })]
            : []),
          ...(dockerEventsProcess !== null
            ? [
              terminateChildProcessAndWait(dockerEventsProcess.child, { signal: childSignal })
                .catch(() => {}),
            ]
            : []),
        ]);
        const terminationFailure = terminationResults.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (workerRuntimeEnv && workerPortMode === "start") {
          await cleanupHostedRunnerContainers({
            cwd: repoRoot,
            env: workerProcessEnv ?? workerRuntimeEnv,
            ignoreErrors: true,
            scope: "current-build",
          });
          // A prepared E2E suite keeps its proved image between compatible
          // scenarios and performs the final current-build cleanup itself.
          if (!shouldRunHostedLocalE2eRunnerSmokeOnce(initialProcessEnv)) {
            await cleanupHostedRunnerImages({
              cwd: repoRoot,
              env: workerProcessEnv ?? workerRuntimeEnv,
              ignoreErrors: true,
              scope: "current-build",
            });
          }
        }
        if (minioServer !== null) {
          await cleanupHostedLocalMinioContainerBestEffort(
            workerProcessEnv ?? workerRuntimeEnv ?? initialProcessEnv,
            minioServer.containerName,
          );
        }
        await cleanupTemporaryInputs();
        if (terminationFailure) {
          throw terminationFailure.reason;
        }
      })();

      return await stopPromise;
    };

    const buildReportingChildren = (): BufferedNamedChildProcess[] => [
      ...children,
      ...(minioServer === null ? [] : [...minioServer.processes()]),
      ...(stripeListener === null ? [] : [stripeListener]),
      ...(dockerEventsProcess === null ? [] : [dockerEventsProcess]),
    ];

    const ready = (async (): Promise<void> => {
      try {
        const healthChecks = [
          waitForHealthyHttpEndpoint({
            host: resolveHostedLocalClientWorkerHost(config.workerHost),
            label: "cloudflare",
            path: "/health",
            port: config.workerPort,
            protocol: config.workerProtocol,
          }),
        ];
        if (webBaseUrl !== null) {
          healthChecks.push(
            waitForHealthyHttpEndpoint({
              host: config.webHost,
              label: "web",
              path: HOSTED_WEB_HEALTH_PATH,
              port: config.webPort,
              protocol: "http",
            }),
          );
        }
        await Promise.race([
          Promise.all(healthChecks).then(() => undefined),
          waitForFirstChildExit(children).then((child) => {
            throw new Error(
              `${child.name} dev process exited before the hosted local stack became healthy.`,
            );
          }),
        ]);
        ensurePreparedRunnerContainerImageAlias(combineChildOutput(children));
        if (workerRuntimeEnv !== null) {
          await maybeRunRunnerContainerSmoke({
            config,
            env: workerProcessEnv ?? workerRuntimeEnv,
            stderrTarget: input.stderrTarget,
            workerBaseUrl,
          });
        }
      } catch (error) {
        if (!stopped) {
          await stop("SIGTERM");
        }
        // Startup failures are exactly where the docker-events forensics
        // matter (image untags, cold-start kills), so the rejection
        // diagnostics must include that stream, not just the fail-fast
        // children.
        throw appendStartupDiagnostics(error, await collectDockerDevDiagnostics({
          cwd: repoRoot,
          env: workerProcessEnv ?? workerRuntimeEnv ?? undefined,
        }), buildReportingChildren());
      }
    })();

    return {
      config: {
        ...config,
        workerPersistDir,
      },
      hostedAppSessionHmacKey,
      kill,
      oidcIdentity,
      oidcToken,
      processes: {
        cloudflare: cloudflareProcess,
        healthCommons: healthCommonsWatcher,
        linqTunnel: linqTunnelProcess,
        minio: minioProcess,
        stripe: stripeListener,
        temporalServer: temporalRuntime?.serverProcess ?? null,
        temporalWorker: temporalRuntime?.workerProcess ?? null,
        web: webProcess,
      },
      ready,
      linqWebhookTargetUrl: linqWebhookSetup?.targetUrl ?? null,
      runtimeEnv,
      workerRuntimeEnv,
      stderrTail: (maxChars?: number): string => tail(combineChildOutput(
        buildReportingChildren().map(
          (child) => `[${child.name}:stderr]\n${child.stderrTail(maxChars)}`,
        ),
      ), maxChars),
      stdoutTail: (maxChars?: number): string => tail(combineChildOutput(
        buildReportingChildren().map(
          (child) => `[${child.name}:stdout]\n${child.stdoutTail(maxChars)}`,
        ),
      ), maxChars),
      stop,
      waitForExit: async (): Promise<NamedChildProcess> => {
        return await waitForFirstChildExit(children);
      },
      webBaseUrl,
      workerBaseUrl,
    };
  } catch (error) {
    await stopHostedLocalMinioMonitor().catch(() => {});
    for (const { child } of children) {
      await terminateChildProcessAndWait(child, { signal: "SIGTERM" }).catch(() => {});
    }
    if (minioServer !== null) {
      for (const { child } of minioServer.processes()) {
        await terminateChildProcessAndWait(child, { signal: "SIGTERM" }).catch(() => {});
      }
    }
    if (stripeListener !== null) {
      await terminateChildProcessAndWait(stripeListener.child, { signal: "SIGTERM" }).catch(() => {});
    }
    if (dockerEventsProcess !== null) {
      await terminateChildProcessAndWait(dockerEventsProcess.child, { signal: "SIGTERM" })
        .catch(() => {});
    }
    if (workerRuntimeEnv && workerPortMode === "start") {
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerProcessEnv ?? workerRuntimeEnv,
        ignoreErrors: true,
        scope: "current-build",
      }).catch(() => {});
      // Preserve suite-owned reuse even when this scenario fails to start; the
      // outer E2E finally block still removes the current-build image.
      if (!shouldRunHostedLocalE2eRunnerSmokeOnce(initialProcessEnv)) {
        await cleanupHostedRunnerImages({
          cwd: repoRoot,
          env: workerProcessEnv ?? workerRuntimeEnv,
          ignoreErrors: true,
          scope: "current-build",
        }).catch(() => {});
      }
    }
    if (minioServer !== null) {
      await cleanupHostedLocalMinioContainerBestEffort(
        workerProcessEnv ?? workerRuntimeEnv ?? initialProcessEnv,
        minioServer.containerName,
      ).catch(() => {});
    }
    if (!stopped) {
      await rm(workerConfigPath, { force: true }).catch(() => {});
      if (hostedWebTestPreloadOutputDir !== null) {
        await rm(hostedWebTestPreloadOutputDir, { force: true, recursive: true }).catch(() => {});
      }
      if (restoreCloudflareDevVars) {
        await rm(cloudflareDevVarsPath, { force: true }).catch(() => {});
        if (hadExistingCloudflareDevVars) {
          await rename(workerDevVarsBackupPath, cloudflareDevVarsPath).catch(() => {});
        }
      }
      if (!tempDirOverride) {
        await rm(tempDir, { force: true, recursive: true }).catch(() => {});
      }
    }
    throw error;
  }

  async function stopHostedLocalMinioMonitor(): Promise<void> {
    if (minioMonitor !== null) {
      const monitor = minioMonitor;
      minioMonitor = null;
      await monitor.stop();
    }
  }

  function killHostedLocalMinioMonitor(): void {
    if (minioMonitor !== null) {
      minioMonitor.kill();
      minioMonitor = null;
    }
  }
}

interface HostedLocalMinioMonitor {
  kill(): void;
  stop(): Promise<void>;
}

function startHostedLocalMinioMonitor(input: {
  isStopped: () => boolean;
  onRestart: (process: BufferedNamedChildProcess) => void;
  server: HostedLocalMinioServer;
  stderrTarget?: NodeJS.WritableStream;
}): HostedLocalMinioMonitor {
  let pollPromise: Promise<void> | null = null;
  let stopped = false;
  let terminateLateRestart = false;
  const poll = (): void => {
    if (pollPromise !== null || stopped || input.isStopped()) {
      return;
    }
    pollPromise = (async () => {
      const restartedProcess = await input.server.ensureReady();
      if (restartedProcess === null) {
        return;
      }
      if (stopped || input.isStopped()) {
        if (terminateLateRestart) {
          terminateChildProcess(restartedProcess.child, "SIGTERM");
        }
        return;
      }
      input.onRestart(restartedProcess);
      (input.stderrTarget ?? process.stderr).write(
        "[minio] Restarted hosted-local R2 sidecar after health check failed.\n",
      );
    })()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        (input.stderrTarget ?? process.stderr).write(
          `[minio] Hosted-local R2 sidecar health check failed: ${redactHostedLocalDiagnosticText(message)}\n`,
        );
      })
      .finally(() => {
        pollPromise = null;
      });
  };
  const timer = setInterval(poll, HOSTED_LOCAL_MINIO_MONITOR_INTERVAL_MS);
  timer.unref?.();
  return {
    kill: () => {
      terminateLateRestart = true;
      stopped = true;
      clearInterval(timer);
    },
    stop: async () => {
      terminateLateRestart = false;
      stopped = true;
      clearInterval(timer);
      const inFlightPoll = pollPromise;
      if (inFlightPoll !== null) {
        await inFlightPoll;
      }
    },
  };
}

function resolveHostedLocalWorkerPersistDir(input: {
  configuredPersistDir: string;
  env: NodeJS.ProcessEnv;
  tempDir: string;
}): string {
  const explicitPersistDir = input.env.MURPH_DEV_CF_PERSIST_DIR?.trim();
  if (explicitPersistDir || input.configuredPersistDir !== DEFAULT_WORKER_PERSIST_DIR) {
    return input.configuredPersistDir;
  }

  return path.join(input.tempDir, HOSTED_LOCAL_DEFAULT_WRANGLER_PERSIST_DIR_NAME);
}

async function maybeGenerateHostedWebPrismaClient(input: {
  abortSignal: AbortSignal | undefined;
  env: NodeJS.ProcessEnv;
  stderrTarget: NodeJS.WritableStream | undefined;
}): Promise<void> {
  if (input.env[HOSTED_WEB_PRISMA_GENERATED_PREPARED_ENV] === "1") {
    writePreparedGeneratedArtifactSkip(
      input.stderrTarget,
      "hosted web Prisma client generation",
    );
    return;
  }

  await runCommand("pnpm", ["--dir", "apps/web", "prisma:generate"], {
    cwd: repoRoot,
    env: input.env,
    name: "setup",
    signal: input.abortSignal,
  });
}

async function maybeGenerateHostedWebHealthCommons(input: {
  abortSignal: AbortSignal | undefined;
  env: NodeJS.ProcessEnv;
  stderrTarget: NodeJS.WritableStream | undefined;
}): Promise<void> {
  if (input.env[HEALTH_COMMONS_GENERATED_PREPARED_ENV] === "1") {
    writePreparedGeneratedArtifactSkip(
      input.stderrTarget,
      "Health Commons generated artifacts",
    );
    return;
  }

  await runCommand("pnpm", ["health-commons:generate"], {
    cwd: repoRoot,
    env: input.env,
    name: "setup",
    signal: input.abortSignal,
  });
}

function writePreparedGeneratedArtifactSkip(
  stderrTarget: NodeJS.WritableStream | undefined,
  label: string,
): void {
  (stderrTarget ?? process.stderr).write(
    `[setup] Skipping ${label}; already prepared for this hosted-local E2E run.\n`,
  );
}

function pickHostedLocalStripeAuthorityEnv(input: {
  inheritedEnv: NodeJS.ProcessEnv;
  localEnvFiles: Array<Record<string, string>>;
  localStripeEnv: Record<string, string>;
}): Record<string, string | undefined> {
  const authorityEnv: Record<string, string | undefined> = {};
  const keys = [
    "STRIPE_SECRET_KEY",
    ...HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS,
  ] as const;

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input.localStripeEnv, key)) {
      authorityEnv[key] = input.localStripeEnv[key];
      continue;
    }

    const localEnvValue = pickLastDefinedEnvValue(input.localEnvFiles, key);

    if (localEnvValue !== undefined) {
      authorityEnv[key] = localEnvValue;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(input.inheritedEnv, key)) {
      authorityEnv[key] = input.inheritedEnv[key];
    }
  }

  return authorityEnv;
}

function pickLastDefinedEnvValue(
  envFiles: Array<Record<string, string>>,
  key: string,
): string | undefined {
  for (let index = envFiles.length - 1; index >= 0; index -= 1) {
    const envFile = envFiles[index];
    if (Object.prototype.hasOwnProperty.call(envFile, key)) {
      return envFile[key];
    }
  }

  return undefined;
}

function buildHostedLocalStripeBillingIsolationOverlay(
  authorityEnv: Record<string, string | undefined>,
): Record<string, undefined> {
  const hasLocalStripeSecretAuthority =
    typeof authorityEnv.STRIPE_SECRET_KEY === "string" &&
    authorityEnv.STRIPE_SECRET_KEY.trim().length > 0;
  const hasLocalStripePriceAuthority = Object.entries(authorityEnv).some(([key, value]) =>
    isHostedLocalStripeBillingPriceEnvKey(key) &&
    typeof value === "string" &&
    value.trim().length > 0
  );

  if (!hasLocalStripeSecretAuthority && !hasLocalStripePriceAuthority) {
    return {};
  }

  return Object.fromEntries(
    [
      "STRIPE_SECRET_KEY",
      ...HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS,
    ]
      .filter((key) => !Object.prototype.hasOwnProperty.call(authorityEnv, key))
      .map((key) => [key, undefined]),
  );
}

function isHostedLocalStripeBillingPriceEnvKey(
  key: string,
): key is (typeof HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS)[number] {
  return HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS.includes(
    key as (typeof HOSTED_LOCAL_STRIPE_BILLING_PRICE_ENV_KEYS)[number],
  );
}

async function invalidateHostedWebHealthCommonsDevCache(
  env: NodeJS.ProcessEnv,
  stderrTarget: NodeJS.WritableStream | undefined,
): Promise<void> {
  let invalidated = 0;

  for (const cachePath of resolveHostedWebHealthCommonsDevCachePaths(env)) {
    try {
      await rm(cachePath, { force: true, recursive: true });
      invalidated += 1;
    } catch (error) {
      writeHostedWebHealthCommonsInvalidationWarning(
        stderrTarget,
        `Unable to remove hosted web dev cache ${formatRepoPath(cachePath)}`,
        error,
      );
    }
  }

  const now = new Date();
  for (const filePath of HOSTED_WEB_HEALTH_COMMONS_BRIDGE_FILES) {
    try {
      await utimes(filePath, now, now);
      invalidated += 1;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      writeHostedWebHealthCommonsInvalidationWarning(
        stderrTarget,
        `Unable to touch hosted web Health Commons bridge ${formatRepoPath(filePath)}`,
        error,
      );
    }
  }

  if (invalidated > 0) {
    (stderrTarget ?? process.stderr).write(
      "[setup] Invalidated hosted web Health Commons dev cache.\n",
    );
  }
}

function assertHostedLocalE2eIsolation(
  env: NodeJS.ProcessEnv,
  config: HostedLocalDevConfig,
): void {
  if (!requiresHostedLocalE2eIsolation(env)) {
    return;
  }

  const failures: string[] = [];

  if (!config.skipWeb && config.webPort === DEFAULT_WEB_PORT) {
    failures.push("MURPH_DEV_WEB_PORT must not use the interactive default");
  }
  if (config.workerPort === DEFAULT_WORKER_PORT) {
    failures.push("MURPH_DEV_WORKER_PORT must not use the interactive default");
  }
  if (config.workerPersistDir === DEFAULT_WORKER_PERSIST_DIR) {
    failures.push("MURPH_DEV_CF_PERSIST_DIR must not use the interactive default");
  }
  if (env.MURPH_DEV_REUSE_EXISTING_WORKER === "1") {
    failures.push("MURPH_DEV_REUSE_EXISTING_WORKER must not be enabled");
  }
  if (!config.skipWeb && env.NEXT_DIST_DIR_MODE !== "smoke") {
    failures.push("NEXT_DIST_DIR_MODE must be smoke");
  }
  if (!config.skipWeb && !env.NEXT_DIST_DIR_SUFFIX?.trim()) {
    failures.push("NEXT_DIST_DIR_SUFFIX must be set");
  }
  if (
    !config.skipStripeListen
    && env.MURPH_HOSTED_LOCAL_E2E_STRIPE_LISTENER !== "1"
  ) {
    failures.push(
      "MURPH_DEV_SKIP_STRIPE_LISTEN must be 1 unless the isolated Stripe listener is explicitly owned",
    );
  }
  if (config.linqWebhookTunnelMode !== "disabled") {
    failures.push("MURPH_DEV_LINQ_WEBHOOK_TUNNEL must be disabled");
  }
  if (!config.skipLinqWebhookRegister) {
    failures.push("MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER must be 1");
  }

  if (failures.length === 0) {
    return;
  }

  throw new Error(
    [
      "Hosted-local E2E isolation is required, but this stack would overlap the interactive dev lane:",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}

function shouldStreamHostedLocalDockerEventsForensics(
  env: NodeJS.ProcessEnv,
): boolean {
  return requiresHostedLocalE2eIsolation(env)
    || env.MURPH_HOSTED_LOCAL_DOCKER_EVENTS_FORENSICS === "1";
}

function requiresHostedLocalE2eIsolation(env: NodeJS.ProcessEnv): boolean {
  const profile = env.MURPH_HOSTED_LOCAL_PROFILE?.trim();
  return env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function buildHostedWebProcessArgs(input: {
  config: HostedLocalDevConfig;
  shouldUseProductionStart: boolean;
}): string[] {
  const serverArgs = [
    "--hostname",
    input.config.webHost,
    "--port",
    String(input.config.webPort),
  ];

  if (input.shouldUseProductionStart) {
    return [
      "--dir",
      "apps/web",
      "exec",
      "next",
      "start",
      ...serverArgs,
    ];
  }

  // Keep the TypeScript loader to one Node option. The tsx CLI injects both a
  // require and an import, which Next can merge with a harness-owned preload.
  return [
    "--dir",
    ".",
    "exec",
    "node",
    "--import=tsx",
    "apps/web/scripts/dev-local.ts",
    "--",
    ...serverArgs,
  ];
}

function buildHostedWebProcessEnv(
  env: NodeJS.ProcessEnv,
  shouldUseProductionStart: boolean,
): NodeJS.ProcessEnv {
  if (shouldUseProductionStart) {
    return { ...env };
  }

  return {
    ...env,
    MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
  };
}

async function prepareHostedLocalTemporalMailboxSignalFaultPreload(input: {
  abortSignal: AbortSignal | undefined;
  env: NodeJS.ProcessEnv;
  expectedUserId: string;
  outputDir: string;
}): Promise<NodeJS.ProcessEnv> {
  const expectedUserId = input.expectedUserId.trim();
  if (!expectedUserId) {
    throw new Error(
      `${HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID_ENV} is required.`,
    );
  }

  const profile = input.env.MURPH_HOSTED_LOCAL_PROFILE?.trim();
  if (
    (profile !== "e2e:stub" && profile !== "e2e:live")
    || input.env.MURPH_HOSTED_LOCAL_TEST_ROUTES !== "1"
  ) {
    throw new Error(
      "The Temporal mailbox signal fault preload requires the hosted-local E2E test-control profile.",
    );
  }

  await rm(input.outputDir, { force: true, recursive: true });
  await mkdir(input.outputDir, { recursive: true });
  await runCommand("pnpm", [
    "--dir",
    "apps/web",
    "exec",
    "tsc",
    HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD_SOURCE,
    "--target",
    "ES2022",
    "--module",
    "CommonJS",
    "--moduleResolution",
    "Node",
    "--skipLibCheck",
    "--noEmitOnError",
    "--outDir",
    path.relative(webDir, input.outputDir),
    "--rootDir",
    path.dirname(HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD_SOURCE),
  ], {
    cwd: repoRoot,
    env: input.env,
    name: "setup",
    signal: input.abortSignal,
  });

  const preloadPath = path.join(
    input.outputDir,
    HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD_OUTPUT,
  );
  return {
    ...input.env,
    [HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID_ENV]: expectedUserId,
    NODE_OPTIONS: appendHostedLocalNodeRequireOption(
      input.env.NODE_OPTIONS,
      preloadPath,
    ),
  };
}

function appendHostedLocalNodeRequireOption(
  existingNodeOptions: string | undefined,
  preloadPath: string,
): string {
  const repoRelativePath = path.relative(repoRoot, preloadPath);
  if (
    path.isAbsolute(repoRelativePath)
    || repoRelativePath === ".."
    || repoRelativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Hosted-local Web preloads must stay inside the repository.");
  }
  const requireOption = `--require=${JSON.stringify(preloadPath)}`;
  const existing = existingNodeOptions?.trim();
  return existing ? `${existing} ${requireOption}` : requireOption;
}

function hasHostedLocalWorktreeScope(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env[HOSTED_LOCAL_WORKTREE_SCOPE_ENV]?.trim());
}

function usesHostedLocalIsolatedRunnerScope(env: NodeJS.ProcessEnv): boolean {
  return requiresHostedLocalE2eIsolation(env) || hasHostedLocalWorktreeScope(env);
}

function shouldUseIsolatedDockerConfig(env: NodeJS.ProcessEnv): boolean {
  return requiresHostedLocalE2eIsolation(env)
    && env[HOSTED_LOCAL_PRESERVE_DOCKER_CONFIG_ENV]?.trim() !== "1";
}

async function prepareHostedLocalCloudflareSourceSnapshot(input: {
  abortSignal: AbortSignal | undefined;
  tempDir: string;
}): Promise<HostedLocalCloudflareSourceSnapshot> {
  const workspaceRoot = path.join(
    input.tempDir,
    HOSTED_LOCAL_CLOUDFLARE_SOURCE_SNAPSHOT_DIR,
  );
  const cloudflareAppDir = path.join(workspaceRoot, "apps", "cloudflare");

  await rm(workspaceRoot, { force: true, recursive: true });
  await mkdir(cloudflareAppDir, { recursive: true });
  throwIfAbortSignalAborted(input.abortSignal);

  await copyFile(
    path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner"),
    path.join(workspaceRoot, "Dockerfile.cloudflare-hosted-runner"),
  );
  await copyFile(
    path.join(cloudflareDir, "package.json"),
    path.join(cloudflareAppDir, "package.json"),
  );
  await copyFile(
    path.join(cloudflareDir, ".dockerignore"),
    path.join(cloudflareAppDir, ".dockerignore"),
  );
  await cp(
    path.join(cloudflareDir, "src"),
    path.join(cloudflareAppDir, "src"),
    { recursive: true },
  );
  throwIfAbortSignalAborted(input.abortSignal);

  await mkdir(path.join(cloudflareAppDir, ".deploy"), { recursive: true });
  await cp(
    HOSTED_LOCAL_RUNNER_BUNDLE_ROOT,
    path.join(cloudflareAppDir, ".deploy", "runner-bundle"),
    { recursive: true },
  );
  await symlinkIfPresent(
    path.join(repoRoot, "node_modules"),
    path.join(workspaceRoot, "node_modules"),
  );
  await materializeHostedLocalCloudflareWorkspacePackages({
    abortSignal: input.abortSignal,
    cloudflareAppDir,
  });

  return { cloudflareAppDir, workspaceRoot };
}

async function materializeHostedLocalCloudflareWorkspacePackages(input: {
  abortSignal: AbortSignal | undefined;
  cloudflareAppDir: string;
}): Promise<void> {
  const packagesByName = discoverHostedLocalWorkspacePackages();
  const packageNames = resolveHostedLocalCloudflareWorkspacePackageNames(packagesByName);
  const nodeModulesRoot = path.join(input.cloudflareAppDir, "node_modules");
  const cloudflarePackageJson = readPackageJsonRecord(
    path.join(cloudflareDir, "package.json"),
  );

  await rm(
    path.join(nodeModulesRoot, HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE.slice(0, -1)),
    { force: true, recursive: true },
  );

  for (const packageName of packageNames) {
    throwIfAbortSignalAborted(input.abortSignal);
    const workspacePackage = packagesByName.get(packageName);
    if (!workspacePackage) {
      throw new Error(
        `Hosted local Cloudflare snapshot could not find workspace package ${packageName}.`,
      );
    }

    const packageTargetDir = path.join(nodeModulesRoot, ...packageName.split("/"));
    const sourceDistDir = path.join(workspacePackage.dir, "dist");
    if (!existsSync(sourceDistDir)) {
      throw new Error(
        `Hosted local Cloudflare snapshot requires ${packageName}/dist. Run the package build before starting pnpm dev.`,
      );
    }

    await mkdir(packageTargetDir, { recursive: true });
    await copyFile(
      workspacePackage.packageJsonPath,
      path.join(packageTargetDir, "package.json"),
    );
    await cp(sourceDistDir, path.join(packageTargetDir, "dist"), {
      recursive: true,
    });
    await linkHostedLocalExternalDependencies({
      dependencyNames: workspacePackage.externalDependencies,
      sourceNodeModulesRoot: path.join(workspacePackage.dir, "node_modules"),
      targetNodeModulesRoot: path.join(packageTargetDir, "node_modules"),
    });
  }

  await linkHostedLocalExternalDependencies({
    dependencyNames: readExternalDependencyNames(cloudflarePackageJson),
    sourceNodeModulesRoot: path.join(cloudflareDir, "node_modules"),
    targetNodeModulesRoot: nodeModulesRoot,
  });
}

async function linkHostedLocalExternalDependencies(input: {
  dependencyNames: readonly string[];
  sourceNodeModulesRoot: string;
  targetNodeModulesRoot: string;
}): Promise<void> {
  for (const dependencyName of input.dependencyNames) {
    const dependencyParts = dependencyName.split("/");
    const sourcePath = path.join(input.sourceNodeModulesRoot, ...dependencyParts);
    const targetPath = path.join(input.targetNodeModulesRoot, ...dependencyParts);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await symlinkIfPresent(sourcePath, targetPath);
  }
}

function resolveHostedLocalCloudflareWorkspacePackageNames(
  packagesByName: ReadonlyMap<string, HostedLocalWorkspacePackage>,
): readonly string[] {
  const cloudflarePackageJsonPath = path.join(cloudflareDir, "package.json");
  const cloudflarePackageJson = readPackageJsonRecord(cloudflarePackageJsonPath);
  const queue = readWorkspaceDependencyNames(cloudflarePackageJson);
  const names: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index];
    if (seen.has(packageName)) {
      continue;
    }

    const workspacePackage = packagesByName.get(packageName);
    if (!workspacePackage) {
      throw new Error(
        `Cloudflare depends on ${packageName}, but no matching workspace package was found.`,
      );
    }

    seen.add(packageName);
    names.push(packageName);
    queue.push(...workspacePackage.dependencies);
  }

  return names;
}

function discoverHostedLocalWorkspacePackages(): ReadonlyMap<string, HostedLocalWorkspacePackage> {
  const packagesRoot = path.join(repoRoot, "packages");
  const packagesByName = new Map<string, HostedLocalWorkspacePackage>();

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesRoot, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readPackageJsonRecord(packageJsonPath);
    const packageName = packageJson.name;
    if (
      typeof packageName !== "string"
      || !packageName.startsWith(HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE)
    ) {
      continue;
    }

    packagesByName.set(packageName, {
      dependencies: readWorkspaceDependencyNames(packageJson),
      dir: path.dirname(packageJsonPath),
      externalDependencies: readExternalDependencyNames(packageJson),
      packageJsonPath,
    });
  }

  return packagesByName;
}

function readPackageJsonRecord(packageJsonPath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Invalid package.json at ${formatRepoPath(packageJsonPath)}.`);
  }

  return parsed;
}

function readWorkspaceDependencyNames(
  packageJson: Record<string, unknown>,
): string[] {
  return readPackageDependencyNames(packageJson, "workspace");
}

function readExternalDependencyNames(
  packageJson: Record<string, unknown>,
): string[] {
  return readPackageDependencyNames(packageJson, "external");
}

function readPackageDependencyNames(
  packageJson: Record<string, unknown>,
  kind: "external" | "workspace",
): string[] {
  const dependencies = isRecord(packageJson.dependencies)
    ? packageJson.dependencies
    : {};

  return Object.entries(dependencies)
    .filter(([name, version]) => {
      if (typeof version !== "string") {
        return false;
      }

      const workspaceDependency =
        name.startsWith(HOSTED_LOCAL_WORKSPACE_PACKAGE_SCOPE)
        && version.startsWith("workspace:");
      return kind === "workspace" ? workspaceDependency : !workspaceDependency;
    })
    .map(([name]) => name);
}

async function symlinkIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await access(sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  await symlink(sourcePath, targetPath, "dir");
}

async function maybePersistHostedLocalLinqWebhookSecret(input: {
  envPath: string;
  existingEnv: Readonly<Record<string, string | undefined>>;
  stderrTarget?: NodeJS.WritableStream;
  webhookSecret: string;
}): Promise<void> {
  if (normalizeOptionalEnvValue(input.existingEnv.LINQ_WEBHOOK_SECRET) === input.webhookSecret) {
    return;
  }

  const currentText = await readOptionalTextFile(input.envPath);
  const nextText = upsertSimpleEnvAssignment(
    currentText ?? "",
    "LINQ_WEBHOOK_SECRET",
    input.webhookSecret,
  );
  await writePrivateTextFileAtomically(input.envPath, nextText);
  (input.stderrTarget ?? process.stderr).write(
    "[linq] Updated ignored apps/web/.env.local with the local Linq webhook signing secret.\n",
  );
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function upsertSimpleEnvAssignment(raw: string, key: string, value: string): string {
  const assignment = `${key}=${quoteSimpleEnvValue(value)}`;
  const lines = raw.length > 0 ? raw.split(/\r?\n/u) : [];
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (isSimpleEnvAssignmentForKey(line, key)) {
      replaced = true;
      return assignment;
    }
    return line;
  });
  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(assignment);
  }
  return `${nextLines.join("\n").replace(/\n*$/u, "")}\n`;
}

function isSimpleEnvAssignmentForKey(line: string, key: string): boolean {
  const trimmed = line.trimStart();
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(withoutExport);
  return match?.[1] === key;
}

function quoteSimpleEnvValue(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;
}

function normalizeOptionalEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

async function writePrivateTextFileAtomically(
  filePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertHostedLocalWorktreeRuntimePreconditions(env: NodeJS.ProcessEnv): void {
  if (!hasHostedLocalWorktreeScope(env)) {
    return;
  }
  if (isHostedLocalWorkerReuseEnabled(env)) {
    throw new Error(
      "MURPH_DEV_REUSE_EXISTING_WORKER must not be enabled for hosted-local worktree scopes.",
    );
  }
}

async function prepareIsolatedDockerConfig(input: {
  configDir: string;
  sourceEnv: NodeJS.ProcessEnv;
}): Promise<void> {
  await mkdir(input.configDir, { mode: 0o700, recursive: true });
  await writeFile(
    path.join(input.configDir, "config.json"),
    '{"auths":{}}\n',
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await symlinkDockerCliPluginsIfPresent({
    targetConfigDir: input.configDir,
    sourceEnv: input.sourceEnv,
  });
}

async function symlinkDockerCliPluginsIfPresent(input: {
  targetConfigDir: string;
  sourceEnv: NodeJS.ProcessEnv;
}): Promise<void> {
  const targetDir = path.join(input.targetConfigDir, "cli-plugins");
  const sourceDir = await findDockerCliPluginSourceDir({
    sourceEnv: input.sourceEnv,
    targetDir,
  });
  if (sourceDir === null) {
    return;
  }

  await rm(targetDir, { force: true, recursive: true });
  await symlink(sourceDir, targetDir, "dir");
}

async function findDockerCliPluginSourceDir(input: {
  sourceEnv: NodeJS.ProcessEnv;
  targetDir: string;
}): Promise<string | null> {
  for (const candidate of resolveDockerCliPluginSourceDirs(input.sourceEnv)) {
    if (path.resolve(candidate) === path.resolve(input.targetDir)) {
      continue;
    }

    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function resolveDockerCliPluginSourceDirs(env: NodeJS.ProcessEnv): string[] {
  const dockerConfig = env.DOCKER_CONFIG?.trim();
  const candidates = [
    ...(dockerConfig ? [path.join(dockerConfig, "cli-plugins")] : []),
    path.join(os.homedir(), ".docker", "cli-plugins"),
    ...(process.platform === "darwin"
      ? ["/Applications/Docker.app/Contents/Resources/cli-plugins"]
      : []),
    "/usr/local/lib/docker/cli-plugins",
    "/usr/libexec/docker/cli-plugins",
    "/usr/lib/docker/cli-plugins",
  ];
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function resolvePreStartHostedRunnerContainerCleanupScope(
  env: NodeJS.ProcessEnv,
): HostedRunnerContainerCleanupScope {
  return usesHostedLocalIsolatedRunnerScope(env) ? "current-build" : "all-builds";
}

function shouldUseGlobalCloudflareDevVarsSymlink(env: NodeJS.ProcessEnv): boolean {
  return !usesHostedLocalIsolatedRunnerScope(env);
}

function resolveHostedWebHealthCommonsDevCachePaths(env: NodeJS.ProcessEnv): string[] {
  const distDirName = resolveHostedWebDevDistDirName(env);
  return [
    path.join(webDir, distDirName, "dev", "cache", "fetch-cache"),
  ];
}

function writeHostedWebHealthCommonsInvalidationWarning(
  stderrTarget: NodeJS.WritableStream | undefined,
  message: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  (stderrTarget ?? process.stderr).write(`[setup] ${message}: ${detail}\n`);
}

function formatRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function requireLinqWebhookTunnelConfigPath(
  setup: HostedLocalLinqWebhookSetup,
): string {
  if (!setup.tunnelConfigPath) {
    throw new Error("Linq webhook tunnel config path is required to start cloudflared.");
  }
  return setup.tunnelConfigPath;
}

function requireLinqWebhookTunnelName(
  setup: HostedLocalLinqWebhookSetup,
): string {
  if (!setup.tunnelName) {
    throw new Error("Linq webhook tunnel name is required to start cloudflared.");
  }
  return setup.tunnelName;
}

function buildCloudflaredProcessEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passthrough = [
    "HOME",
    "PATH",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of passthrough) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

function buildHostedLocalTemporalProcessEnv(input: {
  cloudflareDevVars: Record<string, string>;
  runtimeEnv: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const callbackPrivateJwkJson =
    input.cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?.trim();

  if (!callbackPrivateJwkJson) {
    return input.runtimeEnv;
  }

  return {
    ...input.runtimeEnv,
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackPrivateJwkJson,
  };
}

function resolveRepoRelativeChildArg(filePath: string): string {
  const relative = path.relative(repoRoot, filePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll(path.sep, "/");
  }

  return filePath;
}

function requireHostedLocalAssistantProviderEnv(env: NodeJS.ProcessEnv): void {
  const provider = env.HOSTED_ASSISTANT_PROVIDER?.trim() || HOSTED_LOCAL_REQUIRED_ASSISTANT_PROVIDER;
  if (provider !== HOSTED_LOCAL_REQUIRED_ASSISTANT_PROVIDER) {
    throw new Error(
      [
        "HOSTED_ASSISTANT_PROVIDER=openai is required for local hosted dev.",
        "The host-side Codex bridge has been removed.",
      ].join(" "),
    );
  }
  env.HOSTED_ASSISTANT_PROVIDER = HOSTED_LOCAL_REQUIRED_ASSISTANT_PROVIDER;

  requireEnvValue(
    "OPENAI_API_KEY",
    env.OPENAI_API_KEY,
    "Set OPENAI_API_KEY for hosted runner Codex app-server access through OpenAI.",
  );
}

const HOSTED_LOCAL_HOST_ONLY_CODEX_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "CODEX_AUTH_TOKEN",
  "CODEX_CI",
  "CODEX_HOME",
  "CODEX_MANAGED_BY_NPM",
  "CODEX_THREAD_ID",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_API_KEY",
  // Harness-derived only; inherited shell/env-file values are never trusted.
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
  "HF_TOKEN",
  "XAI_API_KEY",
] as const;

function stripHostedLocalHostOnlyCodexEnv<TEnv extends Record<string, string | undefined>>(
  env: TEnv,
): TEnv {
  const nextEnv = { ...env };
  for (const key of HOSTED_LOCAL_HOST_ONLY_CODEX_ENV_NAMES) {
    delete nextEnv[key];
  }
  return nextEnv;
}

async function prepareHostedLocalCodexModelCatalog(input: {
  catalogPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<string> {
  const result = spawnSync(
    "codex",
    ["debug", "models", "--bundled"],
    {
      encoding: "utf8",
      env: buildHostedLocalCodexCatalogCommandEnv(input.env),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) {
    throw new Error("Hosted local dev could not read the bundled Codex model catalog.", {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error("Hosted local dev could not read the bundled Codex model catalog.");
  }

  const catalogText = buildHostedLocalOpenAiCodexModelCatalogText(result.stdout);
  await mkdir(path.dirname(input.catalogPath), { mode: 0o700, recursive: true });
  await writeFile(input.catalogPath, catalogText, { encoding: "utf8", mode: 0o644 });
  await chmod(input.catalogPath, 0o644);

  return input.catalogPath;
}

function buildHostedLocalCodexCatalogCommandEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...(env.PATH ? { PATH: env.PATH } : {}),
    ...(env.PATHEXT ? { PATHEXT: env.PATHEXT } : {}),
    ...(env.SystemRoot ? { SystemRoot: env.SystemRoot } : {}),
    ...(env.SystemDrive ? { SystemDrive: env.SystemDrive } : {}),
  };
}

function buildHostedLocalOpenAiCodexModelCatalogText(rawCatalog: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCatalog);
  } catch (error) {
    throw new Error("Hosted local dev received an invalid Codex model catalog.", {
      cause: error,
    });
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error("Hosted local dev received a Codex model catalog without a models array.");
  }

  const targetModel = parsed.models
    .filter(isRecord)
    .find((candidate) => candidate.slug === HOSTED_LOCAL_OPENAI_FLEX_MODEL_SLUG);
  if (!targetModel) {
    throw new Error(
      `Hosted local dev Codex model catalog is missing ${HOSTED_LOCAL_OPENAI_FLEX_MODEL_SLUG}.`,
    );
  }

  const serviceTiers = Array.isArray(targetModel.service_tiers)
    ? targetModel.service_tiers
    : [];
  const hasFlexTier = serviceTiers
    .filter(isRecord)
    .some((candidate) => candidate.id === HOSTED_LOCAL_OPENAI_FLEX_SERVICE_TIER.id);
  targetModel.service_tiers = hasFlexTier
    ? serviceTiers
    : [
      ...serviceTiers,
      HOSTED_LOCAL_OPENAI_FLEX_SERVICE_TIER,
    ];

  const deploySmokeModel = parsed.models
    .filter(isRecord)
    .find((candidate) => candidate.slug === HOSTED_LOCAL_DEPLOY_SMOKE_MODEL_SLUG);
  if (deploySmokeModel) {
    Object.assign(deploySmokeModel, {
      description: "Fast, low-cost model for deploy smoke checks.",
      display_name: "GPT-5.4-Nano",
      priority: 5,
      service_tiers: [],
      supports_parallel_tool_calls: false,
      supports_search_tool: false,
      // The OpenAI API rejects gpt-5.4-nano when Codex >= 0.143 sends the
      // x-openai-internal-codex-responses-lite header.
      use_responses_lite: false,
    });
  } else {
    const templateModel = parsed.models
      .filter(isRecord)
      .find((candidate) => candidate.slug === HOSTED_LOCAL_DEPLOY_SMOKE_TEMPLATE_MODEL_SLUG);
    if (!templateModel) {
      throw new Error(
        `Hosted local dev Codex model catalog is missing ${HOSTED_LOCAL_DEPLOY_SMOKE_TEMPLATE_MODEL_SLUG}.`,
      );
    }

    parsed.models.push({
      ...templateModel,
      description: "Fast, low-cost model for deploy smoke checks.",
      display_name: "GPT-5.4-Nano",
      priority: 5,
      service_tiers: [],
      slug: HOSTED_LOCAL_DEPLOY_SMOKE_MODEL_SLUG,
      supports_parallel_tool_calls: false,
      supports_search_tool: false,
      use_responses_lite: false,
    });
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldUseRemoteHostedCryptoKeys(env: Record<string, string | undefined>): boolean {
  return isHostedLocalTruthyEnvValue(env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV]);
}

function stripHostedCryptoMaterialEnv<TEnv extends Record<string, string | undefined>>(
  env: TEnv,
): TEnv {
  const nextEnv = { ...env };
  for (const key of Object.keys(nextEnv)) {
    if (
      key.startsWith("HOSTED_CRYPTO_")
      || key.startsWith("HOSTED_WEB_CALLBACK_SIGNING_")
      || key.startsWith("HOSTED_WEB_ENCRYPTION_")
      || key.startsWith("HOSTED_WAKE_ENCRYPTION_")
      || /^HOSTED_EXECUTION_(?:PLATFORM_ENVELOPE|AUTOMATION_RECIPIENT|RECOVERY_RECIPIENT|TEE_AUTOMATION_RECIPIENT)(?:_|$)/u
        .test(key)
    ) {
      delete nextEnv[key];
    }
  }
  return nextEnv;
}

async function maybeRunRunnerContainerSmoke(input: {
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv | null;
  stderrTarget?: NodeJS.WritableStream;
  workerBaseUrl: string;
}): Promise<void> {
  if (input.env === null || input.config.skipRunnerSmoke) {
    return;
  }

  if (await hasHostedLocalE2eRunnerSmokeProof(input.env)) {
    input.stderrTarget?.write(
      "[setup] Skipping runner container deploy-smoke; already proved for this hosted-local E2E run.\n",
    );
    return;
  }

  try {
    await runCommand("pnpm", ["--dir", "apps/cloudflare", "deploy:smoke"], {
      cwd: repoRoot,
      env: {
        ...input.env,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: input.workerBaseUrl,
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS:
          input.env.HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS?.trim() || "30",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS:
          input.env.HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS?.trim() || "1000",
      },
      name: "setup",
    });
    await markHostedLocalE2eRunnerSmokeProved(input.env);
  } catch (error) {
    if (requiresHostedLocalE2eIsolation(input.env)) {
      throw error;
    }
    writeRunnerContainerSmokeWarning(input.stderrTarget, error);
  }
}

async function hasHostedLocalE2eRunnerSmokeProof(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!shouldRunHostedLocalE2eRunnerSmokeOnce(env)) {
    return false;
  }

  const buildId = env[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim();
  if (!buildId) {
    return false;
  }

  return process.env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV]?.trim() === buildId
    || env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV]?.trim() === buildId
    || (await readHostedLocalE2eRunnerSmokeProofBuildId(env)) === buildId;
}

async function markHostedLocalE2eRunnerSmokeProved(env: NodeJS.ProcessEnv): Promise<void> {
  if (!shouldRunHostedLocalE2eRunnerSmokeOnce(env)) {
    return;
  }

  const buildId = env[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim();
  if (!buildId) {
    return;
  }

  env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV] = buildId;
  process.env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID_ENV] = buildId;
  const proofPath = resolveHostedLocalE2eRunnerSmokeProofPath(env);
  if (proofPath === null) {
    return;
  }

  await writeFile(
    proofPath,
    `${JSON.stringify({
      buildId,
      provedAt: new Date().toISOString(),
    })}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

function shouldRunHostedLocalE2eRunnerSmokeOnce(env: NodeJS.ProcessEnv): boolean {
  return env[HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE_ENV] === "1"
    && requiresHostedLocalE2eIsolation(env);
}

async function readHostedLocalE2eRunnerSmokeProofBuildId(
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const proofPath = resolveHostedLocalE2eRunnerSmokeProofPath(env);
  if (proofPath === null) {
    return null;
  }

  try {
    const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
      buildId?: unknown;
    };
    return typeof proof.buildId === "string" ? proof.buildId.trim() || null : null;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function resolveHostedLocalE2eRunnerSmokeProofPath(env: NodeJS.ProcessEnv): string | null {
  const artifactDir = env.MURPH_HOSTED_LOCAL_ARTIFACT_DIR?.trim();
  if (!artifactDir) {
    return null;
  }

  return path.join(artifactDir, HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROOF_FILE);
}

function writeRunnerContainerSmokeWarning(
  stderrTarget: NodeJS.WritableStream | undefined,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  (stderrTarget ?? process.stderr).write(
    [
      "[setup] Runner container deploy-smoke failed after local web/worker health checks passed; keeping hosted-local dev running.\n",
      "[setup] Hosted runner/container paths may fail until this smoke issue is fixed. ",
      "Set MURPH_DEV_SKIP_RUNNER_SMOKE=1 to skip this proof during focused local debugging.\n",
      `[setup] deploy-smoke failure: ${redactHostedLocalDiagnosticText(detail)}\n`,
    ].join(""),
  );
}

function maybeStartTlsProxy(input: {
  pipeOutput?: boolean;
  runtimeEnv: NodeJS.ProcessEnv;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
}): BufferedNamedChildProcess | null {
  if (input.runtimeEnv.MURPH_DEV_SKIP_TLS_PROXY === "1") {
    return null;
  }

  const caddyfilePath = path.join(repoRoot, "Caddyfile");
  if (!existsSync(caddyfilePath)) {
    return null;
  }

  try {
    execFileSync("which", ["caddy"], { stdio: "ignore" });
  } catch {
    (input.stderrTarget ?? process.stderr).write(
      "[tls-proxy] Caddyfile found but `caddy` is not on PATH; skipping local HTTPS proxy. Install with `brew install caddy` to enable.\n",
    );
    return null;
  }

  return spawnChildProcess("tls-proxy", "caddy", [
    "run",
    "--config",
    caddyfilePath,
  ], input.runtimeEnv, {
    pipeOutput: input.pipeOutput,
    stderrTarget: input.stderrTarget,
    stdoutTarget: input.stdoutTarget,
  });
}

async function maybeStartStripeWebhookListener(input: {
  config: HostedLocalDevConfig;
  initialEnv: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  repoEnv: NodeJS.ProcessEnv;
  runtimeEnv: NodeJS.ProcessEnv;
  stripeCliApiKey: string | null;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
}): Promise<BufferedNamedChildProcess | null> {
  const { config, initialEnv, repoEnv, runtimeEnv } = input;
  if (config.skipStripeListen || config.skipWeb) {
    return null;
  }

  const stderrTarget = input.stderrTarget ?? process.stderr;

  const shellSecret = initialEnv.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const repoSecret = repoEnv.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const trustedExistingSecret = shellSecret.length > 0
    ? shellSecret
    : repoSecret.length > 0
      ? repoSecret
      : null;

  if (trustedExistingSecret === null) {
    delete runtimeEnv.STRIPE_WEBHOOK_SECRET;
  }

  const forwardUrl = `http://${config.webHost}:${config.webPort}${STRIPE_WEBHOOK_FORWARD_PATH}`;

  try {
    const result = await spawnStripeListenerWithSecretCapture({
      args: ["listen", "--forward-to", forwardUrl],
      command: "stripe",
      env: {
        ...runtimeEnv,
        ...(input.stripeCliApiKey === null
          ? {}
          : { STRIPE_API_KEY: input.stripeCliApiKey }),
      },
      pipeOutput: input.pipeOutput,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
      timeoutMs: STRIPE_LISTENER_SECRET_CAPTURE_TIMEOUT_MS,
    });

    if (trustedExistingSecret !== null) {
      runtimeEnv.STRIPE_WEBHOOK_SECRET = trustedExistingSecret;
      if (trustedExistingSecret !== result.secret) {
        stderrTarget.write(
          [
            "[stripe] STRIPE_WEBHOOK_SECRET from shell or repo .env does not match the listener's captured secret; ",
            "hosted webhook signature verification will fail unless the shell value matches the CLI login. ",
            "Unset the shell value or set MURPH_DEV_SKIP_STRIPE_LISTEN=1 to manage the listener yourself.\n",
          ].join(""),
        );
      }
    } else {
      runtimeEnv.STRIPE_WEBHOOK_SECRET = result.secret;
    }

    return result.child;
  } catch (error) {
    if (error instanceof StripeCliMissingError) {
      stderrTarget.write(
        [
          "[stripe] Stripe CLI not found on PATH — skipping the local webhook listener.\n",
          "[stripe] Install with `brew install stripe/stripe-cli/stripe` (docs: https://docs.stripe.com/stripe-cli)\n",
          "[stripe] Hosted onboarding checkout will fail locally until a webhook signing secret is available.\n",
          "[stripe] Set MURPH_DEV_SKIP_STRIPE_LISTEN=1 to silence this warning.\n",
        ].join(""),
      );
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    stderrTarget.write(
      `[stripe] Failed to start the Stripe webhook listener: ${message}\n`,
    );
    stderrTarget.write(
      "[stripe] Continuing without the listener; hosted onboarding checkout will fail locally until webhooks are available.\n",
    );
    return null;
  }
}

function resolveHostedLocalTempDir(
  root: string,
  override: string,
): string {
  const tempRoot = path.join(root, ".tmp");
  const worktreeStateRoot = path.resolve(root, HOSTED_LOCAL_WORKTREE_ROOT);
  const resolved = path.resolve(root, override);
  const relative = path.relative(tempRoot, resolved);
  const relativeToWorktreeState = path.relative(worktreeStateRoot, resolved);

  if (
    relative.length === 0
    || relative === "."
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error("MURPH_DEV_TEMP_DIR must resolve inside the repo-local .tmp directory.");
  }
  if (
    relativeToWorktreeState.length === 0
    || relativeToWorktreeState === "."
    || (!relativeToWorktreeState.startsWith("..")
      && !path.isAbsolute(relativeToWorktreeState))
  ) {
    throw new Error(
      "MURPH_DEV_TEMP_DIR must not resolve inside the hosted-local worktree state directory.",
    );
  }

  return resolved;
}

function resolveContainerReachableWorkerOrigin(
  config: HostedLocalDevConfig,
  env: NodeJS.ProcessEnv,
): string {
  const reachableHost = resolveContainerReachableWorkerHost(config.workerHost, env);
  return `${config.workerProtocol}://${reachableHost}:${config.workerPort}`;
}

function resolveContainerReachableWorkerHost(
  workerHost: string,
  env: NodeJS.ProcessEnv,
): string {
  if (!isLoopbackWorkerHost(workerHost)) {
    return workerHost;
  }

  const configured = env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform !== "linux") {
    return "host.docker.internal";
  }

  const gateway = readLinuxDockerBridgeGatewayHost();
  if (gateway) {
    return gateway;
  }

  throw new Error(
    "Hosted local dev on Linux could not resolve a container-reachable worker host. Set HOSTED_EXECUTION_RUNNER_HOST_ALIAS to the host bridge address.",
  );
}

function isLoopbackWorkerHost(value: string): boolean {
  return value === "127.0.0.1"
    || value === "0.0.0.0"
    || value === "::1"
    || value === "::"
    || value === "localhost";
}

function readLinuxDockerBridgeGatewayHost(): string | null {
  const result = spawnSync(
    "docker",
    [
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const gateway = result.stdout.trim();
  return gateway.length > 0 ? gateway : null;
}

function resolveWranglerDebugArgs(env: NodeJS.ProcessEnv): string[] {
  const logLevel = env.MURPH_DEV_CF_WRANGLER_LOG_LEVEL?.trim();
  if (!logLevel) {
    return [];
  }

  return [
    "--log-level",
    logLevel,
    "--show-interactive-dev-session=false",
  ];
}

function appendStartupDiagnostics(
  error: unknown,
  diagnostics: string,
  children: readonly BufferedNamedChildProcess[],
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const output = combineChildOutput(children);
  return new Error(
    [
      message,
      output ? `process output tail:\n${tail(output)}` : null,
      redactHostedLocalDiagnosticText(diagnostics),
    ].filter((value): value is string => value !== null).join("\n"),
  );
}

function combineChildOutput(input: readonly BufferedNamedChildProcess[] | readonly string[]): string {
  return input
    .map((value) => typeof value === "string"
      ? value
      : [
        `[${value.name}:stdout]`,
        value.stdoutTail(),
        `[${value.name}:stderr]`,
        value.stderrTail(),
      ].join("\n"))
    .filter((value) => value.trim().length > 0)
    .join("\n");
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

function ensurePreparedRunnerContainerImageAlias(stdout: string): void {
  const artifacts = readPreparedRunnerContainerImageArtifacts(stdout);
  if (artifacts.length === 0) {
    return;
  }

  for (const artifact of artifacts) {
    if (hasDockerImageRef(artifact.ref)) {
      continue;
    }

    if (!artifact.imageIdPrefix) {
      throw new Error(
        `Prepared runner container image ${artifact.ref} is missing and no local image id was found in dev output.`,
      );
    }

    const existingRef = findPreparedRunnerContainerImageRefByIdPrefix(artifact.imageIdPrefix);
    if (!existingRef) {
      throw new Error(
        `Prepared runner container image ${artifact.ref} is missing and no local image matches id prefix ${artifact.imageIdPrefix}.`,
      );
    }

    spawnSync("docker", ["tag", existingRef, artifact.ref], {
      stdio: "pipe",
    });
  }
}

type PreparedRunnerContainerImageArtifact = {
  imageIdPrefix: string | null;
  ref: string;
};

function readPreparedRunnerContainerImageArtifacts(
  stdout: string,
): PreparedRunnerContainerImageArtifact[] {
  const artifacts: PreparedRunnerContainerImageArtifact[] = [];
  let latestImageIdPrefix: string | null = null;

  for (const line of stdout.split("\n")) {
    const manifestMatch = line.match(/(?:exporting manifest|writing image) sha256:([a-f0-9]{12,64})/);
    if (manifestMatch?.[1]) {
      latestImageIdPrefix = manifestMatch[1].slice(0, 12);
      continue;
    }

    const refMatch = line.match(
      /naming to docker\.io\/(cloudflare-dev\/(?:runnercontainer|deploysmokerunnercontainer):[a-f0-9]+)\s+done/,
    );
    if (refMatch?.[1]) {
      artifacts.push({
        imageIdPrefix: latestImageIdPrefix,
        ref: refMatch[1],
      });
    }
  }

  return artifacts;
}

function hasDockerImageRef(imageRef: string): boolean {
  const result = spawnSync("docker", ["image", "inspect", imageRef], {
    stdio: "pipe",
  });
  return result.status === 0;
}

function findPreparedRunnerContainerImageRefByIdPrefix(expectedIdPrefix: string): string | null {
  const result = spawnSync(
    "docker",
    ["images", "--format", "{{.Repository}}:{{.Tag}} {{.ID}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    return null;
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [imageRef, imageId] = line.split(/\s+/, 2);
    if (
      !imageRef?.startsWith("cloudflare-dev/runnercontainer:")
      && !imageRef?.startsWith("cloudflare-dev/deploysmokerunnercontainer:")
    ) {
      continue;
    }

    if (imageId?.startsWith(expectedIdPrefix)) {
      return imageRef;
    }
  }

  return null;
}

function isHostedLocalWorkerReuseEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.MURPH_DEV_REUSE_EXISTING_WORKER?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function resolveHostedLocalChildShutdownSignal(signal: NodeJS.Signals): NodeJS.Signals {
  return signal === "SIGINT" ? "SIGTERM" : signal;
}
