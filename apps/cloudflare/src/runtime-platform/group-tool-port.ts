import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type {
  HostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_EFFECT_ID_PARAM,
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

export function createHostedRuntimeGroupToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  return {
    async request(request) {
      const effectId = request.action === "post_join_offer"
        ? normalizeNullableString(request.effectId)
        : null;
      const body = request.action === "post_join_offer"
        ? omitHostedGroupJoinOfferEffectId(request)
        : request;
      const payload = await fetchHostedWebControlPlaneJson({
        body,
        boundUserId: input.boundUserId,
        description: "Hosted group tool",
        fetchImpl: input.fetchImpl,
        path: buildHostedRuntimeGroupToolPath(effectId),
        timeoutMs: input.timeoutMs,
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

function buildHostedRuntimeGroupToolPath(effectId: string | null): string {
  const params = new URLSearchParams();
  for (const projectionScope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
    params.append(
      HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM,
      buildHostedVaultShareProjectionScopeKey(projectionScope),
    );
  }
  if (effectId) {
    params.set(HOSTED_RUNTIME_GROUP_JOIN_OFFER_EFFECT_ID_PARAM, effectId);
  }
  return `${HOSTED_RUNTIME_GROUP_TOOL_PATH}?${params.toString()}`;
}

function omitHostedGroupJoinOfferEffectId(
  request: Extract<
    HostedRuntimeGroupToolRequest,
    { action: "post_join_offer" }
  >,
): Omit<typeof request, "effectId"> {
  const { effectId: _effectId, ...body } = request;
  return body;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
