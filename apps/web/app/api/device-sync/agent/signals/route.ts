import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "../../../../../src/lib/device-sync/http";

export const GET = withJsonError(async (request: Request) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  return jsonOk(await controlPlane.listSignals(session.userId, new URL(request.url)));
});
