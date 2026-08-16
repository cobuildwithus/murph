import {
  buildDeviceSyncCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackSuccessRedirectLocation,
} from "@murphai/device-syncd/callback-redirect";
import {
  buildPublicDeviceSyncErrorPayload,
  DeviceSyncError,
  deviceSyncError,
  isDeviceSyncError,
} from "@murphai/device-syncd/errors";
import { NextResponse } from "next/server";

import {
  createJsonRouteHelpers,
  mergeJsonHeaders,
  type JsonErrorMapping,
} from "../http";

const HOSTED_DEVICE_SYNC_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;
const DEVICE_WEBHOOK_QUEUE_DIAGNOSTIC_TYPES = new Set([
  "enqueue_failed",
  "invalid_request",
  "persistence_failure_unclassified",
  "persistence_key_unavailable",
  "persistence_reseal_failed",
  "queue_unavailable",
  "transport_context_mismatch",
  "transport_metadata_invalid",
  "transport_payload_open_failed",
  "transport_recipient_key_unavailable",
  "transport_root_key_unwrap_failed",
]);

export {
  InvalidRouteParamEncodingError,
  methodNotAllowedJson,
  postOnlyJson,
  readJsonObject,
  readOptionalJsonObject,
  readRawBodyBuffer,
  resolveDecodedRouteParam,
  resolveRouteParams,
} from "../http";

export function callbackHtml(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
      body,
    )}</p></main></body></html>`,
    {
      headers: mergeJsonHeaders(HOSTED_DEVICE_SYNC_DEFAULT_HEADERS, {
        "content-type": "text/html; charset=utf-8",
      }),
      status,
    },
  );
}

export function redirectTo(url: string): NextResponse {
  return NextResponse.redirect(url, {
    headers: mergeJsonHeaders(HOSTED_DEVICE_SYNC_DEFAULT_HEADERS),
    status: 302,
  });
}

export function providerCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  connectSourceId?: string | null;
  connectTarget?: string | null;
}): NextResponse | null {
  const location = buildDeviceSyncCallbackSuccessRedirectLocation(input);
  return location ? redirectTo(location) : null;
}

export function errorToCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  error: DeviceSyncError;
  connectSourceId?: string | null;
  connectTarget?: string | null;
}): NextResponse | null {
  const location = buildDeviceSyncCallbackErrorRedirectLocation({
    returnTo: input.returnTo,
    provider: input.provider,
    connectSourceId: input.connectSourceId ?? null,
    connectTarget: input.connectTarget ?? null,
    errorCode: input.error.code,
  });
  return location ? redirectTo(location) : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function matchDeviceSyncError(error: unknown): JsonErrorMapping | null {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  const queueDiagnosticType = readDeviceWebhookQueueDiagnosticType(error);
  return {
    error: buildPublicDeviceSyncErrorPayload(error).error,
    ...(error.retryable || queueDiagnosticType
      ? {
          log: {
            ...(error.retryable ? { level: "warn" as const } : {}),
            ...(queueDiagnosticType
              ? { details: { deviceWebhookQueueFailureType: queueDiagnosticType } }
              : {}),
          },
        }
      : {}),
    status: error.httpStatus,
  };
}

function readDeviceWebhookQueueDiagnosticType(
  error: DeviceSyncError,
): string | null {
  if (error.code !== "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED") {
    return null;
  }
  const type = error.details?.type;
  return typeof type === "string" && DEVICE_WEBHOOK_QUEUE_DIAGNOSTIC_TYPES.has(type)
    ? type
    : "enqueue_failed";
}

// Prisma reports every transaction-API fault as P2028, covering both a
// transaction that expired mid-flight and one that never started in time.
const PRISMA_TRANSACTION_FAULT_CODE = "P2028";
// Raw queries fail with P2010; @prisma/adapter-pg nests the original Postgres
// code under meta.driverAdapterError.cause.
const PRISMA_RAW_QUERY_FAULT_CODE = "P2010";
// Postgres raises 55P03 when a bounded `lock_timeout` wait gives up, which is
// how the webhook admission member-row lock fails fast under fan-out bursts.
const POSTGRES_LOCK_TIMEOUT_CODE = "55P03";

const DEVICE_SYNC_STORE_CONTENTION_ERROR_CODE = "STORE_CONTENTION";

/**
 * Providers retry this path on a retryable 503 (`WEBHOOK_ACCOUNT_NOT_READY`,
 * `WEBHOOK_TRACE_IN_PROGRESS`, ...); an unmapped 500 breaks that redelivery
 * contract. Nothing is committed when a transaction expires, because the
 * ingress releases the webhook trace claim, so contention faults are safe to
 * retry.
 */
function matchDatabaseContentionError(error: unknown): JsonErrorMapping | null {
  if (!isDatabaseContentionError(error)) {
    return null;
  }

  return {
    error: buildPublicDeviceSyncErrorPayload(deviceSyncError({
      code: DEVICE_SYNC_STORE_CONTENTION_ERROR_CODE,
      message: "The device-sync store timed out under contention. Retry later.",
      retryable: true,
      httpStatus: 503,
    })).error,
    log: { level: "warn" },
    status: 503,
  };
}

/**
 * Both contention shapes arrive directly: the Prisma wrapper, the webhook
 * trace-release catch, and the shared JSON route helper all rethrow the
 * original error, so the classifier decodes exactly what the store emits.
 */
function isDatabaseContentionError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const record = error as { code?: unknown; meta?: unknown };
  return record.code === PRISMA_TRANSACTION_FAULT_CODE
    || (record.code === PRISMA_RAW_QUERY_FAULT_CODE && isAdapterPgLockTimeoutMeta(record.meta));
}

/**
 * The production adapter-pg shape for a raw-query lock timeout: P2010 with the
 * Postgres code at meta.driverAdapterError.cause.originalCode (or .code). The
 * hosted member billing store decodes this exact shape for its own lock bound.
 */
function isAdapterPgLockTimeoutMeta(meta: unknown): boolean {
  if (meta === null || typeof meta !== "object") {
    return false;
  }
  const driverAdapterError = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (driverAdapterError === null || typeof driverAdapterError !== "object") {
    return false;
  }
  const cause = (driverAdapterError as { cause?: unknown }).cause;
  if (cause === null || typeof cause !== "object") {
    return false;
  }
  const causeRecord = cause as { code?: unknown; originalCode?: unknown };
  return causeRecord.originalCode === POSTGRES_LOCK_TIMEOUT_CODE
    || causeRecord.code === POSTGRES_LOCK_TIMEOUT_CODE;
}

const deviceSyncJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_DEVICE_SYNC_DEFAULT_HEADERS,
  internalMessage: "Hosted device-sync route failed unexpectedly.",
  logMessage: "Hosted device-sync route failed.",
  matchers: [matchDeviceSyncError, matchDatabaseContentionError],
});

export const jsonOk = deviceSyncJsonRouteHelpers.jsonOk;
export const jsonError = deviceSyncJsonRouteHelpers.jsonError;
export const withJsonError = deviceSyncJsonRouteHelpers.withJsonError;
