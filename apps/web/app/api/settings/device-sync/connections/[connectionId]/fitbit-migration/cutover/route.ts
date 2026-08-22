import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const connectionId = await resolveDecodedRouteParam(
    context.params,
    "connectionId",
  );

  return jsonOk(
    await createHostedDeviceSyncPublicIngressService(request)
      .completeBrowserGoogleHealthFitbitMigration(auth.member.id, connectionId),
  );
});
