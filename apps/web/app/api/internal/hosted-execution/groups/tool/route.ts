import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
  isHostedRuntimeAssistantAskDiagnosticCode,
  type HostedRuntimeGroupCurrentSenderDirectResult,
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
  const currentSenderWire = readHostedCurrentSenderWire(payload);
  const body = parseHostedRuntimeGroupToolRequest(currentSenderWire.payload, {
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
      currentSenderWire.compatibility,
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

type HostedCurrentSenderWireCompatibility = {
  action: "message_current_sender";
};

type HostedCurrentSenderWire = {
  compatibility: HostedCurrentSenderWireCompatibility | null;
  payload: unknown;
};

type HostedCurrentSenderLegacyWireResponse = {
  action: "message_current_sender";
  result: HostedRuntimeGroupCurrentSenderDirectResult;
};

function readHostedCurrentSenderWire(
  payload: unknown,
): HostedCurrentSenderWire {
  const hasProtocolMarker = hasHostedWireProperty(
    payload,
    HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
  );

  if (hasProtocolMarker) {
    if (
      readHostedWireProperty(
        payload,
        HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
      ) !== HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE
      || readHostedCurrentSenderWireAction(payload) !== "ask_current_sender"
    ) {
      throw new TypeError("Hosted current-sender protocol is invalid.");
    }
    return {
      compatibility: null,
      payload: removeHostedWireProperty(
        payload,
        HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
      ),
    };
  }

  const action = readHostedCurrentSenderWireAction(payload);
  if (action === "ask_current_sender") {
    throw new TypeError("Hosted current-sender group protocol marker is required.");
  }
  if (action === "message_current_sender") {
    assertHostedCurrentSenderLegacyWireShape(payload);
    return {
      compatibility: { action },
      payload,
    };
  }
  return { compatibility: null, payload };
}

function assertHostedCurrentSenderLegacyWireShape(payload: unknown): void {
  if (
    typeof payload !== "object"
    || payload === null
    || Object.keys(payload).some((key) => key !== "action" && key !== "origin")
  ) {
    throw new TypeError("Hosted current-sender legacy protocol is invalid.");
  }
}

function hasHostedWireProperty(
  payload: unknown,
  key: string,
): payload is object {
  return (typeof payload === "object" || typeof payload === "function")
    && payload !== null
    && Object.hasOwn(payload, key);
}

function readHostedWireProperty(payload: unknown, key: string): unknown {
  if (!hasHostedWireProperty(payload, key)) {
    return undefined;
  }
  try {
    return Reflect.get(payload, key);
  } catch {
    return undefined;
  }
}

function removeHostedWireProperty(payload: unknown, key: string): unknown {
  const canonicalPayload = { ...(payload as Record<string, unknown>) };
  delete canonicalPayload[key];
  return canonicalPayload;
}

function readHostedCurrentSenderWireAction(
  payload: unknown,
): "ask_current_sender" | "message_current_sender" | null {
  const action = readHostedWireProperty(payload, "action");
  return action === "ask_current_sender" || action === "message_current_sender"
    ? action
    : null;
}

function encodeHostedCurrentSenderLegacyWireResponse(
  response: HostedRuntimeGroupToolResponse,
  compatibility: HostedCurrentSenderWireCompatibility | null,
): HostedRuntimeGroupToolResponse | HostedCurrentSenderLegacyWireResponse {
  if (response.action !== "ask_current_sender" || compatibility === null) {
    return response;
  }
  return { action: compatibility.action, result: response.result };
}
