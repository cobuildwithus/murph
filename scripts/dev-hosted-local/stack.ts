import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveHostedLocalDevConfig } from "./config.ts";
import {
  startHostedLocalCodexBridge,
  type HostedLocalCodexBridge,
} from "./codex-bridge.ts";
import {
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  repoRoot,
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
  resolveHostedLocalDatabaseUrl,
  readOptionalSimpleEnvFile,
  readHostedLocalStripeEnvFile,
  readSimpleEnvFile,
  requireEnvValue,
  resolveCloudflareLocalEnv,
  shouldSyncLocalDatabaseSchema,
  warnForMissingEnv,
} from "./environment.ts";
import {
  assertHostedWebDevServerAvailable,
  assertHostedWebPortAvailable,
  cleanupHostedRunnerContainers,
  collectDockerDevDiagnostics,
  resolveHostedLocalWorkerPortMode,
  runCommand,
  spawnChildProcess,
  spawnStripeListenerWithSecretCapture,
  StripeCliMissingError,
  terminateChildProcessAndWait,
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
} from "./runtime.ts";
import {
  writeHostedLocalStripeCheckoutDiagnostics,
} from "./stripe.ts";
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

const HOSTED_WEB_HEALTH_PATH = "/api/internal/health";
const HOSTED_WEB_HEALTH_COMMONS_DEV_CACHE_PATHS = [
  path.join(webDir, ".next-dev", "dev", "cache", "fetch-cache"),
];
const HOSTED_WEB_HEALTH_COMMONS_BRIDGE_FILES = [
  path.join(webDir, "src", "lib", "health-commons", "biomarker-detail.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-browse.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-detail.ts"),
  path.join(webDir, "src", "lib", "health-commons", "experiment-projections.ts"),
  path.join(webDir, "src", "lib", "health-commons", "generated-experiment-artifacts.ts"),
  path.join(webDir, "src", "lib", "health-commons", "measurement-method-detail.ts"),
];
const HOSTED_LOCAL_CODEX_PROVIDER_ID = "local-codex";
const DEFAULT_HOSTED_CODEX_MODEL = "gpt-5.5";

export interface HostedLocalDevStack {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
  oidcToken: string;
  processes: {
    cloudflare: BufferedNamedChildProcess | null;
    codex: HostedLocalCodexBridge | null;
    healthCommons: BufferedNamedChildProcess | null;
    stripe: BufferedNamedChildProcess | null;
    web: BufferedNamedChildProcess | null;
  };
  ready: Promise<void>;
  runtimeEnv: NodeJS.ProcessEnv;
  stderrTail(maxChars?: number): string;
  stdoutTail(maxChars?: number): string;
  stop(signal?: NodeJS.Signals): Promise<void>;
  waitForExit(): Promise<NamedChildProcess>;
  webBaseUrl: string | null;
  workerBaseUrl: string;
}

const STRIPE_WEBHOOK_FORWARD_PATH = "/api/hosted-onboarding/stripe/webhook";
const STRIPE_LISTENER_SECRET_CAPTURE_TIMEOUT_MS = 15_000;

export async function startHostedLocalDevStack(input: {
  env: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
}): Promise<HostedLocalDevStack> {
  const initialEnv = { ...input.env } satisfies NodeJS.ProcessEnv;
  const initialProcessEnv = copyWithoutHostedLocalCodexBridgeProxyEnv(initialEnv);
  const config = resolveHostedLocalDevConfig(initialEnv);
  const tempDirOverride = initialEnv.MURPH_DEV_TEMP_DIR?.trim() || null;
  const providedVercelOidcToken = initialEnv.VERCEL_OIDC_TOKEN?.trim() || null;
  const hostedRunnerLocalBuildId = buildHostedRunnerLocalBuildId(
    initialEnv[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim() || randomUUID(),
  );
  const tsxTsconfigPath = path.join(repoRoot, "tsconfig.base.json");
  const workerBaseUrl = `${config.workerProtocol}://${config.workerHost}:${config.workerPort}`;

  if (!config.skipVercelPull && !providedVercelOidcToken) {
    await ensureVercelLinkExists();
  }
  if (!config.skipWeb) {
    await assertHostedWebDevServerAvailable(initialEnv);
    await assertHostedWebPortAvailable({
      host: config.webHost,
      message: [
        `Local hosted web port ${config.webPort} is already in use on ${config.webHost}.`,
        "Stop the existing listener or set MURPH_DEV_WEB_PORT to a free port before running `pnpm dev`.",
      ].join(" "),
      port: config.webPort,
      stderrTarget: input.stderrTarget,
    });
  }
  const workerPortMode = await resolveHostedLocalWorkerPortMode({
    host: config.workerHost,
    message: [
      `Local Cloudflare worker port ${config.workerPort} is already in use on ${config.workerHost}.`,
      "Stop the existing listener or set MURPH_DEV_WORKER_PORT to a free port before running `pnpm dev`.",
    ].join(" "),
    port: config.workerPort,
    protocol: config.workerProtocol,
  });
  if (config.localCodexBridge && workerPortMode !== "start") {
    throw new Error(
      [
        `Local Cloudflare worker port ${config.workerPort} is already serving a Murph worker.`,
        "Stop that worker before running `pnpm dev`, or set MURPH_DEV_CODEX_BRIDGE=0 to reuse it without the local Codex bridge.",
      ].join(" "),
    );
  }

  const tempDir = tempDirOverride
    ? resolveHostedLocalTempDir(repoRoot, tempDirOverride)
    : await mkdtemp(path.join(os.tmpdir(), "murph-dev-env-"));
  if (tempDirOverride) {
    await rm(tempDir, { force: true, recursive: true });
    await mkdir(tempDir, { mode: 0o700, recursive: true });
  }
  await chmod(tempDir, 0o700);

  const pulledEnvPath = path.join(tempDir, ".env.local");
  const workerEnvPath = path.join(tempDir, "cloudflare-worker.env");
  const workerDevVarsPath = path.join(tempDir, "cloudflare-worker.dev.vars");
  const workerDevVarsBackupPath = path.join(tempDir, "cloudflare-worker.dev.vars.backup");
  const hostedLocalStateDevVarsPath = path.join(tempDir, "hosted-local-state.dev.vars");
  const workerConfigPath = path.join(tempDir, "cloudflare-worker.local-dev.generated.json");
  const repoEnvPath = path.join(repoRoot, ".env");
  const webEnvPath = path.join(webDir, ".env");
  const webLocalEnvPath = path.join(webDir, ".env.local");
  let restoreCloudflareDevVars = false;
  let hadExistingCloudflareDevVars = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let codexBridge: HostedLocalCodexBridge | null = null;
  const children: BufferedNamedChildProcess[] = [];
  let healthCommonsWatcher: BufferedNamedChildProcess | null = null;
  let stripeListener: BufferedNamedChildProcess | null = null;
  let workerRuntimeEnv: NodeJS.ProcessEnv | null = null;
  let workerProcessEnv: NodeJS.ProcessEnv | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  try {
    if (!config.skipVercelPull && !providedVercelOidcToken) {
      await runCommand("vercel", ["env", "pull", pulledEnvPath, "--environment=development"], {
        cwd: webDir,
        env: initialProcessEnv,
        name: "setup",
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
    const rawVercelEnv: NodeJS.ProcessEnv = {
      ...repoEnv,
      ...pulledEnv,
      ...webEnv,
      ...webLocalEnv,
      ...localStripeEnv,
      ...initialEnv,
    };
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
    stripHostedLocalCodexBridgeProxyEnv(vercelEnv);
    const localInternalProxyBaseUrl = resolveContainerReachableWorkerOrigin(config, vercelEnv);
    const codexBridgeEnv: Record<string, string> = {};

    if (config.localCodexBridge && workerPortMode === "start") {
      codexBridge = await startHostedLocalCodexBridge({
        codexCommand: config.localCodexCommand,
        env: initialProcessEnv,
        listenHost: resolveHostedLocalCodexBridgeListenHost({
          config,
          initialEnv,
          localInternalProxyBaseUrl,
        }),
        listenPort: config.localCodexBridgePort,
        stderrTarget: input.stderrTarget,
      });
      Object.assign(codexBridgeEnv, buildHostedLocalCodexBridgeWorkerEnv({
        bridge: codexBridge,
        initialEnv,
        mergedEnv: vercelEnv,
      }));
    }

    const oidcToken = await resolveVercelOidcToken(vercelEnv);
    const oidcIdentity = parseHostedExecutionOidcIdentity(oidcToken);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
      overrides: {
        ...vercelEnv,
        ...codexBridgeEnv,
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: localInternalProxyBaseUrl,
      },
    });
    const localOverrides = buildHostedLocalDevOverrides(config, cloudflareDevVars);
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...vercelEnv,
      ...localOverrides,
      TSX_TSCONFIG_PATH: tsxTsconfigPath,
      VERCEL_OIDC_TOKEN: oidcToken,
    };
    const workerRuntimeBaseEnv = codexBridge === null
      ? runtimeEnv
      : stripHostedLocalCodexCredentialEnv(runtimeEnv);
    const workerCloudflareDevVars = codexBridge === null
      ? cloudflareDevVars
      : stripHostedLocalCodexCredentialEnv(cloudflareDevVars);
    workerRuntimeEnv = workerPortMode === "start"
      ? {
        ...workerRuntimeBaseEnv,
        ...workerCloudflareDevVars,
        [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: hostedRunnerLocalBuildId,
      }
      : null;
    workerProcessEnv = workerRuntimeEnv === null
      ? null
      : copyWithoutHostedLocalCodexBridgeProxyEnv(workerRuntimeEnv);
    if (workerRuntimeEnv !== null) {
      const workerEnvText = `${buildWranglerEnvFileText(workerRuntimeEnv)}\n`;
      const hostedLocalStateEnvText = `${buildHostedLocalStateEnvFileText(cloudflareDevVars)}\n`;
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
      await writeFile(
        workerConfigPath,
        `${JSON.stringify(
          buildWranglerLocalDevConfig(workerRuntimeEnv, {
            configDir: path.dirname(workerConfigPath),
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

    await runCommand("pnpm", ["--dir", "apps/web", "prisma:generate"], {
      cwd: repoRoot,
      env: runtimeEnv,
      name: "setup",
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
        });
      } else {
        await runCommand("pnpm", ["--dir", "apps/web", "prisma:migrate:deploy"], {
          cwd: repoRoot,
          env: runtimeEnv,
          name: "setup",
        });
      }
    }

    if (!config.skipWeb) {
      await runCommand("pnpm", ["health-commons:generate"], {
        cwd: repoRoot,
        env: runtimeEnv,
        name: "setup",
      });
      await invalidateHostedWebHealthCommonsDevCache(input.stderrTarget);
    }

    if (workerRuntimeEnv !== null) {
      if (initialEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE !== "1") {
        await runCommand("pnpm", ["--dir", "apps/cloudflare", "runner:bundle"], {
          cwd: repoRoot,
          env: workerProcessEnv ?? workerRuntimeEnv,
          name: "setup",
        });
        if (workerProcessEnv !== null) {
          workerProcessEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE = "1";
        }
      }

      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerProcessEnv ?? workerRuntimeEnv,
      });
    }

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
        config.workerPersistDir,
        "--env-file",
        workerEnvPath,
        ...resolveWranglerDebugArgs(initialEnv),
        ...buildWranglerVarArgs(workerProcessEnv ?? workerRuntimeEnv),
      ], workerProcessEnv ?? workerRuntimeEnv, {
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

    stripeListener = await maybeStartStripeWebhookListener({
      config,
      initialEnv: initialProcessEnv,
      pipeOutput: input.pipeOutput,
      repoEnv,
      runtimeEnv,
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

    const webProcess = config.skipWeb
      ? null
      : spawnChildProcess("web", "pnpm", [
        "--dir",
        ".",
        "exec",
        "tsx",
        "apps/web/scripts/dev-local.ts",
        "--",
        "--hostname",
        config.webHost,
        "--port",
        String(config.webPort),
      ], {
        ...runtimeEnv,
        MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      }, {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (webProcess) {
      children.push(webProcess);
    }

    const webBaseUrl = config.skipWeb ? null : `http://${config.webHost}:${config.webPort}`;
    const cleanupTemporaryInputs = async (): Promise<void> => {
      if (restoreCloudflareDevVars) {
        await rm(cloudflareDevVarsPath, { force: true });
        if (hadExistingCloudflareDevVars) {
          await rm(workerDevVarsBackupPath, { force: true });
        }
        await rename(hostedLocalStateDevVarsPath, cloudflareDevVarsPath);
      }
      await rm(workerConfigPath, { force: true });
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
        for (const { child } of children) {
          await terminateChildProcessAndWait(child, { signal });
        }
        if (stripeListener !== null) {
          await terminateChildProcessAndWait(stripeListener.child, { signal });
        }
        if (codexBridge !== null) {
          await codexBridge.stop();
          codexBridge = null;
        }
        if (keepAliveTimer !== null) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        if (workerRuntimeEnv && workerPortMode === "start") {
          await cleanupHostedRunnerContainers({
            cwd: repoRoot,
            env: workerProcessEnv ?? workerRuntimeEnv,
            ignoreErrors: true,
          });
        }
        await cleanupTemporaryInputs();
      })();

      return await stopPromise;
    };

    const ready = (async (): Promise<void> => {
      try {
        const healthChecks = [
          waitForHealthyHttpEndpoint({
            host: config.workerHost,
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
            workerBaseUrl,
          });
        }
      } catch (error) {
        if (!stopped) {
          await stop("SIGTERM");
        }
        throw appendStartupDiagnostics(error, await collectDockerDevDiagnostics({
          cwd: repoRoot,
          env: workerProcessEnv ?? workerRuntimeEnv ?? undefined,
        }), children);
      }
    })();

    const reportingChildren = stripeListener === null
      ? children
      : [...children, stripeListener];

    return {
      config,
      oidcIdentity,
      oidcToken,
      processes: {
        cloudflare: cloudflareProcess,
        codex: codexBridge,
        healthCommons: healthCommonsWatcher,
        stripe: stripeListener,
        web: webProcess,
      },
      ready,
      runtimeEnv,
      stderrTail: (maxChars?: number): string => tail(combineChildOutput(
        reportingChildren.map(
          (child) => `[${child.name}:stderr]\n${child.stderrText()}`,
        ),
      ), maxChars),
      stdoutTail: (maxChars?: number): string => tail(combineChildOutput(
        reportingChildren.map(
          (child) => `[${child.name}:stdout]\n${child.stdoutText()}`,
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
    for (const { child } of children) {
      await terminateChildProcessAndWait(child, { signal: "SIGTERM" }).catch(() => {});
    }
    if (stripeListener !== null) {
      await terminateChildProcessAndWait(stripeListener.child, { signal: "SIGTERM" }).catch(() => {});
    }
    if (codexBridge !== null) {
      await codexBridge.stop().catch(() => {});
      codexBridge = null;
    }
    if (workerRuntimeEnv && workerPortMode === "start") {
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerProcessEnv ?? workerRuntimeEnv,
        ignoreErrors: true,
      }).catch(() => {});
    }
    if (!stopped) {
      await rm(workerConfigPath, { force: true }).catch(() => {});
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
}

async function invalidateHostedWebHealthCommonsDevCache(
  stderrTarget: NodeJS.WritableStream | undefined,
): Promise<void> {
  let invalidated = 0;

  for (const cachePath of HOSTED_WEB_HEALTH_COMMONS_DEV_CACHE_PATHS) {
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

function buildHostedLocalCodexBridgeWorkerEnv(input: {
  bridge: HostedLocalCodexBridge;
  initialEnv: NodeJS.ProcessEnv;
  mergedEnv: NodeJS.ProcessEnv;
}): Record<string, string> {
  const shellProvider = input.initialEnv.HOSTED_ASSISTANT_PROVIDER?.trim();
  if (shellProvider && shellProvider !== "vercel-ai-gateway") {
    throw new Error(
      [
        "MURPH_DEV_CODEX_BRIDGE requires HOSTED_ASSISTANT_PROVIDER to be unset or vercel-ai-gateway.",
        "Set MURPH_DEV_CODEX_BRIDGE=0 to use a custom hosted assistant provider in local dev.",
      ].join(" "),
    );
  }

  return {
    HOSTED_ASSISTANT_MODEL:
      input.mergedEnv.HOSTED_ASSISTANT_MODEL?.trim() || DEFAULT_HOSTED_CODEX_MODEL,
    HOSTED_ASSISTANT_PROVIDER: HOSTED_LOCAL_CODEX_PROVIDER_ID,
    [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV]: input.bridge.proxyToken,
    [HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV]: input.bridge.proxyUrl,
    NODE_ENV: "development",
  };
}

const HOSTED_LOCAL_CODEX_CREDENTIAL_ENV_NAMES = [
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
  "HF_TOKEN",
  "OPENAI_API_KEY",
  "VENICE_API_KEY",
  "VERCEL_AI_API_KEY",
  "XAI_API_KEY",
] as const;

function stripHostedLocalCodexCredentialEnv<TEnv extends Record<string, string | undefined>>(
  env: TEnv,
): TEnv {
  const nextEnv = { ...env };

  for (const key of HOSTED_LOCAL_CODEX_CREDENTIAL_ENV_NAMES) {
    delete nextEnv[key];
  }

  return nextEnv;
}

function stripHostedLocalCodexBridgeProxyEnv(env: Record<string, string | undefined>): void {
  delete env[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_TOKEN_ENV];
  delete env[HOSTED_RUNTIME_CODEX_APP_SERVER_PROXY_URL_ENV];
}

function shouldUseRemoteHostedCryptoKeys(env: Record<string, string | undefined>): boolean {
  const value = env[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
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

function copyWithoutHostedLocalCodexBridgeProxyEnv<TEnv extends Record<string, string | undefined>>(
  env: TEnv,
): TEnv {
  const nextEnv = { ...env };
  stripHostedLocalCodexBridgeProxyEnv(nextEnv);
  return nextEnv;
}

function resolveHostedLocalCodexBridgeListenHost(input: {
  config: HostedLocalDevConfig;
  initialEnv: NodeJS.ProcessEnv;
  localInternalProxyBaseUrl: string;
}): string {
  let proxyHost: string | null = null;
  try {
    proxyHost = new URL(input.localInternalProxyBaseUrl).hostname;
  } catch {
    proxyHost = null;
  }
  const normalizedProxyHost = normalizeBridgeHostname(proxyHost);

  if (input.initialEnv.MURPH_DEV_CODEX_BRIDGE_HOST?.trim()) {
    return requireHostedLocalCodexBridgeListenHost({
      allowedPrivateHost: normalizedProxyHost,
      hostname: input.config.localCodexBridgeHost,
    });
  }

  if (
    normalizedProxyHost
    && normalizedProxyHost !== "host.docker.internal"
    && !isLoopbackBridgeHostname(normalizedProxyHost)
  ) {
    return requireHostedLocalCodexBridgeListenHost({
      allowedPrivateHost: normalizedProxyHost,
      hostname: normalizedProxyHost,
    });
  }

  return requireHostedLocalCodexBridgeListenHost({
    allowedPrivateHost: normalizedProxyHost,
    hostname: input.config.localCodexBridgeHost,
  });
}

function normalizeBridgeHostname(hostname: string | null): string | null {
  const normalized = hostname?.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return normalized ? normalized : null;
}

function isLoopbackBridgeHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function requireHostedLocalCodexBridgeListenHost(input: {
  allowedPrivateHost: string | null;
  hostname: string;
}): string {
  const normalized = normalizeBridgeHostname(input.hostname);
  if (!normalized || normalized === "0.0.0.0" || normalized === "::") {
    throw new Error(
      "MURPH_DEV_CODEX_BRIDGE_HOST must be loopback or the resolved local Docker bridge host.",
    );
  }

  if (isLoopbackBridgeHostname(normalized)) {
    return normalized;
  }

  const allowedPrivateHost = normalizeBridgeHostname(input.allowedPrivateHost);
  if (
    allowedPrivateHost
    && normalized === allowedPrivateHost
    && (isPrivateIpv4BridgeHostname(normalized) || isLocalIpv6BridgeHostname(normalized))
  ) {
    return normalized;
  }

  throw new Error(
    "MURPH_DEV_CODEX_BRIDGE_HOST must be loopback or the resolved local Docker bridge host.",
  );
}

function isPrivateIpv4BridgeHostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => {
    if (!/^[0-9]+$/u.test(part)) {
      return Number.NaN;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : Number.NaN;
  });

  if (octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}

function isLocalIpv6BridgeHostname(hostname: string): boolean {
  if (isIP(hostname) !== 6) {
    return false;
  }

  return hostname.startsWith("fc")
    || hostname.startsWith("fd")
    || hostname.startsWith("fe80:");
}

async function maybeRunRunnerContainerSmoke(input: {
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv | null;
  workerBaseUrl: string;
}): Promise<void> {
  if (input.config.skipRunnerSmoke || input.env === null) {
    return;
  }

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
}

async function maybeStartStripeWebhookListener(input: {
  config: HostedLocalDevConfig;
  initialEnv: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  repoEnv: NodeJS.ProcessEnv;
  runtimeEnv: NodeJS.ProcessEnv;
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
      env: runtimeEnv,
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
  const resolved = path.resolve(root, override);
  const relative = path.relative(tempRoot, resolved);

  if (
    relative.length === 0
    || relative === "."
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error("MURPH_DEV_TEMP_DIR must resolve inside the repo-local .tmp directory.");
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
      diagnostics,
    ].filter((value): value is string => value !== null).join("\n"),
  );
}

function combineChildOutput(input: readonly BufferedNamedChildProcess[] | readonly string[]): string {
  return input
    .map((value) => typeof value === "string"
      ? value
      : [
        `[${value.name}:stdout]`,
        value.stdoutText(),
        `[${value.name}:stderr]`,
        value.stderrText(),
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
  const expectedRef = readLatestPreparedRunnerContainerImageRef(stdout);
  if (!expectedRef) {
    return;
  }

  if (hasDockerImageRef(expectedRef)) {
    return;
  }

  const expectedIdPrefix = readLatestPreparedRunnerContainerImageIdPrefix(stdout);
  if (!expectedIdPrefix) {
    throw new Error(
      `Prepared runner container image ${expectedRef} is missing and no local image id was found in dev output.`,
    );
  }

  const existingRef = findPreparedRunnerContainerImageRefByIdPrefix(expectedIdPrefix);
  if (!existingRef) {
    throw new Error(
      `Prepared runner container image ${expectedRef} is missing and no local image matches id prefix ${expectedIdPrefix}.`,
    );
  }

  spawnSync("docker", ["tag", existingRef, expectedRef], {
    stdio: "pipe",
  });
}

function readLatestPreparedRunnerContainerImageRef(stdout: string): string | null {
  const matches = Array.from(
    stdout.matchAll(/naming to docker\.io\/(cloudflare-dev\/runnercontainer:[a-f0-9]+)\s+done/g),
  );
  return matches.at(-1)?.[1] ?? null;
}

function readLatestPreparedRunnerContainerImageIdPrefix(stdout: string): string | null {
  const matches = Array.from(stdout.matchAll(/exporting manifest sha256:([a-f0-9]{12,64})/g));
  const manifestHash = matches.at(-1)?.[1] ?? null;
  return manifestHash ? manifestHash.slice(0, 12) : null;
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
    if (!imageRef?.startsWith("cloudflare-dev/runnercontainer:")) {
      continue;
    }

    if (imageId?.startsWith(expectedIdPrefix)) {
      return imageRef;
    }
  }

  return null;
}
