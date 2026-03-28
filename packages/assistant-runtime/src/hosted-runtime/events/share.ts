import {
  importSharePackIntoVault,
} from "@murph/core";
import {
  fetchHostedExecutionSharePack,
  parseHostedExecutionSharePackResponse,
} from "@murph/hosted-execution";

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
    runtime: Pick<
      NormalizedHostedAssistantRuntimeConfig,
      "commitTimeoutMs" | "webControlPlane"
    >;
    vaultRoot: string;
  },
): Promise<HostedDispatchEffect> {
  const sharePayload = await fetchHostedSharePayload(
    input.dispatch.event.share,
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
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "webControlPlane"
  >,
): Promise<ReturnType<typeof parseHostedExecutionSharePackResponse>> {
  if (!hasHostedSharePayloadAccess(runtime.webControlPlane)) {
    throw new Error("Hosted share payload fetch is not configured.");
  }
  const baseUrl = runtime.webControlPlane.shareBaseUrl!;
  const shareToken = runtime.webControlPlane.shareToken!;

  return await fetchHostedExecutionSharePack({
    baseUrl,
    share,
    shareToken,
    timeoutMs: runtime.commitTimeoutMs,
  });
}

function hasHostedSharePayloadAccess(
  webControlPlane: Pick<NormalizedHostedAssistantRuntimeConfig, "webControlPlane">["webControlPlane"],
): boolean {
  if (!webControlPlane.shareBaseUrl) {
    return false;
  }

  return webControlPlane.shareToken !== null
    || isHostedWorkerProxyBaseUrl(webControlPlane.shareBaseUrl, "share-pack.worker");
}

function isHostedWorkerProxyBaseUrl(baseUrl: string, hostname: string): boolean {
  try {
    return new URL(baseUrl).hostname === hostname;
  } catch {
    return false;
  }
}
