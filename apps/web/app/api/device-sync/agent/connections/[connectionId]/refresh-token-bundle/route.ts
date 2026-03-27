import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
import { jsonOk, readOptionalJsonObject, resolveRouteParams, withJsonError } from "../../../../../../../src/lib/device-sync/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const { connectionId } = await resolveRouteParams(context.params);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const expectedTokenVersion = typeof body.expectedTokenVersion === "number" ? body.expectedTokenVersion : null;
  const force = body.force === true;
  return jsonOk(
    await controlPlane.refreshTokenBundle(session, decodeURIComponent(connectionId), {
      expectedTokenVersion,
      force,
    }),
  );
});
