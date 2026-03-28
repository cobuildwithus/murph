import {
  buildPublicDeviceSyncErrorPayload,
  DeviceSyncError,
  isDeviceSyncError,
} from "@murph/device-syncd";
import { NextResponse } from "next/server";

import {
  createJsonErrorResponse,
} from "../http";

export { jsonOk, readJsonObject, readOptionalJsonObject, readRawBodyBuffer, resolveRouteParams } from "../http";

export function jsonError(error: unknown): NextResponse {
  return createJsonErrorResponse(error, {
    internalMessage: "Hosted device-sync route failed unexpectedly.",
    logMessage: "Hosted device-sync route failed.",
    matchers: [mapDeviceSyncError],
  });
}

export function withJsonError<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
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

export function providerCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  connectionId: string;
}): NextResponse | null {
  if (!input.returnTo) {
    return null;
  }

  const destination = new URL(input.returnTo);
  clearDeviceSyncRedirectState(destination);
  destination.searchParams.set("deviceSyncStatus", "connected");
  destination.searchParams.set("deviceSyncProvider", input.provider);
  destination.searchParams.set("deviceSyncConnectionId", input.connectionId);
  return redirectTo(destination.toString());
}

export function errorToCallbackRedirect(input: {
  returnTo: string | null;
  provider: string;
  error: DeviceSyncError;
}): NextResponse | null {
  if (!input.returnTo) {
    return null;
  }

  const destination = new URL(input.returnTo);
  clearDeviceSyncRedirectState(destination);
  destination.searchParams.set("deviceSyncStatus", "error");
  destination.searchParams.set("deviceSyncProvider", input.provider);
  destination.searchParams.set("deviceSyncError", input.error.code);
  return redirectTo(destination.toString());
}

function clearDeviceSyncRedirectState(destination: URL): void {
  destination.searchParams.delete("deviceSyncConnectionId");
  destination.searchParams.delete("deviceSyncError");
  destination.searchParams.delete("deviceSyncErrorMessage");
  destination.searchParams.delete("deviceSyncProvider");
  destination.searchParams.delete("deviceSyncStatus");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mapDeviceSyncError(error: unknown) {
  if (!isDeviceSyncError(error)) {
    return null;
  }

  return {
    error: buildPublicDeviceSyncErrorPayload(error).error,
    status: error.httpStatus,
  };
}
