import { createHostedDeviceSyncControlPlane } from "../../../../src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (request: Request) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const user = await controlPlane.requireAuthenticatedUser();
  return jsonOk(await controlPlane.listConnections(user.id));
});
