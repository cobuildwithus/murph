import { spawnSync } from "node:child_process";
import net from "node:net";

import {
  spawnChildProcess,
  terminateChildProcessAndWait,
  throwIfAbortSignalAborted,
} from "./runtime.ts";
import type {
  BufferedNamedChildProcess,
  HostedLocalDevConfig,
} from "./types.ts";

const MANAGED_TEMPORAL_STARTUP_TIMEOUT_MS = 60_000;
const MANAGED_TEMPORAL_AUTH_ENV_CLEARANCES: Record<string, undefined> = {
  HOSTED_TEMPORAL_API_KEY: undefined,
  HOSTED_TEMPORAL_CLIENT_CERT_BASE64: undefined,
  HOSTED_TEMPORAL_CLIENT_CERT_PEM: undefined,
  HOSTED_TEMPORAL_CLIENT_KEY_BASE64: undefined,
  HOSTED_TEMPORAL_CLIENT_KEY_PEM: undefined,
  HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64: undefined,
  HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM: undefined,
  HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE: undefined,
  TEMPORAL_API_KEY: undefined,
  TEMPORAL_CLIENT_CERT_BASE64: undefined,
  TEMPORAL_CLIENT_CERT_PEM: undefined,
  TEMPORAL_CLIENT_KEY_BASE64: undefined,
  TEMPORAL_CLIENT_KEY_PEM: undefined,
  TEMPORAL_SERVER_ROOT_CA_CERT_BASE64: undefined,
  TEMPORAL_SERVER_ROOT_CA_CERT_PEM: undefined,
  TEMPORAL_TLS_SERVER_NAME_OVERRIDE: undefined,
};
const LOCAL_TEMPORAL_CLI_ENV_CLEARANCE_NAMES = [
  ...Object.keys(MANAGED_TEMPORAL_AUTH_ENV_CLEARANCES),
  "HOSTED_TEMPORAL_ADDRESS",
  "HOSTED_TEMPORAL_NAMESPACE",
  "HOSTED_TEMPORAL_TASK_QUEUE",
  "TEMPORAL_ADDRESS",
  "TEMPORAL_NAMESPACE",
  "TEMPORAL_TASK_QUEUE",
] as const;

export interface HostedLocalTemporalRuntime {
  address: string;
  namespace: string;
  serverProcess: BufferedNamedChildProcess | null;
  taskQueue: string;
  workerProcess: BufferedNamedChildProcess;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

export function buildHostedLocalTemporalRuntimeEnv(input: {
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  if (input.config.temporal.mode === "disabled") {
    return {};
  }

  const address = resolveHostedLocalTemporalAddress(input);
  const localTlsEnv = usesLocalTemporalAddress(input.config.temporal.mode)
    ? {
        ...MANAGED_TEMPORAL_AUTH_ENV_CLEARANCES,
        HOSTED_TEMPORAL_TLS_ENABLED: "false",
        TEMPORAL_TLS_ENABLED: "false",
      }
    : {};

  return {
    ...localTlsEnv,
    HOSTED_TEMPORAL_ADDRESS: address,
    HOSTED_TEMPORAL_NAMESPACE: input.config.temporal.namespace,
    HOSTED_TEMPORAL_TASK_QUEUE: input.config.temporal.taskQueue,
    TEMPORAL_ADDRESS: address,
    TEMPORAL_NAMESPACE: input.config.temporal.namespace,
    TEMPORAL_TASK_QUEUE: input.config.temporal.taskQueue,
  };
}

export async function startHostedLocalTemporalRuntime(input: {
  abortSignal?: AbortSignal;
  cloudflareHostedControlBaseUrl: string;
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv;
  hostedWebBaseUrl: string | null;
  pipeOutput?: boolean;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
}): Promise<HostedLocalTemporalRuntime | null> {
  const temporal = input.config.temporal;
  throwIfAbortSignalAborted(input.abortSignal);
  if (temporal.mode === "disabled") {
    return null;
  }

  const hostedWebBaseUrl = input.hostedWebBaseUrl?.trim() || input.env.HOSTED_WEB_BASE_URL?.trim();
  if (!hostedWebBaseUrl) {
    throw new Error(
      "Hosted-local Temporal requires HOSTED_WEB_BASE_URL or a managed web child process.",
    );
  }

  const address = resolveHostedLocalTemporalAddress(input);
  const cloudflareHostedControlBaseUrl = normalizeHostedLocalClientBaseUrl(
    input.cloudflareHostedControlBaseUrl,
  );
  let serverProcess: BufferedNamedChildProcess | null = null;
  let workerProcess: BufferedNamedChildProcess | null = null;

  try {
    const startManagedServer = temporal.mode === "managed"
      || temporal.mode === "auto" && !(await canConnect(temporal.host, temporal.port));

    if (temporal.mode === "auto" && !startManagedServer) {
      assertTemporalCliAvailable();
      assertLocalTemporalServerAvailable({
        address,
        namespace: temporal.namespace,
      });
      process.stdout.write(
        `[setup] Reusing existing local Temporal at ${address} (namespace ${temporal.namespace}).\n`,
      );
    }

    if (startManagedServer) {
      assertTemporalCliAvailable();
      if (await canConnect(temporal.host, temporal.port)) {
        throw new Error(
          [
            `Local Temporal port ${temporal.port} is already in use on ${temporal.host}.`,
            "Stop the existing listener, set MURPH_DEV_TEMPORAL_PORT to a free port, or set MURPH_DEV_TEMPORAL=auto/external to use it intentionally.",
          ].join(" "),
        );
      }

      serverProcess = spawnChildProcess(
        "temporal-server",
        "bash",
        ["scripts/temporal-dev-server.sh"],
        {
          ...buildHostedLocalTemporalServerEnv(input.env),
          TEMPORAL_DEV_IP: temporal.host,
          TEMPORAL_DEV_PORT: String(temporal.port),
          TEMPORAL_NAMESPACE: temporal.namespace,
        },
        {
          pipeOutput: input.pipeOutput,
          stderrTarget: input.stderrTarget,
          stdoutTarget: input.stdoutTarget,
        },
      );
      await waitForTcpPort({
        signal: input.abortSignal,
        host: temporal.host,
        port: temporal.port,
        timeoutMs: MANAGED_TEMPORAL_STARTUP_TIMEOUT_MS,
      });
      throwIfAbortSignalAborted(input.abortSignal);
    }

    throwIfAbortSignalAborted(input.abortSignal);
    workerProcess = spawnChildProcess(
      "temporal-worker",
      "pnpm",
      ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
      {
        ...input.env,
        ...buildHostedLocalTemporalRuntimeEnv({
          config: input.config,
          env: input.env,
        }),
        CLOUDFLARE_HOSTED_CONTROL_BASE_URL: cloudflareHostedControlBaseUrl,
        HOSTED_WEB_BASE_URL: hostedWebBaseUrl,
      },
      {
        pipeOutput: input.pipeOutput,
        stderrTarget: input.stderrTarget,
        stdoutTarget: input.stdoutTarget,
      },
    );
    const startedWorkerProcess = workerProcess;
    throwIfAbortSignalAborted(input.abortSignal);

    return {
      address,
      namespace: temporal.namespace,
      serverProcess,
      taskQueue: temporal.taskQueue,
      workerProcess: startedWorkerProcess,
      stop: async (signal: NodeJS.Signals = "SIGTERM") => {
        await Promise.allSettled([
          terminateChildProcessAndWait(startedWorkerProcess.child, { signal }),
          ...(serverProcess
            ? [terminateChildProcessAndWait(serverProcess.child, { signal })]
            : []),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([
      ...(workerProcess
        ? [terminateChildProcessAndWait(workerProcess.child, { signal: "SIGTERM" })]
        : []),
      ...(serverProcess
        ? [terminateChildProcessAndWait(serverProcess.child, { signal: "SIGTERM" })]
        : []),
    ]);
    throw error;
  }
}

export async function waitForHostedLocalTemporalPortRelease(input: {
  host: string;
  port: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    throwIfAbortSignalAborted(input.signal);
    if (!(await canConnect(input.host, input.port))) {
      return;
    }
    await sleep(100);
  }

  throw new Error(
    `Timed out waiting for local Temporal at ${input.host}:${input.port} to stop.`,
  );
}

function normalizeHostedLocalClientBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  } else if (url.hostname === "[::]") {
    url.hostname = "[::1]";
  }
  return url.toString().replace(/\/$/u, "");
}

function buildHostedLocalTemporalServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const serverEnv = { ...env };
  delete serverEnv.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
  return serverEnv;
}

function resolveHostedLocalTemporalAddress(input: {
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv;
}): string {
  if (input.config.temporal.mode === "external") {
    const externalAddress =
      input.env.HOSTED_TEMPORAL_ADDRESS?.trim()
      || input.env.TEMPORAL_ADDRESS?.trim();
    if (externalAddress) {
      return externalAddress;
    }
  }

  return `${input.config.temporal.host}:${input.config.temporal.port}`;
}

function usesLocalTemporalAddress(mode: HostedLocalDevConfig["temporal"]["mode"]): boolean {
  return mode === "auto" || mode === "managed";
}

function assertTemporalCliAvailable(): void {
  const result = spawnSync("temporal", ["--version"], {
    env: buildLocalTemporalCliEnv(),
    stdio: "ignore",
  });

  if (result.error) {
    throw new Error(
      "Temporal CLI is required for auto/managed hosted-local Temporal. Run `pnpm temporal:cli:setup` or set MURPH_DEV_TEMPORAL=external/disabled.",
    );
  }

  if (result.status !== 0) {
    throw new Error(
      "Temporal CLI is present but `temporal --version` failed. Fix the CLI or set MURPH_DEV_TEMPORAL=external/disabled.",
    );
  }
}

function assertLocalTemporalServerAvailable(input: {
  address: string;
  namespace: string;
}): void {
  const health = spawnSync("temporal", [
    "operator",
    "cluster",
    "health",
    "--address",
    input.address,
    "--tls=false",
  ], {
    env: buildLocalTemporalCliEnv(),
    stdio: "ignore",
  });

  if (health.error || health.status !== 0) {
    throw new Error(
      `Local Temporal port is in use at ${input.address}, but it did not pass a Temporal health probe.`,
    );
  }

  const namespace = spawnSync("temporal", [
    "operator",
    "namespace",
    "describe",
    "--namespace",
    input.namespace,
    "--address",
    input.address,
    "--tls=false",
  ], {
    env: buildLocalTemporalCliEnv(),
    stdio: "ignore",
  });

  if (namespace.error || namespace.status !== 0) {
    throw new Error(
      `Local Temporal at ${input.address} is reachable, but namespace ${input.namespace} is not available.`,
    );
  }
}

function buildLocalTemporalCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const localEnv = { ...env };
  for (const name of LOCAL_TEMPORAL_CLI_ENV_CLEARANCE_NAMES) {
    delete localEnv[name];
  }
  localEnv.HOSTED_TEMPORAL_TLS_ENABLED = "false";
  localEnv.TEMPORAL_TLS_ENABLED = "false";
  return localEnv;
}

async function waitForTcpPort(input: {
  host: string;
  port: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    throwIfAbortSignalAborted(input.signal);
    if (await canConnect(input.host, input.port)) {
      return;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for local Temporal at ${input.host}:${input.port}.`,
  );
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
