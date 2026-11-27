import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import { gameProofs, habitEvidence } from "../src/lib/health-you/game-habits";
vi.mock("../src/lib/game/crypto", () => ({
  openGameTexts: async (fields: { value: string }[]) => fields.map((f) => f.value),
}));
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
  it("uses the credited player's task revision, excludes self-reports and drops withdrawn proof", async () => {
    const db = getPrisma(),
      owner = randomUUID(),
      peer = randomUUID(),
      id = randomUUID();
    const start = new Date("2033-02-03T00:00:00Z"),
      clock = new Date("2033-02-08T12:00:00Z");
    await db.hostedMember.createMany({ data: [owner, peer].map((id) => ({ id, billingStatus: "active" })) });
    try {
      await db.gameProfile.createMany({
        data: [owner, peer].map((memberId) => ({
          memberId,
          firstNameEncrypted: "synthetic",
          timeZone: "UTC",
        })),
      });
      await db.game.create({
        data: {
          id,
          wordsOwnerMemberId: peer,
          status: "live",
          terms: {
            v: 1,
            versions: [0, 1].map((n) => ({ n, fromDay: n, schedule: { count: 7 }, stakes: [] })),
          },
          termsWordsEncrypted: JSON.stringify({
            v: 1,
            versions: [0, 1].map((n) => ({
              n,
              stakes: [],
              defaultTask: "Cold plunge",
              tasks: [{ seat: 1, text: n ? "8k steps" : "Strength training" }],
            })),
          }),
          players: {
            create: [peer, owner].map((memberId, seat) => ({
              memberId,
              seat,
              dayOne: start,
              joinedAt: start,
              timeZone: "UTC",
            })),
          },
        },
      });
      const ids = [0, 1, 2, 3, 4].map(() => randomUUID());
      await db.gameEntry.createMany({
        data: ids.map((idEntry, i) => ({
          id: idEntry,
          gameId: id,
          memberId: i === 3 ? peer : owner,
          dayIndex: i,
          attempt: 1,
          kind: i === 2 ? "words" : "photo",
          incomplete: i === 4,
          mediaKeys: i === 2 ? [] : ["synthetic-image"],
          receivedAt: clock,
        })),
      });
      const before = await gameProofs(db, owner, clock);
      const evidence = await habitEvidence(db, owner, before.rows, "UTC", new AbortController().signal);
      expect(evidence).toEqual([
        {
          date: "2033-02-03",
          reported_at: "2033-02-08",
          type: "strength_training",
          done: true,
          verified_by: "photo",
        },
        {
          date: "2033-02-04",
          reported_at: "2033-02-08",
          type: "step_goal",
          goal_steps: 8000,
          done: true,
          verified_by: "photo",
        },
      ]);
      await db.gameEntry.update({ where: { id: ids[0] }, data: { withdrawnAt: clock } });
      const after = await gameProofs(db, owner, clock);
      expect(after.rows).toHaveLength(1);
      expect(after.revision).not.toBe(before.revision);
    } finally {
      await db.game.deleteMany({ where: { id } });
      await db.hostedMember.deleteMany({ where: { id: { in: [owner, peer] } } });
    }
  });
  it("rejects a pin offer when the replica advances before the age cache refreshes", async () => {
    const db = getPrisma(),
      memberId = randomUUID(),
      revision = randomUUID(),
      clock = new Date();
    const ref = {
      schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
      replicaSchema: "murph.browser-vault-replica" as const,
      dataVersion: "b".repeat(64),
      sourceBundleHash: "a".repeat(64),
      byteLength: 128,
      generatedAt: clock.toISOString(),
      generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
      keyId: "fixture-key",
      runtimeRootKeyId: "fixture-root",
      objectKey: "users/browser-vault-replicas/opaque/replica.json",
    };
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    try {
      await db.hostedWorkspace.create({ data: { userId: memberId, browserVaultReplicaRef: ref } });
      await db.healthYouCache.create({
        data: {
          memberId,
          revision,
          viewsEncrypted: "synthetic",
          dependency: dependencyKey(memberId, ref, "UTC", clock.toISOString().slice(0, 10)),
        },
      });
      const current = () =>
        db.$transaction((tx) => isYouAgePinCurrent(tx, memberId, { revision, timeZone: "UTC" }));
      expect(await current()).toBe(true);
      await db.hostedWorkspace.update({
        where: { userId: memberId },
        data: {
          browserVaultReplicaRef: {
            ...ref,
            dataVersion: "c".repeat(64),
          },
        },
      });
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
