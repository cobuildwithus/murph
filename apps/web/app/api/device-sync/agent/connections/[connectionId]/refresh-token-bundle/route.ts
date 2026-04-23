import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  jsonOk,
  postOnlyJson,
  readOptionalJsonObject,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/device-sync/http";

export function GET() {
  return postOnlyJson("Hosted device-sync token bundle refresh routes only allow POST.");
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const expectedTokenVersion = typeof body.expectedTokenVersion === "number" ? body.expectedTokenVersion : null;
  const force = body.force === true;
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const refresh = await controlPlane.refreshTokenBundle(session, connectionId, {
    expectedTokenVersion,
    force,
  });
  return jsonOk({
    connection: refresh.connection,
    tokenBundle: refresh.tokenBundle,
    refreshed: refresh.refreshed,
    tokenVersionChanged: refresh.tokenVersionChanged,
  });
});
