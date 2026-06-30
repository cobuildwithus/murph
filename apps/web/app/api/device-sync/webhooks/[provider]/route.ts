import {
  resolveDeviceSyncWebhookPreflightResponse,
} from "@murphai/device-syncd/public-ingress";
import type { DeviceSyncWebhookPreflightResponse } from "@murphai/device-syncd/types";

import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, resolveDecodedRouteParam, withJsonError } from "@/src/lib/device-sync/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const decodedProvider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const preflight = await resolveDeviceSyncWebhookPreflightResponse({
    provider: decodedProvider,
    registry: await controlPlane.requireRegistry(),
    method: request.method,
    url: new URL(request.url),
    headers: request.headers,
    rawBody: Buffer.alloc(0),
  });

  if (preflight) {
    return createWebhookPreflightResponse(preflight);
  }

  return jsonOk({
    ok: true,
    provider: decodedProvider,
  }, 200);
});

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const rawBody = await controlPlane.readWebhookRawBody();
  const preflight = await resolveDeviceSyncWebhookPreflightResponse({
    provider,
    registry: await controlPlane.requireRegistry(),
    method: request.method,
    url: new URL(request.url),
    headers: request.headers,
    rawBody,
  });

  if (preflight) {
    return createWebhookPreflightResponse(preflight);
  }

  const result = await controlPlane.handleWebhook(provider, rawBody);
  return jsonOk(result, result.orphaned ? 202 : 200);
});

function createWebhookPreflightResponse(preflight: DeviceSyncWebhookPreflightResponse): Response {
  const headers = new Headers({
    "cache-control": "no-store",
  });

  for (const [key, value] of Object.entries(preflight.headers ?? {})) {
    headers.set(key, value);
  }

  if (typeof preflight.body === "string") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "text/plain; charset=utf-8");
    }

    return new Response(preflight.body, {
      headers,
      status: preflight.status,
    });
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(preflight.body), {
    headers,
    status: preflight.status,
  });
}
