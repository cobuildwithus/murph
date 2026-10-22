import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  hostedRunnerBaseImageFingerprintTag,
  hostedRunnerBaseImageRemoteTag,
  hostedLocalRunnerBaseImageTag,
  runnerBaseImageSourceFingerprintLabel,
} from "./runner-base-image-contract.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "..", "..");
const runnerBaseDockerfile = path.join(repoRoot, "Dockerfile.cloudflare-hosted-runner-base");
const forceRebuildEnv = "MURPH_RUNNER_DOCKER_BASE_REBUILD";
const runnerBaseImagePlatform = "linux/amd64";

export interface RunnerBaseImagePreparationResult {
  fingerprint: string;
  imageTag: string;
  status: "built" | "current" | "pulled" | "pushed";
}

export async function computeRunnerBaseImageSourceFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const source of [
    "Dockerfile.cloudflare-hosted-runner-base",
    "patches/codex-public-live.patch",
  ]) {
    const content = await readFile(path.join(repoRoot, source));
    hash.update(`${source}\0${content.length}\0`).update(content);
  }
  return hash.digest("hex");
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

// Publication waits belong before integration jobs and short-lived credentials.
// Inspect only config metadata: do not pull layers or compile a missing image.
export async function waitForPublishedRunnerBaseImage(input: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
} = {}): Promise<{ fingerprint: string; imageTag: string }> {
  const timeoutMs = input.timeoutMs ?? 90 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Runner base publication timeout must be a positive integer.");
  }
  const fingerprint = await computeRunnerBaseImageSourceFingerprint();
  const imageTag = hostedRunnerBaseImageFingerprintTag(fingerprint);
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`Waiting for published runner base image: ${imageTag}\n`);
  while (Date.now() < deadline) {
    const result = spawnSync("docker", [
      "buildx", "imagetools", "inspect", imageTag, "--format", "{{json .Image}}",
    ], {
      env: input.env ?? process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: Math.min(30_000, Math.max(1, deadline - Date.now())),
      maxBuffer: 1024 * 1024,
    });
    if (result.status === 0 && publishedImageMatches(result.stdout, fingerprint)) {
      process.stdout.write(`Published runner base image ready: ${imageTag}\n`);
      return { fingerprint, imageTag };
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await sleep(Math.min(30_000, remainingMs));
  }
  throw new Error(`Timed out waiting for published runner base image: ${imageTag}`);
}

function publishedImageMatches(configJson: string, fingerprint: string): boolean {
  try {
    const parsed: unknown = JSON.parse(configJson);
    if (!isRecord(parsed)) return false;
    // Buildx returns one config for a single platform, or a platform-keyed map.
    const image = parsed[runnerBaseImagePlatform] ?? parsed;
    if (!isRecord(image) || image.os !== "linux" || image.architecture !== "amd64") return false;
    if (!isRecord(image.config) || !isRecord(image.config.Labels)) return false;
    return image.config.Labels[runnerBaseImageSourceFingerprintLabel] === fingerprint;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function prepareRunnerBaseImage(input: {
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  imageTag?: string;
  push?: boolean;
} = {}): Promise<RunnerBaseImagePreparationResult> {
  const env = input.env ?? process.env;
  const imageTag = input.imageTag ?? hostedLocalRunnerBaseImageTag;
  const fingerprint = await computeRunnerBaseImageSourceFingerprint();
  const force = input.force === true || env[forceRebuildEnv] === "1";

  if (input.push === true) {
    await buildRunnerBaseImage({ env, fingerprint, imageTag, push: true });
    return { fingerprint, imageTag, status: "pushed" };
  }

  if (!force && readRunnerBaseImageFingerprint(imageTag, env) === fingerprint) {
    process.stdout.write(`Runner base image current: ${imageTag}\n`);
    return { fingerprint, imageTag, status: "current" };
  }

  if (!force && pullCurrentRunnerBaseImage({ env, fingerprint, imageTag })) {
    process.stdout.write(`Runner base image pulled: ${imageTag}\n`);
    return { fingerprint, imageTag, status: "pulled" };
  }

  await buildRunnerBaseImage({ env, fingerprint, imageTag, push: false });
  return { fingerprint, imageTag, status: "built" };
}

async function buildRunnerBaseImage(input: {
  env: NodeJS.ProcessEnv;
  fingerprint: string;
  imageTag: string;
  push: boolean;
}): Promise<void> {
  const tags = input.push
    ? [
        hostedRunnerBaseImageRemoteTag,
        hostedRunnerBaseImageFingerprintTag(input.fingerprint),
      ]
    : [input.imageTag];
  const child = spawn(
    "docker",
    [
      "buildx",
      "build",
      input.push ? "--push" : "--load",
      "--platform",
      runnerBaseImagePlatform,
      "-f",
      runnerBaseDockerfile,
      ...tags.flatMap((tag) => ["-t", tag]),
      // Without a value, Docker forwards CODEX_CARGO_JOBS from the environment
      // only when it is set, so the Dockerfile default applies otherwise.
      "--build-arg",
      "CODEX_CARGO_JOBS",
      "--label",
      `${runnerBaseImageSourceFingerprintLabel}=${input.fingerprint}`,
      "--label",
      "org.opencontainers.image.source=https://github.com/cobuildwithus/murph",
      "--label",
      "org.opencontainers.image.description=Murph hosted Cloudflare runner native base image",
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

function pullCurrentRunnerBaseImage(input: {
  env: NodeJS.ProcessEnv;
  fingerprint: string;
  imageTag: string;
}): boolean {
  const remoteTags = [
    hostedRunnerBaseImageFingerprintTag(input.fingerprint),
    hostedRunnerBaseImageRemoteTag,
  ];

  for (const remoteTag of remoteTags) {
    if (
      !runDockerSync(
        ["pull", "--platform", runnerBaseImagePlatform, remoteTag],
        input.env,
      ).ok
    ) {
      continue;
    }
    if (readRunnerBaseImageFingerprint(remoteTag, input.env) !== input.fingerprint) {
      continue;
    }
    if (
      remoteTag !== input.imageTag
      && !runDockerSync(["tag", remoteTag, input.imageTag], input.env).ok
    ) {
      continue;
    }
    if (readRunnerBaseImageFingerprint(input.imageTag, input.env) === input.fingerprint) {
      return true;
    }
  }

  return false;
}

function runDockerSync(args: readonly string[], env: NodeJS.ProcessEnv): { ok: boolean } {
  const result = spawnSync("docker", [...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });

  if (result.status === 0) {
    return { ok: true };
  }

  const summary = (result.stderr ?? "").trim().split(/\r?\n/u).at(-1);
  const command = ["docker", ...args].join(" ");
  process.stderr.write(
    summary
      ? `${command} failed: ${summary}\n`
      : `${command} failed.\n`,
  );
  return { ok: false };
}

function shouldRunMain(): boolean {
  return Boolean(process.argv[1])
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
}

function parseForceArg(argv: readonly string[]): boolean {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const unknown = normalized.filter((arg) => arg !== "--force" && arg !== "--push" && arg !== "--wait-published");
  if (unknown.length > 0) {
    throw new Error(`Unsupported runner base image argument: ${unknown.join(" ")}`);
  }
  if (normalized.includes("--wait-published") && normalized.some((arg) => arg === "--force" || arg === "--push")) {
    throw new Error("Publication waiting cannot build or push an image.");
  }
  return normalized.includes("--force");
}

if (shouldRunMain()) {
  const argv = process.argv.slice(2);
  const force = parseForceArg(argv);
  if (argv.includes("--wait-published")) {
    await waitForPublishedRunnerBaseImage();
  } else {
    await prepareRunnerBaseImage({ force, push: argv.includes("--push") });
  }
}
