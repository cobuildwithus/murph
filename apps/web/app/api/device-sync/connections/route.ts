import { createHostedDeviceSyncControlPlane } from "../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk } from "../../../../src/lib/device-sync/http";

export async function GET(request: Request) {
  try {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const user = controlPlane.requireAuthenticatedUser();
    return jsonOk(await controlPlane.listConnections(user.id));
  } catch (error) {
    return jsonError(error);
  }
}
