import {
  buildPublicDeviceSyncErrorPayload,
  DeviceSyncError,
  isDeviceSyncError,
} from "@murphai/device-syncd/public-ingress";
import { NextResponse } from "next/server";

import {
  createJsonErrorResponse,
  type JsonErrorMatcher,
  withJsonErrorHandling,
} from "../http";

export {
  jsonOk,
  readJsonObject,
  readOptionalJsonObject,
  readRawBodyBuffer,
  resolveDecodedRouteParam,
  resolveRouteParams,
} from "../http";

export function jsonError(error: unknown): NextResponse {
  return createJsonErrorResponse(error, {
    internalMessage: "Hosted device-sync route failed unexpectedly.",
    logMessage: "Hosted device-sync route failed.",
    matchers: [matchDeviceSyncError],
  });
}

export function withJsonError<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return withJsonErrorHandling(handler, jsonError);
}

export function callbackHtml(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
      body,
    )}</p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export function redirectTo(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 302 });
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

const matchDeviceSyncError: JsonErrorMatcher = (error) => {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  return {
    error: buildPublicDeviceSyncErrorPayload(error).error,
    status: error.httpStatus,
  };
};
