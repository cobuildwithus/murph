import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk, readOptionalJsonObject } from "../../../../../src/lib/device-sync/http";

export async function POST(request: Request) {
  try {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    controlPlane.assertBrowserMutationOrigin();
    const user = controlPlane.requireAuthenticatedUser();
    const body = await readOptionalJsonObject(request);
    const label = typeof body.label === "string" ? body.label : null;
    return jsonOk(await controlPlane.pairAgent(user.id, label));
  } catch (error) {
    return jsonError(error);
  }
}
