import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import { jsonOk, resolveDecodedRouteParam, withJsonError } from "../../../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const user = await controlPlane.requireAuthenticatedUser();
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  return jsonOk(await controlPlane.getConnectionStatus(user.id, connectionId));
});
