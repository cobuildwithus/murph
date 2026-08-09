import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";

import {
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
} from "./control-plane-fetch.ts";
import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";
const HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_RESPONSE_MAX_BYTES =
  128 * 1024;
const HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOFT_TIMEOUT_MS = 1_000;

export function createHostedRuntimeGroupToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  return {
    async request(request, context) {
      const isParticipantDisplayNameRead =
        request.action === "read_participant_display_names";
      const timeoutMs = isParticipantDisplayNameRead
        ? Math.min(
          input.timeoutMs,
          HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOFT_TIMEOUT_MS,
        )
        : input.timeoutMs;
      let signal = context?.signal;
      if (isParticipantDisplayNameRead) {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        signal = signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal;
      }
      let payload: unknown;
      try {
        payload = await fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted group tool",
          fetchImpl: input.fetchImpl,
          path: buildHostedRuntimeGroupToolPath(),
          replayOnceOnRetryableFailure: isHostedAssistantAskGroupToolRequest(request),
          ...(isParticipantDisplayNameRead
            ? {
                sensitiveResponseBody: {
                  maxBytes:
                    HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_RESPONSE_MAX_BYTES,
                },
              }
            : {}),
          signal,
          timeoutMs,
          transport: input.transport,
        });
      } catch (error) {
        // Web deliberately finishes an irreversible card send even when this
        // hop gives up on it, because aborting one is worse than waiting for
        // it. So a personalized card whose answer never came back is the same
        // uncertainty the send owner already names, and the turn must be able
        // to say so instead of reporting a generic tool failure over a card
        // that may be sitting in the conversation. Only a missing response
        // counts: an answer from Web, including an error status, is a real
        // answer and stays a failure.
        if (
          isHostedPersonalizedContactCardRequest(request)
          && readHostedRuntimeControlPlaneFetchFailureDiagnostics(error) !== null
        ) {
          return {
            action: "share_contact_card",
            result: { status: "unconfirmed" },
          };
        }
        throw error;
      }

      try {
        return parseHostedRuntimeGroupToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted group tool returned invalid JSON.", { cause: error });
      }
    },
  };
}

function isHostedPersonalizedContactCardRequest(
  request: Parameters<
    NonNullable<HostedRuntimePlatform["groupToolPort"]>["request"]
  >[0],
): boolean {
  return request.action === "share_contact_card"
    && typeof request.contactCardImageUrl === "string";
}

function isHostedAssistantAskGroupToolRequest(
  request: Parameters<
    NonNullable<HostedRuntimePlatform["groupToolPort"]>["request"]
  >[0],
): boolean {
  return request.action === "ask"
    || request.action === "ask_current_sender"
    || request.action === "ask_member";
}

function buildHostedRuntimeGroupToolPath(): string {
  const params = new URLSearchParams();
  for (const projectionScope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
    params.append(
      HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM,
      buildHostedVaultShareProjectionScopeKey(projectionScope),
    );
  }
  return `${HOSTED_RUNTIME_GROUP_TOOL_PATH}?${params.toString()}`;
}
