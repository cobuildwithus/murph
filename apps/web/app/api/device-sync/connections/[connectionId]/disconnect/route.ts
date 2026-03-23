import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk, resolveRouteParams } from "../../../../../../src/lib/device-sync/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    controlPlane.assertBrowserMutationOrigin();
    const user = controlPlane.requireAuthenticatedUser();
    return jsonOk(await controlPlane.disconnectConnection(user.id, decodeURIComponent(connectionId)));
  } catch (error) {
    return jsonError(error);
  }
}
