import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import {
  createHostedExecutionDispatchClient,
} from "@murphai/hosted-execution/client";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { formatHostedExecutionSafeLogError } from "./logging";
import {
  type HostedExecutionDispatchEnvironment,
  readHostedExecutionDispatchEnvironment,
} from "./environment";

export async function dispatchHostedExecutionStatus(
  input: HostedExecutionDispatchRequest,
): Promise<HostedExecutionDispatchResult> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!isHostedExecutionConfigured(environment)) {
    return buildHostedExecutionNotConfiguredStatus({
      eventId: input.eventId,
      userId: input.event.userId,
    });
  }

  return postHostedExecutionDispatch(input, environment);
}

export async function dispatchHostedExecution(
  input: HostedExecutionDispatchRequest,
): Promise<{ dispatched: boolean; reason?: string }> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!isHostedExecutionConfigured(environment)) {
    return {
      dispatched: false,
      reason: "not-configured",
    };
  }

  await postHostedExecutionDispatch(input, environment);

  return {
    dispatched: true,
  };
}

export async function dispatchHostedExecutionBestEffort(
  input: HostedExecutionDispatchRequest,
  options: {
    context?: string;
  } = {},
): Promise<{ dispatched: boolean; reason?: string }> {
  try {
    return await dispatchHostedExecution(input);
  } catch (error) {
    console.error(
      options.context ? `Hosted execution dispatch failed (${options.context}).` : "Hosted execution dispatch failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return {
      dispatched: false,
      reason: "dispatch-failed",
    };
  }
}

function buildHostedExecutionNotConfiguredStatus(input: {
  eventId: string;
  userId: string;
}): HostedExecutionDispatchResult {
  const status: HostedExecutionUserStatus = {
    bundleRef: null,
    inFlight: false,
    lastError: HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
    lastEventId: null,
    lastRunAt: null,
    nextWakeAt: null,
    pendingEventCount: 0,
    poisonedEventIds: [],
    retryingEventId: null,
    userId: input.userId,
  };

  return {
    event: {
      eventId: input.eventId,
      lastError: status.lastError,
      state: "queued",
      userId: input.userId,
    },
    status,
  };
}

function isHostedExecutionConfigured(
  environment: HostedExecutionDispatchEnvironment,
): environment is HostedExecutionDispatchEnvironment & {
  dispatchUrl: string;
} {
  return Boolean(environment.dispatchUrl);
}

async function postHostedExecutionDispatch(
  input: HostedExecutionDispatchRequest,
  environment: HostedExecutionDispatchEnvironment & {
    dispatchUrl: string;
  },
): Promise<HostedExecutionDispatchResult> {
  return createHostedExecutionDispatchClient({
    baseUrl: environment.dispatchUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    timeoutMs: environment.dispatchTimeoutMs,
  }).dispatch(input);
}
