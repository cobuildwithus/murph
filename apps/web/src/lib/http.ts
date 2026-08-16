import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { isRecord } from "./primitives";

export function jsonOk(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status });
}

export function methodNotAllowedJson(
  allow: string | readonly string[],
  message = "Method not allowed.",
): NextResponse {
  const allowHeader = typeof allow === "string" ? allow : allow.join(", ");

  return NextResponse.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message,
      },
    },
    {
      headers: {
        allow: allowHeader,
      },
      status: 405,
    },
  );
}

export function postOnlyJson(message = "This route only allows POST."): NextResponse {
  return methodNotAllowedJson("POST", message);
}

export interface JsonErrorMapping {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
  log?: JsonErrorLogMapping | null;
  status: number;
}

export type JsonLogLevel = "warn" | "error";

export interface JsonErrorLogMapping {
  level?: JsonLogLevel;
  details?: Record<string, unknown>;
}

export type JsonErrorMatcher = (error: unknown) => JsonErrorMapping | null;
export type JsonErrorLogDetailProvider = (error: unknown) => Record<string, unknown> | null;
export type JsonLogStringSanitizer = (
  value: string | null | undefined,
  maxLength?: number,
) => string | null;

const JSON_LOG_STRING_MAX_LENGTH = 240;
const DEFAULT_JSON_BODY_LIMIT_BYTES = 128 * 1024;
const DEFAULT_RAW_BODY_LIMIT_BYTES = 1024 * 1024;
// Header values may contain commas, so unquoted auth/cookie forms redact through the next object boundary.
const JSON_LOG_HEADER_SECRET_VALUE_PATTERN =
  /(^|[\s,{])(["']?(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\[[^\]]*\]|[^}]*)/giu;
const JSON_ERROR_RESPONSE_DETAIL_SAFE_KEYS = new Set([
  "code",
  "operationName",
  "requestIdPresent",
  "retryAfterMs",
  "retryAfterSeconds",
  "stripeParam",
  "status",
  "statusCode",
  "type",
]);

interface JsonErrorResponseOptions {
  defaultHeaders?: HeadersInit;
  headers?: HeadersInit;
  internalMessage: string;
  logMessage: string;
  logDetails?: JsonErrorLogDetailProvider;
  routeContext?: JsonRouteLogContext | null;
  sanitizeLogString?: JsonLogStringSanitizer;
  warnLogDetails?: JsonErrorLogDetailProvider;
  matchers?: JsonErrorMatcher[];
}

export interface JsonRouteHelpersOptions {
  defaultHeaders?: HeadersInit;
  internalMessage: string;
  logMessage: string;
  logDetails?: JsonErrorLogDetailProvider;
  sanitizeLogString?: JsonLogStringSanitizer;
  warnLogDetails?: JsonErrorLogDetailProvider;
  matchers?: JsonErrorMatcher[];
}

export interface JsonRouteHelpers {
  jsonError(error: unknown, headers?: HeadersInit): NextResponse;
  jsonOk(payload: unknown, status?: number, headers?: HeadersInit): NextResponse;
  withJsonError<TArgs extends unknown[]>(
    handler: (...args: TArgs) => Promise<Response>,
  ): (...args: TArgs) => Promise<Response>;
}

interface JsonRouteLogContext {
  requestMethod?: string;
}

export class InvalidRouteParamEncodingError extends TypeError {
  constructor(key: string) {
    super(`Route parameter ${key} contained an invalid encoding.`);
    this.name = "InvalidRouteParamEncodingError";
  }
}

export class InvalidJsonObjectBodyError extends TypeError {
  constructor() {
    super("Request body must be a JSON object.");
    this.name = "InvalidJsonObjectBodyError";
  }
}

export interface JsonBodyReadOptions {
  limitBytes?: number;
}

export async function readJsonObject(
  request: Request,
  options: JsonBodyReadOptions = {},
): Promise<Record<string, unknown>> {
  return requireJsonObject(JSON.parse(await readRequestBodyText(request, options)));
}

export async function readOptionalJsonObject(
  request: Request,
  options: JsonBodyReadOptions = {},
): Promise<Record<string, unknown>> {
  const text = await readRequestBodyText(request, options);

  if (!text.trim()) {
    return {};
  }

  return requireJsonObject(JSON.parse(text));
}

async function readRequestBodyText(
  request: Request,
  options: JsonBodyReadOptions,
): Promise<string> {
  return (await readRawBodyBuffer(request, {
    limitBytes: options.limitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES,
  })).toString("utf8");
}

export async function readRawBodyBuffer(
  request: Request,
  options: { limitBytes?: number } = {},
): Promise<Buffer> {
  const limitBytes = options.limitBytes ?? DEFAULT_RAW_BODY_LIMIT_BYTES;

  const declaredContentLength = request.headers.get("content-length");

  if (declaredContentLength) {
    const parsedContentLength = Number.parseInt(declaredContentLength, 10);

    if (Number.isFinite(parsedContentLength) && parsedContentLength > limitBytes) {
      throw new RangeError(`Request body exceeded ${limitBytes} bytes.`);
    }
  }

  if (!request.body) {
    return Buffer.alloc(0);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      totalBytes += value.byteLength;

      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new RangeError(`Request body exceeded ${limitBytes} bytes.`);
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
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

  try {
    return decodeURIComponent(resolvedParams[key]);
  } catch {
    throw new InvalidRouteParamEncodingError(key);
  }
}

/**
 * Tolerant variant for surfaces that must not fail on malformed
 * percent-encoding (for example metadata on pages whose bodies deliberately
 * accept raw values): falls back to the raw value instead of throwing.
 */
export function decodeURIComponentOrRaw(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
    logMappedJsonError(error, matchedError, options);
    return NextResponse.json(
      { error: matchedError.error },
      buildJsonResponseInit(options, matchedError.status),
    );
  }

  if (error instanceof SyntaxError) {
    logJsonError("warn", error, options, {
      errorResponseCode: "INVALID_JSON",
    });
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

  if (isRequestBodyTooLargeError(error)) {
    logJsonError("warn", error, options, {
      errorResponseCode: "REQUEST_BODY_TOO_LARGE",
    });
    return NextResponse.json(
      {
        error: {
          code: "REQUEST_BODY_TOO_LARGE",
          message: "Request body too large.",
        },
      },
      buildJsonResponseInit(options, 413),
    );
  }

  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    logJsonError("warn", error, options, {
      errorResponseCode: "INVALID_REQUEST",
    });
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

  logJsonError("error", error, options, {
    errorResponseCode: "INTERNAL_ERROR",
  });
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

function isRequestBodyTooLargeError(error: unknown): error is RangeError {
  return error instanceof RangeError && error.message.startsWith("Request body exceeded ");
}

export function createJsonRouteHelpers(
  options: JsonRouteHelpersOptions,
): JsonRouteHelpers {
  const jsonErrorWithContext = (
    error: unknown,
    headers?: HeadersInit,
    routeContext?: JsonRouteLogContext | null,
  ): NextResponse =>
    createJsonErrorResponse(error, {
      defaultHeaders: options.defaultHeaders,
      headers,
      internalMessage: options.internalMessage,
      logMessage: options.logMessage,
      logDetails: options.logDetails,
      routeContext,
      sanitizeLogString: options.sanitizeLogString,
      warnLogDetails: options.warnLogDetails,
      matchers: options.matchers,
    });
  const jsonError = (error: unknown, headers?: HeadersInit): NextResponse =>
    jsonErrorWithContext(error, headers);

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
      return async (...args) => {
        try {
          return await handler(...args);
        } catch (error) {
          return jsonErrorWithContext(error, undefined, describeJsonRouteLogContext(args));
        }
      };
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
    throw new InvalidJsonObjectBodyError();
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

function logMappedJsonError(
  error: unknown,
  mapping: JsonErrorMapping,
  options: JsonErrorResponseOptions,
): void {
  if (mapping.log === null) {
    return;
  }

  const explicitLogDetails = mapping.log?.details ?? {};
  const mappedErrorDetails =
    "errorDetails" in explicitLogDetails || "errorResponseDetails" in explicitLogDetails
      ? {}
      : describeMappedJsonErrorDetailsForLog(
          mapping.error.details,
          options.sanitizeLogString ?? sanitizeJsonLogString,
        );

  logJsonError(mapping.log?.level ?? inferJsonErrorLogLevel(mapping.status), error, options, {
    errorResponseCode: mapping.error.code,
    ...(mapping.error.retryable === undefined
      ? {}
      : { errorResponseRetryable: mapping.error.retryable }),
    errorResponseStatus: mapping.status,
    ...(mappedErrorDetails ?? {}),
    ...explicitLogDetails,
  });
}

function describeMappedJsonErrorDetailsForLog(
  details: unknown,
  sanitizeLogString: JsonLogStringSanitizer,
): Record<string, unknown> | null {
  if (!isRecord(details)) {
    return null;
  }

  const safeDetails = Object.entries(details).flatMap(([key, value]) => {
    if (!JSON_ERROR_RESPONSE_DETAIL_SAFE_KEYS.has(key)) {
      return [];
    }

    const safeValue = sanitizeMappedJsonErrorDetailValue(value, sanitizeLogString);
    return safeValue === null ? [] : [[key, safeValue] as const];
  });

  return safeDetails.length > 0
    ? { errorResponseDetails: Object.fromEntries(safeDetails) }
    : null;
}

function sanitizeMappedJsonErrorDetailValue(
  value: unknown,
  sanitizeLogString: JsonLogStringSanitizer,
): unknown {
  if (typeof value === "string") {
    return sanitizeLogString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return null;
}

function inferJsonErrorLogLevel(status: number): JsonLogLevel {
  return status >= 500 ? "error" : "warn";
}

function logJsonError(
  level: JsonLogLevel,
  error: unknown,
  options: JsonErrorResponseOptions,
  extraDetails: Record<string, unknown> = {},
): void {
  const log = level === "warn" ? console.warn : console.error;
  const defaultDetails = describeErrorForLog(error, options.sanitizeLogString);
  const customDetails =
    level === "error" ? (options.logDetails?.(error) ?? {}) : (options.warnLogDetails?.(error) ?? {});

  log(options.logMessage, {
    errorType: describeLoggedErrorType(error),
    internalMessage: options.internalMessage,
    ...(options.routeContext ?? {}),
    ...(defaultDetails ?? {}),
    ...customDetails,
    ...extraDetails,
  });
}

function describeJsonRouteLogContext(args: readonly unknown[]): JsonRouteLogContext | null {
  const request = args.find((arg): arg is Request => arg instanceof Request);

  if (!request) {
    return null;
  }

  return {
    requestMethod: request.method,
  };
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

export function sanitizeJsonLogString(
  value: string | null | undefined,
  maxLength = JSON_LOG_STRING_MAX_LENGTH,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(
      JSON_LOG_HEADER_SECRET_VALUE_PATTERN,
      "$1$2<redacted-secret>",
    )
    .replace(
      /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/giu,
      "$1<redacted-secret>",
    )
    .replace(/\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/giu, "$1 <redacted-secret>")
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/giu, "<redacted-secret>")
    .replace(/\bwhsec_[A-Z0-9]+\b/giu, "<redacted-secret>")
    .replace(/\bfile:\/\/\S+/giu, "<redacted-path>")
    .replace(/\bhttps?:\/\/\S+/giu, "<redacted-url>")
    // Email must resolve before the schemeless-URL rule below. A `www.`-prefixed
    // domain is legal in an address, so matching the URL first would consume the
    // domain and strand the identifying local part (`alice@<redacted-url>`).
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "<redacted-email>")
    // A scheme is a formatting choice, not a sensitivity boundary: `www.host/x`
    // leaks exactly what `https://www.host/x` would.
    .replace(/\bwww\.\S+/giu, "<redacted-url>")
    .replace(/\+\d[\d().\s-]{7,}\d/gu, "<redacted-phone>")
    // Same number without the country prefix. External text we do not control
    // (provider failure reasons especially) writes phone numbers in national
    // format far more often than E.164, so matching only `+` left the common
    // case readable. Over-matching a phone-shaped identifier here is the safe
    // direction: only the number is replaced, not the surrounding wording.
    .replace(/(?:\(\d{3}\)\s*|\b\d{3}[.\s-])\d{3}[.\s-]\d{4}\b/gu, "<redacted-phone>")
    .replace(/(^|[\s(])\/[^\s)]+/gu, "$1<redacted-path>")
    .replace(/\b[A-Z]:\\[^\s]+/gu, "<redacted-path>");

  return normalized ? normalized.slice(0, maxLength) : null;
}

export function describeErrorForLog(
  error: unknown,
  sanitizeLogString: JsonLogStringSanitizer = sanitizeJsonLogString,
): Record<string, unknown> | null {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {};

    assignSanitizedLogField(details, "errorMessage", error.message, sanitizeLogString);
    assignErrorProperty(details, "errorCode", error, "code", sanitizeLogString);
    assignErrorProperty(details, "errorCode", error, "errorCode", sanitizeLogString);
    assignErrorProperty(details, "errorDigest", error, "digest", sanitizeLogString);
    assignErrorProperty(details, "errorErrno", error, "errno", sanitizeLogString);
    assignErrorProperty(details, "errorStatus", error, "status", sanitizeLogString);
    assignErrorProperty(details, "errorStatusCode", error, "statusCode", sanitizeLogString);
    assignErrorProperty(details, "errorSyscall", error, "syscall", sanitizeLogString);

    const errorCause = error.cause;

    if (errorCause !== undefined) {
      details.errorCauseType = describeLoggedErrorType(errorCause);

      if (errorCause instanceof Error) {
        assignSanitizedLogField(
          details,
          "errorCauseMessage",
          errorCause.message,
          sanitizeLogString,
        );
      } else if (typeof errorCause === "string") {
        assignSanitizedLogField(details, "errorCauseMessage", errorCause, sanitizeLogString);
      }
    }

    return Object.keys(details).length > 0 ? details : null;
  }

  if (typeof error === "string") {
    const errorValue = sanitizeLogString(error);
    return errorValue ? { errorValue } : null;
  }

  if (typeof error === "number" || typeof error === "boolean") {
    return { errorValue: error };
  }

  if (typeof error === "bigint") {
    return { errorValue: error.toString() };
  }

  return null;
}

function assignErrorProperty(
  target: Record<string, unknown>,
  targetKey: string,
  error: Error,
  property: string,
  sanitizeLogString: JsonLogStringSanitizer,
): void {
  if (targetKey in target) {
    return;
  }

  const value = getErrorProperty(error, property);

  if (typeof value === "number" || typeof value === "boolean") {
    target[targetKey] = value;
    return;
  }

  if (typeof value === "bigint") {
    target[targetKey] = value.toString();
    return;
  }

  if (typeof value === "string") {
    assignSanitizedLogField(target, targetKey, value, sanitizeLogString);
  }
}

function assignSanitizedLogField(
  target: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
  sanitizeLogString: JsonLogStringSanitizer,
): void {
  const sanitizedValue = sanitizeLogString(value);

  if (sanitizedValue) {
    target[key] = sanitizedValue;
  }
}

function getErrorProperty(error: Error, property: string): unknown {
  const value = Reflect.get(error, property);
  return value === error ? "[circular]" : value;
}
