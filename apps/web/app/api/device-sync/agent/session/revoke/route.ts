import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, postOnlyJson, withJsonError } from "@/src/lib/device-sync/http";

export function GET() {
  return postOnlyJson("Hosted device-sync agent session revoke routes only allow POST.");
}

export const POST = withJsonError(async (request: Request) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  return jsonOk(await controlPlane.revokeAgentSession(session));
});
