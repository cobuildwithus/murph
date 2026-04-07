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
  const pack = input.sharePack.pack;

  return {
    shareImportResult: await importSharePackIntoVault({
      pack,
      vaultRoot: input.vaultRoot,
    }),
    shareImportTitle: pack.title,
  };
}
