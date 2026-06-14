import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveCloudflareDeployPaths } from "./deploy-automation.js";
import {
  hostedLocalRunnerBaseImageTag,
} from "./runner-base-image-contract.js";
import { runnerBundleDirectoryName } from "./runner-bundle-contract.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preparedRunnerBundleDir = path.join(
  resolveCloudflareDeployPaths(appDir).deployDir,
  runnerBundleDirectoryName,
);
export const STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV =
  "MURPH_DEV_STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER";

export function normalizePnpmScriptArgs(argv: readonly string[]): string[] {
  return argv[0] === "--" ? [...argv.slice(1)] : [...argv];
}

export function shouldSkipRunnerBundle(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MURPH_DEV_SKIP_RUNNER_BUNDLE === "1";
}

export function shouldSkipRunnerDockerBase(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MURPH_DEV_SKIP_RUNNER_DOCKER_BASE === "1";
}

export function resolveWorkerDevPnpmCommands(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): string[][] {
  const commands: string[][] = [];

  if (!shouldSkipRunnerBundle(env)) {
    commands.push(["runner:bundle"]);
  }

  if (!shouldSkipRunnerDockerBase(env)) {
    commands.push(["runner:docker:base"]);
  }
  commands.push(["exec", "wrangler", "dev", ...normalizePnpmScriptArgs(argv)]);
  return commands;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (shouldSkipRunnerBundle(process.env)) {
    await assertPreparedRunnerBundleAvailable();
  }
  if (shouldSkipRunnerDockerBase(process.env)) {
    assertPreparedRunnerBaseImageAvailable();
  }

  for (const commandArgs of resolveWorkerDevPnpmCommands(argv, process.env)) {
    await runPnpm(commandArgs);
  }
}

function assertPreparedRunnerBaseImageAvailable(): void {
  const result = spawnSync("docker", ["image", "inspect", hostedLocalRunnerBaseImageTag], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    return;
  }

  throw new Error(
    [
      "MURPH_DEV_SKIP_RUNNER_DOCKER_BASE=1 requires a prepared Cloudflare runner base image.",
      `Missing image: ${hostedLocalRunnerBaseImageTag}.`,
      "Run `pnpm --dir apps/cloudflare runner:docker:base` before starting the hosted local dev lane.",
    ].join(" "),
  );
}

export function isWranglerDevPnpmCommand(args: readonly string[]): boolean {
  return args[0] === "exec" && args[1] === "wrangler" && args[2] === "dev";
}

export function resolveWorkerDevPnpmEnv(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!isWranglerDevPnpmCommand(args)) {
    return env;
  }

  if (env[STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV] !== "1") {
    return env;
  }

  const resolvedEnv = { ...env };
  delete resolvedEnv.CLOUDFLARE_API_TOKEN;
  delete resolvedEnv[STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV];
  return resolvedEnv;
}

async function runPnpm(args: string[]): Promise<void> {
  const child = spawn("pnpm", args, {
    cwd: appDir,
    env: resolveWorkerDevPnpmEnv(args),
    stdio: "inherit",
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `pnpm ${args.join(" ")} exited with signal ${signal}.`
            : `pnpm ${args.join(" ")} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

async function assertPreparedRunnerBundleAvailable(): Promise<void> {
  try {
    await access(preparedRunnerBundleDir, fsConstants.R_OK);
  } catch {
    throw new Error(
      [
        "MURPH_DEV_SKIP_RUNNER_BUNDLE=1 requires a prepared Cloudflare runner bundle.",
        `Missing bundle directory: ${path.relative(appDir, preparedRunnerBundleDir) || preparedRunnerBundleDir}`,
        "Run `pnpm --dir apps/cloudflare runner:bundle` before starting the hosted local dev lane.",
        "The dev helper will still prepare the native runner base image before Wrangler starts.",
      ].join(" "),
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
