import {
  applyHostedDeviceSyncRuntimeUpdates,
  parseHostedDeviceSyncRuntimeApplyRequest,
} from "@/src/lib/device-sync/internal-runtime";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
