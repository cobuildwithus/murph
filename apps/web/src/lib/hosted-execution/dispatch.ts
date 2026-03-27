import { createHmac } from "node:crypto";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

import {
  readHostedExecutionDispatchEnvironment,
  type HostedExecutionDispatchEnvironment,
} from "./env";

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
  const payload = JSON.stringify(input);
  const envelopeTimestamp = new Date().toISOString();
  const signature = createExecutionSignature({
    payload,
    secret: environment.signingSecret,
    timestamp: envelopeTimestamp,
  });
  const response = await fetch(`${environment.dispatchUrl}/internal/dispatch`, {
    body: payload,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: signature,
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: envelopeTimestamp,
    },
    method: "POST",
    signal: AbortSignal.timeout(environment.dispatchTimeoutMs),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Hosted execution dispatch failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}.`,
    );
  }

  return (await response.json()) as HostedExecutionUserStatus;
}

function createExecutionSignature(input: {
  payload: string;
  secret: string;
  timestamp: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.payload}`)
    .digest("hex");
}
