import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { publishCache } from "../src/lib/health-you/read";

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
