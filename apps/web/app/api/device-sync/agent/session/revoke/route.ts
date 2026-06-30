import { createHostedDeviceSyncAgentSessionService } from "@/src/lib/device-sync/agent-session-service";
import { jsonOk, postOnlyJson, withJsonError } from "@/src/lib/device-sync/http";

export function GET() {
  return postOnlyJson("Hosted device-sync agent session revoke routes only allow POST.");
}

export const POST = withJsonError(async (request: Request) => {
  const agentSessions = createHostedDeviceSyncAgentSessionService(request);
  const session = await agentSessions.requireAgentSession();
  return jsonOk(await agentSessions.revokeAgentSession(session));
});
