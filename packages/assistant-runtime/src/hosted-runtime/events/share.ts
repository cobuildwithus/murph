import { importSharePackIntoVault } from "@murphai/core";
import type { HostedExecutionRunnerSharePack } from "@murphai/hosted-execution";

import type {
  HostedDispatchEffect,
  HostedDispatchEvent,
} from "../models.ts";

export async function handleHostedShareAcceptedDispatch(input: {
  dispatch: {
    event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
  };
  sharePack: HostedExecutionRunnerSharePack;
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  if (input.sharePack.ownerUserId !== input.dispatch.event.share.ownerUserId) {
    throw new TypeError("Hosted share pack ownerUserId must match the canonical share reference.");
  }

  if (input.sharePack.shareId !== input.dispatch.event.share.shareId) {
    throw new TypeError("Hosted share pack shareId must match the canonical share reference.");
  }

  const pack = input.sharePack.pack;

  return {
    shareImportResult: await importSharePackIntoVault({
      pack,
      vaultRoot: input.vaultRoot,
    }),
    shareImportTitle: pack.title,
  };
}
