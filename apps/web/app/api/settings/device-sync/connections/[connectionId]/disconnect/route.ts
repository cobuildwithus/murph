import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { deviceSyncError } from "@murphai/device-syncd/errors";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);

  const result = await publicIngress.disconnectConnection(
    auth.member.id,
    connectionId,
  );
  if (result.connection.status !== "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_DISCONNECT_NOT_FINISHED",
      message: result.warning?.historicalResetIncomplete === true
        ? "Disconnect not finished. Remove the old connection in your wearable provider account, then retry Disconnect here."
        : "Disconnect not finished. Remove Murph access in the provider account, then retry Disconnect here.",
      retryable: true,
      httpStatus: 503,
    });
  }

  return jsonOk(result);
});
