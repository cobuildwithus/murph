import type { DeviceSyncWebhookPreflightResponse } from "@murphai/device-syncd/types";

import { jsonOk, resolveDecodedRouteParam, withJsonError } from "@/src/lib/device-sync/http";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import {
  enqueueHostedDeviceWebhook,
  prepareHostedDeviceWebhookQueueTransport,
} from "@/src/lib/device-sync/webhook-queue";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const decodedProvider = await resolveDecodedRouteParam(context.params, "provider");
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);
  const preflight = await publicIngress.resolveWebhookPreflight(decodedProvider, Buffer.alloc(0));

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
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);
  const rawBody = await publicIngress.readWebhookRawBody();
  const preflight = await publicIngress.resolveWebhookPreflight(provider, rawBody);

  if (preflight) {
    return createWebhookPreflightResponse(preflight);
  }

  const queueTransport = prepareHostedDeviceWebhookQueueTransport({
    headers: request.headers,
    provider,
    rawBody,
  });
  if (queueTransport.enabled) {
    const receipt = await publicIngress.verifyWebhookForDurableEnqueue(
      provider,
      rawBody,
      new Date(),
    );
    await enqueueHostedDeviceWebhook({
      headers: queueTransport.headers,
      provider,
      rawBody,
      receivedAt: receipt.receivedAt,
    });
    return jsonOk({
      accepted: true,
      queued: true,
    }, 202);
  }

  const result = await publicIngress.handleWebhook(provider, rawBody);
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
