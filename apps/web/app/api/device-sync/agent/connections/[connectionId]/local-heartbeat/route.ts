import { createHostedDeviceSyncAgentSessionService } from "@/src/lib/device-sync/agent-session-service";
import { jsonOk, postOnlyJson, readOptionalJsonObject, resolveDecodedRouteParam, withJsonError } from "@/src/lib/device-sync/http";
import { parseHostedLocalHeartbeatPatch } from "@/src/lib/device-sync/local-heartbeat";

export function GET() {
  return postOnlyJson("Hosted device-sync local heartbeat routes only allow POST.");
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const agentSessions = createHostedDeviceSyncAgentSessionService(request);
  const session = await agentSessions.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const patch = parseHostedLocalHeartbeatPatch(body, new Date());
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  return jsonOk(
    await agentSessions.recordLocalHeartbeat(session.userId, connectionId, patch),
  );
});
