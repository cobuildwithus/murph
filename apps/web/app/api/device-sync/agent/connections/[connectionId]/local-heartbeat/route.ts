import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { parseHostedLocalHeartbeatPatch } from "../../../../../../../src/lib/device-sync/local-heartbeat";
import { jsonOk, readOptionalJsonObject, resolveRouteParams, withJsonError } from "../../../../../../../src/lib/device-sync/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const { connectionId } = await resolveRouteParams(context.params);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const patch = parseHostedLocalHeartbeatPatch(body, new Date());
  return jsonOk(
    await controlPlane.recordLocalHeartbeat(session.userId, decodeURIComponent(connectionId), patch),
  );
});
