import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import {
  createHostedExecutionDispatchClient,
} from "@murphai/hosted-execution/client";
import {
  parseHostedExecutionDispatchResult,
} from "@murphai/hosted-execution/parsers";

import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { formatHostedExecutionSafeLogError } from "./logging";
import {
  type HostedExecutionDispatchEnvironment,
  readHostedExecutionDispatchEnvironment,
} from "./environment";
import type { HostedExecutionLegacyReferenceOutboxPayload } from "./outbox-payload";

const HOSTED_EXECUTION_LEGACY_REFERENCE_DISPATCH_PATH = "/internal/dispatch/legacy-reference";

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

export async function dispatchHostedExecutionStoredReferenceStatus(
  input: HostedExecutionLegacyReferenceOutboxPayload,
): Promise<HostedExecutionDispatchResult> {
  const environment = readHostedExecutionDispatchEnvironment();

  if (!isHostedExecutionConfigured(environment)) {
    return buildHostedExecutionNotConfiguredStatus({
      eventId: input.dispatchRef.eventId,
      userId: input.dispatchRef.userId,
    });
  }

  return postHostedExecutionLegacyReferenceDispatch(input, environment);
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
    allowHttpLocalhost: true,
    baseUrl: environment.dispatchUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
    timeoutMs: environment.dispatchTimeoutMs,
  }).dispatch(input);
}

async function postHostedExecutionLegacyReferenceDispatch(
  input: HostedExecutionLegacyReferenceOutboxPayload,
  environment: HostedExecutionDispatchEnvironment & {
    dispatchUrl: string;
  },
): Promise<HostedExecutionDispatchResult> {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  headers.set("authorization", await createHostedExecutionVercelOidcBearerTokenProvider()());
  headers.set(HOSTED_EXECUTION_USER_ID_HEADER, input.dispatchRef.userId);

  const response = await fetch(
    new URL(
      HOSTED_EXECUTION_LEGACY_REFERENCE_DISPATCH_PATH.replace(/^\/+/u, ""),
      `${environment.dispatchUrl}/`,
    ).toString(),
    {
      body: JSON.stringify(input),
      headers,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(environment.dispatchTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`Hosted execution legacy reference dispatch failed with HTTP ${response.status}.`);
  }

  return parseHostedExecutionDispatchResult(await response.json());
}
