import {
  buildDeviceSyncCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackSuccessRedirectLocation,
} from "@murphai/device-syncd/callback-redirect";
import { buildPublicDeviceSyncErrorPayload } from "@murphai/device-syncd/http";
import {
  DeviceSyncError,
  isDeviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { NextResponse } from "next/server";

import {
  createJsonRouteHelpers,
  mergeJsonHeaders,
  type JsonErrorMapping,
} from "../http";

const HOSTED_DEVICE_SYNC_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

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

  return {
    error: buildPublicDeviceSyncErrorPayload(error).error,
    ...(error.retryable ? { log: { level: "warn" } } : {}),
    status: error.httpStatus,
  };
}

const deviceSyncJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_DEVICE_SYNC_DEFAULT_HEADERS,
  internalMessage: "Hosted device-sync route failed unexpectedly.",
  logMessage: "Hosted device-sync route failed.",
  matchers: [matchDeviceSyncError],
});

export const jsonOk = deviceSyncJsonRouteHelpers.jsonOk;
export const jsonError = deviceSyncJsonRouteHelpers.jsonError;
export const withJsonError = deviceSyncJsonRouteHelpers.withJsonError;
