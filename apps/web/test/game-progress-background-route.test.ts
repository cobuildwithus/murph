import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pictures: vi.fn(), after: vi.fn(), current: vi.fn(), authority: vi.fn(), replica: vi.fn(), raw: vi.fn(),
  ownGames: vi.fn(), friendGames: vi.fn(), cohort: vi.fn(), ids: vi.fn(), rooms: vi.fn(),
  pairLock: vi.fn(), resolve: vi.fn(), states: vi.fn(), state: vi.fn(), createState: vi.fn(), updateState: vi.fn(),
  awards: vi.fn(), createAwards: vi.fn(), profile: vi.fn(), transaction: vi.fn(), inference: vi.fn(),
  artRows: vi.fn(), ensureArt: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }),
  assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedBrowserVaultReplicaState: mocks.replica }));
vi.mock("@/src/lib/device-sync/companion-numbers", async original => ({
  ...await original<typeof import("@/src/lib/device-sync/companion-numbers")>(), readCompanionHealthSeries: mocks.raw,
}));
vi.mock("@/src/lib/game/progress/series", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/series")>(), readGameSeries: mocks.ownGames,
  scheduleInference: mocks.inference,
}));
vi.mock("@/src/lib/game/progress/pics", () => ({ readProgressPics: mocks.pictures }));
vi.mock("@/src/lib/game/progress/friend-games", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/friend-games")>(), readFriendGameSeries: mocks.friendGames,
}));
vi.mock("@/src/lib/game/progress/friend-cohort", () => ({ readFriendCohort: mocks.cohort, friendCohortIds: mocks.ids }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));
vi.mock("@/src/lib/game/progress/friend-health", () => ({ readFriendHealthSeries: () => { throw new Error("Background must not read friends' private health."); } }));
vi.mock("@/src/lib/game/blocks", () => ({ lockGamePair: mocks.pairLock }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolve }));
vi.mock("@/src/lib/game/progress/place-art", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/place-art")>(), readArtRows: mocks.artRows, ensureArt: mocks.ensureArt,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  gameProfile: { findUnique: mocks.profile, findUniqueOrThrow: mocks.profile },
  gameProgressMeasure: { findMany: mocks.states, findUnique: mocks.state },
  gameProgressAward: { findMany: mocks.awards }, $transaction: mocks.transaction,
}) }));

import { addDaysToIsoDate } from "@murphai/contracts";
import { GET } from "../app/api/game/v1/progress/route";
import { GET as friendsGET } from "../app/api/game/v1/progress/friends/route";
import { GET as healthGET } from "../app/api/game/v1/progress/health/route";
import { healthSchema, progressSchema } from "@/src/lib/game/progress/contract";
import { openProgress, progressLookup } from "@/src/lib/game/progress/crypto";
import * as crypto from "@/src/lib/game/progress/crypto";
import { readAwards, settleAwards } from "@/src/lib/game/progress/awards";
import { healthSettlementCurrent } from "@/src/lib/game/progress/health-reader";
import { encodePolyline } from "@/src/lib/game/progress/route-geometry";
import { mapKey } from "@/src/lib/game/progress/place-art-make";
import { describeMeasure } from "@/src/lib/game/progress/series";
import { patchMeasureState, type MeasureState } from "@/src/lib/game/progress/state";
import type { Candidate } from "@/src/lib/game/progress/registry";
import type { FriendGameSeries } from "@/src/lib/game/progress/friend-games";
import { friendMeasure } from "@/src/lib/game/progress/friend-games";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const joinedOn = "2026-10-21", savedAt = "2026-11-16T12:00:00.000Z";
const request = () => new Request("https://example.test/api/game/v1/progress");
const denied = () => hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." });
type StateRow = { memberId: string; lookup: string; stateEncrypted: string };
let states: StateRow[], awards: Prisma.GameProgressAwardCreateManyInput[];
const tx = { gameProgressMeasure: { createMany: mocks.createState, updateMany: mocks.updateState },
  gameProgressAward: { createMany: mocks.createAwards } };

function healthSnapshot() {
  const daily = Array.from({ length: 55 }, (_, index) => {
    const date = addDaysToIsoDate(joinedOn, index - 28);
    return { date, value: date < joinedOn ? 74 : 71, source: "Apple Watch", observedAt: `${date}T12:00:00Z` };
  });
  return { timeZone: "UTC", savedAt, freshness: "fresh", demographics: { birthYear: 1991, biologicalSex: "female" },
    numbers: { restingHeartRate: { daily }, steps: null, sleep: null, vo2Max: null } };
}

async function drain() {
  const callbacks = mocks.after.mock.calls.splice(0);
  for (const [callback] of callbacks) await callback();
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function healthState() {
  const lookup = progressLookup("ava", "measure", ["restingHeartRate"]);
  const row = states.find(state => state.lookup === lookup);
  return row ? openProgress<MeasureState>({ memberId: "ava", table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted) : null;
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(savedAt));
  states = []; awards = [];
  mocks.pictures.mockResolvedValue([]);
  mocks.artRows.mockResolvedValue(new Map()); mocks.ensureArt.mockResolvedValue(new Map());
  mocks.profile.mockResolvedValue({ timeZone: "UTC", createdAt: new Date(`${joinedOn}T12:00:00Z`) });
  mocks.replica.mockResolvedValue({ browserVaultReplicaRef: { generatedAt: savedAt }, version: "8" });
  mocks.raw.mockResolvedValue(healthSnapshot());
  mocks.ownGames.mockImplementation(async () => ({ checkIns: [], measures: [], successors: new Map(), states: new Map(), awards: await readAwards("ava"), pending: [] }));
  mocks.cohort.mockResolvedValue({ people: ["Ava", "Leo"].map(firstName => ({
    memberId: firstName.toLowerCase(), firstName, avatarUrl: null, me: firstName === "Ava", joinedOn, daily: null,
  })) });
  mocks.ids.mockResolvedValue({ ids: ["ava", "leo"] });
  mocks.rooms.mockResolvedValue([]);
  const measures = ["pushups.reps", "planks.seconds"];
  const games: FriendGameSeries = { pending: [], tasks: new Map(), measures: new Map(measures.map(id => [id, friendMeasure(id)])),
    amounts: new Map(["ava", "leo"].map(member => [member, measures.flatMap(measureId => member === "ava" ? [
      { measureId, date: "2026-11-01", amount: 20 }, { measureId, date: "2026-11-02", amount: 40 },
    ] : [
      { measureId, date: "2026-10-30", amount: 10 }, { measureId, date: "2026-10-31", amount: 10 },
      { measureId, date: "2026-11-01", amount: 30 },
    ])])) };
  mocks.friendGames.mockResolvedValue(games);
  mocks.states.mockImplementation(async ({ where }) => states.filter(row => where.lookup.in.includes(row.lookup)));
  mocks.state.mockImplementation(async ({ where }) => {
    const row = states.find(row => row.lookup === where.memberId_lookup.lookup);
    return row ? { ...row } : null;
  });
  mocks.createState.mockImplementation(async ({ data }: { data: StateRow[] }) => {
    if (states.some(row => row.lookup === data[0].lookup)) return { count: 0 };
    states.push(...data); return { count: 1 };
  });
  mocks.updateState.mockImplementation(async ({ where, data }: { where: StateRow; data: { stateEncrypted: string } }) => {
    const row = states.find(row => row.lookup === where.lookup && row.stateEncrypted === where.stateEncrypted);
    if (!row) return { count: 0 };
    row.stateEncrypted = data.stateEncrypted; return { count: 1 };
  });
  mocks.awards.mockImplementation(async () => [...awards].sort((a, b) => String(b.earnedOn).localeCompare(String(a.earnedOn)) || b.lookup.localeCompare(a.lookup)));
  mocks.createAwards.mockImplementation(async ({ data }: { data: Prisma.GameProgressAwardCreateManyInput[] }) => {
    for (const row of data) if (!awards.some(award => award.lookup === row.lookup)) awards.push(row);
  });
  mocks.transaction.mockImplementation(async run => run(tx));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("freezes pre-join health and earns both exercise passes after the response, visible on the next read", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(progressSchema.parse(await response.json()).medals).toEqual([]);
  expect(states).toEqual([]); expect(awards).toEqual([]); expect(mocks.raw).not.toHaveBeenCalled();
  await drain();
  expect((await healthState())?.baseline).toEqual({ value: 74, source: "Apple Watch", from: "2026-09-23", to: "2026-10-20" });
  expect(mocks.raw.mock.calls[0].slice(2)).toEqual([["restingHeartRate", "steps", "sleep"], { browserVaultReplicaRef: { generatedAt: savedAt }, version: "8" }]);
  const earned = await readAwards("ava");
  expect(earned.filter(award => award.kind === "health").map(award => award.data.level).sort()).toEqual([]);
  expect(earned.some(award => award.kind === "healthAge")).toBe(false);
  expect(earned.filter(award => award.kind === "friend")).toEqual(expect.arrayContaining([
    expect.objectContaining({ measureId: "pushups.reps", on: "2026-11-02", data: expect.objectContaining({ title: "Passed Leo" }) }),
    expect.objectContaining({ measureId: "planks.seconds", on: "2026-11-02" }),
  ]));
  expect(mocks.cohort).toHaveBeenCalledTimes(1); expect(mocks.friendGames).toHaveBeenCalledTimes(1);
  expect(mocks.pairLock).toHaveBeenCalledExactlyOnceWith(tx, "ava", "leo");
  expect(mocks.authority).toHaveBeenCalledWith({ memberId: "ava", prisma: tx });
  const next = progressSchema.parse(await (await GET(request())).json());
  expect(next.medals).toHaveLength(earned.length);
  const seal = vi.spyOn(crypto, "sealProgressMany");
  mocks.createAwards.mockClear();
  await drain();
  expect(await readAwards("ava")).toEqual(earned);
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(seal).not.toHaveBeenCalled();
  expect(mocks.createAwards).not.toHaveBeenCalled();
  expect(mocks.rooms).not.toHaveBeenCalled();
  // The published input changes, but neither worsening readings nor corrections revoke wins.
  mocks.replica.mockResolvedValue({ browserVaultReplicaRef: { generatedAt: "2026-11-16T13:00:00Z" } });
  const snapshot = healthSnapshot();
  mocks.raw.mockResolvedValue({ ...snapshot, savedAt: "2026-11-16T13:00:00Z", numbers: { ...snapshot.numbers,
    restingHeartRate: { daily: snapshot.numbers.restingHeartRate.daily.map(point => ({ ...point, value: 80 })) } } });
  const games = await mocks.friendGames(); games.amounts.clear();
  await GET(request()); await drain();
  expect(await readAwards("ava")).toEqual(earned);
  expect((await healthState())?.baseline?.value).toBe(74);
});

it("freezes covered health baselines and initializes Steps and Sleep journeys through the same write path", async () => {
  const snapshot = healthSnapshot(), daily = snapshot.numbers.restingHeartRate.daily;
  mocks.raw.mockResolvedValue({ ...snapshot, numbers: { ...snapshot.numbers,
    restingHeartRate: { daily: daily.slice(1) },
    steps: { daily: daily.map(point => ({ ...point, value: point.date < joinedOn ? 6000 : 9000 })) },
    sleep: { daily: daily.slice(2).map(point => ({ ...point, value: point.date < joinedOn ? 480 : 510 })) },
  } });
  mocks.resolve.mockResolvedValue({ from: "A", to: "B", distanceM: 1000, polyline: encodePolyline([[0, 0], [1, 0]]), towns: [], straightLine: false });
  await GET(request()); await drain();
  for (const [id, value] of [["restingHeartRate", 74], ["steps", 6000], ["sleep", 28800]] as const) {
    const lookup = progressLookup("ava", "measure", [id]), row = states.find(row => row.lookup === lookup)!;
    const state = await openProgress<MeasureState>({ memberId: "ava", table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted);
    expect(state.baseline?.value).toBe(value);
    if (id === "steps") expect(state.legs).toHaveLength(1);
  }
  const earned = await readAwards("ava");
  expect(earned).toEqual(expect.arrayContaining([
    expect.objectContaining({ measureId: "steps", kind: "route" }),
    expect.objectContaining({ measureId: "sleep", kind: "time" }),
  ]));
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});

it.each(["authority", "reference", "replica"])("does no health writes without %s", async missing => {
  if (missing === "authority") mocks.authority.mockRejectedValue(denied());
  if (missing === "reference") mocks.replica.mockResolvedValue({ browserVaultReplicaRef: null });
  if (missing === "replica") mocks.raw.mockResolvedValue(null);
  await GET(request()); await drain();
  expect(states).toEqual([]);
  expect((await readAwards("ava")).every(award => award.kind === "friend")).toBe(true);
  if (missing !== "replica") expect(mocks.raw).not.toHaveBeenCalled();
});

it("never settles Friends from pending inputs", async () => {
  const input = await mocks.friendGames(); mocks.friendGames.mockClear();
  mocks.friendGames.mockResolvedValue({ ...input, pending: [{ memberId: "leo", lookup: "pending", text: "40 pushups", kind: "photo", inferred: null }] });
  await GET(request()); await drain();
  expect((await readAwards("ava")).some(award => award.kind === "friend")).toBe(false);
  expect(mocks.inference).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ memberId: "leo" })]), expect.any(Function));
});

it("rereads a no-op Prizes snapshot only when it contains a friend award", async () => {
  await GET(request()); await drain();
  expect(awards.some(row => row.subjectMemberId)).toBe(true);
  mocks.awards.mockClear().mockResolvedValueOnce([...awards]);
  awards = awards.filter(row => !row.subjectMemberId);
  mocks.createAwards.mockClear();
  const view = progressSchema.parse(await (await GET(request())).json());
  expect(view.medals.map(medal => medal.id).sort()).toEqual(awards.map(row => row.lookup).sort());
  expect(mocks.awards).toHaveBeenCalledTimes(2);
  mocks.awards.mockClear();
  expect(progressSchema.parse(await (await GET(request())).json())).toEqual(view);
  expect(mocks.awards).toHaveBeenCalledOnce();
  expect(mocks.createAwards).not.toHaveBeenCalled();
});

const passReads = [
  ["Prizes", () => GET(request())],
  ["Friends", () => friendsGET(new Request("https://example.test/api/game/v1/progress/friends?measure=pushups.reps"))],
] as const;

async function gamesWithDepartingFriend(): Promise<FriendGameSeries> {
  const cohort = await mocks.cohort();
  mocks.cohort.mockResolvedValue({ ...cohort, timeZone: "UTC", people: [
    ...cohort.people, { ...cohort.people[1], memberId: "departing", firstName: "Reed" },
  ] });
  return mocks.friendGames();
}

it.each(passReads)("%s settles a remaining friend's pass despite a departed friend's pending task", async (_page, read) => {
  const games = await gamesWithDepartingFriend();
  games.pending.push({ memberId: "departing", lookup: "unresolved", text: "Balance drill", kind: "photo", inferred: null });
  expect((await read()).status).toBe(200); await drain();
  const passes = (await readAwards("ava")).filter(award => award.kind === "friend" && award.measureId === "pushups.reps");
  expect(passes.map(award => award.subjectMemberId)).toEqual(["leo"]);
});

it.each(passReads)("%s excludes an exercise shared only with a departed friend from pass settlement", async (_page, read) => {
  const games = await gamesWithDepartingFriend();
  games.amounts.set("departing", games.amounts.get("leo")!);
  games.amounts.delete("leo");
  expect((await read()).status).toBe(200); await drain();
  expect((await readAwards("ava")).filter(award => award.kind === "friend")).toEqual([]);
});

it("skips background Friends input work without co-players", async () => {
  const cohort = await mocks.cohort();
  mocks.cohort.mockResolvedValue({ ...cohort, people: cohort.people.filter((person: { me: boolean }) => person.me) });
  await GET(request()); await drain();
  expect(mocks.friendGames).not.toHaveBeenCalled();
  expect(mocks.rooms).not.toHaveBeenCalled();
  expect(mocks.ids).not.toHaveBeenCalled();
  expect((await readAwards("ava")).some(award => award.kind === "friend")).toBe(false);
});

it("schedules the viewer's pending tasks in the foreground and friends' tasks in the background", async () => {
  const own = { memberId: "ava", lookup: "ava-pending", text: "40 pushups", kind: "photo", inferred: null };
  const friend = { ...own, memberId: "leo", lookup: "leo-pending" };
  const games = await mocks.friendGames();
  mocks.friendGames.mockResolvedValue({ ...games, pending: [own, friend] });
  mocks.ownGames.mockResolvedValue({ checkIns: [], measures: [], successors: new Map(), states: new Map(), awards: [], pending: [own] });
  await GET(request());
  expect(mocks.inference.mock.calls.map(call => call[0])).toEqual([[own]]);
  await drain();
  expect(mocks.inference.mock.calls.map(call => call[0])).toEqual([[own], [friend]]);
  await mocks.inference.mock.calls[1][1](tx);
  expect(mocks.pairLock).toHaveBeenCalledExactlyOnceWith(tx, "ava", "leo");
  expect((await readAwards("ava")).some(award => award.kind === "friend")).toBe(false);
});

it("earns exercise passes without consulting sharing rooms", async () => {
  await GET(request()); await drain();
  expect(mocks.rooms).not.toHaveBeenCalled();
  expect((await readAwards("ava")).filter(award => award.kind === "friend")).toHaveLength(2);
});

it.each([0, 1, 2])("seals only missing awards with %s already stored, preserving original facts", async existingCount => {
  const candidates: Candidate[] = ["first", "second"].map(key => ({ key, kind: "total", measureId: "pushups.reps",
    subjectMemberId: null, on: "2026-11-02", data: { value: 100 } }));
  const before = vi.fn();
  await settleAwards("ava", candidates.slice(0, existingCount), before);
  const original = awards.slice();
  const seal = vi.spyOn(crypto, "sealProgressMany");
  mocks.awards.mockClear(); mocks.createAwards.mockClear(); before.mockClear();
  const corrected = candidates.map(candidate => ({ ...candidate, on: "2026-11-16", data: { value: 50 } }));
  await settleAwards("ava", corrected, before);
  expect(mocks.awards).toHaveBeenCalledExactlyOnceWith({ where: { memberId: "ava",
    lookup: { in: candidates.map(candidate => progressLookup("ava", "award", [candidate.key])) } }, select: { lookup: true } });
  expect(seal.mock.calls.flatMap(call => call[1].map(row => row.value))).toEqual(corrected.slice(existingCount));
  expect(awards.slice(0, existingCount)).toEqual(original);
  expect(await readAwards("ava")).toHaveLength(2);
  if (existingCount === 2) {
    expect(seal).not.toHaveBeenCalled();
    expect(mocks.createAwards).not.toHaveBeenCalled();
    expect(before).not.toHaveBeenCalled();
  } else {
    expect(mocks.createAwards).toHaveBeenCalledExactlyOnceWith({ skipDuplicates: true, data: expect.any(Array) });
    expect(before).toHaveBeenCalledExactlyOnceWith(tx);
  }
});

it("returns the Health page while a background receipt commits against the same frozen baseline", async () => {
  await patchMeasureState("ava", "restingHeartRate", {
    baseline: { value: 74, from: "2026-09-23", to: "2026-10-20" },
  }, async () => {});
  const started = deferred(), release = deferred();
  const committed = deferred(), pageWrite = deferred();
  const update = mocks.updateState.getMockImplementation()!;
  mocks.updateState.mockImplementationOnce(async input => {
    started.resolve();
    await release.promise;
    const result = await update(input);
    committed.resolve();
    return result;
  }).mockImplementationOnce(async input => {
    pageWrite.resolve();
    await committed.promise;
    return update(input);
  });
  await GET(request());
  const background = drain();
  await started.promise;
  const page = healthGET(new Request("https://example.test/api/game/v1/progress/health"));
  // If the page tries its own receipt CAS, let the background win that race.
  await Promise.race([page, pageWrite.promise]);
  release.resolve();
  const [response] = await Promise.all([page, background]);
  expect(response.status).toBe(200);
  expect(healthSchema.parse(await response.json()).winCount).toBe(0);
  expect(mocks.updateState).toHaveBeenCalledTimes(1);
  expect((await healthState())?.healthSettlement?.savedAt).toBe(savedAt);
});

it("keeps run days and the settlement receipt from the newest replica", async () => {
  const older = "2026-11-16T08:00:00.000Z";
  const days = [{ date: "2026-11-13", km: 2 }, { date: "2026-11-14", km: 6 }];
  for (const [version, runs] of [[savedAt, days], [older, days.slice(0, 1)]] as const) {
    mocks.replica.mockResolvedValue({ browserVaultReplicaRef: { generatedAt: version } });
    mocks.raw.mockResolvedValue({ ...healthSnapshot(), savedAt: version, runs: { days: runs } });
    await GET(request());
    await drain();
  }
  const lookup = progressLookup("ava", "measure", ["run.meters"]);
  const row = states.find(state => state.lookup === lookup)!;
  const running = await openProgress<MeasureState>({ memberId: "ava", table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted);
  expect(running.vaultRuns).toEqual({ savedAt, days: [["2026-11-13", 2000], ["2026-11-14", 6000]] });
  expect((await healthState())?.healthSettlement?.savedAt).toBe(savedAt);
});

it.each([{ peopleCount: 5000, measureCount: 2 }, { peopleCount: 2, measureCount: 5000 }])(
  "batches 10,000 passes across $peopleCount people and $measureCount measures", async ({ peopleCount, measureCount }) => {
    mocks.raw.mockResolvedValue(null);
    const people = Array.from({ length: peopleCount }, (_, index) => ({
      memberId: index === 0 ? "ava" : `friend-${index}`, firstName: index === 0 ? "Ava" : "Leo",
      avatarUrl: null, me: index === 0, joinedOn, daily: null,
    }));
    const measures = Array.from({ length: measureCount }, (_, index) => `exercise${index}.reps`);
    mocks.cohort.mockResolvedValue({ people });
    mocks.ids.mockResolvedValue({ ids: people.map(person => person.memberId) });
    mocks.friendGames.mockResolvedValue({ pending: [], tasks: new Map(),
      measures: new Map(measures.map(id => [id, friendMeasure(id)])),
      // Each friend played three days; you pass them all on the fourth.
      amounts: new Map(people.map(person => [person.memberId, measures.flatMap(measureId => person.me
        ? [{ measureId, date: addDaysToIsoDate(joinedOn, 3), amount: 4 }]
        : [0, 1, 2].map(day => ({ measureId, date: addDaysToIsoDate(joinedOn, day), amount: 1 })))])),
    });
    await GET(request()); await drain();
    expect(mocks.cohort).toHaveBeenCalledTimes(1);
    expect(mocks.friendGames).toHaveBeenCalledTimes(1);
    expect(mocks.createAwards).toHaveBeenCalledTimes(1);
    expect(mocks.pairLock).toHaveBeenCalledTimes(peopleCount - 1);
    expect(mocks.ids).toHaveBeenCalledTimes(2);
    expect(awards).toHaveLength((peopleCount - 1) * measureCount);
  },
);

it.each(["session", "health", "friendship"])("rechecks %s at commit and leaves no unauthorized facts", async boundary => {
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  if (boundary === "session") mocks.current.mockImplementation(async (_auth, db) => { if (db === tx) throw denied(); });
  if (boundary === "health") mocks.authority.mockImplementation(async ({ prisma }) => { if (prisma === tx) throw denied(); });
  if (boundary === "friendship") mocks.ids.mockImplementation(async (_member, db) => ({ ids: db === tx ? ["ava"] : ["ava", "leo"] }));
  expect((await GET(request())).status).toBe(200); await drain();
  const earned = await readAwards("ava");
  if (boundary !== "friendship") expect(states).toEqual([]);
  if (boundary !== "health") expect(earned.some(award => award.kind === "friend")).toBe(false);
  if (boundary === "health") expect(earned.filter(award => award.kind === "friend")).toHaveLength(2);
  expect(logs).toHaveBeenCalledExactlyOnceWith("PROGRESS_BACKGROUND_SETTLEMENT_FAILED");
});

it("a failed background batch preserves the response, emits only one code and does not save completion", async () => {
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.raw.mockRejectedValue(new Error("synthetic private provider body"));
  mocks.cohort.mockRejectedValue(new Error("synthetic private task"));
  const response = await GET(request()), before = await response.clone().json();
  await drain();
  expect(await response.json()).toEqual(before); expect(response.status).toBe(200);
  expect(states).toEqual([]); expect(awards).toEqual([]);
  expect(logs).toHaveBeenCalledExactlyOnceWith("PROGRESS_BACKGROUND_SETTLEMENT_FAILED");
});

it("does not mark partial health work complete when award insertion fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const snapshot = healthSnapshot();
  mocks.raw.mockResolvedValue({ ...snapshot, numbers: { ...snapshot.numbers,
    sleep: { daily: snapshot.numbers.restingHeartRate.daily.map(point => ({ ...point, value: 480 })) },
  } });
  mocks.createAwards.mockRejectedValueOnce(new Error("synthetic write failure"));
  await GET(request()); await drain();
  expect((await healthState())?.baseline?.value).toBe(74);
  expect((await healthState())?.healthSettlement).toBeUndefined();
  await GET(request()); await drain();
  expect((await healthState())?.healthSettlement?.savedAt).toBe(savedAt);
  expect(mocks.raw).toHaveBeenCalledTimes(2);
});

const receipt = { savedAt, checkedAt: savedAt, timeZone: "UTC", profileTimeZone: "UTC" };
it.each([
  { name: "same publication and dates", receipt, publication: savedAt, zone: "UTC", now: "2026-11-16T23:00:00Z", current: true },
  { name: "new publication", receipt, publication: "2026-11-16T13:00:00Z", zone: "UTC", now: savedAt, current: false },
  { name: "member midnight", receipt: { ...receipt, profileTimeZone: "Asia/Tokyo" }, publication: savedAt, zone: "Asia/Tokyo", now: "2026-11-16T15:00:00Z", current: false },
  { name: "vault midnight", receipt: { ...receipt, timeZone: "Asia/Tokyo" }, publication: savedAt, zone: "UTC", now: "2026-11-16T15:00:00Z", current: false },
  { name: "settled Steps boundary", receipt: { ...receipt, checkedAt: "2026-11-16T07:59:59Z" }, publication: savedAt, zone: "UTC", now: "2026-11-16T08:00:00Z", current: false },
  { name: "profile time zone change", receipt, publication: savedAt, zone: "America/New_York", now: savedAt, current: false },
  { name: "no receipt", receipt: undefined, publication: savedAt, zone: "UTC", now: savedAt, current: false },
])("health cost gate: $name", ({ receipt, publication, zone, now, current }) => {
  expect(healthSettlementCurrent(receipt, publication, zone, new Date(now))).toBe(current);
});

it("opens Health awards once on a settled replica and keeps the ordered wins", async () => {
  const read = async () => healthSchema.parse(await (await healthGET(request())).json());
  const first = await read();
  expect(first.winCount).toBe(0);
  expect(mocks.profile).toHaveBeenCalledOnce();
  expect(mocks.awards).toHaveBeenCalledTimes(1);
  mocks.awards.mockClear();
  mocks.createAwards.mockClear();
  const opened = vi.spyOn(crypto, "openProgressMany");
  expect(await read()).toEqual(first);
  expect(mocks.awards).toHaveBeenCalledOnce();
  expect(opened.mock.calls.filter(([rows]) => rows[0]?.table === "game_progress_award")).toHaveLength(0);
  expect(mocks.createAwards).not.toHaveBeenCalled();
});

it("logs the aggregate request once for Prizes and Health, including invalid requests", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  expect((await GET(request())).status).toBe(200);
  expect((await healthGET(request())).status).toBe(200);
  expect((await healthGET(new Request("https://example.test/progress/health?ava=leo"))).status).toBe(400);
  const entries = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(entries.map(row => row.route)).toEqual(["/api/game/v1/progress", "/api/game/v1/progress/health", "/api/game/v1/progress/health"]);
  for (const row of entries) expect(row).toMatchObject({ event: "game.progress.read.timing", pill: "all",
    totalMs: expect.any(Number), phaseMs: { auth: expect.any(Number), awards: expect.any(Number), render: expect.any(Number) } });
  expect(JSON.stringify(entries)).not.toMatch(/ava|leo|birthYear|memberId/i);
});

it("retries a missing Steps map on the same replica after settling other awards", async () => {
  const snapshot = healthSnapshot();
  mocks.raw.mockResolvedValue({ ...snapshot, numbers: { ...snapshot.numbers,
    steps: { daily: snapshot.numbers.restingHeartRate.daily.map(point => ({ ...point, value: 5900 })) } } });
  mocks.resolve.mockRejectedValueOnce(new Error("Map unavailable")).mockResolvedValue({
    from: "A", to: "B", distanceM: 1000, polyline: encodePolyline([[0, 0], [1, 0]]), towns: [], straightLine: false });
  await GET(request()); await drain();
  expect((await healthState())?.baseline?.value).toBe(74);
  expect((await healthState())?.healthSettlement).toBeUndefined();
  await GET(request()); await drain();
  expect((await healthState())?.healthSettlement).toBeDefined();
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
});

it("paints Running's map on the Progress read, as the Health read paints Steps'", async () => {
  const polyline = encodePolyline([[40.71, -74.01], [39.95, -75.17], [38.9, -77.04]]);
  mocks.resolve.mockResolvedValue({ from: "New York", to: "Washington", distanceM: 360_000, polyline, towns: [], straightLine: false });
  mocks.ownGames.mockImplementation(async () => ({ checkIns: [], successors: new Map(), states: new Map(), pending: [], awards: await readAwards("ava"),
    measures: [{ ...describeMeasure("run.meters", "run", "Run 5 km"), pending: false, gameOn: true, needsPerDay: false,
      amounts: [{ measureId: "run.meters", date: "2026-11-14", amount: 5000 }] }] }));
  const card = mapKey(polyline, "card");
  mocks.artRows.mockResolvedValue(new Map([[card, { key: card, status: "ready", startedAt: new Date(savedAt) }]]));
  const view = progressSchema.parse(await (await GET(request())).json());
  expect(view.measures.find(measure => measure.id === "run.meters")?.route).toMatchObject({ mapArt: { state: "ready" }, drawerMapArt: null });
  expect(mocks.ensureArt).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ key: mapKey(polyline, "drawer"), kind: "map" })]), expect.any(Map));
});
