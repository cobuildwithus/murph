import { readHostedRunnerCommitTimeoutMs } from "./timeouts.ts";

export interface HostedJsonHttpResponse {
  payload: unknown;
  response: Response;
  text: string;
}

export interface HostedBytesHttpResponse {
  bytes: Uint8Array;
  response: Response;
}

export async function fetchHostedJsonResponse(input: {
  description: string;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<HostedJsonHttpResponse> {
  const response = await fetchHostedResponse(input);
  const text = await readHostedResponseText(response, input.description);
  const parsed = parseHostedJsonBody(text);

  if (response.ok && parsed.error) {
    throw createHostedInternalHttpError(
      `${input.description} returned an invalid JSON response body.`,
      parsed.error,
    );
  }

  return {
    payload: parsed.error ? null : parsed.value,
    response,
    text,
  };
}

export async function fetchHostedBytesResponse(input: {
  description: string;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<HostedBytesHttpResponse> {
  const response = await fetchHostedResponse(input);

  try {
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      response,
    };
  } catch (error) {
    throw createHostedInternalHttpError(
      `${input.description} response body could not be read.`,
      error,
    );
  }
}

export function summarizeHostedJsonErrorBody(payload: unknown, text: string): string | null {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  const trimmed = text.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 500);
  }

  if (payload === null || payload === undefined) {
    return null;
  }

  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload).slice(0, 500);
  }
}

async function fetchHostedResponse(input: {
  description: string;
  timeoutMs: number | null;
  init?: RequestInit;
  url: string | URL;
}): Promise<Response> {
  try {
    return await fetch(input.url, {
      ...input.init,
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.timeoutMs)),
    });
  } catch (error) {
    throw createHostedInternalHttpError(`${input.description} request failed.`, error);
  }
}

async function readHostedResponseText(response: Response, description: string): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw createHostedInternalHttpError(`${description} response body could not be read.`, error);
  }
}

function parseHostedJsonBody(text: string): {
  error: Error | null;
  value: unknown;
} {
  if (!text.trim()) {
    return {
      error: null,
      value: null,
    };
  }

  try {
    return {
      error: null,
      value: JSON.parse(text) as unknown,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      value: null,
    };
  }
}

function createHostedInternalHttpError(message: string, cause?: unknown): Error {
  const detail = summarizeHostedInternalHttpCause(cause);
  return new Error(detail ? `${message} ${detail}` : message, cause ? { cause } : undefined);
}

function summarizeHostedInternalHttpCause(cause: unknown): string {
  if (
    cause
    && typeof cause === "object"
    && "name" in cause
    && (cause.name === "AbortError" || cause.name === "TimeoutError")
  ) {
    return "The request timed out.";
  }

  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.trim();
  }

  if (typeof cause === "string" && cause.trim().length > 0) {
    return cause.trim();
  }

  return "";
}
