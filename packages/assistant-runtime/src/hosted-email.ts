const HOSTED_RUNNER_EMAIL_BASE_URL = "http://email.worker";

export interface HostedEmailSendRequest {
  identityId: string | null;
  message: string;
  target: string;
  targetKind: "explicit" | "participant" | "thread";
}

export function normalizeHostedEmailBaseUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ? value.trim() : HOSTED_RUNNER_EMAIL_BASE_URL;
  return new URL(candidate).toString();
}

export function buildHostedRunnerEmailMessageUrl(baseUrl: string, rawMessageKey: string): URL {
  return new URL(`/messages/${encodeURIComponent(rawMessageKey)}`, baseUrl);
}

export function buildHostedRunnerEmailSendUrl(baseUrl: string): URL {
  return new URL("/send", baseUrl);
}

export function createHostedEmailChannelDependencies(input: {
  emailBaseUrl: string;
}): {
  sendEmail: (input: HostedEmailSendRequest) => Promise<{ target: string } | void>
} {
  return {
    sendEmail: async (sendInput) => sendHostedEmailOverWorker({
      ...sendInput,
      emailBaseUrl: input.emailBaseUrl,
    }),
  };
}

export async function sendHostedEmailOverWorker(input: HostedEmailSendRequest & {
  emailBaseUrl: string;
}): Promise<
  | {
      target: string;
    }
  | void
> {
  const response = await fetch(buildHostedRunnerEmailSendUrl(input.emailBaseUrl).toString(), {
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
  });

  if (!response.ok) {
    throw await createHostedEmailDeliveryError(response);
  }

  const payload = await response.json() as {
    ok?: boolean;
    target?: unknown;
  };
  const target = typeof payload.target === "string" && payload.target.trim().length > 0
    ? payload.target.trim()
    : null;

  return target ? { target } : undefined;
}

async function createHostedEmailDeliveryError(response: Response): Promise<Error & {
  code: string;
  retryable: boolean;
}> {
  let message = `Hosted email send worker returned HTTP ${response.status}.`;

  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      message = payload.error.trim();
    }
  } catch {}

  const error = new Error(message) as Error & {
    code: string;
    retryable: boolean;
  };
  error.code = "HOSTED_EMAIL_DELIVERY_FAILED";
  error.retryable = response.status >= 500 || response.status === 429;
  return error;
}
