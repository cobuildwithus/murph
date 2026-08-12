import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliverResponse,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
} from "@murphai/hosted-execution/routes";

import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";

export function createHostedWebVaultSharePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async listActiveProjectionScopes() {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted vault share active projection scopes",
        fetchImpl: input.fetchImpl,
        method: "GET",
        path: buildHostedVaultShareActiveKindsPath(),
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedVaultShareActiveProjectionKindsResponse(payload);
    },
    async deliver(request: Parameters<NonNullable<HostedRuntimePlatform["vaultSharePort"]>["deliver"]>[0]) {
      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted vault share delivery",
        fetchImpl: input.fetchImpl,
        path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedVaultShareDeliverResponse(payload);
    },
  };
}

function buildHostedVaultShareActiveKindsPath(): string {
  const params = new URLSearchParams();
  for (const projectionScope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
    params.append(
      HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM,
      buildHostedVaultShareProjectionScopeKey(projectionScope),
    );
  }
  params.set(
    HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
    HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
  );

  return `${HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH}?${params.toString()}`;
}
