import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk, resolveRouteParams } from "../../../../../../src/lib/device-sync/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const user = controlPlane.requireAuthenticatedUser();
    return jsonOk(await controlPlane.getConnectionStatus(user.id, decodeURIComponent(connectionId)));
  } catch (error) {
    return jsonError(error);
  }
}
