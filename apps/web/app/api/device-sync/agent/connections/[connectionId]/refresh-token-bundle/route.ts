import { createHostedDeviceSyncControlPlane } from "../../../../../../../src/lib/device-sync/control-plane";
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
    const expectedTokenVersion = typeof body.expectedTokenVersion === "number" ? body.expectedTokenVersion : null;
    const force = body.force === true;
    return jsonOk(
      await controlPlane.refreshTokenBundle(session, decodeURIComponent(connectionId), {
        expectedTokenVersion,
        force,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
