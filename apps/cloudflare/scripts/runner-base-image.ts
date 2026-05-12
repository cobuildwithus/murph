import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  hostedLocalRunnerBaseImageTag,
  runnerBaseImageSourceFingerprintLabel,
} from "./runner-base-image-contract.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "..", "..");
const runnerBaseDockerfile = path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner-base");
const forceRebuildEnv = "MURPH_RUNNER_DOCKER_BASE_REBUILD";

export interface RunnerBaseImagePreparationResult {
  fingerprint: string;
  imageTag: string;
  status: "built" | "current";
}

export async function computeRunnerBaseImageSourceFingerprint(): Promise<string> {
  const dockerfile = await readFile(runnerBaseDockerfile);
  return createHash("sha256")
    .update("Dockerfile.cloudflare-hosted-runner-base\0")
    .update(dockerfile)
    .digest("hex");
}

export function readRunnerBaseImageFingerprint(
  imageTag = hostedLocalRunnerBaseImageTag,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const result = spawnSync(
    "docker",
    [
      "image",
      "inspect",
      "--format",
      `{{ index .Config.Labels "${runnerBaseImageSourceFingerprintLabel}" }}`,
      imageTag,
    ],
    {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    return null;
  }

  const fingerprint = (result.stdout ?? "").trim();
  return fingerprint && fingerprint !== "<no value>" ? fingerprint : null;
}

export async function prepareRunnerBaseImage(input: {
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  imageTag?: string;
} = {}): Promise<RunnerBaseImagePreparationResult> {
  const env = input.env ?? process.env;
  const imageTag = input.imageTag ?? hostedLocalRunnerBaseImageTag;
  const fingerprint = await computeRunnerBaseImageSourceFingerprint();
  const force = input.force === true || env[forceRebuildEnv] === "1";

  if (!force && readRunnerBaseImageFingerprint(imageTag, env) === fingerprint) {
    process.stdout.write(`Runner base image current: ${imageTag}\n`);
    return { fingerprint, imageTag, status: "current" };
  }

  await buildRunnerBaseImage({ env, fingerprint, imageTag });
  return { fingerprint, imageTag, status: "built" };
}

async function buildRunnerBaseImage(input: {
  env: NodeJS.ProcessEnv;
  fingerprint: string;
  imageTag: string;
}): Promise<void> {
  const child = spawn(
    "docker",
    [
      "buildx",
      "build",
      "--load",
      "--platform",
      "linux/amd64",
      "-f",
      runnerBaseDockerfile,
      "-t",
      input.imageTag,
      "--label",
      `${runnerBaseImageSourceFingerprintLabel}=${input.fingerprint}`,
      repoRoot,
    ],
    {
      cwd: appDir,
      env: input.env,
      stdio: "inherit",
    },
  );

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        signal
          ? `docker buildx build exited with signal ${signal}.`
          : `docker buildx build exited with code ${code ?? "unknown"}.`,
      ));
    });
  });
}

function shouldRunMain(): boolean {
  return Boolean(process.argv[1])
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
}

function parseForceArg(argv: readonly string[]): boolean {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const unknown = normalized.filter((arg) => arg !== "--force");
  if (unknown.length > 0) {
    throw new Error(`Unsupported runner base image argument: ${unknown.join(" ")}`);
  }
  return normalized.includes("--force");
}

if (shouldRunMain()) {
  await prepareRunnerBaseImage({ force: parseForceArg(process.argv.slice(2)) });
}
