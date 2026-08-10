import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
  isHostedRuntimeAssistantAskDiagnosticCode,
} from "@murphai/hosted-execution/runtime-control";
import {
  handleHostedRuntimeGroupTool,
} from "@/src/lib/hosted-groups/group-tool";
import {
  createHostedAssistantAskRequestId,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  filterHostedRuntimeGroupToolResponseProjectionScopes,
} from "@/src/lib/hosted-groups/group-tool-scope-filter";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedExecutionControlOrigin,
} from "@/src/lib/hosted-execution/environment";
import { jsonError, jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  handoffHostedMailboxWake,
} from "@/src/lib/hosted-orchestration/mailbox-wake";
import {
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest,
} from "@/src/lib/hosted-vault-share/supported-projection-scopes";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (request: Request) => {
  // The runner's web-control hop is already running when this handler is
  // entered, so the clock has to start here — before the body read, signature
  // verification, and nonce consumption below — or none of that time is
  // charged to the operation that has to finish inside it.
  const requestStartedAtMs = Date.now();
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
  });
  const body = parseHostedRuntimeGroupToolRequest(payload, {
    privateMediaDeliveryOrigin: readHostedExecutionControlOrigin(),
  });
  const supportedProjectionScopeKeys =
    readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request);
  const executeTool = async () => filterHostedRuntimeGroupToolResponseProjectionScopes(
    await handleHostedRuntimeGroupTool({
      memberId,
      request: body,
      requestStartedAtMs,
      scheduleMailboxWake: (wake) =>
        handoffHostedMailboxWake({
          ...wake,
          directWakeSource: "assistant-ask-request",
          signal: request.signal,
        }),
    }),
    supportedProjectionScopeKeys,
  );

  if (body.action !== "ask") {
    return jsonOk(await executeTool());
  }

  const responseHeaders = {
    [HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER]:
      createHostedAssistantAskRequestId({
        memberId,
        originAssistantInputId: body.originAssistantInputId,
      }),
  };

  try {
    return jsonOk(await executeTool(), 200, responseHeaders);
  } catch (error) {
    const diagnosticCode = readHostedAssistantAskDiagnosticCode(error);
    return jsonError(error, {
      ...responseHeaders,
      ...(diagnosticCode
        ? { [HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER]: diagnosticCode }
        : {}),
    });
  }
});

function readHostedAssistantAskDiagnosticCode(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }

  try {
    const code = Reflect.get(error, "code");
    return isHostedRuntimeAssistantAskDiagnosticCode(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
