import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
  isHostedRuntimeAssistantAskDiagnosticCode,
  type HostedRuntimeGroupCurrentSenderDirectResult,
  type HostedRuntimeGroupMemberAskResult,
  type HostedRuntimeGroupToolResponse,
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
  const currentSenderLegacyWireAction =
    readHostedCurrentSenderLegacyWireAction(payload);
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
    return jsonOk(encodeHostedCurrentSenderLegacyWireResponse(
      await executeTool(),
      currentSenderLegacyWireAction,
    ));
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

// Temporary transport-only compatibility for old Cloudflare/runtime bundles.
// Web admission and every in-process owner use the canonical destination field.
type HostedCurrentSenderLegacyWireAction =
  | "ask_current_sender"
  | "message_current_sender";

type HostedCurrentSenderLegacyWireResponse =
  | {
      action: "ask_current_sender";
      result: HostedRuntimeGroupMemberAskResult;
    }
  | {
      action: "message_current_sender";
      result: HostedRuntimeGroupCurrentSenderDirectResult;
    };

function readHostedCurrentSenderLegacyWireAction(
  payload: unknown,
): HostedCurrentSenderLegacyWireAction | null {
  if (
    (typeof payload !== "object" && typeof payload !== "function")
    || payload === null
  ) {
    return null;
  }
  try {
    const action = Reflect.get(payload, "action");
    if (action === "message_current_sender") {
      return action;
    }
    if (
      action === "ask_current_sender"
      && !Object.hasOwn(payload, "responseDestination")
    ) {
      return action;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeHostedCurrentSenderLegacyWireResponse(
  response: HostedRuntimeGroupToolResponse,
  legacyAction: HostedCurrentSenderLegacyWireAction | null,
): HostedRuntimeGroupToolResponse | HostedCurrentSenderLegacyWireResponse {
  if (response.action !== "ask_current_sender" || legacyAction === null) {
    return response;
  }
  if (legacyAction === "message_current_sender") {
    if (response.responseDestination !== "current_sender") {
      throw new TypeError(
        "Hosted current-sender legacy response destination mismatched.",
      );
    }
    return { action: legacyAction, result: response.result };
  }
  if (response.responseDestination !== "group") {
    throw new TypeError(
      "Hosted current-sender legacy response destination mismatched.",
    );
  }
  return { action: legacyAction, result: response.result };
}
