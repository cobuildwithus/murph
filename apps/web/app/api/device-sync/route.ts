import { createHostedDeviceSyncControlPlane } from "../../../src/lib/device-sync/control-plane";
import { jsonError, jsonOk } from "../../../src/lib/device-sync/http";

export async function GET(request: Request) {
  try {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    return jsonOk({
      ok: true,
      providers: controlPlane.describeProviders(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
