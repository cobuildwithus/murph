import { deviceSyncError } from "@murphai/device-syncd/errors";

import { createHostedDeviceSyncAgentSessionContext } from "@/src/lib/device-sync/agent-session-service";
import {
  assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser,
} from "@/src/lib/device-sync/auth";
import { jsonOk, postOnlyJson, readOptionalJsonObject, withJsonError } from "@/src/lib/device-sync/http";

const HOSTED_DEVICE_SYNC_AGENT_PAIR_BODY_LIMIT_BYTES = 1024;

export function GET() {
  return postOnlyJson("Hosted device-sync agent pair routes only allow POST.");
}

export const POST = withJsonError(async (request: Request) => {
  const context = createHostedDeviceSyncAgentSessionContext(request);
  assertBrowserMutationOrigin(request, context.env);
  const user = await requireAuthenticatedHostedUser(request, context.env, {
    nonceStore: context.store,
  });
  const body = await readAgentPairRequestBody(request);
  const label = typeof body.label === "string" ? body.label : null;
  return jsonOk(await context.agentSessions.createAgentSession(user, label));
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
