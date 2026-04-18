import { importSharePackIntoVault } from "@murphai/core";
import type {
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
} from "@murphai/hosted-execution";

import type { HostedWakeEffect } from "../models.ts";

export async function handleHostedShareAcceptedWake(input: {
  wake: Extract<HostedExecutionWake, { kind: "vault.share.accepted" }>;
  sharePack: HostedExecutionRunnerSharePack;
  vaultRoot: string;
}): Promise<HostedWakeEffect> {
  if (input.sharePack.ownerUserId !== input.wake.share.ownerUserId) {
    throw new TypeError("Hosted share pack ownerUserId must match the canonical share reference.");
  }

  if (input.sharePack.shareId !== input.wake.share.shareId) {
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
