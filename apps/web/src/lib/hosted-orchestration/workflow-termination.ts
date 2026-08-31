import "server-only";

import {
  Client,
  Connection,
  type ConnectionOptions,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  hostedUserRuntimeWorkflowId,
} from "./signal-runtime";
import {
  readHostedRuntimeTemporalEnvironment,
  type HostedRuntimeTemporalEnvironment,
} from "./temporal-client";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";

export const HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS = 5_000;

interface HostedRuntimeTemporalTerminationClient {
  workflow: {
    getHandle(workflowId: string): {
      terminate(reason?: string): Promise<unknown>;
    };
  };
}

interface HostedRuntimeTemporalTerminationConnection {
  client: HostedRuntimeTemporalTerminationClient;
  close(): Promise<unknown>;
}

export interface HostedRuntimeWorkflowTerminationBestEffortResult {
  configured: boolean;
  errorCode: string | null;
  notFound: boolean | null;
  terminated: boolean;
}

export async function terminateHostedUserRuntimeWorkflowBestEffort(input: {
  reason: string;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeWorkflowTerminationBestEffortResult> {
  try {
    return await terminateHostedUserRuntimeWorkflow(input);
  } catch (error) {
    const errorCode = safeHostedRuntimeWorkflowTerminationErrorCode(error);

    console.error("Hosted runtime workflow termination failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code: errorCode }),
      operationMessage: "Hosted runtime workflow termination failed.",
    });
    return {
      configured: true,
      errorCode,
      notFound: null,
      terminated: false,
    };
  }
}

async function terminateHostedUserRuntimeWorkflow(input: {
  reason: string;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeWorkflowTerminationBestEffortResult> {
  const timeoutMs = normalizeHostedRuntimeWorkflowTerminationTimeoutMs(
    input.timeoutMs,
  );
  const deadlineEpochMs = Date.now() + timeoutMs;
  const temporal = await createHostedRuntimeTemporalTerminationConnection(
    deadlineEpochMs,
  );
  if (!temporal) {
    return {
      configured: false,
      errorCode: null,
      notFound: null,
      terminated: false,
    };
  }

  try {
    const workflowId = hostedUserRuntimeWorkflowId(input.userId);
    try {
      const timeoutMs = remainingHostedRuntimeWorkflowTerminationMs(
        deadlineEpochMs,
      );
      const termination = temporal.client.workflow
        .getHandle(workflowId)
        .terminate(input.reason.trim() || undefined);
      await withHostedRuntimeWorkflowTerminationTimeout(
        termination,
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return {
          configured: true,
          errorCode: null,
          notFound: true,
          terminated: true,
        };
      }
      throw error;
    }

    return {
      configured: true,
      errorCode: null,
      notFound: false,
      terminated: true,
    };
  } finally {
    void temporal.close().catch(() => undefined);
  }
}

async function createHostedRuntimeTemporalTerminationConnection(
  deadlineEpochMs: number,
): Promise<HostedRuntimeTemporalTerminationConnection | null> {
  const environment = readHostedRuntimeTemporalEnvironment();
  if (!environment.address) {
    return null;
  }

  const timeoutMs = remainingHostedRuntimeWorkflowTerminationMs(deadlineEpochMs);
  const connectionPromise = Connection.connect(buildConnectionOptions(
    environment,
    timeoutMs,
  ));
  const connection = await withHostedRuntimeWorkflowTerminationTimeout(
    connectionPromise,
    timeoutMs,
    {
      onLateResolve: (lateConnection) => {
        void lateConnection.close().catch(() => undefined);
      },
    },
  );

  return {
    client: new Client({
      connection,
      namespace: environment.namespace,
    }),
    close: () => connection.close(),
  };
}

function buildConnectionOptions(
  environment: HostedRuntimeTemporalEnvironment,
  timeoutMs: number,
): ConnectionOptions {
  if (!environment.address) {
    throw new TypeError("HOSTED_TEMPORAL_ADDRESS must be configured.");
  }

  const options: ConnectionOptions = {
    address: environment.address,
    connectTimeout: timeoutMs,
    tls: environment.tls,
  };
  if (environment.apiKey) {
    options.apiKey = environment.apiKey;
  }
  return options;
}

function safeHostedRuntimeWorkflowTerminationErrorCode(error: unknown): string {
  if (!(error instanceof Error) || !error.name) {
    return "UnknownError";
  }
  return /^[A-Z][A-Za-z0-9]*Error$/u.test(error.name)
    ? error.name
    : "UnknownError";
}

function withHostedRuntimeWorkflowTerminationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  options: {
    onLateResolve?: (value: T) => void;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      reject(new HostedRuntimeWorkflowTerminationTimeoutError());
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timeout);
        if (timedOut) {
          options.onLateResolve?.(value);
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        if (timedOut) {
          return;
        }
        reject(error);
      },
    );
  });
}

function normalizeHostedRuntimeWorkflowTerminationTimeoutMs(
  timeoutMs: number | undefined,
): number {
  if (timeoutMs === undefined) {
    return HOSTED_RUNTIME_WORKFLOW_TERMINATION_TIMEOUT_MS;
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Hosted runtime workflow termination timeout is invalid.");
  }
  return timeoutMs;
}

function remainingHostedRuntimeWorkflowTerminationMs(
  deadlineEpochMs: number,
): number {
  const remainingMs = deadlineEpochMs - Date.now();
  if (remainingMs <= 0) {
    throw new HostedRuntimeWorkflowTerminationTimeoutError();
  }
  return remainingMs;
}

class HostedRuntimeWorkflowTerminationTimeoutError extends Error {
  constructor() {
    super("Hosted runtime workflow termination timed out.");
    this.name = "HostedRuntimeWorkflowTerminationTimeoutError";
  }
}
