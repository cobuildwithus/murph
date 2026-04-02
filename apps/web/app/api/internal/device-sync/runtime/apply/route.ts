import { applyHostedDeviceSyncRuntimeUpdates } from "@/src/lib/device-sync/internal-runtime";
import { parseHostedDeviceSyncRuntimeApplyRequest } from "@/src/lib/device-sync/internal-runtime-request";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { trustedUserId } = authorizeHostedExecutionInternalRequest({
    acceptedToken: "internal",
    request,
    requireBoundUserId: true,
  });
  const body = await readJsonObject(request);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const result = await applyHostedDeviceSyncRuntimeUpdates(
    controlPlane.store,
    parseHostedDeviceSyncRuntimeApplyRequest(
      body,
      trustedUserId,
    ),
  );
  return jsonOk(result);
});
