import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveHostedLocalDevConfig } from "./config.ts";
import {
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  repoRoot,
  webDir,
} from "./constants.ts";
import {
  buildHostedLocalDevOverrides,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  normalizeLocalDatabaseUrl,
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

export async function startHostedLocalDevStack(input: {
  env: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  stderrTarget?: NodeJS.WriteStream;
  stdoutTarget?: NodeJS.WriteStream;
}): Promise<HostedLocalDevStack> {
  const initialEnv = { ...input.env } satisfies NodeJS.ProcessEnv;
  const config = resolveHostedLocalDevConfig(initialEnv);
  const tempDirOverride = initialEnv.MURPH_DEV_TEMP_DIR?.trim() || null;
  const providedVercelOidcToken = initialEnv.VERCEL_OIDC_TOKEN?.trim() || null;
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

    vercelEnv.DATABASE_URL = normalizeLocalDatabaseUrl(
      vercelEnv.DATABASE_URL,
      DEFAULT_DATABASE_URL,
    );
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
    warnForMissingEnv("STRIPE_WEBHOOK_SECRET", runtimeEnv.STRIPE_WEBHOOK_SECRET);

    await runCommand("pnpm", ["--dir", "apps/web", "prisma:generate"], {
      cwd: repoRoot,
      env: runtimeEnv,
      name: "setup",
    });

    if (!config.skipPrismaMigrate) {
      if (shouldSyncLocalDatabaseSchema(runtimeEnv.DATABASE_URL)) {
        await runCommand("pnpm", ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"], {
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

    return {
      config,
      oidcIdentity,
      oidcToken,
      processes: {
        cloudflare: cloudflareProcess,
        web: webProcess,
      },
      ready,
      stderrTail: (maxChars?: number): string => tail(combineChildOutput(
        children.map((child) => `[${child.name}:stderr]\n${child.stderrText()}`),
      ), maxChars),
      stdoutTail: (maxChars?: number): string => tail(combineChildOutput(
        children.map((child) => `[${child.name}:stdout]\n${child.stdoutText()}`),
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
