import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../src/lib/prisma";
import { sealGameText } from "../src/lib/game/crypto";
import { openProgress, progressLookup } from "../src/lib/game/progress/crypto";
import * as crypto from "../src/lib/game/progress/crypto";
import * as series from "../src/lib/game/progress/series";
import { patchMeasureState, type MeasureState } from "../src/lib/game/progress/state";
import { readAwards } from "../src/lib/game/progress/awards";
import { goalsSchema, progressSchema } from "../src/lib/game/progress/contract";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import responseFixture from "./fixtures/progress-goal-lookup-response.json";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), current: vi.fn() }));
vi.mock("../src/lib/game/progress/infer", async original => ({ ...await original<typeof import("../src/lib/game/progress/infer")>(),
  inferenceClient: () => ({ responses: { create: mocks.provider } }) }));
vi.mock("../src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async (request: Request) => ({ member: { id: request.headers.get("X-Test-Member")! } }),
  assertGameMemberAuthCurrentTx: mocks.current,
}));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: async () => {} }));
vi.mock("../src/lib/game/progress/settlement", () => ({ scheduleProgressSettlement: vi.fn() }));
import { GET as goals } from "../app/api/game/v1/progress/goals/route";
import { GET as progress } from "../app/api/game/v1/progress/route";
import { PUT } from "../app/api/game/v1/progress/measures/[id]/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Progress proof needs an isolated loopback test database.");
const db = getPrisma(), members: string[] = [], games: string[] = [];
const authorized = async () => {};
function request(member: string, path = "", units = "us", body?: object) {
  return new Request(`https://example.test/api/game/v1/progress${path}`, { headers: { "X-Test-Member": member, "X-Murph-Client-Units": units },
    method: body ? "PUT" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
}
const lookup = (member: string) => goals(request(member, "/goals?measure=pushups.reps&q=Synthetic%20Tower&find=1"));
const pick = (member: string, rungId: string) => PUT(request(member, "/measures/pushups.reps", "us", { goal: { rungId } }), { params: Promise.resolve({ id: "pushups.reps" }) });
async function fixture() {
  const memberId = randomUUID(), gameId = randomUUID(), entryId = randomUUID(); members.push(memberId); games.push(gameId);
  await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  await db.gameProfile.create({ data: { memberId, timeZone: "UTC", createdAt: new Date("2026-11-14"), firstNameEncrypted: "synthetic" } });
  const termsWordsEncrypted = await sealGameText({ memberId, table: "game", rowId: gameId, field: "terms_words" },
    JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "Pushups" }], stakes: [] }] }));
  await db.game.create({ data: { id: gameId, createdBy: memberId, wordsOwnerMemberId: memberId, status: "live", termsWordsEncrypted: termsWordsEncrypted!,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
    players: { create: { memberId, seat: 0, dayOne: new Date("2026-11-14"), timeZone: "UTC", joinedAt: new Date("2026-11-14T12:00:00Z") } } } });
  const payloadEncrypted = await sealGameText({ memberId, table: "game_entry", rowId: entryId, field: "payload" }, JSON.stringify({ exercise: "pushups", count: 1, reps: [] }));
  await db.gameEntry.create({ data: { id: entryId, gameId, memberId, dayIndex: 0, attempt: 1, kind: "reps", receivedAt: new Date("2026-11-14T12:00:00Z"), payloadEncrypted } });
  return { memberId, entryId };
}
async function state(memberId: string): Promise<MeasureState> {
  const lookup = progressLookup(memberId, "measure", ["pushups.reps"]);
  const row = await db.gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } } });
  return row ? openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted) : {};
}
function responseB() {
  const result = JSON.parse(responseFixture.output_text);
  return { ...responseFixture, output_text: JSON.stringify({ ...result, found: { ...result.found, value: 609.6, where: "Another town" } }) };
}
const deferred = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
beforeEach(() => {
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.provider.mockReset().mockResolvedValue(responseFixture); mocks.current.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (!enabled) return;
  await db.game.deleteMany({ where: { id: { in: games } } });
  await db.hostedMember.deleteMany({ where: { id: { in: members } } });
});

describe.skipIf(!enabled)("Progress found-goal PostgreSQL journeys", () => {
  it("removes a newly reached goal from search and refuses the stale selection", async () => {
    const { memberId, entryId } = await fixture();
    const search = async () => goalsSchema.parse(await (await goals(request(memberId, "/goals?measure=pushups.reps&q=great-blue-hole"))).json());
    const goal = (await search()).match!;
    expect(goal.id).toBe("great-blue-hole");
    await db.gameEntry.update({ where: { id: entryId }, data: { payloadEncrypted: await sealGameText(
      { memberId, table: "game_entry", rowId: entryId, field: "payload" },
      JSON.stringify({ exercise: "pushups", count: goal.at, reps: [] })) } });
    expect(await search()).toMatchObject({ match: null, suggestions: [] });
    const refused = await pick(memberId, goal.id);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "INVALID_REQUEST", message: expect.stringContaining("already reached") } });
    expect((await state(memberId)).goal).toBeUndefined();
  });

  it("earns A, replaces cache and goal with B, withdraws the last post and renders A in every system", async () => {
    const { memberId, entryId } = await fixture();
    const a = goalsSchema.parse(await (await lookup(memberId)).json()).match!;
    expect((await pick(memberId, a.id)).status).toBe(200);
    expect((await state(memberId)).goal).toMatchObject({ found: { id: a.id, at: 1000, sourceUrl: "https://facts.example.test/tower" } });
    await db.gameEntry.update({ where: { id: entryId }, data: { payloadEncrypted: await sealGameText({ memberId, table: "game_entry", rowId: entryId, field: "payload" }, JSON.stringify({ exercise: "pushups", count: 1000, reps: [] })) } });
    expect((await progress(request(memberId))).status).toBe(200);
    const saved = (await readAwards(memberId)).find(award => award.key === `rung:pushups.reps:${a.id}`)!;
    expect(saved.on).toBe("2026-11-14");
    expect((await pick(memberId, a.id)).status).toBe(400);
    mocks.provider.mockResolvedValue(responseB());
    const b = goalsSchema.parse(await (await lookup(memberId)).json()).match!;
    expect(b.id).not.toBe(a.id); expect((await pick(memberId, b.id)).status).toBe(200);
    await db.gameEntry.update({ where: { id: entryId }, data: { withdrawnAt: new Date() } });
    const original = await readAwards(memberId);
    for (const units of ["us", "uk", "metric"]) {
      const view = progressSchema.parse(await (await progress(request(memberId, "", units))).json());
      expect(view.measures[0].total.value).toBe(0);
      expect(view.measures[0].ladder!.passed.find(rung => rung.id === a.id)).toMatchObject({ at: 1000, on: "2026-11-14", atText: units === "us" ? "1,000 ft" : "305 m", short: "Synthetic Tower" });
      expect(view.medals.find(medal => medal.id === saved.id)).toMatchObject({ face: { generic: true }, title: "Synthetic Tower", earnedOn: "2026-11-14" });
    }
    expect(await readAwards(memberId)).toEqual(original);
    const lowerGoal = await goals(request(memberId, "/goals?measure=pushups.reps&q=great-blue-hole"));
    expect(goalsSchema.parse(await lowerGoal.json()).match).toBeNull();
    expect((await pick(memberId, "great-blue-hole")).status).toBe(400);
    expect((await pick(memberId, a.id)).status).toBe(400);
    expect((await state(memberId)).goal).toMatchObject({ found: { id: b.id } });
  });
  it("rejects a stale pick when lookup replaces the slot after PUT's series read", async () => {
    const { memberId } = await fixture();
    const a = goalsSchema.parse(await (await lookup(memberId)).json()).match!;
    await patchMeasureState(memberId, "pushups.reps", { goal: { rungId: "half-dome" } }, authorized);
    const observed = deferred(), resume = deferred(), read = series.readGameSeries;
    vi.spyOn(series, "readGameSeries").mockImplementationOnce(async (...args) => {
      const snapshot = await read(...args); observed.release(); await resume.promise; return snapshot;
    });
    const saving = pick(memberId, a.id); await observed.promise;
    mocks.provider.mockResolvedValue(responseB());
    expect((await lookup(memberId)).status).toBe(200);
    resume.release();
    expect((await saving).status).toBe(400);
    expect((await state(memberId)).goal).toEqual({ rungId: "half-dome" });
  });
  it("rechecks lookup GET authority after the provider and preserves its denial", async () => {
    const { memberId } = await fixture();
    const started = deferred(), resume = deferred();
    mocks.provider.mockImplementationOnce(async () => { started.release(); await resume.promise; return responseFixture; });
    const loading = lookup(memberId); await started.promise;
    mocks.current.mockImplementation(async (_auth: unknown, tx: Prisma.TransactionClient) => {
      expect(tx).toHaveProperty("gameProgressMeasure");
      throw hostedOnboardingError({ code: "AUTH_SESSION_INVALID", httpStatus: 401, message: "Sign in again." });
    });
    resume.release(); const result = await loading;
    expect(result.status).toBe(401); expect(await result.json()).toMatchObject({ error: { code: "AUTH_SESSION_INVALID" } });
    expect(await state(memberId)).toEqual({}); expect(await readAwards(memberId)).toEqual([]);
  });
  it("preserves the writer's conflict instead of reporting a provider failure", async () => {
    const { memberId } = await fixture(), sealed = deferred(), resume = deferred(), seal = crypto.sealProgress;
    vi.spyOn(crypto, "sealProgress").mockImplementationOnce(async (...args) => {
      const value = await seal(...args); sealed.release(); await resume.promise; return value;
    });
    const loading = lookup(memberId); await sealed.promise;
    await patchMeasureState(memberId, "pushups.reps", { perDay: 40 }, authorized);
    resume.release(); const result = await loading;
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: "GAME_PROGRESS_STATE_CONFLICT" } });
    expect(await state(memberId)).toEqual({ perDay: 40 });
  });
  it("deduplicates an identical found definition and enforces one member budget under concurrency", async () => {
    const { memberId } = await fixture();
    const first = goalsSchema.parse(await (await lookup(memberId)).json()).match!;
    const second = goalsSchema.parse(await (await lookup(memberId)).json()).match!;
    expect(first.id).toBe(second.id);
    mocks.provider.mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify({ found: null, closest: [], note: "No verified place found." }) });
    const results: Response[] = [];
    // Bounded batches still contend on the same persisted admission key.
    for (let batch = 0; batch < 5; batch++) results.push(...await Promise.all(Array.from({ length: 4 }, () => lookup(memberId))));
    expect(results.filter(result => result.status === 200)).toHaveLength(18);
    expect(results.filter(result => result.status === 429)).toHaveLength(2);
    expect(mocks.provider).toHaveBeenCalledTimes(20);
    const typing = await goals(request(memberId, "/goals?measure=pushups.reps&q=Unknown"));
    expect(typing.status).toBe(200); expect(mocks.provider).toHaveBeenCalledTimes(20);
    const { memberId: other } = await fixture();
    expect((await lookup(other)).status).toBe(200); expect(mocks.provider).toHaveBeenCalledTimes(21);
  });
});
