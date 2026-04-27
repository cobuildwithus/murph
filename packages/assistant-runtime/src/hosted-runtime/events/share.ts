import { importSharePackIntoVault } from "@murphai/core";
import type {
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
} from "@murphai/hosted-execution";

import type { HostedMailboxEffect } from "../models.ts";

export async function handleHostedShareAcceptedWake(input: {
  wake: Extract<HostedExecutionWake, { kind: "vault.share.accepted" }>;
  sharePack: HostedExecutionRunnerSharePack;
  vaultRoot: string;
}): Promise<HostedMailboxEffect> {
  if (input.sharePack.ownerUserId !== input.wake.share.ownerUserId) {
    throw new TypeError("Hosted share pack ownerUserId must match the canonical share reference.");
  }

  if (input.sharePack.shareId !== input.wake.share.shareId) {
    throw new TypeError("Hosted share pack shareId must match the canonical share reference.");
  }

  const pack = input.sharePack.pack;
  const shareImportResult = await importSharePackIntoVault({
    pack,
    vaultRoot: input.vaultRoot,
  });

  return {
    conversationMetrics: null,
    shareImportResult,
    shareImportTitle: pack.title,
    vaultSyncImportResult: null,
  };
}
