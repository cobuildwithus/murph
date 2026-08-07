import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";

import {
  HOSTED_LOCAL_R2_PRESIGN_BUCKET_NAME,
  HOSTED_LOCAL_R2_PRESIGN_ACCOUNT_ID,
  repoRoot,
} from "./constants.ts";
import {
  buildHostedRunnerLocalBuildId,
} from "./environment.ts";
import {
  spawnChildProcess,
  terminateChildProcessAndWait,
  waitForHealthyHttpEndpoint,
} from "./runtime.ts";
import type {
  BufferedNamedChildProcess,
} from "./types.ts";
import {
  HOSTED_LOCAL_MINIO_MIRROR_IMAGE,
  HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE,
} from "./minio-image-contract.ts";

// GHCR first: Actions pulls from it with the workflow token and are not
// rate-limited, unlike Docker Hub. The upstream ref stays as a fallback because
// pinning to one registry relocates the single point of failure rather than
// removing it, and the failure this guards against is a transient registry
// outage that either registry can have.
const DEFAULT_HOSTED_LOCAL_MINIO_IMAGE = HOSTED_LOCAL_MINIO_MIRROR_IMAGE;
const DEFAULT_HOSTED_LOCAL_MINIO_DATA_DIR = path.join(".tmp", "hosted-local-minio-r2");
const HOSTED_LOCAL_MINIO_DATA_DIR_ENV = "MURPH_DEV_MINIO_DATA_DIR";
const HOSTED_LOCAL_MINIO_PORT_ENV = "MURPH_DEV_MINIO_PORT";
const HOSTED_LOCAL_MINIO_IMAGE_ENV = "MURPH_DEV_MINIO_IMAGE";
const HOSTED_LOCAL_MINIO_SKIP_ENV = "MURPH_DEV_SKIP_MINIO";
const HOSTED_LOCAL_MINIO_HEALTH_PATH = "/minio/health/ready";
const HOSTED_LOCAL_PROFILE_ENV = "MURPH_HOSTED_LOCAL_PROFILE";
const HOSTED_LOCAL_E2E_ISOLATION_ENV = "MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED";
const HOSTED_LOCAL_MINIO_ROLE_LABEL_NAME = "murph.hosted-local.role";
const HOSTED_LOCAL_MINIO_ROLE_LABEL_VALUE = "r2-minio";
const HOSTED_LOCAL_MINIO_ROLE_LABEL = `${HOSTED_LOCAL_MINIO_ROLE_LABEL_NAME}=${HOSTED_LOCAL_MINIO_ROLE_LABEL_VALUE}`;
const HOSTED_LOCAL_MINIO_BUILD_ID_LABEL_NAME = "murph.hosted-local.build-id";
const HOSTED_LOCAL_MINIO_E2E_LABEL = "murph.hosted-local.e2e=1";
const HOSTED_LOCAL_MINIO_CONTAINER_NAME_PREFIX = "murph-hosted-local-r2-";
const HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST_ENV = "MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST";
const HOSTED_LOCAL_MINIO_DOCKER_CLEANUP_TIMEOUT_MS = 10_000;

/**
 * The image to try first. An explicit override always wins so local development
 * and one-off debugging can pin any build.
 */
export function resolveHostedLocalMinioImage(env: Record<string, string | undefined>): string {
  return env[HOSTED_LOCAL_MINIO_IMAGE_ENV]?.trim() || DEFAULT_HOSTED_LOCAL_MINIO_IMAGE;
}

/**
 * Resolves which image to run, falling back to the upstream ref only when the
 * mirror cannot be *pulled*.
 *
 * The fallback is deliberately scoped to pull failures. A registry outage is
 * transient and unrelated to the change under test, so it should not fail a
 * run; but a container that pulls fine and then never becomes healthy is a real
 * failure, and retrying that against a second registry would only double the
 * time it takes to report the same problem.
 *
 * An explicit override disables the fallback entirely: if someone pinned a
 * specific build, silently running a different one is worse than failing.
 */
export async function resolveHostedLocalMinioRunnableImage(
  env: NodeJS.ProcessEnv,
  pullImage: (image: string) => Promise<boolean> = (image) =>
    pullHostedLocalMinioImage(env, image),
): Promise<string> {
  const requestedImage = resolveHostedLocalMinioImage(env);

  if (requestedImage !== HOSTED_LOCAL_MINIO_MIRROR_IMAGE) {
    return requestedImage;
  }

  if (await pullImage(requestedImage)) {
    return requestedImage;
  }

  console.warn(
    `[minio] could not pull ${HOSTED_LOCAL_MINIO_MIRROR_IMAGE}; falling back to ${HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE}.`,
  );
  return HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE;
}

/** True when the image is present locally after the pull attempt. */
async function pullHostedLocalMinioImage(
  env: NodeJS.ProcessEnv,
  image: string,
): Promise<boolean> {
  await runDockerBestEffort(env, ["pull", image]);
  return (await runDockerCaptureBestEffort(env, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ])).trim().length > 0;
}

interface HostedLocalMinioPublishTarget {
  controlHost: string;
  dockerBridgeHost: string | null;
  publishHost: string;
}

interface HostedLocalMinioCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface HostedLocalMinioServer {
  containerName: string;
  env: Record<string, string>;
  ensureReady(): Promise<BufferedNamedChildProcess | null>;
  process: BufferedNamedChildProcess;
  processes(): readonly BufferedNamedChildProcess[];
}

export async function maybeStartHostedLocalMinio(input: {
  buildId: string;
  containerHost: string;
  env: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  /** Test seam: probe whether an image can be pulled. Defaults to real docker. */
  pullImage?: (image: string) => Promise<boolean>;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
  tempDir: string;
}): Promise<HostedLocalMinioServer | null> {
  if (!shouldStartHostedLocalMinio(input.env)) {
    return null;
  }
  if (input.env[HOSTED_LOCAL_MINIO_SKIP_ENV]?.trim() === "1") {
    assertExplicitHostedLocalR2EndpointConfigured(input.env);
    return null;
  }

  const port = input.env[HOSTED_LOCAL_MINIO_PORT_ENV]?.trim()
    ? parseHostedLocalMinioPort(input.env[HOSTED_LOCAL_MINIO_PORT_ENV])
    : await allocateHostedLocalMinioPort();
  const publishTarget = await resolveHostedLocalMinioPublishTarget(input.containerHost, input.env);
  const controlHost = publishTarget.controlHost;
  const buildIdLabelValue = sanitizeHostedLocalMinioNameSegment(input.buildId);
  const containerName = `${HOSTED_LOCAL_MINIO_CONTAINER_NAME_PREFIX}${buildIdLabelValue}`;
  await cleanupHostedLocalMinioContainerBestEffort(input.env, containerName, {
    buildId: buildIdLabelValue,
  });
  await assertHostedLocalMinioPortAvailable(port, publishTarget.publishHost);
  const dataDir = resolveHostedLocalMinioDataDir({
    env: input.env,
    tempDir: input.tempDir,
  });
  await mkdir(path.join(dataDir, HOSTED_LOCAL_R2_PRESIGN_BUCKET_NAME), {
    mode: 0o700,
    recursive: true,
  });
  const credentials = resolveHostedLocalMinioCredentials(input.env);

  const startContainer = async (
    image: string = resolveHostedLocalMinioImage(input.env),
  ): Promise<BufferedNamedChildProcess> => {
    await cleanupHostedLocalMinioContainerBestEffort(input.env, containerName, {
      buildId: buildIdLabelValue,
    });
    const childProcess = spawnChildProcess("minio", "docker", [
      "run",
      "--rm",
      "--name",
      containerName,
      "--label",
      HOSTED_LOCAL_MINIO_ROLE_LABEL,
      "--label",
      `${HOSTED_LOCAL_MINIO_BUILD_ID_LABEL_NAME}=${buildIdLabelValue}`,
      ...(isHostedLocalE2eProfileOrMarker(input.env)
        ? ["--label", HOSTED_LOCAL_MINIO_E2E_LABEL]
        : []),
      ...buildHostedLocalMinioDockerUserArgs(),
      "-p",
      `${publishTarget.publishHost}:${port}:9000`,
      "-v",
      `${dataDir}:/data`,
      "-e",
      "MINIO_ROOT_USER",
      "-e",
      "MINIO_ROOT_PASSWORD",
      "-e",
      "MINIO_REGION_NAME",
      image,
      "server",
      "/data",
      "--address",
      ":9000",
      "--console-address",
      ":9001",
    ], {
      ...input.env,
      MINIO_REGION_NAME: "auto",
      MINIO_ROOT_PASSWORD: credentials.secretAccessKey,
      MINIO_ROOT_USER: credentials.accessKeyId,
    }, {
      pipeOutput: input.pipeOutput,
      stderrTarget: input.stderrTarget,
      stdoutTarget: input.stdoutTarget,
    });

    try {
      await waitForHealthyHttpEndpoint({
        host: controlHost,
        label: "minio",
        path: HOSTED_LOCAL_MINIO_HEALTH_PATH,
        port,
        protocol: "http",
      });
    } catch (error) {
      await terminateChildProcessAndWait(childProcess.child, { signal: "SIGTERM" }).catch(() => {});
      await cleanupHostedLocalMinioContainerBestEffort(input.env, containerName, {
        buildId: buildIdLabelValue,
      }).catch(() => {});
      throw error;
    }

    return childProcess;
  };

  let childProcess = await startContainer(
    await resolveHostedLocalMinioRunnableImage(input.env, input.pullImage),
  );
  const processes: BufferedNamedChildProcess[] = [childProcess];
  let restartPromise: Promise<BufferedNamedChildProcess | null> | null = null;

  const bridgeMarkerEnv: Record<string, string> = {};
  if (publishTarget.dockerBridgeHost !== null) {
    bridgeMarkerEnv[HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST_ENV] = publishTarget.dockerBridgeHost;
  }
  const localMarkerEnv = buildHostedLocalR2MarkerEnv(input.env);
  const endpointHost = publishTarget.dockerBridgeHost ?? input.containerHost.trim();

  return {
    containerName,
    env: {
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: credentials.accessKeyId,
      HOSTED_R2_PRESIGN_ACCOUNT_ID: HOSTED_LOCAL_R2_PRESIGN_ACCOUNT_ID,
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: HOSTED_LOCAL_R2_PRESIGN_BUCKET_NAME,
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: `http://${formatHostedLocalMinioUrlHost(controlHost)}:${port}`,
      HOSTED_R2_PRESIGN_ENDPOINT: `http://${formatHostedLocalMinioUrlHost(endpointHost)}:${port}`,
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      ...bridgeMarkerEnv,
      ...localMarkerEnv,
    },
    ensureReady: async (): Promise<BufferedNamedChildProcess | null> => {
      if (await isHostedLocalMinioReady({
        host: controlHost,
        port,
      })) {
        return null;
      }
      if (restartPromise === null) {
        restartPromise = (async () => {
          childProcess = await startContainer();
          processes.push(childProcess);
          return childProcess;
        })().finally(() => {
          restartPromise = null;
        });
      }
      return await restartPromise;
    },
    get process(): BufferedNamedChildProcess {
      return childProcess;
    },
    processes: () => processes,
  };
}

function resolveHostedLocalMinioCredentials(env: NodeJS.ProcessEnv): HostedLocalMinioCredentials {
  return {
    accessKeyId: env.HOSTED_R2_PRESIGN_ACCESS_KEY_ID?.trim()
      || `murph-local-${randomBytes(12).toString("hex")}`,
    secretAccessKey: env.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY?.trim()
      || randomBytes(32).toString("base64url"),
  };
}

function buildHostedLocalMinioDockerUserArgs(): string[] {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }

  const uid = process.getuid();
  const gid = process.getgid();
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    return [];
  }

  return ["--user", `${uid}:${gid}`];
}

function shouldStartHostedLocalMinio(env: NodeJS.ProcessEnv): boolean {
  const profile = env[HOSTED_LOCAL_PROFILE_ENV]?.trim();
  return isHostedLocalE2eProfileOrMarker(env, profile)
    || profile === "dev"
    || profile === "worker-only";
}

function buildHostedLocalR2MarkerEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const profile = env[HOSTED_LOCAL_PROFILE_ENV]?.trim();
  return {
    ...(profile ? { [HOSTED_LOCAL_PROFILE_ENV]: profile } : {}),
    ...(isHostedLocalE2eProfileOrMarker(env, profile)
      ? { [HOSTED_LOCAL_E2E_ISOLATION_ENV]: "1" }
      : {}),
  };
}

function resolveHostedLocalMinioDataDir(input: {
  env: NodeJS.ProcessEnv;
  tempDir: string;
}): string {
  const configuredDataDir = input.env[HOSTED_LOCAL_MINIO_DATA_DIR_ENV]?.trim();
  if (configuredDataDir) {
    return path.resolve(repoRoot, configuredDataDir);
  }

  const profile = input.env[HOSTED_LOCAL_PROFILE_ENV]?.trim();
  if (profile === "dev") {
    return path.resolve(repoRoot, DEFAULT_HOSTED_LOCAL_MINIO_DATA_DIR);
  }

  return path.join(input.tempDir, "minio-r2");
}

function isHostedLocalE2eProfileOrMarker(
  env: NodeJS.ProcessEnv,
  profile: string | undefined = env[HOSTED_LOCAL_PROFILE_ENV]?.trim(),
): boolean {
  return env[HOSTED_LOCAL_E2E_ISOLATION_ENV] === "1"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function assertExplicitHostedLocalR2EndpointConfigured(env: NodeJS.ProcessEnv): void {
  if (
    env.HOSTED_R2_PRESIGN_ACCESS_KEY_ID?.trim()
    && env.HOSTED_R2_PRESIGN_ACCOUNT_ID?.trim()
    && env.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT?.trim() === "1"
    && env.HOSTED_R2_PRESIGN_BUCKET_NAME?.trim()
    && env.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT?.trim()
    && env.HOSTED_R2_PRESIGN_ENDPOINT?.trim()
    && env.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY?.trim()
  ) {
    return;
  }

  throw new Error(
    `${HOSTED_LOCAL_MINIO_SKIP_ENV}=1 requires explicit hosted-local R2 presign endpoints and credentials.`,
  );
}

function parseHostedLocalMinioPort(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${HOSTED_LOCAL_MINIO_PORT_ENV} must be a valid TCP port.`);
  }
  return parsed;
}

async function allocateHostedLocalMinioPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a hosted-local MinIO port."));
          return;
        }
        resolve(address.port);
      });
    });
    server.listen(0, "127.0.0.1");
  });
}

async function assertHostedLocalMinioPortAvailable(port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => {
      reject(new Error(`${HOSTED_LOCAL_MINIO_PORT_ENV} port ${port} is already in use.`));
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server.listen(port, host);
  });
}

async function isHostedLocalMinioReady(input: {
  host: string;
  port: number;
}): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const request = http.request(
      {
        host: input.host,
        method: "GET",
        path: HOSTED_LOCAL_MINIO_HEALTH_PATH,
        port: input.port,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode === 200));
      },
    );
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
    request.end();
  });
}

export async function cleanupHostedLocalMinioContainerBestEffort(
  env: NodeJS.ProcessEnv,
  containerName: string,
  options: {
    buildId?: string;
  } = {},
): Promise<void> {
  const buildId = options.buildId
    ?? inferHostedLocalMinioBuildIdFromContainerName(containerName);
  const filterArgs = [
    "--filter",
    `label=${HOSTED_LOCAL_MINIO_ROLE_LABEL}`,
    ...(buildId
      ? [
        "--filter",
        `label=${HOSTED_LOCAL_MINIO_BUILD_ID_LABEL_NAME}=${buildId}`,
      ]
      : []),
  ];
  await runDockerBestEffort(env, [
    "rm",
    "-f",
    containerName,
  ]);
  const listedContainerIds = await runDockerCaptureBestEffort(env, [
    "ps",
    "-aq",
    ...filterArgs,
  ]);
  if (!listedContainerIds.trim()) {
    return;
  }
  await runDockerBestEffort(env, [
    "rm",
    "-f",
    ...listedContainerIds.trim().split(/\s+/u),
  ]);
}

export async function cleanupHostedLocalMinioBuildContainersBestEffort(
  env: NodeJS.ProcessEnv,
  buildId: string,
): Promise<void> {
  const buildIdLabelValue = sanitizeHostedLocalMinioNameSegment(
    buildHostedRunnerLocalBuildId(buildId),
  );
  await cleanupHostedLocalMinioContainerBestEffort(
    env,
    `${HOSTED_LOCAL_MINIO_CONTAINER_NAME_PREFIX}${buildIdLabelValue}`,
    {
      buildId: buildIdLabelValue,
    },
  );
}

export async function cleanupHostedLocalMinioE2eContainersBestEffort(
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const listedContainerIds = await runDockerCaptureBestEffort(env, [
    "ps",
    "-aq",
    "--filter",
    `label=${HOSTED_LOCAL_MINIO_ROLE_LABEL}`,
    "--filter",
    `label=${HOSTED_LOCAL_MINIO_E2E_LABEL}`,
  ]);
  if (!listedContainerIds.trim()) {
    return;
  }
  await runDockerBestEffort(env, [
    "rm",
    "-f",
    ...listedContainerIds.trim().split(/\s+/u),
  ]);
}

function inferHostedLocalMinioBuildIdFromContainerName(containerName: string): string | null {
  if (!containerName.startsWith(HOSTED_LOCAL_MINIO_CONTAINER_NAME_PREFIX)) {
    return null;
  }
  const buildId = containerName.slice(HOSTED_LOCAL_MINIO_CONTAINER_NAME_PREFIX.length);
  return buildId || null;
}

async function runDockerBestEffort(env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  const child = spawn("docker", args, {
    env,
    stdio: "ignore",
  });
  await settleDockerCleanupChild(child, undefined, () => undefined);
}

async function runDockerCaptureBestEffort(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const child = spawn("docker", args, {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const decoder = new StringDecoder("utf8");
  let output = "";
  const onStdoutData = (chunk: Buffer | string): void => {
    output += typeof chunk === "string" ? chunk : decoder.write(chunk);
  };
  child.stdout?.on("data", onStdoutData);
  try {
    return await settleDockerCleanupChild(child, "", (code) => {
      output += decoder.end();
      return code === 0 ? output : "";
    });
  } finally {
    child.stdout?.off("data", onStdoutData);
  }
}

async function settleDockerCleanupChild<T>(
  child: ReturnType<typeof spawn>,
  fallback: T,
  onExit: (code: number | null) => T,
): Promise<T> {
  return await new Promise<T>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const settle = (value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(value);
    };
    child.once("error", () => settle(fallback));
    child.once("exit", (code) => {
      if (!settled) {
        settle(onExit(code));
      }
    });
    timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The exact retained child may have exited between the timer and kill.
      }
      settle(fallback);
    }, HOSTED_LOCAL_MINIO_DOCKER_CLEANUP_TIMEOUT_MS);
    timeout.unref();
    if (settled) {
      clearTimeout(timeout);
    }
  });
}

async function runDockerCaptureRequired(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("docker", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
    });
    child.once("error", () => {
      reject(new Error("Unable to inspect Docker bridge gateway for hosted-local MinIO."));
    });
    child.once("exit", (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(
        stderr.trim() || "Unable to inspect Docker bridge gateway for hosted-local MinIO.",
      ));
    });
  });
}

async function resolveHostedLocalMinioPublishTarget(
  containerHost: string,
  env: NodeJS.ProcessEnv,
): Promise<HostedLocalMinioPublishTarget> {
  const normalized = containerHost.trim().toLowerCase();
  if (
    normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]"
  ) {
    return {
      controlHost: "127.0.0.1",
      dockerBridgeHost: null,
      publishHost: "127.0.0.1",
    };
  }

  if (
    normalized === "host.docker.internal"
    || normalized === "host.containers.internal"
  ) {
    if (process.platform === "linux") {
      const dockerBridgeGateway = await resolveDockerBridgeGatewayHost(env);
      return {
        controlHost: dockerBridgeGateway,
        dockerBridgeHost: dockerBridgeGateway,
        publishHost: dockerBridgeGateway,
      };
    }
    return {
      controlHost: "127.0.0.1",
      dockerBridgeHost: null,
      publishHost: "127.0.0.1",
    };
  }

  if (isLoopbackIpv4Host(normalized)) {
    return {
      controlHost: normalized,
      dockerBridgeHost: null,
      publishHost: normalized,
    };
  }

  if (isPrivateIpv4Host(normalized)) {
    const dockerBridgeGateway = await resolveDockerBridgeGatewayHost(env);
    if (normalized === dockerBridgeGateway) {
      return {
        controlHost: normalized,
        dockerBridgeHost: normalized,
        publishHost: normalized,
      };
    }
    throw new Error(
      "Hosted-local MinIO rejects arbitrary private/LAN hosts; use a loopback/Docker host alias or the exact Docker bridge gateway.",
    );
  }

  throw new Error(
    "Hosted-local MinIO requires a loopback or Docker bridge host for container access.",
  );
}

async function resolveDockerBridgeGatewayHost(env: NodeJS.ProcessEnv): Promise<string> {
  const output = await runDockerCaptureRequired(env, [
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}}{{end}}{{end}}",
  ]);
  const gateway = output.trim();
  if (!isPrivateIpv4Host(gateway)) {
    throw new Error("Docker bridge gateway inspection did not return a private IPv4 gateway.");
  }
  return gateway;
}

function formatHostedLocalMinioUrlHost(host: string): string {
  const normalized = host.trim();
  if (normalized.includes(":") && !normalized.startsWith("[")) {
    return `[${normalized}]`;
  }
  return normalized;
}

function isLoopbackIpv4Host(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);
  return octets !== null && octets[0] === 127;
}

function isPrivateIpv4Host(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);
  if (octets === null) {
    return false;
  }

  const [first = -1, second = -1] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseIpv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    octets.some((octet, index) =>
      !Number.isInteger(octet)
      || octet < 0
      || octet > 255
      || String(octet) !== parts[index])
  ) {
    return null;
  }

  return octets as [number, number, number, number];
}

function sanitizeHostedLocalMinioNameSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]/gu, "-");
  return (normalized || "local").slice(0, 48);
}
