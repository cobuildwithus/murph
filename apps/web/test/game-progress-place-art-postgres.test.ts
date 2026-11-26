import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";

const after = vi.hoisted(() => ({ jobs: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({ after: (job: () => Promise<void>) => { after.jobs.push(job); } }));
import { ART_DEADLINE_MS, ArtSkipped, artPath, artState, claimArt, ensureArt, finishArt, readArtBytes, readArtRows } from "../src/lib/game/progress/place-art";
import { readPlaceStory, storyKey } from "../src/lib/game/progress/place-story";
import type OpenAI from "openai";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Place art proof needs an isolated loopback test database.");
const db = getPrisma();
const day = new Date("2031-03-04T12:00:00.000Z");
const at = (ms: number) => new Date(day.getTime() + ms);
const STORY = { deadlineMs: 12_000, retryAfterMs: 60_000, budgeted: false };
const story = { title: "River mills town", facts: ["It sits on a river.", "Mills once ran here.", "A college is nearby."] };
const areas = Array.from({ length: 7 }, (_, index) => "area:v2:" + createHash("sha256").update(`synthetic area ${index}`).digest("base64url"));
const area = areas[0]!, nextArea = areas[1]!;
const firstMember = "fixture-art-budget-one", otherMember = "fixture-art-budget-two";
const firstDay = new Date("2031-03-04"), nextDay = new Date("2031-03-05");

async function clear() {
  await db.gamePlaceArt.deleteMany({ where: { OR: [{ key: { startsWith: "poster:v1:test-" } }, { key: { startsWith: "story:v1:test-" } }, { key: { in: areas } }] } });
  await db.gamePlaceArtBudget.deleteMany({ where: { day: { in: [firstDay, nextDay] } } });
  await db.hostedMember.deleteMany({ where: { id: { in: [firstMember, otherMember] } } });
}

describe.skipIf(!enabled)("shared place art store", () => {
  beforeEach(async () => {
    after.jobs.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(day);
    await clear();
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(clear);

  it("gives one of many concurrent readers the attempt, and counts it once", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimArt("poster:v1:test-a", "poster", day)));
    expect(claims.filter(claim => claim === 1)).toHaveLength(1);
    expect(claims.filter(claim => claim === null)).toHaveLength(7);
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: new Date("2031-03-04") } })).attempts).toBe(1);
  });

  it("makes the same area once and shares its image allowance with game maps", async () => {
    await db.hostedMember.create({ data: { id: firstMember } });
    await db.gamePlaceArtBudget.create({ data: { day: firstDay, attempts: 149 } });
    const make = vi.fn(async () => Buffer.from("synthetic painting"));
    const job = { key: area, kind: "map" as const, areaMemberId: firstMember, make };
    await Promise.all([ensureArt([job], new Map()), ensureArt([job], new Map())]);
    expect(after.jobs).toHaveLength(1);
    await after.jobs[0]!();
    await ensureArt([job], new Map());
    await ensureArt([{ ...job, key: nextArea }], new Map());
    expect(make).toHaveBeenCalledOnce();
    expect(after.jobs).toHaveLength(1);
    expect(artState((await readArtRows([area])).get(area), "map")).toEqual({
      state: "ready", path: artPath(area),
    });
    expect(await db.gamePlaceArt.findUnique({ where: { key: nextArea } })).toBeNull();
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: firstDay } })).attempts).toBe(150);
    expect((await db.gameAreaArtMemberBudget.findUniqueOrThrow({ where: { memberId: firstMember } })).attempts).toBe(1);
  });

  it("admits five concurrent area claims per member per UTC day and charges only the winner", async () => {
    await db.hostedMember.createMany({ data: [firstMember, otherMember].map(id => ({ id })) });
    const claim = (key: string, memberId: string, when = day) => claimArt(key, "map", when, undefined, memberId);
    expect(await claimArt(area, "map", day)).toBeNull();
    const claims = await Promise.all(areas.map(key => claim(key, firstMember)));
    const admitted = areas.filter((_, index) => claims[index] === 1);
    const denied = areas.filter((_, index) => claims[index] === null);
    expect(admitted).toHaveLength(5);
    expect(denied).toHaveLength(2);
    expect(await db.gamePlaceArt.count({ where: { key: { in: denied } } })).toBe(0);
    expect(await claim(admitted[0]!, otherMember)).toBeNull();
    expect(await finishArt(admitted[0]!, 1, { bytes: Buffer.from("synthetic") })).toBe(true);
    expect(await claim(admitted[0]!, otherMember)).toBeNull();
    expect(await db.gameAreaArtMemberBudget.findUnique({ where: { memberId: otherMember } })).toBeNull();
    expect(await claim(denied[0]!, otherMember)).toBe(1);
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: firstDay } })).attempts).toBe(6);
    expect((await db.gameAreaArtMemberBudget.findUniqueOrThrow({ where: { memberId: firstMember } })).attempts).toBe(5);

    expect(await claim(denied[1]!, firstMember, nextDay)).toBe(1);
    expect(await db.gameAreaArtMemberBudget.findUniqueOrThrow({ where: { memberId: firstMember } }))
      .toMatchObject({ day: nextDay, attempts: 1 });
  });

  it("logs only an error class when a member disappears during a claim", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const job = { key: area, kind: "map" as const, areaMemberId: firstMember, make: vi.fn() };
      await ensureArt([job], new Map());
      expect(log.mock.calls).toEqual([["Place art claim update failed.", { errorClass: "PrismaClientKnownRequestError" }]]);
      expect(after.jobs).toHaveLength(0);
      expect(await db.gamePlaceArt.findUnique({ where: { key: area } })).toBeNull();
    } finally { log.mockRestore(); }
  });

  it("refunds a skipped claim to its original day without reviving stale finishers", async () => {
    await db.hostedMember.create({ data: { id: firstMember } });
    const job = { key: area, kind: "map" as const, areaMemberId: firstMember, make: async () => { throw new ArtSkipped(); } };
    await ensureArt([job], new Map());
    // A new UTC day's first claim resets the member counter before yesterday's refund.
    vi.setSystemTime(nextDay);
    expect(await claimArt(nextArea, "map", nextDay, undefined, firstMember)).toBe(1);
    await after.jobs[0]!();
    expect(await db.gamePlaceArt.findUniqueOrThrow({ where: { key: area } })).toMatchObject({
      status: "available", attempts: 0, failureCode: null,
    });
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: firstDay } })).attempts).toBe(0);
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: nextDay } })).attempts).toBe(1);
    expect(await db.gameAreaArtMemberBudget.findUniqueOrThrow({ where: { memberId: firstMember } }))
      .toMatchObject({ day: nextDay, attempts: 1 });

    await ensureArt([{ ...job, make: async () => Buffer.from("new painting") }], await readArtRows([area]));
    expect(after.jobs).toHaveLength(2);
    expect(await finishArt(area, 1, { failure: "timeout" })).toBe(false);
    await after.jobs[0]!();
    await after.jobs[1]!();
    expect((await readArtBytes(area))?.toString()).toBe("new painting");
    expect((await db.gamePlaceArtBudget.findUniqueOrThrow({ where: { day: nextDay } })).attempts).toBe(2);
    expect((await db.gameAreaArtMemberBudget.findUniqueOrThrow({ where: { memberId: firstMember } })).attempts).toBe(2);
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
    await db.gamePlaceArtBudget.delete({ where: { day: firstDay } });
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
    // Keep the winning writer in flight through the five concurrent reads.
    let readersFinished = 0;
    const views = await Promise.all(Array.from({ length: 6 }, async () => {
      const view = await readPlaceStory(place, { client });
      readersFinished += 1;
      if (readersFinished === 5) release();
      return view;
    }));
    expect(views.filter(view => view.state === "ready")).toHaveLength(1);
    expect(views.filter(view => view.state === "making")).toHaveLength(5);
    expect(await readPlaceStory(place, { client })).toEqual({ state: "ready", ...story });
    expect(write).toHaveBeenCalledTimes(1);
    expect(storyKey(place.id)).toBe("story:v1:test-c");
  });
});
