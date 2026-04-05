import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  requireHostedExecutionSignedRequest,
  requireHostedExecutionUserId,
} from "@/src/lib/hosted-execution/internal";

const HOSTED_ASSISTANT_DEVICE_CONNECT_RETURN_TO = "/settings?tab=wearables";

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync connect-link routes only allow POST because starting a connection mutates server state.",
    },
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  await requireHostedExecutionSignedRequest(request);
  const userId = requireHostedExecutionUserId(request);
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const result = await controlPlane.startConnection(
    userId,
    provider,
    HOSTED_ASSISTANT_DEVICE_CONNECT_RETURN_TO,
  );

  return jsonOk({
    authorizationUrl: result.authorizationUrl,
    expiresAt: result.expiresAt,
    provider: result.provider,
    providerLabel: formatHostedDeviceSyncProviderLabel(result.provider),
  });
});

function formatHostedDeviceSyncProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "whoop") {
    return "WHOOP";
  }

  if (normalized === "oura") {
    return "Oura";
  }

  if (normalized === "garmin") {
    return "Garmin";
  }

  return normalized
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
