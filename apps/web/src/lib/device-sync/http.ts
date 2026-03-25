import { DeviceSyncError, isDeviceSyncError } from "@healthybob/device-syncd";
import { NextResponse } from "next/server";

export { jsonOk, readJsonObject, readOptionalJsonObject, readRawBodyBuffer, resolveRouteParams } from "../http";

export function jsonError(error: unknown): NextResponse {
  if (isDeviceSyncError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
      },
      { status: error.httpStatus },
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: error.message,
        },
      },
      { status: 400 },
    );
  }

  console.error("Hosted device-sync route failed.", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Hosted device-sync route failed unexpectedly.",
      },
    },
    { status: 500 },
  );
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
  destination.searchParams.set("deviceSyncStatus", "error");
  destination.searchParams.set("deviceSyncProvider", input.provider);
  destination.searchParams.set("deviceSyncError", input.error.code);
  return redirectTo(destination.toString());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
