import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, postOnlyJson, readOptionalJsonObject, withJsonError } from "@/src/lib/device-sync/http";

const HOSTED_DEVICE_SYNC_AGENT_PAIR_BODY_LIMIT_BYTES = 1024;

export function GET() {
  return postOnlyJson("Hosted device-sync agent pair routes only allow POST.");
}

export const POST = withJsonError(async (request: Request) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  controlPlane.assertBrowserMutationOrigin();
  const user = await controlPlane.requireAuthenticatedUser();
  const body = await readAgentPairRequestBody(request);
  const label = typeof body.label === "string" ? body.label : null;
  return jsonOk(await controlPlane.pairAgent(user, label));
});

async function readAgentPairRequestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readOptionalJsonObject(request, {
      limitBytes: HOSTED_DEVICE_SYNC_AGENT_PAIR_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw deviceSyncError({
        code: "AGENT_PAIR_BODY_TOO_LARGE",
        message: "Hosted device-sync agent pair request body is too large.",
        httpStatus: 413,
        retryable: false,
      });
    }

    throw error;
  }
}
