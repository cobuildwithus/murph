import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";

const after = vi.hoisted(() => ({ jobs: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({ after: (job: () => Promise<void>) => { after.jobs.push(job); } }));
import { ART_DEADLINE_MS, artState, claimArt, ensureArt, finishArt, readArtBytes, readArtRows } from "../src/lib/game/progress/place-art";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Place art proof needs an isolated loopback test database.");
const db = getPrisma();
const day = new Date("2031-03-04T12:00:00.000Z");
const at = (ms: number) => new Date(day.getTime() + ms);

async function clear() {
  await db.gamePlaceArt.deleteMany({ where: { key: { startsWith: "poster:v1:test-" } } });
  await db.gamePlaceArtBudget.deleteMany({});
}

describe.skipIf(!enabled)("shared place art store", () => {
  beforeEach(async () => { after.jobs.length = 0; await clear(); });
  afterAll(clear);

  it("gives one of many concurrent readers the attempt, and counts it once", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimArt("poster:v1:test-a", "poster", day)));
    expect(claims.filter(claim => claim === 1)).toHaveLength(1);
    expect(claims.filter(claim => claim === null)).toHaveLength(7);
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: new Date("2031-03-04") } })).attempts).toBe(1);
  });

  it("lets only the claiming attempt finish, and never changes ready bytes", async () => {
    expect(await claimArt("poster:v1:test-b", "poster", day)).toBe(1);
    // The first attempt went stale and a second reader took the row over.
    expect(await claimArt("poster:v1:test-b", "poster", at(ART_DEADLINE_MS + 1))).toBe(2);
    expect(await finishArt("poster:v1:test-b", 1, { bytes: Buffer.from("late") })).toBe(false);
    expect(await finishArt("poster:v1:test-b", 2, { bytes: Buffer.from("fresh") })).toBe(true);
    expect(await finishArt("poster:v1:test-b", 2, { bytes: Buffer.from("again") })).toBe(false);
    expect(await claimArt("poster:v1:test-b", "poster", at(10 * ART_DEADLINE_MS))).toBeNull();
    expect((await readArtBytes("poster:v1:test-b"))?.toString()).toBe("fresh");
  });

  it("retries a failure after an hour, three attempts in all", async () => {
    expect(await claimArt("poster:v1:test-c", "poster", day)).toBe(1);
    expect(await finishArt("poster:v1:test-c", 1, { failure: "timeout" })).toBe(true);
    expect(await claimArt("poster:v1:test-c", "poster", at(60_000))).toBeNull();
    expect(await claimArt("poster:v1:test-c", "poster", at(3_600_001))).toBe(2);
    expect(await finishArt("poster:v1:test-c", 2, { failure: "refused" })).toBe(true);
    expect(await claimArt("poster:v1:test-c", "poster", at(7_200_002))).toBe(3);
    expect(await finishArt("poster:v1:test-c", 3, { failure: "generation_failed" })).toBe(true);
    expect(await claimArt("poster:v1:test-c", "poster", at(86_400_000))).toBeNull();
    expect(artState((await readArtRows(["poster:v1:test-c"])).get("poster:v1:test-c"), "poster")).toBeNull();
  });

  it("stops at the day's allowance and leaves an over-budget key unclaimed", async () => {
    await db.gamePlaceArtBudget.create({ data: { day: new Date("2031-03-04"), attempts: 150 } });
    expect(await claimArt("poster:v1:test-d", "poster", day)).toBeNull();
    expect(await db.gamePlaceArt.findUnique({ where: { key: "poster:v1:test-d" } })).toBeNull();
    // The next UTC day has its own allowance.
    expect(await claimArt("poster:v1:test-d", "poster", at(86_400_000))).toBe(1);
  });

  it("makes claimed art after the response and records a failed make", async () => {
    const started = await ensureArt([
      { key: "poster:v1:test-e", kind: "poster", make: async () => Buffer.from("poster") },
      { key: "poster:v1:test-f", kind: "poster", make: async () => { throw new Error("provider down"); } },
      { key: "poster:v1:test-g", kind: "poster", make: async () => Buffer.from("third") },
    ], new Map());
    expect([...started.keys()]).toEqual(["poster:v1:test-e", "poster:v1:test-f"]);
    expect(artState(started.get("poster:v1:test-e"), "poster")).toMatchObject({ state: "making", typicalSeconds: 50 });
    await Promise.all(after.jobs.map(job => job()));
    const rows = await readArtRows(["poster:v1:test-e", "poster:v1:test-f", "poster:v1:test-g"]);
    expect(artState(rows.get("poster:v1:test-e"), "poster")).toEqual({ state: "ready", path: "/api/game/v1/progress/art/poster%3Av1%3Atest-e" });
    expect(await db.gamePlaceArt.findUniqueOrThrow({ where: { key: "poster:v1:test-f" }, select: { status: true, failureCode: true } }))
      .toEqual({ status: "failed", failureCode: "generation_failed" });
    expect(rows.has("poster:v1:test-g")).toBe(false);
  });
});
