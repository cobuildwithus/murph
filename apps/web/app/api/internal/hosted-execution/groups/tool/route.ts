import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
} from "@murphai/hosted-execution/runtime-control";
import { after } from "next/server";

import {
  handleHostedRuntimeGroupTool,
} from "@/src/lib/hosted-groups/group-tool";
import {
  filterHostedRuntimeGroupToolResponseProjectionScopes,
} from "@/src/lib/hosted-groups/group-tool-scope-filter";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest,
} from "@/src/lib/hosted-vault-share/supported-projection-scopes";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
  });
  const body = parseHostedRuntimeGroupToolRequest(payload);
  const supportedProjectionScopeKeys =
    readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request);

  return jsonOk(filterHostedRuntimeGroupToolResponseProjectionScopes(
    await handleHostedRuntimeGroupTool({
      memberId,
      request: body,
      scheduleMailboxWake: scheduleMailboxWakeAfterResponse,
    }),
    supportedProjectionScopeKeys,
  ));
});

function scheduleMailboxWakeAfterResponse(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): void {
  const task = async () => {
    try {
      await signalHostedMailboxAppendRuntime(input);
    } catch {
      // The durable mailbox item remains reconciliation truth when a wake is unavailable.
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
