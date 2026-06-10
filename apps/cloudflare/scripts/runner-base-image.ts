import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
  const unknown = normalized.filter((arg) => arg !== "--force" && arg !== "--push");
  if (unknown.length > 0) {
    throw new Error(`Unsupported runner base image argument: ${unknown.join(" ")}`);
  }
  return normalized.includes("--force");
}

if (shouldRunMain()) {
  const argv = process.argv.slice(2);
  await prepareRunnerBaseImage({
    force: parseForceArg(argv),
    push: (argv[0] === "--" ? argv.slice(1) : argv).includes("--push"),
  });
}
