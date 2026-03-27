import {
  createHostedExecutionDispatchClient,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchEnvironment,
  readHostedExecutionDispatchEnvironment,
  type HostedExecutionUserStatus,
} from "@murph/hosted-execution";

export async function dispatchHostedExecutionStatus(
  input: HostedExecutionDispatchRequest,
): Promise<HostedExecutionUserStatus> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!isHostedExecutionConfigured(environment)) {
    return buildHostedExecutionNotConfiguredStatus(input.event.userId);
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

function buildHostedExecutionNotConfiguredStatus(userId: string): HostedExecutionUserStatus {
  return {
    bundleRefs: {
      agentState: null,
      vault: null,
    },
    inFlight: false,
    lastError: "Hosted execution dispatch is not configured.",
    lastEventId: null,
    lastRunAt: null,
    nextWakeAt: null,
    pendingEventCount: 0,
    poisonedEventIds: [],
    retryingEventId: null,
    userId,
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
): Promise<HostedExecutionUserStatus> {
  return createHostedExecutionDispatchClient({
    baseUrl: environment.dispatchUrl,
    signingSecret: environment.signingSecret,
    timeoutMs: environment.dispatchTimeoutMs,
  }).dispatch(input);
}
