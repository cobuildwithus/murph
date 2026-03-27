import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import { jsonOk, resolveRouteParams, withJsonError } from "../../../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const { connectionId } = await resolveRouteParams(context.params);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const user = await controlPlane.requireAuthenticatedUser();
  return jsonOk(await controlPlane.getConnectionStatus(user.id, decodeURIComponent(connectionId)));
});
