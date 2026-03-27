import { createHostedDeviceSyncControlPlane } from "../../../src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "../../../src/lib/device-sync/http";

export const GET = withJsonError(async (request: Request) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  return jsonOk({
    ok: true,
    providers: controlPlane.describeProviders(),
  });
});
