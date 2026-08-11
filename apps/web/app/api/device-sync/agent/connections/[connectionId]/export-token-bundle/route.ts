import { createHostedDeviceSyncProviderAuthorityAgentSessionService } from "@/src/lib/device-sync/agent-session-provider-authority-service";
import {
  jsonOk,
  postOnlyJson,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/device-sync/http";

export function GET() {
  return postOnlyJson("Hosted device-sync token bundle export routes only allow POST.");
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const agentSessions = createHostedDeviceSyncProviderAuthorityAgentSessionService(request);
  const session = await agentSessions.requireAgentSession();
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const { connection, tokenBundle } = await agentSessions.exportTokenBundle(session, connectionId);
  return jsonOk({
    connection,
    tokenBundle,
  });
});
