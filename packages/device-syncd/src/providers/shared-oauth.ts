import { deviceSyncError } from "../errors.js";
import { addMilliseconds, computeRetryDelayMs, sha256Text, sleep, subtractDays } from "../shared.js";

import type { DeviceSyncErrorOptions } from "../errors.js";
import type { ProviderScheduleResult } from "../types.js";

export async function parseResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export function buildProviderApiError(
  code: string,
  message: string,
  response: Response,
  body: string,
  options: {
    retryable?: boolean;
    accountStatus?: DeviceSyncErrorOptions["accountStatus"];
  } = {},
) {
  return deviceSyncError({
    code,
    message,
    retryable: options.retryable ?? (response.status === 429 || response.status >= 500),
    httpStatus: response.status,
    accountStatus: options.accountStatus ?? null,
    details: {
      status: response.status,
      bodySnippet: body.slice(0, 500),
    },
  });
}

export function extractRetryMetadata(error: unknown): {
  retryable: boolean;
  httpStatus?: number;
} {
  const retryable =
    typeof error === "object" && error !== null && "retryable" in error && Boolean((error as { retryable?: boolean }).retryable);
  const httpStatus =
    typeof error === "object" && error !== null && "httpStatus" in error
      ? Number((error as { httpStatus?: number }).httpStatus)
      : undefined;

  return {
    retryable,
    httpStatus,
  };
}

export async function requestWithRefreshAndRetry<T>(input: {
  shouldRefresh: () => boolean;
  refresh: () => Promise<unknown>;
  request: () => Promise<T>;
  maxRetries?: number;
}): Promise<T> {
  const maxRetries = input.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    if (input.shouldRefresh()) {
      await input.refresh();
    }

    try {
      return await input.request();
    } catch (error) {
      const { retryable, httpStatus } = extractRetryMetadata(error);

      if (httpStatus === 401 && attempt === 0) {
        await input.refresh();
        attempt += 1;
        continue;
      }

      if (retryable && attempt < maxRetries) {
        attempt += 1;
        await sleep(computeRetryDelayMs(attempt));
        continue;
      }

      throw error;
    }
  }
}

export async function postOAuthTokenRequest<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  parameters: Record<string, string>;
  buildError: (response: Response, body: string) => Error;
}): Promise<T> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(input.parameters),
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    throw input.buildError(response, await parseResponseBody(response));
  }

  return (await response.json()) as T;
}

export async function fetchBearerJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  accessToken: string;
  timeoutMs: number;
  optional?: boolean;
  buildError: (response: Response, body: string) => Error;
}): Promise<T | null> {
  const response = await input.fetchImpl(input.url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (response.status === 404 && input.optional) {
    return null;
  }

  if (!response.ok) {
    throw input.buildError(response, await parseResponseBody(response));
  }

  return (await response.json()) as T;
}

export function buildOAuthConnectUrl(input: {
  baseUrl: string;
  authorizePath: string;
  clientId: string;
  callbackUrl: string;
  scopes: string[];
  state: string;
}): string {
  const search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.callbackUrl,
    scope: input.scopes.join(" "),
    state: input.state,
  });

  return `${input.baseUrl}${input.authorizePath}?${search.toString()}`;
}

export function buildScheduledReconcileJobs(input: {
  accountId: string;
  nextReconcileAt: string | null;
  now: string;
  reconcileDays: number;
  reconcileIntervalMs: number;
  payload: Record<string, unknown>;
}): ProviderScheduleResult {
  const dedupeKey = `reconcile:${sha256Text(`${input.accountId}:${input.nextReconcileAt ?? input.now}`)}`;

  return {
    jobs: [
      {
        kind: "reconcile",
        dedupeKey,
        priority: 25,
        payload: {
          windowStart: subtractDays(input.now, input.reconcileDays),
          windowEnd: input.now,
          ...input.payload,
        },
      },
    ],
    nextReconcileAt: addMilliseconds(input.now, input.reconcileIntervalMs),
  };
}
