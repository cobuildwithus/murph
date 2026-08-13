import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_PARAM,
  HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_VERSION,
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_PROJECTION_MODE_PARAM,
  HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliverResponse,
  type HostedVaultShareProjectionMode,
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
}): NonNullable<HostedRuntimePlatform["vaultSharePort"]> {
  return {
    async listActiveProjectionScopes(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["vaultSharePort"]>["listActiveProjectionScopes"]
      >[0] = {},
    ) {
      const signal = request.signal ?? null;
      const payload = await runWithExactCallerAbort(signal, async () =>
        await fetchHostedWebControlPlaneJson({
          boundUserId: input.boundUserId,
          description: "Hosted vault share active projection scopes",
          fetchImpl: input.fetchImpl,
          method: "GET",
          path: buildHostedVaultShareActiveKindsPath(request.projectionMode),
          signal,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        })
      );

      return parseHostedVaultShareActiveProjectionKindsResponse(payload);
    },
    async deliver(
      request: Parameters<
        NonNullable<HostedRuntimePlatform["vaultSharePort"]>["deliver"]
      >[0],
    ) {
      const effectDeadlineAtEpochMs = Date.now()
        + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS;
      const settlementDeadlineAtEpochMs = effectDeadlineAtEpochMs
        + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS;
      const headers = new Headers({
        [HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER]: String(effectDeadlineAtEpochMs),
      });
      let payload: unknown;
      try {
        payload = await fetchHostedWebControlPlaneJson({
          body: request,
          boundUserId: input.boundUserId,
          description: "Hosted vault share delivery",
          fetchImpl: input.fetchImpl,
          headers,
          path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
          timeoutMs: Math.max(1, settlementDeadlineAtEpochMs - Date.now()),
          transport: input.transport,
        });
      } catch (error) {
        if (isDefinitiveHostedVaultShareScopeFailure({
          effectDeadlineAtEpochMs,
          error,
          transport: input.transport,
        })) {
          return { status: "scope-failed" };
        }
        if (
          !(error instanceof HostedWebControlPlaneResponseError)
          || (
            input.transport.mode === "proxy"
            && !error.forwardedFromWeb
          )
        ) {
          await waitForHostedVaultShareAmbiguousDeliverySettlement(
            settlementDeadlineAtEpochMs,
          );
        }
        throw error;
      }

      return parseHostedVaultShareDeliverResponse(payload);
    },
  };
}

function isDefinitiveHostedVaultShareScopeFailure(input: {
  effectDeadlineAtEpochMs: number;
  error: unknown;
  transport: HostedWebControlTransport;
}): boolean {
  return input.error instanceof HostedWebControlPlaneResponseError
    && input.error.code === HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE
    && Date.now() < input.effectDeadlineAtEpochMs
    && (
      input.transport.mode === "direct"
      || input.error.forwardedFromWeb
    );
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

function buildHostedVaultShareActiveKindsPath(
  projectionMode?: HostedVaultShareProjectionMode,
): string {
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
  if (projectionMode) {
    params.set(HOSTED_VAULT_SHARE_PROJECTION_MODE_PARAM, projectionMode);
  }

  return `${HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH}?${params.toString()}`;
}
