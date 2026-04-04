import { importSharePackIntoVault } from "@murphai/core";

import type {
  HostedDispatchEffect,
  HostedDispatchEvent,
} from "../models.ts";

export async function handleHostedShareAcceptedDispatch(input: {
  dispatch: {
    event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
  };
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  const pack = input.dispatch.event.share.pack;

  if (!pack) {
    throw new Error("Hosted share dispatch is missing an inline share pack.");
  }

  return {
    shareImportResult: await importSharePackIntoVault({
      pack,
      vaultRoot: input.vaultRoot,
    }),
    shareImportTitle: pack.title,
  };
}
