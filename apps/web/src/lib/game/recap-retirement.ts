import type { Prisma } from "@prisma/client";
import { hostedRecapMediaObjectKey } from "@murphai/hosted-execution/storage-paths";

export const RECAP_RESOURCE_KIND = "game_recap";

/** FK-free receipts outlive both the story and account, including surviving owners.
 * Call under the game lock, in the transaction accepting or clearing the story. */
export async function registerRecapAssetsTx(tx: Prisma.TransactionClient, input: {
  gameId: string; generationId: string; ownerMemberId: string; storageKeys: readonly string[]; acceptedAt: Date; mediaDeadline: Date;
}): Promise<void> {
  if (input.storageKeys.length > 5) throw new Error("Recap asset count exceeds its bound.");
  await tx.hostedRuntimeOrphan.createMany({ data: input.storageKeys.map(storageKey => ({
    userId: input.ownerMemberId, kind: RECAP_RESOURCE_KIND, resourceId: recapResourceId(input.gameId, input.generationId, storageKey),
    objectKey: hostedRecapMediaObjectKey({ userId: input.ownerMemberId, mediaId: storageKey }),
    createdAt: input.acceptedAt, cleanupAt: input.mediaDeadline, recoveryUntil: input.mediaDeadline,
  })), skipDuplicates: true });
}

export function recapResourceId(gameId: string, generationId: string, storageKey: string): string {
  return `${gameId}|${generationId}|${storageKey}`;
}

export async function retainRecapAssetTx(tx: Prisma.TransactionClient, input: { gameId: string; generationId: string; ownerMemberId: string; storageKey: string; now: Date }): Promise<boolean> {
  const changed = await tx.hostedRuntimeOrphan.updateMany({ where: {
    userId: input.ownerMemberId, kind: RECAP_RESOURCE_KIND, resourceId: recapResourceId(input.gameId, input.generationId, input.storageKey),
    retiredAt: null, purgedAt: null, recoveryUntil: { gt: input.now },
  }, data: { recoveryUntil: null, revision: { increment: 1 } } });
  return changed.count === 1;
}

export async function retireGameRecapAssetsTx(tx: Prisma.TransactionClient, gameId: string, ownerMemberId: string, now = new Date(), keepGenerationId?: string): Promise<void> {
  await tx.hostedRuntimeOrphan.updateMany({ where: { userId: ownerMemberId, kind: RECAP_RESOURCE_KIND, resourceId: { startsWith: `${gameId}|` }, ...(keepGenerationId ? { NOT: { resourceId: { startsWith: `${gameId}|${keepGenerationId}|` } } } : {}), retiredAt: null, purgedAt: null },
    data: { retiredAt: now, cleanupAt: now, revision: { increment: 1 } } });
}
