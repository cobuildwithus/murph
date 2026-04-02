import { buildPublicDeviceSyncErrorPayload } from "@murphai/device-syncd/http";
import {
  DeviceSyncError,
  isDeviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { NextResponse } from "next/server";

import {
  createJsonRouteHelpers,
  mergeJsonHeaders,
} from "../http";

const HOSTED_DEVICE_SYNC_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export {
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

function updateCallbackRedirect(
  returnTo: string | null,
  mutate: (destination: URL) => void,
): NextResponse | null {
  if (!returnTo) {
    return null;
  }

  const destination = new URL(returnTo);
  mutate(destination);
  return redirectTo(destination.toString());
}

export function providerCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  connectionId: string;
}): NextResponse | null {
  return updateCallbackRedirect(input.returnTo, (destination) => {
    destination.searchParams.set("deviceSyncStatus", "connected");
    destination.searchParams.set("deviceSyncProvider", input.provider);
    destination.searchParams.set("deviceSyncConnectionId", input.connectionId);
  });
}

export function errorToCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  error: DeviceSyncError;
}): NextResponse | null {
  return updateCallbackRedirect(input.returnTo, (destination) => {
    destination.searchParams.delete("deviceSyncErrorMessage");
    destination.searchParams.set("deviceSyncStatus", "error");
    destination.searchParams.set("deviceSyncProvider", input.provider);
    destination.searchParams.set("deviceSyncError", input.error.code);
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function matchDeviceSyncError(error: unknown) {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  return {
    error: buildPublicDeviceSyncErrorPayload(error).error,
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
