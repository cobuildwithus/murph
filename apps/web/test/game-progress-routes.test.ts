import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { TermWords } from "../src/lib/game/rules";

const mocks = vi.hoisted(() => ({ games: vi.fn(), entries: vi.fn(), tasks: vi.fn(), states: vi.fn(), awards: vi.fn(),
  createAwards: vi.fn(), updateSeen: vi.fn(), patch: vi.fn(), after: vi.fn(), auth: vi.fn(), current: vi.fn(), health: vi.fn(), transaction: vi.fn(), suggest: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  game: { findMany: mocks.games }, gameEntry: { findMany: mocks.entries },
  gameProfile: { findUniqueOrThrow: async () => ({ timeZone: "UTC", createdAt: new Date("2026-11-01T12:00:00Z") }) },
  gameProgressTaskMeasure: { findMany: mocks.tasks }, gameProgressMeasure: { findMany: mocks.states },
  gameProgressAward: { findMany: mocks.awards }, gameProgressPic: { count: async () => 0 }, $transaction: mocks.transaction,
}) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.health }));
vi.mock("@/src/lib/game/progress/state", () => ({ patchMeasureState: mocks.patch }));
vi.mock("@/src/lib/game/progress/infer", async original => ({ ...await original<typeof import("../src/lib/game/progress/infer")>(),
  inferenceClient: () => ({ responses: { create: mocks.suggest } }) }));
// Keep the test port's sealed content opaque to the rows and exercise the production batch bindings.
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: async (entries: { value: string }[]) => entries.map(entry => entry.value) }));

import { GET } from "../app/api/game/v1/progress/route";
import { GET as goals } from "../app/api/game/v1/progress/goals/route";
import { PUT } from "../app/api/game/v1/progress/measures/[id]/route";
import { POST } from "../app/api/game/v1/progress/seen/route";
import { progressSchema, goalsSchema } from "../src/lib/game/progress/contract";
import { progressLookup, sealProgress } from "../src/lib/game/progress/crypto";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { normalizeTask } from "../src/lib/game/progress/infer";
import { ladder } from "../src/lib/game/progress/bank";

const memberId = "member-ava";
const request = (path = "", body?: object) => new Request(`https://example.test/api/game/v1/progress${path}`, { method: body ? "POST" : "GET",
  ...(body ? { body: JSON.stringify(body) } : {}) });
function gameRow(id = "game-one") {
  const words: TermWords = { v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "40 pushups" }], stakes: [] }] };
  return { id, createdBy: memberId, wordsOwnerMemberId: memberId, status: "live", maxPlayers: 2, lengthDays: 7,
    startsOn: new Date("2026-11-01"), settledAt: null, devClockOffsetMs: null, events: [],
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
    termsWordsEncrypted: JSON.stringify(words),
    players: [{ memberId, seat: 0, dayOne: new Date("2026-11-01"), timeZone: "UTC", joinedAt: new Date("2026-11-01T12:00:00Z"), leftAt: null }] };
}
function entryRow(day = 0) {
  return { id: `post-${day}`, gameId: "game-one", memberId, dayIndex: day, attempt: 1, kind: "reps", incomplete: null,
    receivedAt: new Date("2026-11-01T12:00:00Z"), withdrawnAt: null,
    payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 40, reps: [] }) };
}
type AwardRow = Prisma.GameProgressAwardCreateManyInput;
let awards: AwardRow[];
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  awards = [];
  mocks.auth.mockResolvedValue({ member: { id: memberId } }); mocks.current.mockResolvedValue(undefined); mocks.health.mockResolvedValue(undefined);
  mocks.games.mockResolvedValue([gameRow()]); mocks.entries.mockResolvedValue([entryRow()]); mocks.tasks.mockResolvedValue([]); mocks.states.mockResolvedValue([]);
  mocks.awards.mockImplementation(async () => [...awards].sort((a, b) => String(b.earnedOn).localeCompare(String(a.earnedOn)) || b.lookup.localeCompare(a.lookup)));
  mocks.createAwards.mockImplementation(async ({ data }: { data: AwardRow[] }) => {
    for (const row of data) if (!awards.some(award => award.lookup === row.lookup)) awards.push(row);
  });
  mocks.transaction.mockImplementation(async (run: (tx: object) => Promise<void>) => run({ gameProgressAward: { createMany: mocks.createAwards, updateMany: mocks.updateSeen } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Progress HTTP contracts", () => {
  it("builds the before-game screen from an empty source without inventing pre-join streak days", async () => {
    mocks.games.mockResolvedValue([]); mocks.entries.mockResolvedValue([]);
    expect(await (await GET(request())).json()).toEqual({ joinedOn: "2026-11-01", today: "2026-11-05", incomplete: false,
      measures: [], medals: [], shelf: [], moments: [], picCount: 0,
      streak: { current: 0, best: null, today: "none", obligations: [], months: [{ month: "2026-11", days: `....t${"f".repeat(25)}` }] } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("returns a private complete response and settles the same crossing only once", async () => {
    const first = await GET(request());
    expect(first.status).toBe(200); expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    const view = progressSchema.parse(await first.json());
    expect(view.measures[0]).toMatchObject({ id: "pushups.reps", pending: false, total: { value: 40 } });
    expect(mocks.after).not.toHaveBeenCalled();
    const original = structuredClone(awards);
    expect((await GET(request())).status).toBe(200);
    expect(awards).toEqual(original);
    expect(mocks.current).toHaveBeenCalled();
    expect(mocks.games).toHaveBeenCalledWith(expect.objectContaining({ take: 501 }));
    expect(mocks.entries).toHaveBeenCalledWith(expect.objectContaining({ take: 10001, where: expect.objectContaining({ memberId }) }));
  });
  it.each(["games", "entries"])("marks %s overflow incomplete and makes no settling or inference writes", async cap => {
    if (cap === "games") mocks.games.mockResolvedValue(Array.from({ length: 501 }, (_, i) => gameRow(`game-${i}`)));
    else mocks.entries.mockResolvedValue(Array.from({ length: 10001 }, (_, i) => ({ ...entryRow(0), id: `entry-${i}` })));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(progressSchema.parse(await response.json()).incomplete).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("keeps passed landmarks even after the final contributing post is withdrawn", async () => {
    const entry = { ...entryRow(), payloadEncrypted: JSON.stringify({ exercise: "pushups", count: 100, reps: [] }) };
    mocks.entries.mockResolvedValue([entry]);
    const before = progressSchema.parse(await (await GET(request())).json());
    const passed = before.measures[0].ladder!.passed;
    expect(passed.length).toBeGreaterThan(0);
    mocks.entries.mockResolvedValue([{ ...entry, withdrawnAt: new Date() }]);
    const after = progressSchema.parse(await (await GET(request())).json());
    expect(after.measures[0].total.value).toBe(0);
    expect(after.measures[0].ladder!.passed).toEqual(passed);
    expect(after.measures[0].ladder!.next!.id).toBe(before.measures[0].ladder!.next!.id);
    expect(after.measures[0].ladder!.next!.toGo).toBe("125 to go");
    expect(after.medals).toEqual(before.medals);
    expect((await goals(request("/goals?measure=pushups.reps"))).status).toBe(200);
    expect((await PUT(request("/measures/pushups.reps", { goal: { rungId: "half-dome" } }), { params: Promise.resolve({ id: "pushups.reps" }) })).status).toBe(200);
  });
  it("resolves group defaults and seat overrides at their historical terms revisions", async () => {
    const row = gameRow(); row.maxPlayers = 10;
    row.terms.versions.push({ n: 2, fromDay: 1, schedule: { count: 7 }, stakes: [] });
    row.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [
      { n: 1, defaultTask: "20 squats", tasks: [{ seat: 1, text: "100 pushups" }], stakes: [] },
      { n: 2, defaultTask: "20 squats", tasks: [{ seat: 0, text: "10 min abs" }], stakes: [] },
    ] });
    mocks.games.mockResolvedValue([row]);
    mocks.entries.mockResolvedValue([0, 1].map(day => ({ ...entryRow(day), kind: "photo", payloadEncrypted: null })));
    const cached = [];
    for (const [text, name, quantity, unit] of [["20 squats", "squats", 20, "reps"], ["10 min abs", "abs", 10, "minutes"]] as const) {
      const lookup = progressLookup(memberId, "task", [normalizeTask(text), "photo"]);
      cached.push({ lookup, measureEncrypted: await sealProgress({ memberId, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { name, quantity, unit }) });
    }
    mocks.tasks.mockResolvedValue(cached);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(progressSchema.parse(await response.json()).measures.map(measure => [measure.id, measure.total.value])).toEqual([["squats.reps", 20], ["abs.seconds", 600]]);
  });
  it("shows today's obligation text until a future terms revision takes effect", async () => {
    const row = gameRow();
    row.terms.versions.push({ n: 2, fromDay: 5, schedule: { count: 7 }, stakes: [] });
    row.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [
      { n: 1, tasks: [{ seat: 0, text: "40 pushups" }], stakes: [] },
      { n: 2, tasks: [{ seat: 0, text: "20 squats" }], stakes: [] },
    ] });
    mocks.games.mockResolvedValue([row]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.streak.obligations).toEqual([{ id: "game-one", label: "40 pushups", icon: "dumbbell", done: false }]);
  });
  it("uses the terminal event in the game's shifted clock without dropping earlier history", async () => {
    const row = { ...gameRow(), status: "void", devClockOffsetMs: BigInt(86_400_000), events: [{ createdAt: new Date("2026-11-02T12:00:00Z") }] };
    mocks.games.mockResolvedValue([row]); mocks.entries.mockResolvedValue([entryRow(0), entryRow(2)]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.measures[0].total.value).toBe(80);
    expect(view.streak).toMatchObject({ current: 1, obligations: [], best: { count: 1 }, today: "none" });
    expect(view.streak.months[0].days).toBe(`dmd.t${"f".repeat(25)}`);
  });
  it("uses the departing peer's already-shifted time for a void group's surviving member", async () => {
    const row = { ...gameRow(), status: "void", maxPlayers: 10, devClockOffsetMs: BigInt(86_400_000) };
    const peer = { ...row.players[0], memberId: "member-leo", seat: 1, leftAt: new Date("2026-11-03T12:00:00Z") };
    mocks.games.mockResolvedValue([{ ...row, players: [peer, ...row.players] }]);
    mocks.entries.mockResolvedValue([entryRow(0), entryRow(2)]);
    const view = progressSchema.parse(await (await GET(request())).json());
    expect(view.measures[0].total.value).toBe(80);
    expect(view.streak).toMatchObject({ current: 1, obligations: [], today: "none" });
    expect(view.streak.months[0].days).toBe(`dmd.t${"f".repeat(25)}`);
  });
  it("schedules only unresolved untyped phrases after the response, with member and kind bound lookups", async () => {
    mocks.entries.mockResolvedValue([0, 1].map(day => ({ ...entryRow(day), kind: "photo", payloadEncrypted: null })));
    const response = await GET(request());
    const view = progressSchema.parse(await response.json());
    expect(view.measures[0]).toMatchObject({ pending: true, total: { value: 2, unit: "days" }, ladder: null });
    expect(view.medals.some(medal => medal.open.measureId === view.measures[0].id)).toBe(false);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const lookup = progressLookup(memberId, "task", ["40 pushups", "photo"]);
    expect(lookup).not.toBe(progressLookup("member-leo", "task", ["40 pushups", "photo"]));
    expect(lookup).not.toBe(progressLookup(memberId, "task", ["40 pushups", "any"]));
    expect(lookup).not.toBe(createHash("sha256").update("40 pushups").digest("hex"));
  });
  it("denies a session revoked between read and settlement without writing", async () => {
    mocks.current.mockRejectedValue(hostedOnboardingError({ code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in to continue." }));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.createAwards).not.toHaveBeenCalled();
  });
  it("filters stored health medals and moments when current Postgres authority denies access", async () => {
    const lookup = progressLookup(memberId, "award", ["health:one"]);
    const dataEncrypted = await sealProgress({ memberId, table: "game_progress_award", rowId: lookup, field: "data" }, {
      key: "health:one", kind: "health", measureId: "restingHeartRate", subjectMemberId: null, on: "2026-11-05",
      data: { face: { delta: { icon: "heart", text: "↓1" } }, title: "Heart rate", detail: "down 1 bpm", page: "health" },
    });
    awards.push({ memberId, lookup, earnedOn: new Date("2026-11-05"), createdAt: new Date(), seenAt: null, dataEncrypted });
    mocks.health.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const view = progressSchema.parse(await response.json());
    expect(view.medals.some(medal => medal.kind === "health")).toBe(false);
    expect(view.moments.flatMap(moment => moment.medalIds)).not.toContain(lookup);
    expect(view.medals.filter(medal => medal.gold)).toHaveLength(1);
  });
  it("marks only this owner's requested moment awards seen", async () => {
    const view = await (await GET(request())).json();
    const response = await POST(request("/seen", { momentIds: view.moments.map((moment: { id: string }) => moment.id) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(mocks.updateSeen).toHaveBeenCalledWith({ where: { memberId, lookup: { in: awards.map(award => award.lookup) }, seenAt: null }, data: { seenAt: expect.any(Date) } });
  });
  it.each([{ perDay: -1 }, { perDay: 1e308 }, { perDay: 10_001 }, { perDay: 1.5 }, { goal: { rungId: "" } }, { memberId: "member-leo", perDay: 40 }])("rejects invalid measure input before storage", async body => {
    const response = await PUT(request("/measures/pushups.reps", body), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(response.status).toBe(400); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("writes a checked goal only through patchMeasureState and retains the BE3 501 branch", async () => {
    const response = await PUT(request("/measures/pushups.reps", { goal: { rungId: "half-dome" } }), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(response.status).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith(memberId, "pushups.reps", { goal: { rungId: "half-dome" } }, expect.any(Function));
    const route = await PUT(request("/measures/pushups.reps", { goal: { from: "London", to: "Paris" } }), { params: Promise.resolve({ id: "pushups.reps" }) });
    expect(route.status).toBe(501);
  });
  it("returns only checked height tiles and a typed bank match", async () => {
    const response = await goals(request("/goals?measure=pushups.reps&q=Half%20Dome"));
    expect(response.status).toBe(200);
    expect(goalsSchema.parse(await response.json())).toMatchObject({ match: { id: "half-dome" }, note: null, route: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("offers the same curated plank ladder on Totals and goal tiles", async () => {
    const row = gameRow();
    row.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [{ n: 1, tasks: [{ seat: 0, text: "10 min planks" }], stakes: [] }] });
    mocks.games.mockResolvedValue([row]); mocks.entries.mockResolvedValue([{ ...entryRow(), kind: "photo", payloadEncrypted: null }]);
    const lookup = progressLookup(memberId, "task", ["10 min planks", "photo"]);
    mocks.tasks.mockResolvedValue([{ lookup, measureEncrypted: await sealProgress({ memberId, table: "game_progress_task_measure", rowId: lookup, field: "measure" }, { name: "planks", quantity: 10, unit: "minutes" }) }]);
    const response = await goals(request("/goals?measure=planks.seconds"));
    expect(goalsSchema.parse(await response.json()).tiles.map(tile => tile.id)).toEqual(ladder("time", "plank").filter(entry => entry.at > 600).slice(0, 6).map(entry => entry.id));
  });
  it("uses one bank-id-only Responses call for an unmatched goal and rejects invented ids", async () => {
    mocks.suggest.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ ids: ["half-dome"], note: "A real mountain to climb." }) });
    const response = await goals(request("/goals?measure=pushups.reps&q=Mount%20Doom"));
    expect(goalsSchema.parse(await response.json())).toMatchObject({ suggestions: [{ id: "half-dome" }], note: "A real mountain to climb." });
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
    expect(mocks.suggest.mock.calls[0][0].text.format.schema.properties.ids).toMatchObject({ maxItems: 4, items: { enum: expect.arrayContaining(["half-dome"]) } });
    expect(mocks.suggest.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: 8000 });
    mocks.suggest.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ ids: ["mount-doom"], note: null }) });
    expect((await goals(request("/goals?measure=pushups.reps&q=Mount%20Doom"))).status).toBe(503);
  });
  it("omits the unmatched-goal note when the single call has no suggestions", async () => {
    mocks.suggest.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ ids: [], note: "No close match." }) });
    expect(goalsSchema.parse(await (await goals(request("/goals?measure=pushups.reps&q=Mount%20Doom"))).json()))
      .toMatchObject({ match: null, suggestions: [], note: null });
    expect(mocks.suggest).toHaveBeenCalledTimes(1);
  });
});
