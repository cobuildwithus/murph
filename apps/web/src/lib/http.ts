import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { isRecord } from "./device-sync/shared";

export function jsonOk(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status });
}

export interface JsonErrorMapping {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
  status: number;
}

export type JsonErrorMatcher = (error: unknown) => JsonErrorMapping | null;
export type JsonErrorLogDetailProvider = (error: unknown) => Record<string, unknown> | null;

interface JsonErrorResponseOptions {
  defaultHeaders?: HeadersInit;
  headers?: HeadersInit;
  internalMessage: string;
  logMessage: string;
  logDetails?: JsonErrorLogDetailProvider;
  matchers?: JsonErrorMatcher[];
}

export interface JsonRouteHelpersOptions {
  defaultHeaders?: HeadersInit;
  internalMessage: string;
  logMessage: string;
  logDetails?: JsonErrorLogDetailProvider;
  matchers?: JsonErrorMatcher[];
}

export interface JsonRouteHelpers {
  jsonError(error: unknown, headers?: HeadersInit): NextResponse;
  jsonOk(payload: unknown, status?: number, headers?: HeadersInit): NextResponse;
  withJsonError<TArgs extends unknown[]>(
    handler: (...args: TArgs) => Promise<Response>,
  ): (...args: TArgs) => Promise<Response>;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  return requireJsonObject((await request.json()) as unknown);
}

export async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  return requireJsonObject(JSON.parse(text) as unknown);
}

export async function readRawBodyBuffer(request: Request): Promise<Buffer> {
  return Buffer.from(await request.arrayBuffer());
}

export async function resolveRouteParams<TParams extends Record<string, string>>(
  params: Promise<TParams> | TParams,
): Promise<TParams> {
  return Promise.resolve(params);
}

export async function resolveDecodedRouteParam<
  TParams extends Record<string, string>,
  TKey extends keyof TParams & string,
>(
  params: Promise<TParams> | TParams,
  key: TKey,
): Promise<string> {
  const resolvedParams = await resolveRouteParams(params);
  return decodeURIComponent(resolvedParams[key]);
}

export function mapDomainJsonError(error: {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
  httpStatus: number;
}): JsonErrorMapping {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    },
    status: error.httpStatus,
  };
}

export function createJsonErrorResponse(
  error: unknown,
  options: JsonErrorResponseOptions,
): NextResponse {
  const matchedError = matchJsonError(error, options.matchers);

  if (matchedError) {
    return NextResponse.json(
      { error: matchedError.error },
      buildJsonResponseInit(options, matchedError.status),
    );
  }

  if (error instanceof SyntaxError) {
    logJsonError("warn", error, options);
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Invalid JSON.",
        },
      },
      buildJsonResponseInit(options, 400),
    );
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    logJsonError("warn", error, options);
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      },
      buildJsonResponseInit(options, 400),
    );
  }

  logJsonError("error", error, options);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    },
    buildJsonResponseInit(options, 500),
  );
}

export function createJsonRouteHelpers(
  options: JsonRouteHelpersOptions,
): JsonRouteHelpers {
  const jsonError = (error: unknown, headers?: HeadersInit): NextResponse =>
    createJsonErrorResponse(error, {
      defaultHeaders: options.defaultHeaders,
      headers,
      internalMessage: options.internalMessage,
      logMessage: options.logMessage,
      logDetails: options.logDetails,
      matchers: options.matchers,
    });

  const jsonOk = (payload: unknown, status = 200, headers?: HeadersInit): NextResponse =>
    NextResponse.json(payload, {
      headers: mergeJsonHeaders(options.defaultHeaders, headers),
      status,
    });

  return {
    jsonError,
    jsonOk,
    withJsonError<TArgs extends unknown[]>(
      handler: (...args: TArgs) => Promise<Response>,
    ): (...args: TArgs) => Promise<Response> {
      return withJsonErrorHandling(handler, (error) => jsonError(error));
    },
  };
}

export function withJsonErrorHandling<TArgs extends unknown[], TResponse extends Response>(
  handler: (...args: TArgs) => Promise<TResponse>,
  mapError: (error: unknown) => TResponse,
): (...args: TArgs) => Promise<TResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return mapError(error);
    }
  };
}

export function mergeJsonHeaders(
  defaultHeaders?: HeadersInit,
  headers?: HeadersInit,
): Headers | undefined {
  if (!defaultHeaders && !headers) {
    return undefined;
  }

  const merged = new Headers(defaultHeaders);

  if (headers) {
    const requestedHeaders = new Headers(headers);

    for (const [key, value] of requestedHeaders.entries()) {
      merged.set(key, value);
    }
  }

  return merged;
}

function requireJsonObject(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return body;
}

function buildJsonResponseInit(
  options: JsonErrorResponseOptions,
  status: number,
): ResponseInit {
  return {
    headers: mergeJsonHeaders(options.defaultHeaders, options.headers),
    status,
  };
}

function matchJsonError(
  error: unknown,
  matchers: JsonErrorMatcher[] | undefined,
): JsonErrorMapping | null {
  if (!matchers) {
    return null;
  }

  for (const matcher of matchers) {
    const mappedError = matcher(error);

    if (mappedError) {
      return mappedError;
    }
  }

  return null;
}

function logJsonError(
  level: "warn" | "error",
  error: unknown,
  options: JsonErrorResponseOptions,
): void {
  const log = level === "warn" ? console.warn : console.error;

  log(options.logMessage, {
    errorType: describeLoggedErrorType(error),
    internalMessage: options.internalMessage,
    ...(level === "error" ? (options.logDetails?.(error) ?? {}) : {}),
  });
}

function describeLoggedErrorType(error: unknown): string {
  if (error instanceof Error) {
    const constructorName = error.constructor?.name;

    return typeof constructorName === "string" && constructorName ? constructorName : "Error";
  }

  if (Array.isArray(error)) {
    return "array";
  }

  return error === null ? "null" : typeof error;
}
