import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { parseHostedLocalHeartbeatPatch } from "../../../../../../../src/lib/device-sync/local-heartbeat";
import { jsonOk, readOptionalJsonObject, resolveDecodedRouteParam, withJsonError } from "../../../../../../../src/lib/device-sync/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const patch = parseHostedLocalHeartbeatPatch(body, new Date());
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  return jsonOk(
    await controlPlane.recordLocalHeartbeat(session.userId, connectionId, patch),
  );
});
