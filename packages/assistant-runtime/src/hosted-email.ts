import {
  DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution";

import {
  fetchHostedJsonResponse,
  summarizeHostedJsonErrorBody,
} from "./hosted-runtime/internal-http.ts";

export interface HostedEmailSendRequest {
  identityId: string | null;
  message: string;
  target: string;
  targetKind: "explicit" | "participant" | "thread";
  timeoutMs?: number | null;
}

export function normalizeHostedEmailBaseUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ? value.trim() : DEFAULT_HOSTED_EXECUTION_EMAIL_BASE_URL;
  const normalized = normalizeHostedExecutionBaseUrl(candidate, {
    allowHttpHosts: [HOSTED_EXECUTION_CALLBACK_HOSTS.email],
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError("Hosted email baseUrl must be configured.");
  }

  return normalized;
}

export function buildHostedRunnerEmailMessageUrl(baseUrl: string, rawMessageKey: string): URL {
  return new URL(`/messages/${encodeURIComponent(rawMessageKey)}`, baseUrl);
}

export function buildHostedRunnerEmailSendUrl(baseUrl: string): URL {
  return new URL("/send", baseUrl);
}

export function createHostedEmailChannelDependencies(input: {
  emailBaseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number | null;
}): {
  sendEmail: (input: HostedEmailSendRequest) => Promise<{ target: string } | void>
} {
  return {
    sendEmail: async (sendInput) => sendHostedEmailOverWorker({
      ...sendInput,
      emailBaseUrl: input.emailBaseUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: sendInput.timeoutMs ?? input.timeoutMs ?? null,
    }),
  };
}

export async function sendHostedEmailOverWorker(input: HostedEmailSendRequest & {
  emailBaseUrl: string;
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
    url: buildHostedRunnerEmailSendUrl(input.emailBaseUrl).toString(),
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
