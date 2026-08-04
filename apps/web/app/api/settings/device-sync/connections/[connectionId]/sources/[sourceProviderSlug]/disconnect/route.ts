import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string; sourceProviderSlug: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const [connectionId, sourceProviderSlug] = await Promise.all([
    resolveDecodedRouteParam(context.params, "connectionId"),
    resolveDecodedRouteParam(context.params, "sourceProviderSlug"),
  ]);
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);

  return jsonOk(await publicIngress.disconnectConnectionSource(
    auth.member.id,
    connectionId,
    sourceProviderSlug,
  ));
});
