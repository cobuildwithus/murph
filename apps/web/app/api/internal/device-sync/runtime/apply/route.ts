import { applyHostedDeviceSyncRuntimeUpdates } from "@/src/lib/device-sync/internal-runtime";
import { parseHostedDeviceSyncRuntimeApplyRequest } from "@/src/lib/device-sync/internal-runtime-request";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const body = await readJsonObject(request);
  const { trustedUserId } = authorizeHostedExecutionInternalRequest({
    acceptedToken: "internal",
    bodyUserIds: [typeof body.userId === "string" ? body.userId : null],
    request,
    requireBoundUserId: true,
  });
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
