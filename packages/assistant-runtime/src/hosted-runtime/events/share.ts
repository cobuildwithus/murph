import { importSharePackIntoVault } from "@murphai/core";
import type {
  HostedExecutionRunnerSharePack,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";

import type { HostedIngressEffect } from "../models.ts";

export async function handleHostedShareAcceptedWake(input: {
  wake: Extract<HostedIngressEnvelope, { kind: "vault.share.accepted" }>;
  sharePack: HostedExecutionRunnerSharePack;
  vaultRoot: string;
}): Promise<HostedIngressEffect> {
  if (input.sharePack.ownerUserId !== input.wake.share.ownerUserId) {
    throw new TypeError("Hosted share pack ownerUserId must match the canonical share reference.");
  }

  if (input.sharePack.shareId !== input.wake.share.shareId) {
    throw new TypeError("Hosted share pack shareId must match the canonical share reference.");
  }

  const pack = input.sharePack.pack;

  return {
    conversationMetrics: null,
    shareImportResult: await importSharePackIntoVault({
      pack,
      vaultRoot: input.vaultRoot,
    }),
    shareImportTitle: pack.title,
    vaultSyncImportResult: null,
  };
}
