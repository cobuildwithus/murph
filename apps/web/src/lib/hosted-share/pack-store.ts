import type { SharePack } from "@murphai/contracts";

import { requireHostedExecutionControlClient } from "../hosted-execution/control";

export async function writeHostedSharePackObject(input: {
  ownerUserId: string;
  pack: SharePack;
  shareId: string;
}): Promise<SharePack> {
  return requireHostedExecutionControlClient().putSharePack(input.ownerUserId, input.shareId, input.pack);
}

export async function readHostedSharePackObject(input: {
  ownerUserId: string;
  shareId: string;
}): Promise<SharePack | null> {
  return requireHostedExecutionControlClient().getSharePack(input.ownerUserId, input.shareId);
}

export async function deleteHostedSharePackObject(input: {
  ownerUserId: string;
  shareId: string;
}): Promise<void> {
  await requireHostedExecutionControlClient().deleteSharePack(input.ownerUserId, input.shareId);
}
