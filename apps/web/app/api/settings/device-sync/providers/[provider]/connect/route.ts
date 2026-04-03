import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedPrivyActiveRequestAuthContext(request);
  const body = await readOptionalJsonObject(request);
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/settings";

  return jsonOk(await controlPlane.startConnection(auth.member.id, provider, returnTo));
});
