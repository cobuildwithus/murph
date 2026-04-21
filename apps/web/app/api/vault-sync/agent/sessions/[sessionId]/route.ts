import { resolveDecodedRouteParam } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedVaultSyncAgentSession } from "@/src/lib/vault-sync/session-service";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  return jsonOk({
    ok: true,
    session: await readHostedVaultSyncAgentSession({ request, sessionId }),
  });
});
