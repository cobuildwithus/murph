import type { SharePack } from "@murphai/contracts";

import { requireHostedSharePackClient } from "./pack-client";

export async function writeHostedSharePackObject(input: {
  ownerUserId: string;
  pack: SharePack;
  shareId: string;
}): Promise<SharePack> {
  return requireHostedSharePackClient().putSharePack(input.ownerUserId, input.shareId, input.pack);
}

export async function readHostedSharePackObject(input: {
  ownerUserId: string;
  shareId: string;
}): Promise<SharePack | null> {
  return requireHostedSharePackClient().getSharePack(input.ownerUserId, input.shareId);
}

export async function deleteHostedSharePackObject(input: {
  ownerUserId: string;
  shareId: string;
}): Promise<void> {
  await requireHostedSharePackClient().deleteSharePack(input.ownerUserId, input.shareId);
}
