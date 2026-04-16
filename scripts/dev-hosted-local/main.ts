import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { resolveHostedLocalDevConfig } from "./config.ts";
import {
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  repoRoot,
  webDir,
} from "./constants.ts";
import {
  buildHostedLocalDevOverrides,
  normalizeLocalDatabaseUrl,
  shouldSyncLocalDatabaseSchema,
  buildWranglerEnvFileText,
  buildWranglerLocalDevConfig,
  buildWranglerVarArgs,
  readOptionalSimpleEnvFile,
  readSimpleEnvFile,
  requireEnvValue,
  resolveCloudflareLocalEnv,
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
import type { NamedChildProcess } from "./types.ts";
import {
  ensureVercelLinkExists,
  parseHostedExecutionOidcIdentity,
  resolveVercelOidcToken,
} from "./vercel.ts";

export async function main(): Promise<void> {
  const config = resolveHostedLocalDevConfig(process.env);
  const tempDirOverride = process.env.MURPH_DEV_TEMP_DIR?.trim() || null;
  const providedVercelOidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() || null;

  if (!config.skipVercelPull && !providedVercelOidcToken) {
    await ensureVercelLinkExists();
  }
  if (!config.skipWeb) {
    await assertHostedWebDevServerAvailable(process.env);
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
  const initialEnv = { ...process.env } satisfies NodeJS.ProcessEnv;
  let restoreCloudflareDevVars = false;
  let hadExistingCloudflareDevVars = false;

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

    const vercelOidcToken = await resolveVercelOidcToken(vercelEnv);
    const oidcIdentity = parseHostedExecutionOidcIdentity(vercelOidcToken);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
      overrides: vercelEnv,
    });
    const localOverrides = buildHostedLocalDevOverrides(config, cloudflareDevVars);
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...vercelEnv,
      ...localOverrides,
      VERCEL_OIDC_TOKEN: vercelOidcToken,
    };
    const runnerHostAlias = resolveLocalRunnerHostAlias(initialEnv);
    const internalWorkerProxyUpstreamBaseUrl = `${config.workerProtocol}://${runnerHostAlias ?? config.workerHost}:${config.workerPort}`;
    const workerRuntimeEnv: NodeJS.ProcessEnv = {
      ...runtimeEnv,
      ...cloudflareDevVars,
      HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL: internalWorkerProxyUpstreamBaseUrl,
      ...(runnerHostAlias
        ? {
          HOSTED_EXECUTION_RUNNER_HOST_ALIAS: runnerHostAlias,
        }
        : {}),
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
    warnForMissingEnv("HOSTED_ONBOARDING_STRIPE_PRICE_ID", runtimeEnv.HOSTED_ONBOARDING_STRIPE_PRICE_ID);
    warnForMissingEnv("STRIPE_SECRET_KEY", runtimeEnv.STRIPE_SECRET_KEY);
    warnForMissingEnv("STRIPE_WEBHOOK_SECRET", runtimeEnv.STRIPE_WEBHOOK_SECRET);

    await runCommand("pnpm", ["--dir", "apps/web", "prisma:generate"], {
      cwd: repoRoot,
      env: runtimeEnv,
      name: "setup",
    });

    if (!config.skipPrismaMigrate) {
      await runCommand("pnpm", ["--dir", "apps/web", "prisma:migrate:deploy"], {
        cwd: repoRoot,
        env: runtimeEnv,
        name: "setup",
      });

      if (shouldSyncLocalDatabaseSchema(runtimeEnv.DATABASE_URL)) {
        await runCommand("pnpm", ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"], {
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

    const children: NamedChildProcess[] = [
      spawnChildProcess("cloudflare", "pnpm", [
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
      ], workerRuntimeEnv),
    ];
    if (!config.skipWeb) {
      children.push(
        spawnChildProcess("web", "pnpm", [
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
        ], runtimeEnv),
      );
    }
    let terminationSignal: NodeJS.Signals | null = null;

    const stopChildren = async (signal: NodeJS.Signals = "SIGTERM") => {
      for (const { child } of children) {
        await terminateChildProcessAndWait(child, { signal });
      }
      await cleanupHostedRunnerContainers({
        cwd: repoRoot,
        env: workerRuntimeEnv,
        ignoreErrors: true,
      });
    };

    const handleTerminationSignal = async (signal: NodeJS.Signals) => {
      if (terminationSignal) {
        return;
      }

      terminationSignal = signal;
      process.stderr.write(`\nStopping local hosted dev (${signal}).\n`);
      await stopChildren(signal);
    };

    process.once("SIGINT", () => {
      void handleTerminationSignal("SIGINT");
    });
    process.once("SIGTERM", () => {
      void handleTerminationSignal("SIGTERM");
    });

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
      if (!config.skipWeb) {
        healthChecks.push(
          waitForHealthyHttpEndpoint({
            host: config.webHost,
            label: "web",
            path: "/",
            port: config.webPort,
            protocol: "http",
          }),
        );
      }
      await Promise.all(healthChecks);
    } catch (error) {
      if (terminationSignal) {
        return;
      }

      await stopChildren("SIGTERM");
      throw appendStartupDiagnostics(error, await collectDockerDevDiagnostics({
        cwd: repoRoot,
        env: workerRuntimeEnv,
      }));
    }

    process.stdout.write(
      [
        "",
        "Local hosted dev is ready.",
        ...(config.skipWeb ? [] : [`web:    http://${config.webHost}:${config.webPort}`]),
        `worker: ${config.workerProtocol}://${config.workerHost}:${config.workerPort}`,
        "",
      ].join("\n"),
    );
    emitReadyToken(process.env.MURPH_DEV_READY_TOKEN);

    const exited = await waitForFirstChildExit(children);
    await stopChildren("SIGTERM");

    if (terminationSignal) {
      return;
    }

    if (exited.child.exitCode === 0) {
      return;
    }

    throw new Error(`${exited.name} exited with code ${exited.child.exitCode ?? "unknown"}.`);
  } finally {
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
  }
}

function emitReadyToken(token: string | undefined): void {
  const normalized = token?.trim();
  if (!normalized) {
    return;
  }

  process.stdout.write(`__MURPH_HOSTED_LOCAL_READY__ ${normalized}\n`);
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

function resolveLocalRunnerHostAlias(env: NodeJS.ProcessEnv): string | null {
  const configured = env.HOSTED_EXECUTION_RUNNER_HOST_ALIAS?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform !== "linux") {
    return "host.docker.internal";
  }

  return readLinuxDockerBridgeGatewayHost();
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

function appendStartupDiagnostics(error: unknown, diagnostics: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message}\n${diagnostics}`);
}
