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
  HostedWebControlPlaneResponseError,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";
import {
  isRetryableHostedWebControlReadError,
} from "./control-plane-fetch.ts";

const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";

export function createHostedRuntimeGroupToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  return {
    async request(request) {
      const deadlineMs = Date.now() + input.timeoutMs;
      const fetchRequest = () => fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted group tool",
          fetchImpl: input.fetchImpl,
          path: buildHostedRuntimeGroupToolPath(),
          timeoutMs: Math.max(1, deadlineMs - Date.now()),
          transport: input.transport,
        });
      let payload: unknown;
      try {
        payload = await fetchRequest();
      } catch (error) {
        if (
          !isHostedAssistantAskGroupToolRequest(request)
          || !isRetryableHostedAssistantAskRequestError(error)
          || deadlineMs <= Date.now()
        ) {
          throw error;
        }
        payload = await fetchRequest();
      }

      try {
        return parseHostedRuntimeGroupToolResponse(payload);
      } catch (error) {
        throw new Error("Hosted group tool returned invalid JSON.", { cause: error });
      }
    },
  };
}

function isHostedAssistantAskGroupToolRequest(
  request: Parameters<
    NonNullable<HostedRuntimePlatform["groupToolPort"]>["request"]
  >[0],
): boolean {
  return request.action === "ask" || request.action === "ask_member";
}

function isRetryableHostedAssistantAskRequestError(error: unknown): boolean {
  if (error instanceof HostedWebControlPlaneResponseError) {
    return error.status >= 500 && error.status <= 599;
  }
  return isRetryableHostedWebControlReadError(error);
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
