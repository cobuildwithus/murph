import {
  importSharePackIntoVault,
} from "@murphai/core";
import {
  parseHostedExecutionSharePackResponse,
  resolveHostedExecutionSharePackClient,
} from "@murphai/hosted-execution";

import type {
  HostedDispatchEffect,
  HostedDispatchEvent,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

export async function handleHostedShareAcceptedDispatch(
  input: {
    dispatch: {
      event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
    };
    internalWorkerFetch?: typeof fetch;
    runtime: Pick<
      NormalizedHostedAssistantRuntimeConfig,
      "commitTimeoutMs" | "webControlPlane"
    >;
    vaultRoot: string;
  },
): Promise<HostedDispatchEffect> {
  const sharePayload = await fetchHostedSharePayload(
    input.dispatch.event.share,
    input.dispatch.event.userId,
    input.internalWorkerFetch,
    input.runtime,
  );

  return {
    shareImportResult: await importSharePackIntoVault({
      vaultRoot: input.vaultRoot,
      pack: sharePayload.pack,
    }),
    shareImportTitle: sharePayload.pack.title,
  };
}

async function fetchHostedSharePayload(
  share: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>["share"],
  boundUserId: string,
  internalWorkerFetch: typeof fetch | undefined,
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "webControlPlane"
  >,
): Promise<ReturnType<typeof parseHostedExecutionSharePackResponse>> {
  const client = resolveHostedExecutionSharePackClient({
    baseUrl: runtime.webControlPlane.shareBaseUrl,
    boundUserId,
    fetchImpl: internalWorkerFetch,
    shareToken: runtime.webControlPlane.shareToken,
    timeoutMs: runtime.commitTimeoutMs,
  });

  if (!client) {
    throw new Error("Hosted share payload fetch is not configured for the current control-plane client.");
  }

  return await client.fetchSharePack(share);
}
