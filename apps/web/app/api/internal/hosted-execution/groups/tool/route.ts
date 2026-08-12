import type {
  HostedExecutionAssistantAskGroupSenderResponseDestination,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER_VALUE,
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
  const currentSenderWire = readHostedCurrentSenderWire(request, payload);
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
      currentSenderLegacyResponseDestination:
        currentSenderWire.compatibility?.responseDestination ?? null,
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

// Temporary transport-only compatibility for old Cloudflare/runtime bundles.
// The authenticated URL-and-body marker is the only way to opt into the
// neutral reviewer-owned audience protocol. Requiring both makes a new caller
// fail closed against an old strict Web parser instead of becoming a legacy
// group-only request.
type HostedCurrentSenderWireCompatibility = {
  action: "ask_current_sender" | "message_current_sender";
  includeResponseDestination: boolean;
  responseDestination: HostedExecutionAssistantAskGroupSenderResponseDestination;
};

type HostedCurrentSenderWire = {
  compatibility: HostedCurrentSenderWireCompatibility | null;
  payload: unknown;
};

type HostedCurrentSenderLegacyWireResponse =
  | {
      action: "ask_current_sender";
      responseDestination?: HostedExecutionAssistantAskGroupSenderResponseDestination;
      result: HostedRuntimeGroupCurrentSenderDirectResult;
    }
  | {
      action: "message_current_sender";
      result: HostedRuntimeGroupCurrentSenderDirectResult;
    };

function readHostedCurrentSenderWire(
  request: Request,
  payload: unknown,
): HostedCurrentSenderWire {
  const url = new URL(request.url);
  const markerValues = url.searchParams.getAll(
    HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER,
  );
  const hasBodyMarker = hasHostedCurrentSenderReviewMarker(payload);
  if (markerValues.length > 0 || hasBodyMarker) {
    if (
      markerValues.length !== 1
      || markerValues[0] !== HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER_VALUE
      || readHostedCurrentSenderReviewMarker(payload)
        !== HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER_VALUE
      || readHostedCurrentSenderWireAction(payload) !== "ask_current_sender"
      || hasHostedCurrentSenderResponseDestination(payload)
    ) {
      throw new TypeError(
        "Hosted current-sender audience-review protocol is invalid.",
      );
    }
    return {
      compatibility: null,
      payload: removeHostedCurrentSenderReviewMarker(payload),
    };
  }

  const action = readHostedCurrentSenderWireAction(payload);
  if (action === "message_current_sender") {
    return {
      compatibility: {
        action,
        includeResponseDestination: false,
        responseDestination: "current_sender",
      },
      payload,
    };
  }
  if (action !== "ask_current_sender") {
    return { compatibility: null, payload };
  }
  const responseDestination = readHostedCurrentSenderResponseDestination(
    payload,
  );
  return {
    compatibility: {
      action,
      includeResponseDestination: responseDestination !== null,
      responseDestination: responseDestination ?? "group",
    },
    payload,
  };
}

function hasHostedCurrentSenderReviewMarker(payload: unknown): payload is object {
  return (typeof payload === "object" || typeof payload === "function")
    && payload !== null
    && Object.hasOwn(
      payload,
      HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER,
    );
}

function readHostedCurrentSenderReviewMarker(payload: unknown): unknown {
  if (!hasHostedCurrentSenderReviewMarker(payload)) {
    return undefined;
  }
  try {
    return Reflect.get(
      payload,
      HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER,
    );
  } catch {
    return undefined;
  }
}

function removeHostedCurrentSenderReviewMarker(payload: unknown): unknown {
  const canonicalPayload = {
    ...(payload as Record<string, unknown>),
  };
  delete canonicalPayload[HOSTED_RUNTIME_GROUP_CURRENT_SENDER_REVIEW_MARKER];
  return canonicalPayload;
}

function readHostedCurrentSenderWireAction(
  payload: unknown,
): "ask_current_sender" | "message_current_sender" | null {
  if (
    (typeof payload !== "object" && typeof payload !== "function")
    || payload === null
  ) {
    return null;
  }
  try {
    const action = Reflect.get(payload, "action");
    return action === "ask_current_sender" || action === "message_current_sender"
      ? action
      : null;
  } catch {
    return null;
  }
}

function hasHostedCurrentSenderResponseDestination(
  payload: unknown,
): payload is object {
  return (typeof payload === "object" || typeof payload === "function")
    && payload !== null
    && Object.hasOwn(payload, "responseDestination");
}

function readHostedCurrentSenderResponseDestination(
  payload: unknown,
): HostedExecutionAssistantAskGroupSenderResponseDestination | null {
  if (!hasHostedCurrentSenderResponseDestination(payload)) {
    return null;
  }
  let value: unknown;
  try {
    value = Reflect.get(payload, "responseDestination");
  } catch {
    return null;
  }
  if (value === "group" || value === "current_sender") {
    return value;
  }
  // The shared parser will produce the canonical schema error. This branch
  // only avoids accidentally treating malformed legacy metadata as neutral.
  return null;
}

function encodeHostedCurrentSenderLegacyWireResponse(
  response: HostedRuntimeGroupToolResponse,
  compatibility: HostedCurrentSenderWireCompatibility | null,
): HostedRuntimeGroupToolResponse | HostedCurrentSenderLegacyWireResponse {
  if (response.action !== "ask_current_sender" || compatibility === null) {
    return response;
  }
  if (compatibility.action === "message_current_sender") {
    return { action: compatibility.action, result: response.result };
  }
  return {
    action: compatibility.action,
    ...(compatibility.includeResponseDestination
      ? { responseDestination: compatibility.responseDestination }
      : {}),
    result: response.result,
  };
}
