import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import { dependencyKey, isYouAgePinCurrent, publishCache } from "../src/lib/health-you/read";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (
  enabled &&
  !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/.test(
    process.env.DATABASE_URL ?? "",
  )
) {
  throw new Error("The private cache test requires an isolated test database.");
}
describe.skipIf(!enabled)("member cache", () => {
  it("rejects a pin offer when the replica advances before the age cache refreshes", async () => {
    const db = getPrisma(), memberId = randomUUID(), revision = randomUUID(), clock = new Date();
    const ref = { schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
      replicaSchema: "murph.browser-vault-replica" as const, dataVersion: "b".repeat(64),
      sourceBundleHash: "a".repeat(64), byteLength: 128, generatedAt: clock.toISOString(),
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION, keyId: "fixture-key",
      runtimeRootKeyId: "fixture-root", objectKey: "users/browser-vault-replicas/opaque/replica.json" };
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    try {
      await db.hostedWorkspace.create({ data: { userId: memberId, browserVaultReplicaRef: ref } });
      await db.healthYouCache.create({ data: { memberId, revision, viewsEncrypted: "synthetic",
        dependency: dependencyKey(memberId, ref, "UTC", clock.toISOString().slice(0, 10)) } });
      const current = () => db.$transaction(tx => isYouAgePinCurrent(tx, memberId, { revision, timeZone: "UTC" }));
      expect(await current()).toBe(true);
      await db.hostedWorkspace.update({ where: { userId: memberId }, data: { browserVaultReplicaRef: {
        ...ref, dataVersion: "c".repeat(64) } } });
      expect(await current()).toBe(false);
    } finally {
      await db.hostedMember.delete({ where: { id: memberId } });
    }
  });
  it("prevents late publishers overwriting a winner and cascades the one cache row", async () => {
    const db = getPrisma(),
      memberId = randomUUID();
    const next = () => ({
      memberId,
      revision: randomUUID(),
      dependency: randomUUID(),
      viewsEncrypted: "synthetic-sealed-payload",
    });
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    try {
      const first = next(),
        winner = next();
      expect(await publishCache(db, null, first)).toBe(true);
      expect(await publishCache(db, null, next())).toBe(false);
      expect(await publishCache(db, first, winner)).toBe(true);
      expect(await publishCache(db, first, next())).toBe(false);
      expect(await db.healthYouCache.findUnique({ where: { memberId } })).toEqual(winner);
    } finally {
      await db.hostedMember.delete({ where: { id: memberId } });
    }
    expect(await db.healthYouCache.count({ where: { memberId } })).toBe(0);
  });
});
