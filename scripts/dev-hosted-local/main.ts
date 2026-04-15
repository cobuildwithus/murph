import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveHostedLocalDevConfig } from "./config.ts";
import { DEFAULT_DATABASE_URL, repoRoot, webDir } from "./constants.ts";
import {
  buildHostedLocalDevOverrides,
  buildWranglerVarArgs,
  readSimpleEnvFile,
  requireEnvValue,
  resolveCloudflareLocalEnv,
  warnForMissingEnv,
} from "./environment.ts";
import {
  assertHostedWebDevServerAvailable,
  assertPortAvailable,
  runCommand,
  spawnChildProcess,
  terminateChildProcess,
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

  await ensureVercelLinkExists();
  await assertHostedWebDevServerAvailable(process.env);
  await assertPortAvailable(config.webHost, config.webPort, [
    `Local hosted web port ${config.webPort} is already in use on ${config.webHost}.`,
    "Stop the existing listener or set MURPH_DEV_WEB_PORT to a free port before running `pnpm dev`.",
  ].join(" "));
  await assertPortAvailable(config.workerHost, config.workerPort, [
    `Local Cloudflare worker port ${config.workerPort} is already in use on ${config.workerHost}.`,
    "Stop the existing listener or set MURPH_DEV_WORKER_PORT to a free port before running `pnpm dev`.",
  ].join(" "));

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "murph-dev-env-"));
  const pulledEnvPath = path.join(tempDir, ".env.local");
  const initialEnv = { ...process.env } satisfies NodeJS.ProcessEnv;

  try {
    if (!config.skipVercelPull) {
      await runCommand("vercel", ["env", "pull", pulledEnvPath, "--environment=development"], {
        cwd: webDir,
        env: initialEnv,
        name: "setup",
      });
    }

    const pulledEnv = config.skipVercelPull ? {} : await readSimpleEnvFile(pulledEnvPath);
    const vercelEnv: NodeJS.ProcessEnv = {
      ...initialEnv,
      ...pulledEnv,
    };

    if (!vercelEnv.DATABASE_URL?.trim()) {
      vercelEnv.DATABASE_URL = DEFAULT_DATABASE_URL;
    }

    const vercelOidcToken = await resolveVercelOidcToken(vercelEnv);
    const oidcIdentity = parseHostedExecutionOidcIdentity(vercelOidcToken);
    const cloudflareDevVars = await resolveCloudflareLocalEnv({
      config,
      oidcIdentity,
    });
    const localOverrides = buildHostedLocalDevOverrides(config, cloudflareDevVars);
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...vercelEnv,
      ...localOverrides,
      VERCEL_OIDC_TOKEN: vercelOidcToken,
    };
    const workerRuntimeEnv: NodeJS.ProcessEnv = {
      ...runtimeEnv,
      ...cloudflareDevVars,
    };

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
    }

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
        "--local-protocol",
        config.workerProtocol,
        "--persist-to",
        config.workerPersistDir,
        ...buildWranglerVarArgs(cloudflareDevVars),
      ], workerRuntimeEnv),
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
    ];
    let terminationSignal: NodeJS.Signals | null = null;

    const stopChildren = async (signal: NodeJS.Signals = "SIGTERM") => {
      for (const { child } of children) {
        terminateChildProcess(child, signal);
      }
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
      await Promise.all([
        waitForHealthyHttpEndpoint({
          host: config.workerHost,
          label: "cloudflare",
          path: "/health",
          port: config.workerPort,
          protocol: config.workerProtocol,
        }),
        waitForHealthyHttpEndpoint({
          host: config.webHost,
          label: "web",
          path: "/",
          port: config.webPort,
          protocol: "http",
        }),
      ]);
    } catch (error) {
      if (terminationSignal) {
        return;
      }

      await stopChildren("SIGTERM");
      throw error;
    }

    process.stdout.write(
      [
        "",
        "Local hosted dev is ready.",
        `web:    http://${config.webHost}:${config.webPort}`,
        `worker: ${config.workerProtocol}://${config.workerHost}:${config.workerPort}`,
        "",
      ].join("\n"),
    );

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
    await rm(tempDir, { force: true, recursive: true });
  }
}
