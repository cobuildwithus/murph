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
    async request(request) {
      const isParticipantDisplayNameRead =
        request.action === "read_participant_display_names";
      const timeoutMs = isParticipantDisplayNameRead
        ? Math.min(
          input.timeoutMs,
          HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOFT_TIMEOUT_MS,
        )
        : input.timeoutMs;
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted group tool",
        fetchImpl: input.fetchImpl,
        path: buildHostedRuntimeGroupToolPath(),
        ...(isParticipantDisplayNameRead
          ? {
              sensitiveResponseBody: {
                maxBytes:
                  HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_RESPONSE_MAX_BYTES,
              },
              signal: AbortSignal.timeout(timeoutMs),
            }
          : {}),
        timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedRuntimeGroupToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted group tool returned invalid JSON.", { cause: error });
      }
    },
  };
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
