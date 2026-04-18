import { importSharePackIntoVault } from "@murphai/core";
import type {
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
} from "@murphai/hosted-execution";

import type { HostedDispatchEffect } from "../models.ts";

export async function handleHostedShareAcceptedDispatch(input: {
  dispatch: Extract<HostedExecutionWake, { kind: "vault.share.accepted" }>;
  sharePack: HostedExecutionRunnerSharePack;
  vaultRoot: string;
}): Promise<HostedDispatchEffect> {
  if (input.sharePack.ownerUserId !== input.dispatch.share.ownerUserId) {
    throw new TypeError("Hosted share pack ownerUserId must match the canonical share reference.");
  }

  if (input.sharePack.shareId !== input.dispatch.share.shareId) {
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
