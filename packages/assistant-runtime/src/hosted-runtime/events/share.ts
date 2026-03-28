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
  if (!runtime.webControlPlane.shareBaseUrl || !runtime.webControlPlane.shareToken) {
    throw new Error("Hosted share payload fetch is not configured.");
  }

  return await fetchHostedExecutionSharePack({
    baseUrl: runtime.webControlPlane.shareBaseUrl,
    share,
    shareToken: runtime.webControlPlane.shareToken,
    timeoutMs: runtime.commitTimeoutMs,
  });
}
