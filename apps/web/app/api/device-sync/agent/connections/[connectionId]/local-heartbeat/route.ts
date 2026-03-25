import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { parseHostedLocalHeartbeatPatch } from "../../../../../../../src/lib/device-sync/local-heartbeat";
import { jsonError, jsonOk, readOptionalJsonObject, resolveRouteParams } from "../../../../../../../src/lib/device-sync/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const session = await controlPlane.requireAgentSession();
    const body = await readOptionalJsonObject(request);
    const patch = parseHostedLocalHeartbeatPatch(body, new Date());
    return jsonOk(
      await controlPlane.recordLocalHeartbeat(session.userId, decodeURIComponent(connectionId), patch),
    );
  } catch (error) {
    return jsonError(error);
  }
}
