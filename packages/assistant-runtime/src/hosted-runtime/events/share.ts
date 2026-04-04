import {
  importSharePackIntoVault,
} from "@murphai/core";

import type {
  HostedDispatchEffect,
  HostedDispatchEvent,
} from "../models.ts";

export async function handleHostedShareAcceptedDispatch(
  input: {
    dispatch: {
      event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
    };
    vaultRoot: string;
  },
): Promise<HostedDispatchEffect> {
  const pack = input.dispatch.event.share.pack;

  if (!pack) {
    throw new Error(
      "Hosted share dispatch is missing its inline share pack. Share imports no longer fetch payloads over the runtime control plane.",
    );
  }

  return {
    shareImportResult: await importSharePackIntoVault({
      vaultRoot: input.vaultRoot,
      pack,
    }),
    shareImportTitle: pack.title,
  };
}
