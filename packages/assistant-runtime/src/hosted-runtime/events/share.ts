import {
  importSharePackIntoVault,
} from "@murph/core";
import {
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
    runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">;
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
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">,
): Promise<ReturnType<typeof parseHostedExecutionSharePackResponse>> {
  if (!runtime.sharePackBaseUrl || !runtime.sharePackToken) {
    throw new Error("Hosted share payload fetch is not configured.");
  }

  const url = new URL(
    `/api/hosted-share/internal/${encodeURIComponent(share.shareId)}/payload`,
    runtime.sharePackBaseUrl,
  );
  url.searchParams.set("shareCode", share.shareCode);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${runtime.sharePackToken}`,
    },
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) as unknown : null;

  if (!response.ok) {
    throw new Error(
      `Hosted share payload fetch failed with HTTP ${response.status}${
        text ? `: ${text.slice(0, 500)}` : ""
      }.`,
    );
  }

  return parseHostedExecutionSharePackResponse(payload);
}
