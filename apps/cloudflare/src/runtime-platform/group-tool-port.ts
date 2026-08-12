import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER,
  HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";
const HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_RESPONSE_MAX_BYTES =
  128 * 1024;
const HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOFT_TIMEOUT_MS = 1_000;

export const HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID =
  "HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID";

export class HostedGroupToolResponseSchemaError extends Error {
  readonly code = HOSTED_GROUP_TOOL_RESPONSE_SCHEMA_INVALID;

  constructor() {
    super("Hosted group tool returned an invalid response.");
    this.name = "HostedGroupToolResponseSchemaError";
  }
}

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
      const payload = await fetchHostedWebControlPlaneJson({
        body: encodeHostedRuntimeGroupToolRequest(request),
        boundUserId: input.boundUserId,
        description: "Hosted group tool",
        fetchImpl: input.fetchImpl,
        path: buildHostedRuntimeGroupToolPath(),
        replayOnceOnRetryableFailure: isHostedReplaySafeGroupToolRequest(request),
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

      try {
        return parseHostedRuntimeGroupToolResponse(payload);
      } catch {
        throw new HostedGroupToolResponseSchemaError();
      }
    },
  };
}

function encodeHostedRuntimeGroupToolRequest(
  request: Parameters<
    NonNullable<HostedRuntimePlatform["groupToolPort"]>["request"]
  >[0],
): unknown {
  return request.action === "ask_current_sender"
    ? {
        ...request,
        [HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER]:
          HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE,
      }
    : request;
}

function isHostedReplaySafeGroupToolRequest(
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
