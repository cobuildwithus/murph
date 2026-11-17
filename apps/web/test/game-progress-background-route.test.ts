import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), current: vi.fn(), authority: vi.fn(), replica: vi.fn(), raw: vi.fn(),
  ownGames: vi.fn(), friendGames: vi.fn(), cohort: vi.fn(), ids: vi.fn(), rooms: vi.fn(),
  pairLock: vi.fn(), resolve: vi.fn(), states: vi.fn(), state: vi.fn(), createState: vi.fn(), updateState: vi.fn(),
  awards: vi.fn(), createAwards: vi.fn(), profile: vi.fn(), transaction: vi.fn(), inference: vi.fn(),
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
vi.mock("@/src/lib/game/progress/pics", () => ({ readProgressPics: async () => ({ incomplete: false, pics: [] }) }));
vi.mock("@/src/lib/game/progress/friend-games", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/friend-games")>(), readFriendGameSeries: mocks.friendGames,
}));
vi.mock("@/src/lib/game/progress/friend-cohort", () => ({ readFriendCohort: mocks.cohort, friendCohortIds: mocks.ids }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));
vi.mock("@/src/lib/game/progress/friend-health", () => ({ readFriendHealthSeries: () => { throw new Error("Background must not read friends' private health."); } }));
vi.mock("@/src/lib/game/blocks", () => ({ lockGamePair: mocks.pairLock }));
vi.mock("@/src/lib/game/progress/mapbox", () => ({ resolveRoute: mocks.resolve }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  gameProfile: { findUnique: mocks.profile, findUniqueOrThrow: mocks.profile },
  gameProgressMeasure: { findMany: mocks.states, findUnique: mocks.state },
  gameProgressAward: { findMany: mocks.awards }, $transaction: mocks.transaction,
}) }));

import { addDaysToIsoDate } from "@murphai/contracts";
import { GET } from "../app/api/game/v1/progress/route";
import { progressSchema } from "@/src/lib/game/progress/contract";
import { openProgress, progressLookup } from "@/src/lib/game/progress/crypto";
import { readAwards } from "@/src/lib/game/progress/awards";
import { healthSettlementCurrent } from "@/src/lib/game/progress/health-reader";
import { encodePolyline } from "@/src/lib/game/progress/route-geometry";
import type { MeasureState } from "@/src/lib/game/progress/state";
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
async function healthState() {
  const lookup = progressLookup("ava", "measure", ["restingHeartRate"]);
  const row = states.find(state => state.lookup === lookup);
  return row ? openProgress<MeasureState>({ memberId: "ava", table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted) : null;
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(savedAt));
  states = []; awards = [];
  mocks.profile.mockResolvedValue({ timeZone: "UTC", createdAt: new Date(`${joinedOn}T12:00:00Z`) });
  mocks.replica.mockResolvedValue({ browserVaultReplicaRef: { generatedAt: savedAt } });
  mocks.raw.mockResolvedValue(healthSnapshot());
  mocks.ownGames.mockResolvedValue({ incomplete: false, measures: [], states: new Map(), awards: [], pending: [] });
  mocks.cohort.mockResolvedValue({ incomplete: false, people: ["Ava", "Leo"].map(firstName => ({
    memberId: firstName.toLowerCase(), firstName, avatarUrl: null, me: firstName === "Ava", invited: false, joinedOn, daily: null,
  })) });
  mocks.ids.mockResolvedValue({ incomplete: false, ids: ["ava", "leo"], invited: [] });
  mocks.rooms.mockResolvedValue({ incomplete: false, rooms: [] });
  const measures = ["pushups.reps", "planks.seconds"];
  const games: FriendGameSeries = { incomplete: false, pending: [], measures: new Map(measures.map(id => [id, friendMeasure(id)])),
    amounts: new Map(["ava", "leo"].map(member => [member, measures.flatMap(measureId => [
      { measureId, date: "2026-11-01", amount: member === "ava" ? 20 : 50 },
      { measureId, date: "2026-11-02", amount: member === "ava" ? 40 : 0 },
    ])])) };
  mocks.friendGames.mockResolvedValue(games);
  mocks.states.mockImplementation(async ({ where }) => states.filter(row => where.lookup.in.includes(row.lookup)));
  mocks.state.mockImplementation(async ({ where }) => states.find(row => row.lookup === where.memberId_lookup.lookup) ?? null);
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
  expect((await healthState())?.baseline).toEqual({ value: 74, from: "2026-09-23", to: "2026-10-20" });
  const earned = await readAwards("ava");
  expect(earned.filter(award => award.kind === "health").map(award => award.data.level).sort()).toEqual([1, 2, 3]);
  expect(earned.some(award => award.kind === "healthAge")).toBe(true);
  expect(earned.filter(award => award.kind === "friend")).toEqual(expect.arrayContaining([
    expect.objectContaining({ measureId: "pushups.reps", on: "2026-11-02", data: expect.objectContaining({ title: "Passed Leo" }) }),
    expect.objectContaining({ measureId: "planks.seconds", on: "2026-11-02" }),
  ]));
  expect(mocks.cohort).toHaveBeenCalledTimes(1); expect(mocks.friendGames).toHaveBeenCalledTimes(1);
  expect(mocks.pairLock).toHaveBeenCalledExactlyOnceWith(tx, "ava", "leo");
  expect(mocks.authority).toHaveBeenCalledWith({ memberId: "ava", prisma: tx });
  const next = progressSchema.parse(await (await GET(request())).json());
  expect(next.medals).toHaveLength(earned.length);
  await drain();
  expect(await readAwards("ava")).toEqual(earned);
  expect(mocks.raw).toHaveBeenCalledTimes(1);
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
    expect.objectContaining({ measureId: "steps", kind: "health" }),
    expect.objectContaining({ measureId: "steps", kind: "route" }),
    expect.objectContaining({ measureId: "sleep", kind: "health" }),
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

it.each(["cohort", "games", "rooms", "current", "pending"])("never settles Friends from %s-incomplete inputs", async boundary => {
  const target = { cohort: mocks.cohort, games: mocks.friendGames, rooms: mocks.rooms, current: mocks.ids, pending: mocks.friendGames }[boundary]!;
  const input = await target(); target.mockClear();
  target.mockResolvedValue({ ...input, ...(boundary === "pending" ? { pending: [{ memberId: "leo", lookup: "pending", text: "40 pushups", kind: "photo", inferred: null }] } : { incomplete: true }) });
  await GET(request()); await drain();
  expect((await readAwards("ava")).some(award => award.kind === "friend")).toBe(false);
  if (boundary === "pending") expect(mocks.inference).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ memberId: "leo" })]), expect.any(Function));
});

it("an incomplete main read schedules no settlement", async () => {
  mocks.ownGames.mockResolvedValue({ incomplete: true, measures: [], states: new Map(), awards: [], pending: [] });
  expect(progressSchema.parse(await (await GET(request())).json()).incomplete).toBe(true);
  expect(mocks.after).not.toHaveBeenCalled();
});

it.each(["session", "health", "friendship"])("rechecks %s at commit and leaves no unauthorized facts", async boundary => {
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  if (boundary === "session") mocks.current.mockImplementation(async (_auth, db) => { if (db === tx) throw denied(); });
  if (boundary === "health") mocks.authority.mockImplementation(async ({ prisma }) => { if (prisma === tx) throw denied(); });
  if (boundary === "friendship") mocks.ids.mockImplementation(async (_member, db) => ({ incomplete: false, invited: [], ids: db === tx ? ["ava"] : ["ava", "leo"] }));
  expect((await GET(request())).status).toBe(200); await drain();
  const earned = await readAwards("ava");
  if (boundary !== "friendship") expect(states).toEqual([]);
  if (boundary !== "health") expect(earned.some(award => award.kind === "friend")).toBe(false);
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
