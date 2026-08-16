import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup";
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
  const disconnected = await publicIngress.disconnectConnection(
    auth.member.id,
    connectionId,
  );
  if (disconnected.connection.status !== "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_DISCONNECT_NOT_FINISHED",
      message: disconnected.warning?.historicalResetIncomplete === true
        ? "Disconnect not finished. Remove the old connection in your wearable provider account, then retry Disconnect here."
        : "Disconnect not finished. Remove Murph access in the provider account, then retry Disconnect here.",
      retryable: true,
      httpStatus: 503,
    });
  }
  const registration = readMemberOwnedProviderSetupRegistration(
    disconnected.connection.provider,
  );
  if (registration) {
    // Upstream revocation and the connection record are authoritative. A
    // projection repair failure must not report the completed disconnect as a
    // failure; the next setup read reconciles from connection truth.
    try {
      await createMemberOwnedProviderSetupService(
        registration.coordinates.provider,
      ).markDisconnected(auth.member.id);
    } catch (projectionError) {
      console.warn("Member-owned provider setup disconnect projection failed.", {
        errorType: describeProjectionErrorType(projectionError),
        provider: registration.coordinates.provider,
      });
    }
  }

  return jsonOk(disconnected);
});

function describeProjectionErrorType(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor?.name || error.name || "Error";
  }
  return error === null ? "null" : typeof error;
}
