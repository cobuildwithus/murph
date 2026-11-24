import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import * as controlAuth from "../src/lib/hosted-execution/auth-adapter";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "../src/lib/hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { putProgressPic, readProgressPic, readProgressPics } from "../src/lib/game/progress/pics";
import { localRosterCrypto } from "./support/roster-postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { markAwardsSeen, readAwards, settleAwards } from "../src/lib/game/progress/awards";
import { openProgress, progressLookup, sealProgress } from "../src/lib/game/progress/crypto";
import * as crypto from "../src/lib/game/progress/crypto";
import { patchMeasureState, type MeasureState } from "../src/lib/game/progress/state";
import type { Candidate } from "../src/lib/game/progress/registry";
import { healthSteps } from "../src/lib/game/progress/health";
import { savedHealthView } from "../src/lib/game/progress/health-view";
import { roundTotals } from "../src/lib/game/progress/achievements";
import { gameSeries } from "../src/lib/game/progress/series";
import { achievementContext, visibleAwards } from "../src/lib/game/progress/view";
import { game, memberId, post, task } from "./support/progress-games";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Progress proof needs an isolated loopback test database.");
const db = getPrisma();
const members: string[] = [];
const authorized = async () => {};
const candidate = (key: string, on = "2026-11-16"): Candidate => ({ key, kind: "total", measureId: "pushups.reps", subjectMemberId: null, on, data: { value: 1000 } });
async function member(timeZone = "UTC") {
  const id = randomUUID(); members.push(id);
  await db.hostedMember.create({ data: { id, billingStatus: "active" } });
  await db.gameProfile.create({ data: { memberId: id, firstNameEncrypted: "synthetic", timeZone } });
  return id;
}
async function readState(memberId: string) {
  const lookup = progressLookup(memberId, "measure", ["pushups.reps"]);
  const row = await db.gameProgressMeasure.findUniqueOrThrow({ where: { memberId_lookup: { memberId, lookup } } });
  return openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted);
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T01:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { if (enabled) await db.hostedMember.deleteMany({ where: { id: { in: members } } }); });

describe.skipIf(!enabled)("Progress PostgreSQL invariants", () => {
  it.each(["lowercase", "uppercase"])("stages and reopens a phone-sized JPEG on first upload and replay (%s UUID)", async casing => {
    localRosterCrypto();
    vi.stubGlobal("__murphHostedSecureBoxStringTestCodec", undefined);
    const owner = await member();
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ userId: owner, domain: "control" });
    const width = 2048, height = 1536;
    const jpeg = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 78 }).toBuffer();
    expect(jpeg.length).toBeGreaterThan(1.5 * 1024 * 1024);
    expect(jpeg.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    const id = randomUUID();
    const input = { id: casing === "uppercase" ? id.toUpperCase() : id, measureId: "squats.reps", takenAt: "2026-07-14T15:23:41.637Z" };
    const hash = createHash("sha256").update(jpeg).digest("hex");
    const keys: string[] = [];
    let envelope: string;
    vi.stubEnv("HOSTED_EXECUTION_CONTROL_URL", "https://control.example.test");
    vi.spyOn(controlAuth, "createHostedExecutionVercelOidcBearerTokenProvider").mockReturnValue(async () => "synthetic");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method === "GET") return Response.json({ envelope, hash });
      expect(String(url)).toBe(`https://control.example.test/internal/users/${owner}/progress-pics/stage`);
      const headers = new Headers(init?.headers);
      expect(headers.get("x-murph-recap-hash")).toBe(hash);
      keys.push(headers.get("x-murph-recap-media-id")!);
      if (typeof init?.body !== "string") throw new Error("Expected a sealed envelope");
      envelope = init.body;
      expect(Buffer.byteLength(envelope)).toBeLessThan(3 * 1024 * 1024);
      return Response.json({ stored: true });
    });
    const upload = () => runWithHostedDomainRootUnwrapCache(() => putProgressPic(owner, input, jpeg, authorized));
    await upload();
    await upload();
    const row = await db.gameProgressPic.findUniqueOrThrow({ where: { id: input.id } });
    expect(row.takenAt.toISOString()).toBe(input.takenAt);
    expect(keys).toEqual([row.storageKey, row.storageKey]);
    expect(Buffer.from(await readProgressPic(owner, input.id)).equals(jpeg)).toBe(true);
  });
  it("publishes a picture once its reserved upload succeeds on retry", async () => {
    localRosterCrypto();
    const owner = await member();
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ userId: owner, domain: "control" });
    vi.stubEnv("HOSTED_EXECUTION_CONTROL_URL", "https://control.example.test");
    vi.spyOn(controlAuth, "createHostedExecutionVercelOidcBearerTokenProvider").mockReturnValue(async () => "synthetic");
    const stage = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("staging interrupted"));
    const input = { id: randomUUID(), measureId: "squats.reps", takenAt: "2026-08-09T12:00:00Z" };
    const upload = () => putProgressPic(owner, input, Uint8Array.of(1, 2), authorized);
    await expect(upload()).rejects.toMatchObject({ httpStatus: 503 });
    expect(await readProgressPics(owner)).toEqual([]);
    stage.mockResolvedValue(Response.json({ stored: true }));
    await upload();
    stage.mockResolvedValue(Response.json({ stored: true }));
    await upload();
    expect(await readProgressPics(owner)).toEqual([{ ...input, takenAt: new Date(input.takenAt) }]);
  });

  it("opens an uppercase legacy picture alongside an unreadable neighbor and finishes its replay", async () => {
    localRosterCrypto();
    vi.stubGlobal("__murphHostedSecureBoxStringTestCodec", undefined);
    const owner = await member();
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ userId: owner, domain: "control" });
    const id = "ab12cd34-5678-4abc-8def-0123456789ab";
    const takenAt = new Date("2026-08-09T12:00:00Z");
    const meta = { measureId: "lunges.reps" };
    const target = { memberId: owner, table: "game_progress_pic", field: "meta" } as const;
    const encrypted = await sealProgress({ ...target, rowId: id.toUpperCase() }, meta);
    await db.gameProgressPic.createMany({ data: [id, randomUUID()].map(rowId => ({
      id: rowId, memberId: owner, takenAt, metaEncrypted: encrypted, storageKey: `progress/${randomBytes(16).toString("hex")}.jpg`,
    })) });
    expect(await readProgressPics(owner)).toEqual([{ id, takenAt, ...meta }]);
    vi.stubEnv("HOSTED_EXECUTION_CONTROL_URL", "https://control.example.test");
    vi.spyOn(controlAuth, "createHostedExecutionVercelOidcBearerTokenProvider").mockReturnValue(async () => "synthetic");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ stored: true }));
    await putProgressPic(owner, { id: id.toUpperCase(), takenAt: takenAt.toISOString(), ...meta }, Uint8Array.of(1), authorized);
    const row = await db.gameProgressPic.findUniqueOrThrow({ where: { id } });
    expect(await openProgress({ ...target, rowId: id }, row.metaEncrypted)).toEqual(meta);
  });

  it.each(["2026-11-01", "2026-11-02", "2026-11-04"])("recognizes independent Running evidence for a stored health medal on %s", async on => {
    const owner = await member();
    const game = { ...candidate("total:run.meters:1609.344", on), measureId: "run.meters" };
    const health = { ...game, on: "2026-11-02", data: { ...game.data, health: true } };
    await settleAwards(owner, [health], authorized);
    const original = await readAwards(owner);
    await settleAwards(owner, [game], authorized, { awards: original, timeZone: "UTC" });
    const updated = await readAwards(owner);
    expect(visibleAwards(updated, true)).toMatchObject([{ id: original[0].id, on: health.on }]);
    expect(visibleAwards(updated, false)).toMatchObject([{ id: original[0].id, on: game.on }]);
    expect(updated[0].seenAt).toEqual(original[0].seenAt);
  });

  it("starts time-total awards at ten minutes and preserves earned dates through repeated reads and corrections", async () => {
    const id = await member();
    const source = game("time", task("4 min planks", { quantity: 4, unit: "minutes", name: "planks" }));
    const candidates = () => roundTotals(achievementContext(gameSeries([source], memberId, new Map()), new Map()));
    post(source, 0, "photo", null); post(source, 1, "photo", null);
    await settleAwards(id, candidates(), authorized);
    expect(await readAwards(id)).toEqual([]);
    post(source, 2, "photo", null); post(source, 3, "photo", null);
    await settleAwards(id, candidates(), authorized);
    const earned = await readAwards(id);
    expect(earned.map(award => [award.data.value, award.on])).toEqual([[900, "2026-11-04"], [600, "2026-11-03"]]);
    await settleAwards(id, candidates(), authorized);
    source.state.entries[2].withdrawnAt = source.now;
    source.state.entries[3].withdrawnAt = source.now;
    await settleAwards(id, candidates(), authorized);
    expect(await readAwards(id)).toEqual(earned);
  });
  it("settles every held health level on its earned date once, even after readings worsen", async () => {
    const id = await member();
    const context = { metric: "restingHeartRate" as const, baseline: 74, joinedOn: "2026-11-01", step: 1, direction: -1,
      profile: { age: 35, sex: "female" as const }, means: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-11-0${index + 1}`, value: 71, source: "Apple Watch", observedAt: "2026-11-16T00:00:00Z",
      })) };
    await settleAwards(id, healthSteps(context), authorized);
    const first = await readAwards(id);
    expect(first).toHaveLength(3);
    expect(first.every(award => award.on === "2026-11-07")).toBe(true);
    await settleAwards(id, healthSteps(context), authorized);
    await settleAwards(id, healthSteps({ ...context, means: context.means.map(point => ({ ...point, value: 76 })) }), authorized);
    expect(await readAwards(id)).toEqual(first);
    const state = await patchMeasureState(id, context.metric,
      { baseline: { value: 74, from: "2026-10-04", to: "2026-10-31" } }, authorized);
    const before = await db.gameProgressAward.findMany({ where: { memberId: id }, orderBy: { lookup: "asc" } });
    const saved = savedHealthView(context.joinedOn, "2026-11-16", [{ id: context.metric, daily: [],
      baseline: state.baseline!.value, step: context.step, direction: context.direction, wins: await readAwards(id) }]);
    expect(saved.metrics[0]).toMatchObject({ headline: "Down 3 bpm", next: { detail: "70 bpm" } });
    expect(saved.metrics[0].wins.map(win => [win.medalId, win.on])).toEqual(first.map(win => [win.id, win.on]));
    expect(await db.gameProgressAward.findMany({ where: { memberId: id }, orderBy: { lookup: "asc" } })).toEqual(before);
  });
  it("settles concurrently and never revokes or rewrites the original crossing day", async () => {
    const id = await member();
    await Promise.all([settleAwards(id, [candidate("1000", "2026-11-13")], authorized), settleAwards(id, [candidate("1000", "2026-11-13")], authorized)]);
    const original = await readAwards(id);
    await settleAwards(id, [{ ...candidate("1000", "2026-11-15"), data: { value: 500 } }], authorized);
    await settleAwards(id, [], authorized);
    expect(await readAwards(id)).toEqual(original);
    expect(original).toMatchObject([{ on: "2026-11-13", data: { value: 1000 } }]);
  });
  it.each([
    ["UTC", "2026-11-08", true], ["UTC", "2026-11-09", false],
    ["America/Los_Angeles", "2026-11-07", true], ["America/Los_Angeles", "2026-11-08", false],
  ])("marks only awards more than seven local days old already seen (%s, %s)", async (zone, on, seen) => {
    const id = await member(zone); await settleAwards(id, [candidate("old", on)], authorized);
    expect((await readAwards(id))[0].seenAt !== null).toBe(seen);
  });
  it("orders newest gold by earned day, insert time, then lookup", async () => {
    const id = await member();
    await settleAwards(id, [candidate("a"), candidate("b"), candidate("older", "2026-11-15")], authorized);
    vi.setSystemTime(new Date("2026-11-16T02:00:00Z"));
    await settleAwards(id, [candidate("later"), candidate("backfill", "2026-11-14")], authorized);
    const rows = await readAwards(id);
    expect(rows.map(row => row.key)).toEqual(["later", ...["a", "b"].sort((a, b) => progressLookup(id, "award", [b]).localeCompare(progressLookup(id, "award", [a]))), "older", "backfill"]);
  });
  it("marks only this member's selected awards seen, without moving their first seen time", async () => {
    const a = await member(), b = await member();
    await settleAwards(a, [candidate("one"), candidate("two")], authorized); await settleAwards(b, [candidate("one")], authorized);
    const [own] = await readAwards(a), [foreign] = await readAwards(b);
    await markAwardsSeen(a, [own.id, foreign.id], authorized);
    const seen = (await readAwards(a)).find(row => row.id === own.id)!.seenAt;
    vi.setSystemTime(new Date("2026-11-17T01:00:00Z")); await markAwardsSeen(a, [own.id], authorized);
    expect((await readAwards(a)).filter(row => row.seenAt !== null)).toHaveLength(1);
    expect((await readAwards(a)).find(row => row.id === own.id)!.seenAt).toEqual(seen);
    expect((await readAwards(b))[0].seenAt).toBeNull();
  });
  it("merges unrelated goal, baseline and per-day fields", async () => {
    const id = await member();
    await patchMeasureState(id, "pushups.reps", { baseline: { value: 72, from: "2026-09-23", to: "2026-10-20" } }, authorized);
    await patchMeasureState(id, "pushups.reps", { goal: { rungId: "empire-state-building" } }, authorized);
    await patchMeasureState(id, "pushups.reps", { perDay: 40 }, authorized);
    expect(await readState(id)).toEqual({ baseline: { value: 72, from: "2026-09-23", to: "2026-10-20" }, goal: { rungId: "empire-state-building" }, perDay: 40 });
  });
  it("keeps the first eligible baseline when a stale caller proposes another", async () => {
    const id = await member();
    const baseline = { value: 70.51, from: "2026-09-23", to: "2026-10-20" };
    await patchMeasureState(id, "restingHeartRate", { baseline }, authorized);
    const state = await patchMeasureState(id, "restingHeartRate", previous => ({
      baseline: { ...previous.baseline!, value: 75 }, goal: { rungId: "empire-state-building" },
    }), authorized);
    expect(state.baseline).toEqual(baseline);
    const lookup = progressLookup(id, "measure", ["restingHeartRate"]);
    const row = await db.gameProgressMeasure.findUniqueOrThrow({ where: { memberId_lookup: { memberId: id, lookup } } });
    expect(await openProgress<MeasureState>({ memberId: id, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted))
      .toEqual({ baseline, goal: { rungId: "empire-state-building" } });
  });
  it.each([false, true])("a racing %s-state patch returns a retryable conflict instead of losing another field", async exists => {
    const id = await member();
    if (exists) await patchMeasureState(id, "pushups.reps", { perDay: 40 }, authorized);
    let release!: () => void;
    const bothSealed = new Promise<void>(resolve => { release = resolve; });
    let count = 0;
    const seal = crypto.sealProgress;
    vi.spyOn(crypto, "sealProgress").mockImplementation(async (...args) => {
      const ciphertext = await seal(...args);
      if (++count === 2) release();
      await bothSealed;
      return ciphertext;
    });
    const results = await Promise.allSettled([
      patchMeasureState(id, "pushups.reps", { goal: { rungId: "empire-state-building" } }, authorized),
      patchMeasureState(id, "pushups.reps", { baseline: { value: 72, from: "2026-09-23", to: "2026-10-20" } }, authorized),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find(result => result.status === "rejected");
    expect(loser).toMatchObject({ status: "rejected", reason: { code: "GAME_PROGRESS_STATE_CONFLICT", retryable: true } });
    const winner = results.find(result => result.status === "fulfilled");
    expect(await readState(id)).toEqual(winner?.status === "fulfilled" ? winner.value : null);
  });
  it("rechecks authority after crypto preparation and rolls back every write on rejection", async () => {
    const id = await member();
    const deny = vi.fn(async () => { throw new Error("authority revoked"); });
    await expect(patchMeasureState(id, "pushups.reps", { perDay: 40 }, deny)).rejects.toThrow("authority revoked");
    await expect(settleAwards(id, [candidate("one")], deny)).rejects.toThrow("authority revoked");
    expect(await db.gameProgressMeasure.count({ where: { memberId: id } })).toBe(0);
    expect(await readAwards(id)).toEqual([]);
    await settleAwards(id, [candidate("one")], authorized);
    await expect(markAwardsSeen(id, [(await readAwards(id))[0].id], deny)).rejects.toThrow("authority revoked");
    expect((await readAwards(id))[0].seenAt).toBeNull();
  });
  it("cascades subject awards and all owner state; late task inserts fail the owner FK", async () => {
    const owner = await member(), subject = await member();
    await settleAwards(owner, [{ ...candidate("friend"), subjectMemberId: subject, kind: "friend" }, candidate("total")], authorized);
    await patchMeasureState(owner, "pushups.reps", { perDay: 40 }, authorized);
    const taskLookup = progressLookup(owner, "task", ["40 pushups", "photo"]);
    const task = { memberId: owner, lookup: taskLookup, measureEncrypted: await sealProgress({ memberId: owner, table: "game_progress_task_measure", rowId: taskLookup, field: "measure" }, { name: "pushups", quantity: 40, unit: "reps" }) };
    await db.gameProgressTaskMeasure.create({ data: task });
    const picId = randomUUID();
    await db.gameProgressPic.create({ data: { id: picId, memberId: owner, storageKey: `progress/${randomUUID()}`, takenAt: new Date(), metaEncrypted: await sealProgress({ memberId: owner, table: "game_progress_pic", rowId: picId, field: "meta" }, { measureId: "pushups.reps" }), retiredAt: new Date() } });
    await db.hostedMember.delete({ where: { id: subject } });
    expect((await readAwards(owner)).map(row => row.key)).toEqual(["total"]);
    await db.hostedMember.delete({ where: { id: owner } });
    expect(await db.gameProgressAward.count({ where: { memberId: owner } })).toBe(0);
    expect(await db.gameProgressMeasure.count({ where: { memberId: owner } })).toBe(0);
    expect(await db.gameProgressPic.count({ where: { memberId: owner } })).toBe(0);
    expect(await db.gameProgressTaskMeasure.count({ where: { memberId: owner } })).toBe(0);
    await expect(db.gameProgressTaskMeasure.create({ data: task })).rejects.toMatchObject({ code: "P2003" });
  });
});
