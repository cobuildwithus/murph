import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedVaultShareDeliverResponse } from "@murphai/hosted-execution/vault-share";
import { HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH } from "@murphai/hosted-execution/routes";

import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createHostedWebVaultSharePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
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
