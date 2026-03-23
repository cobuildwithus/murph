import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk, resolveRouteParams } from "../../../../../src/lib/device-sync/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const challenge = controlPlane.resolveWebhookVerificationChallenge(decodeURIComponent(provider));

    if (!challenge) {
      return jsonOk(
        {
          ok: true,
          provider: decodeURIComponent(provider),
        },
        200,
      );
    }

    return new Response(challenge, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    return jsonOk(await controlPlane.handleWebhook(decodeURIComponent(provider)), 202);
  } catch (error) {
    return jsonError(error);
  }
}
