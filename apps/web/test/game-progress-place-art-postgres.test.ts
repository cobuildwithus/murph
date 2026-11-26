import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";

const after = vi.hoisted(() => ({ jobs: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({ after: (job: () => Promise<void>) => { after.jobs.push(job); } }));
import { ART_DEADLINE_MS, artState, claimArt, ensureArt, finishArt, readArtBytes, readArtRows } from "../src/lib/game/progress/place-art";
import { readPlaceStory, storyKey } from "../src/lib/game/progress/place-story";
import type OpenAI from "openai";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Place art proof needs an isolated loopback test database.");
const db = getPrisma();
const day = new Date("2031-03-04T12:00:00.000Z");
const at = (ms: number) => new Date(day.getTime() + ms);
const STORY = { deadlineMs: 12_000, retryAfterMs: 60_000, budgeted: false };
const story = { title: "River mills town", facts: ["It sits on a river.", "Mills once ran here.", "A college is nearby."] };
const area = "area:v1:15/3801/16384";
const nextArea = "area:v1:15/3804/16384";

async function clear() {
  await db.gamePlaceArt.deleteMany({ where: { OR: [{ key: { startsWith: "poster:v1:test-" } }, { key: { startsWith: "story:v1:test-" } }, { key: { in: [area, nextArea] } }] } });
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

  it("makes the same area once and shares its image allowance with game maps", async () => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    await db.gamePlaceArtBudget.create({ data: { day: today, attempts: 149 } });
    const make = vi.fn(async () => Buffer.from("synthetic painting"));
    const job = { key: area, kind: "map" as const, make };
    await Promise.all([ensureArt([job], new Map()), ensureArt([job], new Map())]);
    expect(after.jobs).toHaveLength(1);
    await after.jobs[0]!();
    await ensureArt([job], new Map());
    await ensureArt([{ ...job, key: nextArea }], new Map());
    expect(make).toHaveBeenCalledOnce();
    expect(after.jobs).toHaveLength(1);
    expect(artState((await readArtRows([area])).get(area), "map")).toEqual({
      state: "ready", path: "/api/game/v1/progress/art/area%3Av1%3A15%2F3801%2F16384",
    });
    expect(await db.gamePlaceArt.findUnique({ where: { key: nextArea } })).toBeNull();
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: today } })).attempts).toBe(150);
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
    expect(artState(started.get("poster:v1:test-e"), "poster")).toMatchObject({ state: "making", typicalSeconds: 8 });
    await Promise.all(after.jobs.map(job => job()));
    const rows = await readArtRows(["poster:v1:test-e", "poster:v1:test-f", "poster:v1:test-g"]);
    expect(artState(rows.get("poster:v1:test-e"), "poster")).toEqual({ state: "ready", path: "/api/game/v1/progress/art/poster%3Av1%3Atest-e" });
    expect(await db.gamePlaceArt.findUniqueOrThrow({ where: { key: "poster:v1:test-f" }, select: { status: true, failureCode: true } }))
      .toEqual({ status: "failed", failureCode: "generation_failed" });
    expect(rows.has("poster:v1:test-g")).toBe(false);
  });

  it("claims a story on its own lease and outside the image allowance", async () => {
    await db.gamePlaceArtBudget.create({ data: { day: new Date("2031-03-04"), attempts: 150 } });
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimArt("story:v1:test-a", "story", day, STORY)));
    expect(claims.filter(claim => claim === 1)).toHaveLength(1);
    expect((await db.gamePlaceArt.findUniqueOrThrow({ where: { key: "story:v1:test-a" } })).kind).toBe("story");
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: new Date("2031-03-04") } })).attempts).toBe(150);
    // A story write is dead after 12 s; a poster's lease is unchanged.
    expect(await claimArt("story:v1:test-a", "story", at(12_001), STORY)).toBe(2);
    await db.gamePlaceArtBudget.deleteMany({});
    expect(await claimArt("poster:v1:test-h", "poster", day)).toBe(1);
    expect(await claimArt("poster:v1:test-h", "poster", at(12_001))).toBeNull();
  });

  it("retries a failed story after a minute, and reads an abandoned last try as failed", async () => {
    expect(await claimArt("story:v1:test-b", "story", day, STORY)).toBe(1);
    expect(await finishArt("story:v1:test-b", 1, { failure: "timeout" })).toBe(true);
    expect(await claimArt("story:v1:test-b", "story", at(30_000), STORY)).toBeNull();
    expect(await claimArt("story:v1:test-b", "story", at(60_001), STORY)).toBe(2);
    expect(await finishArt("story:v1:test-b", 2, { failure: "refused" })).toBe(true);
    expect(await claimArt("story:v1:test-b", "story", at(120_002), STORY)).toBe(3);
    // The third writer never finishes. Once its lease ends, it reads as failed and no one claims it.
    await db.gamePlaceArt.update({ where: { key: "story:v1:test-b" }, data: { startedAt: new Date(Date.now() - 13_000) } });
    const write = vi.fn();
    expect(await readPlaceStory({ id: "test-b", label: "Middle, Delaware, United States" },
      { client: { responses: { create: write } } as unknown as OpenAI })).toEqual({ state: "failed" });
    expect(write).not.toHaveBeenCalled();
  });

  it("starts one write for many first flips, and everyone after reads it", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async () => { await gate; return { status: "completed", output_text: JSON.stringify(story) }; });
    const client = { responses: { create: write } } as unknown as OpenAI;
    const place = { id: "test-c", label: "Middle, Delaware, United States" };
    const flips = Promise.all(Array.from({ length: 6 }, () => readPlaceStory(place, { client })));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    release();
    const views = await flips;
    expect(views.filter(view => view.state === "ready")).toHaveLength(1);
    expect(views.filter(view => view.state === "making")).toHaveLength(5);
    expect(await readPlaceStory(place, { client })).toEqual({ state: "ready", ...story });
    expect(write).toHaveBeenCalledTimes(1);
    expect(storyKey(place.id)).toBe("story:v1:test-c");
  });
});
