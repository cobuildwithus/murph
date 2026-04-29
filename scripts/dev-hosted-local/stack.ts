import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveHostedLocalDevConfig } from "./config.ts";
import {
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  repoRoot,
  webDir,
} from "./constants.ts";
import {
  buildHostedRunnerLocalBuildId,
  buildHostedLocalDevOverrides,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  resolveHostedLocalDatabaseUrl,
  readOptionalSimpleEnvFile,
  readSimpleEnvFile,
  requireEnvValue,
  resolveCloudflareLocalEnv,
  shouldSyncLocalDatabaseSchema,
  warnForMissingEnv,
} from "./environment.ts";
import {
  assertHostedWebDevServerAvailable,
  assertPortAvailable,
  cleanupHostedRunnerContainers,
  collectDockerDevDiagnostics,
  runCommand,
  spawnChildProcess,
  spawnStripeListenerWithSecretCapture,
  StripeCliMissingError,
  terminateChildProcessAndWait,
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
} from "./runtime.ts";
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

export interface HostedLocalDevStack {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
  oidcToken: string;
  processes: {
    cloudflare: BufferedNamedChildProcess;
    stripe: BufferedNamedChildProcess | null;
    web: BufferedNamedChildProcess | null;
  };
  ready: Promise<void>;
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
  const config = resolveHostedLocalDevConfig(initialEnv);
  const tempDirOverride = initialEnv.MURPH_DEV_TEMP_DIR?.trim() || null;
  const providedVercelOidcToken = initialEnv.VERCEL_OIDC_TOKEN?.trim() || null;
  const hostedRunnerLocalBuildId = buildHostedRunnerLocalBuildId(
    initialEnv[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]?.trim() || randomUUID(),
  );
  const tsxTsconfigPath = path.join(repoRoot, "tsconfig.base.json");

  if (!config.skipVercelPull && !providedVercelOidcToken) {
    await ensureVercelLinkExists();
  }
  if (!config.skipWeb) {
    await assertHostedWebDevServerAvailable(initialEnv);
    await assertPortAvailable(config.webHost, config.webPort, [
      `Local hosted web port ${config.webPort} is already in use on ${config.webHost}.`,
      "Stop the existing listener or set MURPH_DEV_WEB_PORT to a free port before running `pnpm dev`.",
    ].join(" "));
  }
  await assertPortAvailable(config.workerHost, config.workerPort, [
    `Local Cloudflare worker port ${config.workerPort} is already in use on ${config.workerHost}.`,
    "Stop the existing listener or set MURPH_DEV_WORKER_PORT to a free port before running `pnpm dev`.",
  ].join(" "));

  const tempDir = tempDirOverride
    ? resolveHostedLocalTempDir(repoRoot, tempDirOverride)
    : await mkdtemp(path.join(os.tmpdir(), "murph-dev-env-"));
  if (tempDirOverride) {
    await rm(tempDir, { force: true, recursive: true });
    await mkdir(tempDir, { recursive: true });
  }

  const pulledEnvPath = path.join(tempDir, ".env.local");
  const workerEnvPath = path.join(tempDir, "cloudflare-worker.env");
  const workerDevVarsPath = path.join(tempDir, "cloudflare-worker.dev.vars");
  const workerDevVarsBackupPath = path.join(tempDir, "cloudflare-worker.dev.vars.backup");
  const workerConfigPath = path.join(tempDir, "cloudflare-worker.local-dev.generated.json");
  const repoEnvPath = path.join(repoRoot, ".env");
  let restoreCloudflareDevVars = false;
  let hadExistingCloudflareDevVars = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const children: BufferedNamedChildProcess[] = [];
  let stripeListener: BufferedNamedChildProcess | null = null;
  let workerRuntimeEnv: NodeJS.ProcessEnv | null = null;

  try {
    if (!config.skipVercelPull && !providedVercelOidcToken) {
      await runCommand("vercel", ["env", "pull", pulledEnvPath, "--environment=development"], {
        cwd: webDir,
        env: initialEnv,
        name: "setup",
      });
    }

    const repoEnv = await readOptionalSimpleEnvFile(repoEnvPath);
    const pulledEnv = (config.skipVercelPull || providedVercelOidcToken)
      ? {}
      : await readSimpleEnvFile(pulledEnvPath);
    const vercelEnv: NodeJS.ProcessEnv = {
      ...repoEnv,
      ...pulledEnv,
      ...initialEnv,
    };

    vercelEnv.DATABASE_URL = resolveHostedLocalDatabaseUrl({
      databaseUrlOverride: config.databaseUrlOverride,
      fallbackUrl: DEFAULT_DATABASE_URL,
      pulledDatabaseUrl: pulledEnv.DATABASE_URL,
      repoDatabaseUrl: repoEnv.DATABASE_URL,
      shellDatabaseUrl: initialEnv.DATABASE_URL,
      useVercelDatabaseUrl: config.useVercelDatabaseUrl,
    });
    const localInternalProxyBaseUrl = resolveContainerReachableWorkerOrigin(config, vercelEnv);

    const oidcToken = await resolveVercelOidcToken(vercelEnv);
    const oidcIdentity = parseHostedExecutionOidcIdentity(oidcToken);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
      overrides: {
        ...vercelEnv,
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
    workerRuntimeEnv = {
      ...runtimeEnv,
      ...cloudflareDevVars,
      [HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]: hostedRunnerLocalBuildId,
    };
    const workerEnvText = `${buildWranglerEnvFileText(workerRuntimeEnv)}\n`;
    await writeFile(workerEnvPath, workerEnvText, "utf8");
    await writeFile(workerDevVarsPath, workerEnvText, "utf8");
    await writeFile(
      workerConfigPath,
      `${JSON.stringify(
        buildWranglerLocalDevConfig(workerRuntimeEnv, {
          configDir: path.dirname(workerConfigPath),
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
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
    warnForMissingEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
      runtimeEnv.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY,
    );
    warnForMissingEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL",
      runtimeEnv.HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL,
    );
    warnForMissingEnv("STRIPE_SECRET_KEY", runtimeEnv.STRIPE_SECRET_KEY);
    const stripeListenerWillCaptureSecret = !config.skipStripeListen && !config.skipWeb;
    if (!stripeListenerWillCaptureSecret) {
      warnForMissingEnv("STRIPE_WEBHOOK_SECRET", runtimeEnv.STRIPE_WEBHOOK_SECRET);
    }

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

    const shouldPrepareRunnerBundle = initialEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE !== "1";
    if (shouldPrepareRunnerBundle) {
      await runCommand("pnpm", ["--dir", "apps/cloudflare", "runner:bundle"], {
        cwd: repoRoot,
        env: workerRuntimeEnv,
        name: "setup",
      });
      workerRuntimeEnv.MURPH_DEV_SKIP_RUNNER_BUNDLE = "1";
    }

    await cleanupHostedRunnerContainers({
      cwd: repoRoot,
      env: workerRuntimeEnv,
    });

    const cloudflareProcess = spawnChildProcess("cloudflare", "pnpm", [
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
      ...buildWranglerVarArgs(workerRuntimeEnv),
    ], workerRuntimeEnv, {
      pipeOutput: input.pipeOutput,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
    });
    children.push(cloudflareProcess);

    stripeListener = await maybeStartStripeWebhookListener({
      config,
      initialEnv,
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
      ], runtimeEnv, {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      });
    if (webProcess) {
      children.push(webProcess);
    }

    const webBaseUrl = config.skipWeb ? null : `http://${config.webHost}:${config.webPort}`;
    const workerBaseUrl = `${config.workerProtocol}://${config.workerHost}:${config.workerPort}`;

    const cleanupTemporaryInputs = async (): Promise<void> => {
      if (restoreCloudflareDevVars) {
        await rm(cloudflareDevVarsPath, { force: true });
        if (hadExistingCloudflareDevVars) {
          await rename(workerDevVarsBackupPath, cloudflareDevVarsPath);
        }
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
        if (workerRuntimeEnv) {
          await cleanupHostedRunnerContainers({
            cwd: repoRoot,
            env: workerRuntimeEnv,
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
        await maybeRunRunnerContainerSmoke({
          config,
          env: workerRuntimeEnv,
          workerBaseUrl,
        });
      } catch (error) {
        if (!stopped) {
          await stop("SIGTERM");
        }
        throw appendStartupDiagnostics(error, await collectDockerDevDiagnostics({
          cwd: repoRoot,
          env: workerRuntimeEnv,
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
        stripe: stripeListener,
        web: webProcess,
      },
      ready,
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
    if (workerRuntimeEnv) {
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerRuntimeEnv,
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
