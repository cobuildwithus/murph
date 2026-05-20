import "server-only";

import {
  Client,
  Connection,
  type ConnectionOptions,
} from "@temporalio/client";

import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "@murphai/hosted-execution";

export interface HostedRuntimeTemporalEnvironment {
  address: string | null;
  namespace: string;
  taskQueue: string;
}

export interface HostedRuntimeTemporalSignalClient {
  workflow: {
    signalWithStart(
      workflowType: string,
      options: {
        args: unknown[];
        signal: string;
        signalArgs: unknown[];
        taskQueue: string;
        workflowId: string;
      },
    ): Promise<unknown>;
  };
}

let cachedClient:
  | Promise<HostedRuntimeTemporalSignalClient | null>
  | null = null;

export function readHostedRuntimeTemporalEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): HostedRuntimeTemporalEnvironment {
  return {
    address: readOptionalEnv(source, "HOSTED_TEMPORAL_ADDRESS", "TEMPORAL_ADDRESS"),
    namespace:
      readOptionalEnv(source, "HOSTED_TEMPORAL_NAMESPACE", "TEMPORAL_NAMESPACE")
      ?? "default",
    taskQueue:
      readOptionalEnv(source, "HOSTED_TEMPORAL_TASK_QUEUE", "TEMPORAL_TASK_QUEUE")
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
  };
}

export async function readHostedRuntimeTemporalSignalClientIfConfigured(): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  cachedClient ??= createHostedRuntimeTemporalSignalClient();
  return cachedClient;
}

export function resetHostedRuntimeTemporalSignalClientForTesting(): void {
  cachedClient = null;
}

async function createHostedRuntimeTemporalSignalClient(): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  const environment = readHostedRuntimeTemporalEnvironment();
  if (!environment.address) {
    return null;
  }

  const connection = await Connection.connect(
    buildConnectionOptions(environment.address),
  );

  return new Client({
    connection,
    namespace: environment.namespace,
  });
}

function buildConnectionOptions(address: string): ConnectionOptions {
  return { address };
}

function readOptionalEnv(
  source: NodeJS.ProcessEnv,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}
