import {
  HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
  buildHostedExecutionRunnerEmailMessagePath,
} from "@murphai/hosted-execution";
import {
  DEFAULT_HOSTED_EXECUTION_RESULTS_BASE_URL,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
} from "@murphai/hosted-execution/callback-hosts";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import {
  fetchHostedJsonResponse,
  summarizeHostedJsonErrorBody,
} from "./hosted-runtime/internal-http.ts";

export const hostedEmailSendTargetKindValues = [
  "explicit",
  "participant",
  "thread",
] as const;

export type HostedEmailSendTargetKind = (typeof hostedEmailSendTargetKindValues)[number];

export interface HostedEmailSendRequest {
  identityId: string | null;
  message: string;
  target: string;
  targetKind: HostedEmailSendTargetKind;
  timeoutMs?: number | null;
}

export function parseHostedEmailSendRequest(value: unknown): HostedEmailSendRequest {
  const record = requireHostedEmailSendRequestObject(value, "Hosted email send request");

  return {
    identityId: readOptionalHostedEmailSendRequestString(
      record.identityId ?? null,
      "Hosted email send request identityId",
    ),
    message: requireHostedEmailSendRequestString(
      record.message,
      "Hosted email send request message",
    ),
    target: requireHostedEmailSendRequestString(
      record.target,
      "Hosted email send request target",
    ),
    targetKind: requireHostedEmailSendTargetKind(
      record.targetKind,
      "Hosted email send request targetKind",
    ),
  };
}

export function normalizeHostedEmailBaseUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ? value.trim() : DEFAULT_HOSTED_EXECUTION_RESULTS_BASE_URL;
  const normalized = normalizeHostedExecutionBaseUrl(candidate, {
    allowHttpHosts: [HOSTED_EXECUTION_CALLBACK_HOSTS.results],
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted email baseUrl must be configured.");
  }

  return normalized;
}

export function buildHostedRunnerEmailMessageUrl(baseUrl: string, rawMessageKey: string): URL {
  return new URL(buildHostedExecutionRunnerEmailMessagePath(rawMessageKey), baseUrl);
}

export function buildHostedRunnerEmailSendUrl(baseUrl: string): URL {
  return new URL(HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH, baseUrl);
}

export function createHostedEmailChannelDependencies(input: {
  resultsBaseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): {
  sendEmail: (input: HostedEmailSendRequest) => Promise<{ target: string } | void>
} {
  return {
    sendEmail: async (sendInput) => sendHostedEmailOverWorker({
      ...sendInput,
      resultsBaseUrl: input.resultsBaseUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: sendInput.timeoutMs ?? input.timeoutMs ?? null,
    }),
  };
}

export async function sendHostedEmailOverWorker(input: HostedEmailSendRequest & {
  resultsBaseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | {
      target: string;
    }
  | void
> {
  const { payload, response, text } = await fetchHostedJsonResponse({
    description: "Hosted email send worker",
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs ?? null,
    url: buildHostedRunnerEmailSendUrl(input.resultsBaseUrl).toString(),
    init: {
      body: JSON.stringify({
        identityId: input.identityId,
        message: input.message,
        target: input.target,
        targetKind: input.targetKind,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  });

  if (!response.ok) {
    throw createHostedEmailDeliveryError(response.status, payload, text);
  }

  const parsedPayload = payload as {
    ok?: boolean;
    target?: unknown;
  };
  const target = typeof parsedPayload.target === "string" && parsedPayload.target.trim().length > 0
    ? parsedPayload.target.trim()
    : null;

  return target ? { target } : undefined;
}

function createHostedEmailDeliveryError(
  status: number,
  payload: unknown,
  text: string,
): Error & {
  code: string;
  retryable: boolean;
} {
  let message = `Hosted email send worker returned HTTP ${status}.`;
  const errorText =
    payload && typeof payload === "object" && "error" in payload
      ? typeof payload.error === "string" && payload.error.trim().length > 0
        ? payload.error.trim()
        : null
      : summarizeHostedJsonErrorBody(payload, text);

  if (errorText) {
    message = errorText;
  }

  const error = new Error(message) as Error & {
    code: string;
    retryable: boolean;
  };
  error.code = "HOSTED_EMAIL_DELIVERY_FAILED";
  error.retryable = status >= 500 || status === 429;
  return error;
}

function requireHostedEmailSendRequestObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function readOptionalHostedEmailSendRequestString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = requireHostedEmailSendRequestString(value, label).trim();
  return normalized.length > 0 ? normalized : null;
}

function requireHostedEmailSendTargetKind(
  value: unknown,
  label: string,
): HostedEmailSendTargetKind {
  const targetKind = requireHostedEmailSendRequestString(value, label);

  if (hostedEmailSendTargetKindValues.includes(targetKind as HostedEmailSendTargetKind)) {
    return targetKind as HostedEmailSendTargetKind;
  }

  throw new TypeError(`${label} must be explicit, participant, or thread.`);
}
