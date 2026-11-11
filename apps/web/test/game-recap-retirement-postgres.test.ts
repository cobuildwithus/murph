import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { registerRecapAssetsTx, retainRecapAssetTx, retireGameRecapAssetsTx } from "@/src/lib/game/recap-retirement";
import { claimHostedRuntimeResourceCleanup, acknowledgeHostedRuntimeOrphanPurge } from "@/src/lib/hosted-execution/runtime-resource-cleanup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Recap retirement requires an isolated local test database.");
const ownerMemberId = `synthetic_recap_${randomUUID()}`;
afterAll(async () => { if (enabled) await getPrisma().gameRecapAsset.deleteMany({ where: { userId: ownerMemberId } }); });

describe.skipIf(!enabled)("recap retirement receipts", () => {
  it("keeps ready assets, expires abandoned uploads, and preserves terminal fences without either FK", async () => {
    const db = getPrisma();
    const gameId = `synthetic_game_${randomUUID()}`, generationId = "a".repeat(32);
    const first = `recap/${generationId}/scene-0.jpg`, abandoned = `recap/${generationId}/scene-1.jpg`;
    const acceptedAt = new Date("2026-01-01T00:00:00Z"), recoveryUntil = new Date("2026-01-01T00:10:00Z");
    await db.$transaction(async tx => {
      await registerRecapAssetsTx(tx, { gameId, generationId, ownerMemberId, storageKeys: [first, abandoned], acceptedAt, recoveryUntil });
      expect(await retainRecapAssetTx(tx, { gameId, generationId, ownerMemberId, storageKey: first, now: acceptedAt })).toBe(true);
    });
    const expired = await claimHostedRuntimeResourceCleanup({ prisma: db, now: recoveryUntil });
    const claimed = expired.orphans.filter(row => row.userId === ownerMemberId);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.resourceId).toContain(abandoned);
    await db.$transaction(async tx => {
      expect(await retainRecapAssetTx(tx, { gameId, generationId, ownerMemberId, storageKey: abandoned, now: acceptedAt })).toBe(false);
      await retireGameRecapAssetsTx(tx, gameId, ownerMemberId, recoveryUntil);
    });
    const retired = (await claimHostedRuntimeResourceCleanup({ prisma: db, now: recoveryUntil })).orphans.filter(row => row.userId === ownerMemberId);
    expect(retired).toHaveLength(2);
    for (const orphan of retired) expect(await acknowledgeHostedRuntimeOrphanPurge({ prisma: db, orphan, now: recoveryUntil })).toBe(true);
    expect(await db.gameRecapAsset.count({ where: { userId: ownerMemberId, retiredAt: { not: null }, purgedAt: { not: null } } })).toBe(2);
  });
});
