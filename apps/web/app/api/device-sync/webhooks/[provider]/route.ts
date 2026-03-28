import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonOk, resolveRouteParams, withJsonError } from "../../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const { provider } = await resolveRouteParams(context.params);
  const decodedProvider = decodeURIComponent(provider);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const challenge = controlPlane.resolveWebhookVerificationChallenge(decodedProvider);

  if (!challenge) {
    return jsonOk(
      {
        ok: true,
        provider: decodedProvider,
      },
      200,
    );
  }

  return jsonOk(
    {
      challenge,
    },
    200,
  );
});

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const { provider } = await resolveRouteParams(context.params);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  return jsonOk(await controlPlane.handleWebhook(decodeURIComponent(provider)), 202);
});
