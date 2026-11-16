import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  health: vi.fn(), openGameTexts: vi.fn(), states: vi.fn(), games: vi.fn(), entries: vi.fn(), tasks: vi.fn(), openTasks: vi.fn(), settle: vi.fn(), rooms: vi.fn(), current: vi.fn(), cohort: vi.fn(), ids: vi.fn(), after: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ game: { findMany: mocks.games },
  gameEntry: { findMany: mocks.entries }, gameProgressTaskMeasure: { findMany: mocks.tasks }, gameProgressMeasure: { findMany: mocks.states } }) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }),
  assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/game/blocks", () => ({ lockGamePair: vi.fn() }));
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: mocks.openGameTexts }));
vi.mock("@/src/lib/game/progress/crypto", () => ({ openProgressMany: mocks.openTasks,
  progressLookup: (memberId: string, _purpose: string, parts: string[]) => [memberId, ...parts].join(":") }));
vi.mock("@/src/lib/game/progress/awards", () => ({ settleAwards: mocks.settle }));
vi.mock("@/src/lib/game/progress/friend-cohort", () => ({ readFriendCohort: mocks.cohort, friendCohortIds: mocks.ids }));
vi.mock("@/src/lib/game/progress/friend-health", () => ({ readFriendHealthSeries: mocks.health }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));
import { GET } from "../app/api/game/v1/progress/friends/route";
import { friendsSchema } from "@/src/lib/game/progress/contract";

const request = (query = "measure=pushups.reps", units = "us") => new Request(`https://example.test/api/game/v1/progress/friends?${query}`,
  { headers: { "X-Murph-Client-Units": units } });
const game = (id: string, memberIds: string[]) => ({ id, wordsOwnerMemberId: memberIds[0],
  terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
  termsWordsEncrypted: JSON.stringify({ v: 1, versions: [{ n: 1, tasks: memberIds.map((_, seat) => ({ seat, text: "40 pushups daily" })), stakes: [] }] }),
  players: memberIds.map((memberId, seat) => ({ memberId, seat, dayOne: new Date("2026-11-01T00:00:00Z") })),
});
const entry = (id: string, gameId: string, memberId: string, dayIndex: number, count: number, attempt = 1) => ({
  id, gameId, memberId, kind: "reps", dayIndex, attempt, payloadEncrypted: JSON.stringify({ exercise: "pushups", count, reps: [] }),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.openGameTexts.mockImplementation(async (rows: { value: string }[]) => rows.map(row => row.value));
  mocks.cohort.mockResolvedValue({ incomplete: false, departureNotice: null, timeZone: "UTC", people: [
    { memberId: "ava", firstName: "Ava", avatarUrl: null, me: true, invited: false, joinedOn: "2026-10-21", daily: null },
    { memberId: "leo", firstName: "Leo", avatarUrl: null, me: false, invited: false, joinedOn: "2026-10-21", daily: null },
  ] });
  mocks.rooms.mockResolvedValue({ rooms: [], incomplete: false });
  mocks.ids.mockResolvedValue({ ids: ["ava", "leo"], invited: [], incomplete: false });
  mocks.games.mockResolvedValue([game("shared", ["ava", "leo"]), game("other-game", ["leo"])]);
  mocks.entries.mockResolvedValue([
    entry("replaced", "shared", "ava", 0, 100), entry("retake", "shared", "ava", 0, 120, 2),
    entry("later", "shared", "ava", 1, 200), entry("shared-leo", "shared", "leo", 0, 50),
    entry("other-leo", "other-game", "leo", 0, 200),
  ]);
  mocks.tasks.mockResolvedValue([]); mocks.states.mockResolvedValue([]); mocks.openTasks.mockResolvedValue([]);
  mocks.settle.mockImplementation(async (_member, _candidates, before) => { await before({}); });
});
afterEach(() => vi.useRealTimers());

it("counts a friend's other games, merges same-day amounts and counts a retake once", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.incomplete).toBe(false);
  expect(body.rows.map(row => [row.memberId, row.total?.value, row.rank])).toEqual([["ava", 320, 1], ["leo", 250, 2]]);
  expect(body.chart.find(line => line.memberId === "leo")?.points).toEqual([["2026-11-01", 250]]);
  expect(JSON.stringify(body)).not.toMatch(/other-game|40 pushups daily|payloadEncrypted/);
  expect(mocks.games.mock.calls[0][0].where.players.some).toEqual({ memberId: { in: ["ava", "leo"] } });
  expect(mocks.settle.mock.calls[0][1]).toEqual([expect.objectContaining({ kind: "friend", subjectMemberId: "leo", on: "2026-11-02" })]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it.each([["us", "1 mi"], ["metric", "1.6 km"]])("renders ranked distance and gaps in requested %s units", async (units, text) => {
  mocks.entries.mockResolvedValue(["ava", "leo"].map((memberId, index) => ({
    ...entry(memberId, "shared", memberId, 0, 0), kind: "route",
    payloadEncrypted: JSON.stringify({ activity: "walk", distanceM: 1609.344 * (index + 1), durationS: 1800, polyline: "" }),
  })));
  const body = friendsSchema.parse(await (await GET(request("measure=walk.meters", units))).json());
  expect(body.rows.find(row => row.me)?.total).toEqual({ value: 1609.344, unit: "meters", text });
  expect(body.next).toEqual({ memberId: "leo", text: `${text} to pass Leo` });
  expect(body.chart.find(line => line.memberId === "ava")?.points).toEqual([["2026-11-01", 1609.344]]);
});

it.each(["games", "entries"])("marks a capped %s input incomplete and settles nothing", async cap => {
  if (cap === "games") mocks.games.mockResolvedValue(Array.from({ length: 501 }, () => game("shared", ["ava", "leo"])));
  else mocks.entries.mockResolvedValue(Array.from({ length: 10001 }, () => entry("one", "shared", "ava", 0, 1)));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ incomplete: true, rows: [], chart: [], next: null });
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it("withholds a friend blocked while loading private game inputs", async () => {
  mocks.ids.mockResolvedValue({ ids: ["ava"], invited: [], incomplete: false });
  const response = await GET(request());
  const body = friendsSchema.parse(await response.json());
  expect(body.rows.map(row => row.memberId)).toEqual(["ava"]);
  expect(mocks.settle.mock.calls[0][1]).toEqual([]);
});

it("uses each untyped post's terms version and group seat override", async () => {
  const shared = game("shared", ["ava", "leo"]);
  shared.terms.versions.push({ n: 2, fromDay: 1, schedule: { count: 7 }, stakes: [] });
  shared.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [
    { n: 1, defaultTask: "20 pushups", tasks: [{ seat: 1, text: "30 pushups" }], stakes: [] },
    { n: 2, defaultTask: "40 pushups", tasks: [{ seat: 1, text: "50 pushups" }], stakes: [] },
  ] });
  mocks.games.mockResolvedValue([shared]);
  mocks.entries.mockResolvedValue(["ava", "leo"].flatMap(memberId => [0, 1].map(dayIndex => ({
    ...entry(`${memberId}-${dayIndex}`, "shared", memberId, dayIndex, 0), kind: "photo", payloadEncrypted: null,
  }))));
  mocks.tasks.mockImplementation(({ where }: { where: { lookup: { in: string[] } } }) => where.lookup.in.map(lookup => ({
    memberId: lookup.split(":")[0], lookup,
    measureEncrypted: JSON.stringify({ name: "pushups", quantity: Number.parseInt(lookup.split(":")[1], 10), unit: "reps" }),
  })));
  mocks.openTasks.mockImplementation((rows: { value: string }[]) => rows.map(row => JSON.parse(row.value)));
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.rows.map(row => [row.memberId, row.total?.value])).toEqual([["leo", 80], ["ava", 60]]);
  expect(mocks.openGameTexts.mock.calls[0][0].map((row: { table: string }) => row.table)).toEqual(["game"]);
});

it("does not settle incomplete inference as a zero-amount opponent", async () => {
  mocks.entries.mockResolvedValue([{ ...entry("photo", "shared", "leo", 0, 0), kind: "photo", payloadEncrypted: null }]);
  expect(await (await GET(request())).json()).toMatchObject({ incomplete: true, rows: [], chart: [] });
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledTimes(1);
});

it("validates range and private drawer identity before reading game amounts", async () => {
  expect((await GET(request("measure=pushups.reps&range=forever"))).status).toBe(400);
  expect((await GET(request("measure=pushups.reps&with=maya"))).status).toBe(404);
  expect(mocks.entries).not.toHaveBeenCalled();
});

it("returns an incomplete health view when the room authority recheck reaches its cap", async () => {
  mocks.health.mockResolvedValue({ people: [], incomplete: true });
  const response = await GET(request("measure=sleep"));
  expect(response.status).toBe(200);
  expect(friendsSchema.parse(await response.json())).toMatchObject({ incomplete: true, rows: [], chart: [], next: null });
  expect(mocks.settle).not.toHaveBeenCalled();
});

it.each(["steps", "sleep"])("returns every ranked %s line while keeping private rows unranked", async measure => {
  const people = ["Sam", "Maya", "Leo", "Ava", "Jordan", "Priya"].map((firstName, index) => ({
    memberId: firstName.toLowerCase(), firstName, avatarUrl: null, me: firstName === "Ava", invited: false,
    joinedOn: "2026-10-21", daily: [{ date: "2026-11-01", amount: (6 - index) * 1000 }],
  }));
  const cohort = await mocks.cohort();
  mocks.cohort.mockResolvedValue({ ...cohort, people });
  mocks.ids.mockResolvedValue({ ids: people.map(person => person.memberId), invited: [], incomplete: false });
  mocks.health.mockResolvedValue({ people, incomplete: false });
  const body = friendsSchema.parse(await (await GET(request(`measure=${measure}`))).json());
  expect(body.chart.map(line => line.memberId)).toEqual(people.map(person => person.memberId));
  expect(body.rows.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(body.incomplete).toBe(false);
  expect(mocks.settle).not.toHaveBeenCalled();

  mocks.health.mockResolvedValue({ people: people.map(person => person.memberId === "priya" ? { ...person, daily: null } : person), incomplete: false });
  const privateBody = friendsSchema.parse(await (await GET(request(`measure=${measure}`))).json());
  expect(privateBody.rows.at(-1)).toMatchObject({ memberId: "priya", private: true, rank: null, total: null });
  expect(privateBody.chart.map(line => line.memberId)).toEqual(people.slice(0, -1).map(person => person.memberId));
});

it("shares BE1's Unicode task key and applies a per-day amount to earlier posts", async () => {
  const shared = game("shared", ["ava", "leo"]);
  shared.termsWordsEncrypted = JSON.stringify({ v: 1, versions: [{ n: 1, defaultTask: "Ｐｕｓｈｕｐｓ　daily", tasks: [], stakes: [] }] });
  mocks.games.mockResolvedValue([shared]);
  mocks.entries.mockResolvedValue(["ava", "leo"].map(memberId => ({ ...entry(memberId, "shared", memberId, 0, 0), kind: "photo", payloadEncrypted: null })));
  mocks.tasks.mockImplementation(({ where }: { where: { lookup: { in: string[] } } }) => where.lookup.in.map(lookup => ({ memberId: lookup.split(":")[0], lookup,
    measureEncrypted: JSON.stringify({ name: "pushups", quantity: null, unit: "days" }) })));
  mocks.states.mockImplementation(({ where }: { where: { lookup: { in: string[] } } }) => where.lookup.in.map(lookup => ({ memberId: lookup.split(":")[0], lookup,
    stateEncrypted: JSON.stringify({ perDay: 40 }) })));
  mocks.openTasks.mockImplementation((rows: { value: string }[]) => rows.map(row => JSON.parse(row.value)));
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.rows.map(row => [row.memberId, row.total?.value])).toEqual([["ava", 40], ["leo", 40]]);
  expect(mocks.tasks.mock.calls[0][0].where.lookup.in).toEqual(["ava:pushups daily:photo", "leo:pushups daily:photo"]);
});


it.each(["pushups.reps", "sleep"])("keeps invited-only friends out of %s totals, charts, awards and sharing", async measure => {
  const cohort = await mocks.cohort();
  cohort.people[1] = { ...cohort.people[1], invited: true, joinedOn: null };
  mocks.cohort.mockResolvedValue(cohort);
  mocks.ids.mockResolvedValue({ ids: ["ava"], invited: [{ memberId: "leo" }], incomplete: false });
  mocks.games.mockResolvedValue([game("mine", ["ava"])]);
  mocks.entries.mockResolvedValue([entry("mine", "mine", "ava", 0, 100)]);
  mocks.health.mockImplementation(async ({ people }: { people: typeof cohort.people }) => ({ people, incomplete: false }));
  const response = await GET(request(`measure=${measure}`));
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.rows.find(row => row.memberId === "leo")).toEqual({ memberId: "leo", firstName: "Leo", avatarUrl: null,
    me: false, invited: true, joinedOn: null, private: false, rank: null, total: null });
  expect(body.chart.some(line => line.memberId === "leo")).toBe(false);
  expect(body.next).toBeNull();
  expect(body.shareAudience).toEqual([]);
  expect(mocks.games.mock.calls[0][0].where.players.some.memberId.in).toEqual(["ava"]);
  expect(mocks.rooms).toHaveBeenCalledWith("ava", []);
  expect(mocks.settle.mock.calls.flatMap(call => call[1])).toEqual([]);
  if (measure === "sleep") expect(mocks.health.mock.calls[0][0].people.map((person: { memberId: string }) => person.memberId)).toEqual(["ava"]);
  else expect(body.pills.map(pill => pill.id)).toContain("pushups.reps");
});

it("removes an invitation cancelled or expired while loading inputs", async () => {
  const cohort = await mocks.cohort();
  cohort.people[1] = { ...cohort.people[1], invited: true, joinedOn: null };
  mocks.cohort.mockResolvedValue(cohort);
  mocks.ids.mockResolvedValue({ ids: ["ava"], invited: [], incomplete: false });
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.rows.map(row => row.memberId)).toEqual(["ava"]);
  expect(body.chart.some(line => line.memberId === "leo")).toBe(false);
});
