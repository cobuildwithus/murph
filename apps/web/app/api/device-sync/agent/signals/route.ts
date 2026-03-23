import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk } from "../../../../../src/lib/device-sync/http";

export async function GET(request: Request) {
  try {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const session = await controlPlane.requireAgentSession();
    return jsonOk(await controlPlane.listSignals(session.userId, new URL(request.url)));
  } catch (error) {
    return jsonError(error);
  }
}
