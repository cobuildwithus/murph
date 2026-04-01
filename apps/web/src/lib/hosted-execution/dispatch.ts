import {
  createHostedExecutionDispatchClient,
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchEnvironment,
  readHostedExecutionDispatchEnvironment,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

export async function dispatchHostedExecutionStatus(
  input: HostedExecutionDispatchRequest,
): Promise<HostedExecutionDispatchResult> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!isHostedExecutionConfigured(environment)) {
    return buildHostedExecutionNotConfiguredStatus(input);
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      options.context ? `Hosted execution dispatch failed (${options.context}).` : "Hosted execution dispatch failed.",
      message,
    );
    return {
      dispatched: false,
      reason: "dispatch-failed",
    };
  }
}

function buildHostedExecutionNotConfiguredStatus(
  input: HostedExecutionDispatchRequest,
): HostedExecutionDispatchResult {
  const status: HostedExecutionUserStatus = {
    bundleRefs: {
      agentState: null,
      vault: null,
    },
    inFlight: false,
    lastError: HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
    lastEventId: null,
    lastRunAt: null,
    nextWakeAt: null,
    pendingEventCount: 0,
    poisonedEventIds: [],
    retryingEventId: null,
    userId: input.event.userId,
  };

  return {
    event: {
      eventId: input.eventId,
      lastError: status.lastError,
      state: "queued",
      userId: input.event.userId,
    },
    status,
  };
}

function isHostedExecutionConfigured(
  environment: HostedExecutionDispatchEnvironment,
): environment is HostedExecutionDispatchEnvironment & {
  dispatchUrl: string;
  signingSecret: string;
} {
  return Boolean(environment.dispatchUrl && environment.signingSecret);
}

async function postHostedExecutionDispatch(
  input: HostedExecutionDispatchRequest,
  environment: HostedExecutionDispatchEnvironment & {
    dispatchUrl: string;
    signingSecret: string;
  },
): Promise<HostedExecutionDispatchResult> {
  return createHostedExecutionDispatchClient({
    baseUrl: environment.dispatchUrl,
    signingSecret: environment.signingSecret,
    timeoutMs: environment.dispatchTimeoutMs,
  }).dispatch(input);
}
