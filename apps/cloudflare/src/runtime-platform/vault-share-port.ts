import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareActiveProjectionKindsResponse,
  parseHostedVaultShareDeliverResponse,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_RUNTIME_VAULT_SHARE_ACTIVE_KINDS_PATH,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD,
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
  isHostedRuntimeVaultShareDeliverContinuation,
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

      return parseHostedVaultShareActiveProjectionKindsResponse(payload).projectionScopes;
    },
    async deliver(request: Parameters<NonNullable<HostedRuntimePlatform["vaultSharePort"]>["deliver"]>[0]) {
      const deadlineMs = Date.now() + input.timeoutMs;
      const deadlineSignal = AbortSignal.timeout(input.timeoutMs);
      const observedContinuations = new Set<string>();
      let continuation: string | null = null;
      let delivered = false;

      while (true) {
        const remainingTimeoutMs = deadlineMs - Date.now();
        if (remainingTimeoutMs <= 0) {
          throw createHostedVaultShareDeliveryTimeoutError();
        }
        const payload = await fetchHostedWebControlPlaneJson({
          body: continuation === null
            ? request
            : {
                ...request,
                [HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD]: continuation,
              },
          boundUserId: input.boundUserId,
          description: "Hosted vault share delivery",
          fetchImpl: input.fetchImpl,
          path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
          replayOnceOnRetryableFailure: true,
          signal: deadlineSignal,
          timeoutMs: remainingTimeoutMs,
          transport: input.transport,
        });
        const response = parseHostedVaultShareDeliverResponse(payload);
        delivered ||= response.status === "delivered";

        const nextContinuation = readHostedVaultShareDeliverContinuation(payload);
        if (nextContinuation === null) {
          return delivered
            ? { status: "delivered" as const }
            : { status: "no-active-share" as const };
        }
        if (
          nextContinuation === continuation
          || observedContinuations.has(nextContinuation)
        ) {
          throw new TypeError("Hosted vault-share delivery continuation repeated.");
        }

        observedContinuations.add(nextContinuation);
        continuation = nextContinuation;
      }
    },
  };
}

function createHostedVaultShareDeliveryTimeoutError(): Error {
  const error = new Error("Hosted vault-share delivery deadline exceeded.");
  error.name = "TimeoutError";
  return error;
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

function readHostedVaultShareDeliverContinuation(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted vault share delivery response must be an object.");
  }

  const continuation = (value as Record<string, unknown>)[
    HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD
  ];
  if (continuation === undefined) {
    return null;
  }
  if (!isHostedRuntimeVaultShareDeliverContinuation(continuation)) {
    throw new TypeError("Hosted vault-share delivery continuation is invalid.");
  }

  return continuation;
}
