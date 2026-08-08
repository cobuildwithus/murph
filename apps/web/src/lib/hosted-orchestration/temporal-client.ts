import "server-only";

import {
  Client,
  Connection,
  type ConnectionOptions,
} from "@temporalio/client";

import {
  readHostedRuntimeTemporalEnvironment as readSharedHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions as readSharedHostedRuntimeTemporalWorkflowOptions,
  type HostedRuntimeTemporalEnvironment,
  type HostedRuntimeTemporalWorkflowOptions,
} from "@murphai/hosted-execution/temporal-env";

export type {
  HostedRuntimeTemporalEnvironment,
  HostedRuntimeTemporalWorkflowOptions,
};

export interface HostedRuntimeTemporalSignalClient {
  withAbortSignal<R>(
    abortSignal: AbortSignal,
    fn: () => Promise<R>,
  ): Promise<R>;
  workflow: {
    getHandle?(workflowId: string): {
      query(queryName: string): Promise<unknown>;
    };
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
  return readSharedHostedRuntimeTemporalEnvironment(source, {
    defaultAddress: null,
  });
}

export function readHostedRuntimeTemporalWorkflowOptions(
  source: NodeJS.ProcessEnv = process.env,
): Pick<
  HostedRuntimeTemporalWorkflowOptions,
  "ensureRuntimeProcessingStartToCloseTimeoutMs"
> {
  const options = readSharedHostedRuntimeTemporalWorkflowOptions(source);
  return {
    ensureRuntimeProcessingStartToCloseTimeoutMs:
      options.ensureRuntimeProcessingStartToCloseTimeoutMs,
  };
}

export async function readHostedRuntimeTemporalSignalClientIfConfigured(): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  cachedClient ??= createHostedRuntimeTemporalSignalClient().catch((error) => {
    cachedClient = null;
    throw error;
  });
  return cachedClient;
}

export async function createHostedRuntimeTemporalSignalClient(
  source: NodeJS.ProcessEnv = process.env,
): Promise<
  HostedRuntimeTemporalSignalClient | null
> {
  const environment = readHostedRuntimeTemporalEnvironment(source);
  if (!environment.address) {
    return null;
  }

  const connection = Connection.lazy(buildConnectionOptions(environment));

  return new Client({
    connection,
    namespace: environment.namespace,
  });
}

function buildConnectionOptions(
  environment: HostedRuntimeTemporalEnvironment,
): ConnectionOptions {
  if (!environment.address) {
    throw new TypeError("HOSTED_TEMPORAL_ADDRESS must be configured.");
  }

  const options: ConnectionOptions = {
    address: environment.address,
    tls: environment.tls,
  };
  if (environment.apiKey) {
    options.apiKey = environment.apiKey;
  }
  return options;
}
