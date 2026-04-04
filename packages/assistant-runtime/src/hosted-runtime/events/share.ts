import { importSharePackIntoVault } from "@murphai/core";
import {
  resolveHostedExecutionSharePackClient,
  summarizeHostedExecutionError,
} from "@murphai/hosted-execution";

import type {
  HostedDispatchEffect,
  HostedDispatchEvent,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

export async function handleHostedShareAcceptedDispatch(input: {
  dispatch: {
    event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
  };
  internalWorkerFetch?: typeof fetch;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "commitTimeoutMs" | "webControlPlane">;
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  const pack = input.dispatch.event.share.pack
    ?? await fetchHostedSharePayload({
      boundUserId: input.dispatch.event.userId,
      internalWorkerFetch: input.internalWorkerFetch,
      runtime: input.runtime,
      share: input.dispatch.event.share,
    });

  return {
    shareImportResult: await importSharePackIntoVault({
      vaultRoot: input.vaultRoot,
      pack,
    }),
    shareImportTitle: pack.title,
  };
}

async function fetchHostedSharePayload(input: {
  boundUserId: string;
  internalWorkerFetch?: typeof fetch;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "commitTimeoutMs" | "webControlPlane">;
  share: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>["share"];
}) {
  const client = resolveHostedExecutionSharePackClient({
    baseUrl: input.runtime.webControlPlane.shareBaseUrl,
    boundUserId: input.boundUserId,
    fetchImpl: input.internalWorkerFetch,
    timeoutMs: input.runtime.commitTimeoutMs,
  });

  if (!client) {
    throw new Error("Hosted share payload fetch is not configured.");
  }

  try {
    const response = await client.fetchSharePack(input.share);
    return response.pack;
  } catch (error) {
    throw new Error(
      `Hosted share payload fetch failed: ${summarizeHostedExecutionError(error)}`,
    );
  }
}
