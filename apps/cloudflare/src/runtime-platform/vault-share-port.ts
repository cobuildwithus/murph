import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliverResponse,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";

export function createHostedWebVaultSharePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}) {
  return {
    async listActiveProjectionScopes(
      context?: Parameters<
        NonNullable<HostedRuntimePlatform["vaultSharePort"]>["listActiveProjectionScopes"]
      >[0],
    ) {
      const signal = context?.signal ?? null;
      const payload = await runWithExactCallerAbort(signal, async () =>
        await fetchHostedWebControlPlaneJson({
          boundUserId: input.boundUserId,
          description: "Hosted vault share active projection scopes",
          fetchImpl: input.fetchImpl,
          method: "GET",
          path: buildHostedVaultShareActiveKindsPath(),
          signal,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        })
      );

      return parseHostedVaultShareActiveProjectionKindsResponse(payload).projectionScopes;
    },
    async deliver(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["vaultSharePort"]>["deliver"]
      >[0],
    ) {
      const ambiguousSettlementDeadlineAtEpochMs = Date.now()
        + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
        + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS;
      let payload: unknown;
      try {
        payload = await fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted vault share delivery",
          fetchImpl: input.fetchImpl,
          path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
          timeoutMs: Math.max(
            input.timeoutMs,
            HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
              + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
          ),
          transport: input.transport,
        });
      } catch (error) {
        if (!(error instanceof HostedWebControlPlaneResponseError)) {
          await waitForHostedVaultShareAmbiguousDeliverySettlement(
            ambiguousSettlementDeadlineAtEpochMs,
          );
        }
        throw error;
      }

      return parseHostedVaultShareDeliverResponse(payload);
    },
  };
}

async function waitForHostedVaultShareAmbiguousDeliverySettlement(
  deadlineAtEpochMs: number,
): Promise<void> {
  const remainingMs = Math.max(0, deadlineAtEpochMs - Date.now());
  if (remainingMs === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, remainingMs);
  });
}

async function runWithExactCallerAbort<T>(
  signal: AbortSignal | null,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    throw error;
  }
}

function buildHostedVaultShareActiveKindsPath(): string {
  const params = new URLSearchParams();
  for (const projectionScope of HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES) {
    params.append(
      HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM,
      buildHostedVaultShareProjectionScopeKey(projectionScope),
    );
  }

  return `${HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH}?${params.toString()}`;
}
