import { createHostedDeviceSyncControlPlane } from "../../../../../src/lib/device-sync/control-plane";
import { jsonOk, readOptionalJsonObject, withJsonError } from "../../../../../src/lib/device-sync/http";

export const POST = withJsonError(async (request: Request) => {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    controlPlane.assertBrowserMutationOrigin();
    const body = await readOptionalJsonObject(request);
    const label = typeof body.label === "string" ? body.label : null;
    return jsonOk(await controlPlane.pairAgent(label));
});
