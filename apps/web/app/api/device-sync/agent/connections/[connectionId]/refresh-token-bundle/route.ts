import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { jsonOk, readOptionalJsonObject, resolveDecodedRouteParam, withJsonError } from "../../../../../../../src/lib/device-sync/http";

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
  return jsonOk(
    await controlPlane.refreshTokenBundle(session, connectionId, {
      expectedTokenVersion,
      force,
    }),
  );
});
