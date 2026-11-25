import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FriendGameSeries } from "@/src/lib/game/progress/friend-games";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  profiles: vi.fn(), profile: vi.fn(), blocks: vi.fn(), games: vi.fn(), open: vi.fn(),
  current: vi.fn(), friends: vi.fn(), after: vi.fn(), settle: vi.fn(), inference: vi.fn(),
  health: vi.fn(), rooms: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  gameProfile: { findMany: mocks.profiles, findUnique: mocks.profile }, gameBlock: { findMany: mocks.blocks },
}) }));
vi.mock("@/src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async () => ({ member: { id: "viewer" } }), assertGameMemberAuthCurrentTx: mocks.current,
}));
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: mocks.open }));
vi.mock("@/src/lib/game/progress/friend-games", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/friend-games")>(), readFriendGameSeries: mocks.games,
}));
vi.mock("@/src/lib/game/progress/friends-reader", () => ({ readProgressFriends: mocks.friends }));
vi.mock("@/src/lib/game/progress/awards", () => ({ settleAwards: mocks.settle }));
vi.mock("@/src/lib/game/progress/series", async original => ({
  ...await original<typeof import("@/src/lib/game/progress/series")>(), scheduleInference: mocks.inference,
}));
vi.mock("@/src/lib/game/progress/friend-health", () => ({ readFriendHealthSeries: mocks.health }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));

import { GET } from "../app/api/game/v1/progress/friends/route";
import { friendsSchema } from "@/src/lib/game/progress/contract";
import { friendMeasure } from "@/src/lib/game/progress/friend-games";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type Profile = {
  memberId: string; firstNameEncrypted: string; photoKey: string | null; timeZone: string;
  everyoneJoinedAt: Date | null; member: { suspendedAt: Date | null };
};
type ProfileQuery = {
  where: { memberId?: { in?: string[]; gt?: string }; everyoneJoinedAt?: { not: null }; member?: { suspendedAt: null } };
  select: Record<string, unknown>; take?: number;
};
let profiles: Profile[];
let blocks: { blockerMemberId: string; blockedMemberId: string }[];
let series: FriendGameSeries;
const date = "2026-11-04";
const peer = (index: number) => `peer-${String(index).padStart(2, "0")}`;
const request = (query = "measure=pushups.reps&scope=everyone", signal?: AbortSignal) =>
  new Request(`https://example.test/api/game/v1/progress/friends?${query}`, { signal });
const profile = (memberId: string): Profile => ({ memberId, firstNameEncrypted: `sealed-${memberId}`,
  photoKey: null, timeZone: "UTC", everyoneJoinedAt: new Date("2026-11-12T12:00:00Z"), member: { suspendedAt: null } });
const names = (rows: { memberId: string }[]) => rows.map(row => row.memberId === "viewer" ? "Rill" : `Player ${row.memberId.slice(-2)}`);
const own = () => profiles.find(row => row.memberId === "viewer")!;
const subject = () => profiles.find(row => row.memberId === peer(5))!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  profiles = [profile("viewer"), ...Array.from({ length: 10 }, (_, index) => profile(peer(index + 1)))];
  blocks = [];
  series = { windowed: true, amounts: new Map(profiles.map((row, index) => [row.memberId,
    [{ measureId: "pushups.reps", date, amount: index === 0 ? 55 : (11 - index) * 10 }]])),
    measures: new Map([["pushups.reps", friendMeasure("pushups.reps")]]), pending: [],
    tasks: new Map([["viewer", new Map([["pushups.reps", { date, text: "Synthetic private task" }]])]]) };
  mocks.profile.mockImplementation(({ where }: { where: { memberId: string } }) =>
    profiles.find(row => row.memberId === where.memberId) ?? null);
  mocks.profiles.mockImplementation(({ where, take }: ProfileQuery) => profiles.filter(row =>
    (!where.memberId?.in || where.memberId.in.includes(row.memberId)) &&
    (!where.memberId?.gt || row.memberId > where.memberId.gt) &&
    (!where.everyoneJoinedAt || row.everyoneJoinedAt !== null) &&
    (!where.member || row.member.suspendedAt === null))
    .sort((a, b) => a.memberId.localeCompare(b.memberId)).slice(0, take));
  mocks.blocks.mockImplementation(() => blocks);
  mocks.games.mockImplementation(async () => series);
  mocks.open.mockImplementation(async (rows: { memberId: string }[]) => names(rows));
});

afterEach(() => {
  for (const effect of [mocks.friends, mocks.after, mocks.settle, mocks.inference, mocks.health, mocks.rooms]) {
    expect(effect).not.toHaveBeenCalled();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["range=week", "range=all", "with=peer-05", "range=month&with=peer-05"])(
  "rejects an unrestricted Everyone query (%s) before private reads", async extra => {
    expect((await GET(request(`measure=pushups.reps&scope=everyone&${extra}`))).status).toBe(400);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
    expect(mocks.games).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

it.each(["steps", "sleep", "steps.steps", "sleep.seconds", "custom.reps", "pushups.days", "pushups", "pushups.reps.extra"])(
  "rejects ineligible %s before private reads", async measure => {
    expect((await GET(request(`measure=${measure}&scope=everyone`))).status).toBe(404);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
    expect(mocks.games).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

it("requires current membership before loading anyone's games or names", async () => {
  own().everyoneJoinedAt = null;
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "EVERYONE_NOT_JOINED" } });
  expect(mocks.games).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("returns only the three positions on each side and their public fields", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const raw = await response.json();
  const body = friendsSchema.parse(raw);
  const visible = [peer(3), peer(4), peer(5), "viewer", peer(6), peer(7), peer(8)];
  expect(body.rows.map(row => row.memberId)).toEqual(visible);
  expect(body.chart.map(line => line.memberId)).toEqual(visible.slice(0, 4));
  expect(body.chart.map(line => line.points)).toEqual([80, 70, 60, 55].map(total => [[date, total]]));
  expect(body).toMatchObject({ scope: "everyone", everyoneJoined: true, range: "month", incomplete: false,
    shareAsk: false, shareAudience: [], departureNotice: null, challenge: null });
  for (const row of raw.rows) {
    expect(Object.keys(row).sort()).toEqual(["avatarUrl", "firstName", "invited", "joinedOn", "me", "memberId", "private", "rank", "total"]);
    expect(row).toMatchObject({ rank: null, joinedOn: null, private: false, invited: false });
  }
  expect(JSON.stringify(raw)).not.toMatch(/Synthetic private task|sealed-|everyoneJoinedAt|timeZone/);
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.open.mock.calls[0][0].map((row: { memberId: string }) => row.memberId).sort()).toEqual([...visible].sort());
  const identityReads = mocks.profiles.mock.calls.map(([query]) => query as ProfileQuery)
    .filter(query => query.select.firstNameEncrypted);
  expect(identityReads).toHaveLength(1);
  expect(identityReads[0].take).toBeLessThanOrEqual(7);
  expect(identityReads[0].where.memberId?.in?.sort()).toEqual([...visible].sort());
  expect(mocks.current).toHaveBeenCalledOnce();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(body.pills).toContainEqual(expect.objectContaining({ id: "pushups.reps", everyone: true }));
  expect(body.pills.filter(pill => ["steps", "sleep"].includes(pill.id)).map(pill => pill.everyone)).toEqual([false, false]);
});

it("bounds tied groups by position instead of returning the entire tied rank", async () => {
  for (const [memberId, amounts] of series.amounts) {
    amounts[0].amount = memberId === "viewer" ? 55 : memberId <= peer(7) ? 60 : 50;
  }
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.rows.map(row => row.memberId)).toEqual([peer(5), peer(6), peer(7), "viewer", peer(8), peer(9), peer(10)]);
  expect(body.chart.map(line => line.memberId)).toEqual([peer(5), peer(6), peer(7), "viewer"]);
  expect(mocks.open.mock.calls[0][0]).toHaveLength(7);
});

it("keeps a joined viewer with no exercise history while omitting zero-total peers", async () => {
  series.amounts.delete("viewer");
  series.amounts.set(peer(10), [{ measureId: "pushups.reps", date, amount: 0 }]);
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.rows.map(row => row.memberId)).toEqual([peer(7), peer(8), peer(9), "viewer"]);
  expect(body.rows.at(-1)).toMatchObject({ me: true, rank: null, total: { value: 0 } });
  expect(body.chart.at(-1)).toEqual({ memberId: "viewer", points: [] });
});

it.each(["games", "names"])("returns 403 if the viewer leaves during private %s reads", async stage => {
  if (stage === "games") mocks.games.mockImplementationOnce(async () => { own().everyoneJoinedAt = null; return series; });
  else mocks.open.mockImplementationOnce(async (rows: { memberId: string }[]) => { own().everyoneJoinedAt = null; return names(rows); });
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "EVERYONE_NOT_JOINED" } });
});

it.each(["left", "suspended", "blocked", "blockedBy"])("drops a subject who becomes %s while names open", async change => {
  mocks.open.mockImplementationOnce(async (rows: { memberId: string }[]) => {
    if (change === "left") subject().everyoneJoinedAt = null;
    if (change === "suspended") subject().member.suspendedAt = new Date();
    if (change === "blocked") blocks = [{ blockerMemberId: "viewer", blockedMemberId: peer(5) }];
    if (change === "blockedBy") blocks = [{ blockerMemberId: peer(5), blockedMemberId: "viewer" }];
    return names(rows);
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.rows.map(row => row.memberId)).not.toContain(peer(5));
  expect(body.chart.map(line => line.memberId)).not.toContain(peer(5));
  expect(body.rows.some(row => row.me)).toBe(true);
  expect(body.rows.length).toBeLessThanOrEqual(7);
  expect(body.chart.length).toBeLessThanOrEqual(4);
});

it("rechecks the authenticated session before returning the board", async () => {
  mocks.current.mockRejectedValueOnce(hostedOnboardingError({ code: "SESSION_EXPIRED", httpStatus: 401, message: "Sign in again." }));
  expect((await GET(request())).status).toBe(401);
});

it("threads the request signal and month through private game and name reads", async () => {
  const input = request();
  expect((await GET(input)).status).toBe(200);
  expect(mocks.games).toHaveBeenCalledWith(expect.any(Array), expect.anything(),
    { viewer: "viewer", period: { from: "2026-11-01", to: "2026-11-19" } }, input.signal);
  expect(mocks.open).toHaveBeenCalledWith(expect.any(Array), input.signal);
});

it("never returns a partial board after cancellation during private reads", async () => {
  const controller = new AbortController();
  mocks.open.mockImplementationOnce(async (rows: { memberId: string }[]) => { controller.abort(); return names(rows); });
  expect((await GET(request(undefined, controller.signal))).status).not.toBe(200);
});

it("records the Everyone scope without identities in progress timing", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  expect((await GET(request())).status).toBe(200);
  const events = info.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(events).toContainEqual(expect.objectContaining({ event: "game.progress.read.timing", scope: "everyone", pill: "pushups.reps" }));
  expect(JSON.stringify(events)).not.toMatch(/viewer|peer-|sealed-|Rill/);
});


it("pages a large cohort while opening only the selected identities", async () => {
  profiles = [profile("viewer"), ...Array.from({ length: 503 }, (_, index) => profile(`member-${String(index).padStart(4, "0")}`))];
  series.amounts = new Map(profiles.map((row, index) => [row.memberId,
    [{ measureId: "pushups.reps", date, amount: index === 0 ? 250 : index }]]));
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = friendsSchema.parse(await response.json());
  expect(body.rows).toHaveLength(7);
  expect(body.chart).toHaveLength(4);
  const cohortReads = mocks.profiles.mock.calls.map(([query]) => query as ProfileQuery)
    .filter(query => !query.select.firstNameEncrypted);
  expect(cohortReads).toHaveLength(3); // Two initial pages and one selected-subject recheck.
  expect(cohortReads.every(query => query.take === 500)).toBe(true);
  expect(cohortReads[1].where.memberId?.gt).toBeDefined();
  expect(mocks.open.mock.calls[0][0]).toHaveLength(7);
});

it("keeps the pill catalog independent of other members' exercises", async () => {
  series.windowed = undefined;
  series.amounts.get("viewer")!.push({ measureId: "squats.reps", date, amount: 12 });
  series.measures.set("squats.reps", friendMeasure("squats.reps"));
  const body = friendsSchema.parse(await (await GET(request())).json());
  expect(body.pills.map(pill => pill.id)).toContain("squats.reps");
});
