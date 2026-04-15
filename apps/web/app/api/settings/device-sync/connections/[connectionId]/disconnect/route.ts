import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActivePrivyMemberAuth(request);
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const controlPlane = createHostedDeviceSyncControlPlane(request);

  return jsonOk(await controlPlane.disconnectConnection(auth.member.id, connectionId));
});
