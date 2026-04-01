import { resolveDeviceSyncWebhookVerificationResponse } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonOk, resolveDecodedRouteParam, withJsonError } from "../../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const decodedProvider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  return jsonOk(
    resolveDeviceSyncWebhookVerificationResponse({
      provider: decodedProvider,
      registry: controlPlane.registry,
      url: new URL(request.url),
      verificationToken: controlPlane.env.ouraWebhookVerificationToken,
    }),
    200,
  );
});

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  return jsonOk(await controlPlane.handleWebhook(provider), 202);
});
