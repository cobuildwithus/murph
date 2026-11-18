import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  board: vi.fn(), replica: vi.fn(),
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
vi.mock("@/src/lib/device-sync/companion-numbers", () => ({ readCompanionHealthSeries: mocks.replica }));
vi.mock("@/src/lib/hosted-groups/group-store", () => ({ readHostedGroupBoardData: mocks.board }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));
import { GET } from "../app/api/game/v1/progress/friends/route";
import { friendsSchema } from "@/src/lib/game/progress/contract";
import { getHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const request = (query = "measure=pushups.reps", units = "us") => new Request(`https://example.test/api/game/v1/progress/friends?${query}`,
  { headers: { "X-Murph-Client-Units": units } });
const game = (id: string, memberIds: string[]) => ({ id, wordsOwnerMemberId: memberIds[0],
  terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] },
  termsWordsEncrypted: JSON.stringify({ v: 1, versions: [{ n: 1, tasks: memberIds.map((memberId, seat) => ({ seat, text: `${memberId === "ava" ? 40 : 30} pushups daily` })), stakes: [] }] }),
  players: memberIds.map((memberId, seat) => ({ memberId, seat, dayOne: new Date("2026-11-01T00:00:00Z") })),
});
const entry = (id: string, gameId: string, memberId: string, dayIndex: number, count: number, attempt = 1) => ({
  id, gameId, memberId, kind: "reps", dayIndex, attempt, payloadEncrypted: JSON.stringify({ exercise: "pushups", count, reps: [] }),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.openGameTexts.mockImplementation(async (rows: { value: string }[]) => rows.map(row => row.value));
  mocks.cohort.mockResolvedValue({ incomplete: false, departureNotice: null, timeZone: "UTC", people: [
    { memberId: "ava", firstName: "Ava", avatarUrl: null, me: true, joinedOn: "2026-10-21", daily: null },
    { memberId: "leo", firstName: "Leo", avatarUrl: null, me: false, joinedOn: "2026-10-21", daily: null },
  ] });
  mocks.rooms.mockResolvedValue({ rooms: [], incomplete: false });
  mocks.ids.mockResolvedValue({ ids: ["ava", "leo"], incomplete: false });
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

it("reads Friends inside the request's root unwrap cache", async () => {
  mocks.games.mockImplementationOnce(async () => {
    expect(getHostedDomainRootUnwrapCache()).toBeDefined();
    return [game("shared", ["ava", "leo"]), game("other-game", ["leo"])];
  });
  expect((await GET(request())).status).toBe(200);
  expect(mocks.rooms).not.toHaveBeenCalled();
  expect(mocks.ids).toHaveBeenCalledOnce();
});

it("starts games and rooms together and reads health after rooms while games are pending", async () => {
  let finishGames!: () => void, finishRooms!: () => void;
  mocks.games.mockImplementationOnce(() => new Promise(resolve => { finishGames = () => resolve([]); }));
  mocks.rooms.mockImplementationOnce(() => new Promise(resolve => { finishRooms = () => resolve({ rooms: [], incomplete: false }); }));
  mocks.entries.mockResolvedValue([]);
  mocks.health.mockResolvedValue({ people: [], rooms: [], incomplete: false });
  const response = GET(request("measure=steps"));
  await vi.waitFor(() => {
    expect(mocks.games).toHaveBeenCalledOnce();
    expect(mocks.rooms).toHaveBeenCalledOnce();
  });
  expect(mocks.health).not.toHaveBeenCalled();
  finishRooms();
  await vi.waitFor(() => expect(mocks.health).toHaveBeenCalledOnce());
  finishGames();
  expect((await response).status).toBe(200);
});

it("returns the game failure even if health fails first", async () => {
  let failGames!: () => void;
  mocks.games.mockImplementationOnce(() => new Promise((_resolve, reject) => { failGames = () => reject(new Error()); }));
  mocks.health.mockRejectedValueOnce(hostedOnboardingError({ code: "CONSENT_REQUIRED", httpStatus: 403, message: "Consent required." }));
  const response = GET(request("measure=steps"));
  await vi.waitFor(() => expect(mocks.health).toHaveBeenCalledOnce());
  failGames();
  const result = await response;
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({ error: { code: "PROGRESS_FRIENDS_UNAVAILABLE", retryable: true } });
});

it("rejects a missing exercise without reading rooms", async () => {
  mocks.rooms.mockRejectedValueOnce(new Error());
  expect((await GET(request("measure=unknown.reps"))).status).toBe(404);
  expect(mocks.rooms).not.toHaveBeenCalled();
});

it("reads only the selected Steps board and own replica while retaining the full sharing audience", async () => {
  const { readFriendHealthSeries } = await vi.importActual<typeof import("@/src/lib/game/progress/friend-health")>("@/src/lib/game/progress/friend-health");
  mocks.health.mockImplementationOnce(readFriendHealthSeries);
  const cohort = await mocks.cohort();
  const people = [...cohort.people, { ...cohort.people[1], memberId: "sam", firstName: "Sam" }];
  mocks.cohort.mockResolvedValue({ ...cohort, people });
  mocks.ids.mockResolvedValue({ ids: ["ava", "leo", "sam"], incomplete: false });
  mocks.rooms.mockResolvedValue({ incomplete: false, rooms: [
    { otherMemberId: "leo", runtimeMemberId: "room-leo", shared: ["steps"] },
    { otherMemberId: "sam", runtimeMemberId: "room-sam", shared: [] },
  ] });
  const date = "2026-11-10";
  mocks.replica.mockResolvedValue({ numbers: { steps: { daily: [{ date, value: 4000 }] } } });
  mocks.board.mockResolvedValue({ people: [{ memberId: "leo", projections: [null, null, {
    state: "available", records: [{ recordKey: "steps", data: { date, metricKey: "steps", value: 5000, unit: "steps" } }],
  }] }] });
  const body = friendsSchema.parse(await (await GET(request("measure=steps&with=leo"))).json());
  expect(mocks.board).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ otherId: "leo", otherMetric: "steps" }));
  expect(mocks.replica.mock.calls.map(call => call[2])).toEqual([["steps"]]);
  expect(mocks.rooms.mock.calls).toEqual([["ava", ["leo", "sam"], false], ["ava", ["leo", "sam"]]]);
  expect(body.rows.map(row => [row.memberId, row.total?.value, row.rank])).toEqual([["leo", 5000, 1], ["ava", 4000, 2]]);
  expect(body.chart).toEqual([{ memberId: "leo", points: [[date, 5000]] }, { memberId: "ava", points: [[date, 4000]] }]);
  expect(body.shareAudience.map(person => person.memberId)).toEqual(["leo", "sam"]);
  expect(body.shareAsk).toBe(true);
  expect(body.incomplete).toBe(false);
});

it("counts a friend's other games, merges same-day amounts and counts a retake once", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.incomplete).toBe(false);
  expect(body.rows.map(row => [row.memberId, row.total?.value, row.rank])).toEqual([["ava", 320, 1], ["leo", 250, 2]]);
  expect(body.chart.find(line => line.memberId === "leo")?.points).toEqual([["2026-11-01", 250]]);
  expect(JSON.stringify(body)).not.toMatch(/other-game|30 pushups daily|payloadEncrypted/);
  expect(body.challenge).toEqual({ task: "40 pushups daily", category: "strength" });
  expect(mocks.games.mock.calls[0][0].where.players.some).toEqual({ memberId: { in: ["ava", "leo"] } });
  expect(mocks.settle).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  // Leo has played one day, so passing him isn't a medal yet.
  expect(mocks.settle.mock.calls[0][1]).toEqual([]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("challenges with your task from the latest day you played the exercise", async () => {
  const earlier = { ...game("earlier", ["ava"]), players: [{ memberId: "ava", seat: 0, dayOne: new Date("2026-10-20T00:00:00Z") }] };
  earlier.termsWordsEncrypted = earlier.termsWordsEncrypted.replace("40 pushups daily", "100 pushups");
  mocks.games.mockResolvedValue([game("shared", ["ava", "leo"]), earlier]);
  mocks.entries.mockResolvedValue([entry("later", "shared", "ava", 1, 200), entry("old", "earlier", "ava", 0, 100)]);
  expect(friendsSchema.parse(await (await GET(request())).json()).challenge?.task).toBe("40 pushups daily");
});

it.each([["us", "1 mi"], ["metric", "1.6 km"]])("renders ranked distance in requested %s units", async (units, text) => {
  mocks.entries.mockResolvedValue(["ava", "leo"].map((memberId, index) => ({
    ...entry(memberId, "shared", memberId, 0, 0), kind: "route",
    payloadEncrypted: JSON.stringify({ activity: "walk", distanceM: 1609.344 * (index + 1), durationS: 1800, polyline: "" }),
  })));
  const body = friendsSchema.parse(await (await GET(request("measure=walk.meters", units))).json());
  expect(body.rows.find(row => row.me)?.total).toEqual({ value: 1609.344, unit: "meters", text });
  expect(body).not.toHaveProperty("next");
  expect(body.challenge?.category).toBe("move");
  expect(body.chart.find(line => line.memberId === "ava")?.points).toEqual([["2026-11-01", 1609.344]]);
});

it.each(["games", "entries"])("marks a capped %s input incomplete and settles nothing", async cap => {
  if (cap === "games") mocks.games.mockResolvedValue(Array.from({ length: 501 }, () => game("shared", ["ava", "leo"])));
  else mocks.entries.mockResolvedValue(Array.from({ length: 10001 }, () => entry("one", "shared", "ava", 0, 1)));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ incomplete: true, rows: [], chart: [] });
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});

it("withholds a friend blocked while loading private game inputs", async () => {
  mocks.ids.mockResolvedValue({ ids: ["ava"], incomplete: false });
  const response = await GET(request());
  const body = friendsSchema.parse(await response.json());
  expect(body.rows.map(row => row.memberId)).toEqual(["ava"]);
  expect(mocks.settle).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
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

it("shows pending friends without settling them as zero-amount opponents", async () => {
  mocks.entries.mockResolvedValue([{ ...entry("photo", "shared", "leo", 0, 0), kind: "photo", payloadEncrypted: null }]);
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.incomplete).toBe(false);
  expect(body.rows.map(row => [row.memberId, row.total?.value])).toEqual([["ava", 0], ["leo", 0]]);
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
  expect(friendsSchema.parse(await response.json())).toMatchObject({ incomplete: true, rows: [], chart: [] });
  expect(mocks.settle).not.toHaveBeenCalled();
});

it.each(["steps", "sleep"])("returns every ranked %s line and leaves private friends off the board", async measure => {
  const people = ["Sam", "Maya", "Leo", "Ava", "Leo", "Maya"].map((firstName, index) => ({
    memberId: firstName === "Ava" ? "ava" : `friend-${index}`, firstName, avatarUrl: null, me: firstName === "Ava",
    joinedOn: "2026-10-21", daily: [{ date: "2026-11-01", amount: (6 - index) * 1000 }],
  }));
  const cohort = await mocks.cohort();
  mocks.cohort.mockResolvedValue({ ...cohort, people });
  mocks.ids.mockResolvedValue({ ids: people.map(person => person.memberId), incomplete: false });
  mocks.health.mockResolvedValue({ people, rooms: [], incomplete: false });
  const body = friendsSchema.parse(await (await GET(request(`measure=${measure}`))).json());
  expect(body.chart.map(line => line.memberId)).toEqual(people.map(person => person.memberId));
  expect(body.rows.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(body.incomplete).toBe(false);
  expect(mocks.settle).not.toHaveBeenCalled();

  mocks.health.mockResolvedValue({ people: people.map((person, index) => index === people.length - 1 ? { ...person, daily: null } : person), rooms: [], incomplete: false });
  const privateBody = friendsSchema.parse(await (await GET(request(`measure=${measure}`))).json());
  expect(privateBody.rows.map(row => row.memberId)).toEqual(people.slice(0, -1).map(person => person.memberId));
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

it("keeps the response and refuses the deferred pass if a friend leaves before commit", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.settle).not.toHaveBeenCalled();
    mocks.ids.mockResolvedValue({ ids: ["ava"], incomplete: false });
    await mocks.after.mock.calls[0][0]();
    expect(mocks.current).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledExactlyOnceWith("PROGRESS_BACKGROUND_SETTLEMENT_FAILED");
  } finally { log.mockRestore(); }
});

it("logs foreground counts once per request and omits drawer identity and custom pill text", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const { readFriendHealthSeries } = await vi.importActual<typeof import("@/src/lib/game/progress/friend-health")>("@/src/lib/game/progress/friend-health");
    mocks.health.mockImplementationOnce(readFriendHealthSeries);
    mocks.rooms.mockResolvedValue({ rooms: [{ otherMemberId: "leo", runtimeMemberId: "room", shared: [] }], incomplete: false });
    expect((await GET(request("measure=steps&with=leo"))).status).toBe(200);
    expect((await GET(request("measure=ava.reps"))).status).toBe(404);
    expect((await GET(request())).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(3);
    const [steps, custom, exercise] = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(steps).toMatchObject({ route: "/api/game/v1/progress/friends", pill: "steps", totalMs: expect.any(Number),
      counts: { games: 2, entries: 5, friends: 1, boards: 1 } });
    expect(custom.pill).toBe("exercise");
    expect(exercise.pill).toBe("pushups.reps");
    expect(Object.keys(steps).sort()).toEqual(["counts", "event", "phaseMs", "pill", "route", "totalMs"]);
    expect(Object.values(steps.phaseMs).every(ms => typeof ms === "number" && ms >= 0)).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ava|leo|with=|pushups daily/i);
  } finally { log.mockRestore(); }
});

it("withholds the drawer and a superseded departure notice on the final cohort check", async () => {
  const cohort = await mocks.cohort();
  mocks.cohort.mockResolvedValue({ ...cohort, departure: { nameEncrypted: "old" }, departureNotice: "Sam left." });
  mocks.ids.mockResolvedValue({ ids: ["ava"], incomplete: false, departure: { nameEncrypted: "new" } });
  expect((await GET(request("measure=pushups.reps&with=leo"))).status).toBe(404);
  const view = friendsSchema.parse(await (await GET(request())).json());
  expect(view.departureNotice).toBeNull();
  expect(view.chart.map(row => row.memberId)).toEqual(["ava"]);
});
