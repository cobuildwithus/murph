import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ raw: vi.fn(), shared: vi.fn(), rooms: vi.fn() }));
vi.mock("@/src/lib/device-sync/companion-numbers", () => ({ readCompanionHealthSeries: mocks.raw }));
vi.mock("@/src/lib/hosted-groups/group-store", () => ({ readHostedGroupBoardData: mocks.shared }));
vi.mock("@/src/lib/game/progress/friend-sharing", () => ({ readFriendRooms: mocks.rooms }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }) }));
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { readFriendHealthSeries } from "@/src/lib/game/progress/friend-health";
import type { FriendSeries } from "@/src/lib/game/progress/friends";

const request = new Request("https://example.test/progress/friends?measure=sleep");
const people: FriendSeries[] = ["ava", "leo", "sam"].map((memberId, index) => ({ memberId,
  firstName: ["Ava", "Leo", "Sam"][index], avatarUrl: null, me: memberId === "ava",
  joinedOn: "2026-10-21", daily: null }));
const rooms = [{ gameId: "pair-game", groupId: "pair-group", runtimeMemberId: "pair-room", otherMemberId: "leo", membershipId: null, shared: [] }];
const day = { date: "2026-11-15", value: 420.5, source: "Garmin", observedAt: "2026-11-15T12:00:00Z" };
async function read() {
  return readFriendHealthSeries({ auth: await requireGameMemberAuth(request), people, rooms, metric: "sleep", timeZone: "UTC", signal: request.signal });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.raw.mockResolvedValue({ heightCm: 170, numbers: { sleep: { daily: [day] } } });
  mocks.shared.mockResolvedValue({ people: [{ memberId: "leo", projections: [
    { state: "not_granted", records: [] },
    { state: "available", records: [{ data: { date: day.date, metricKey: "total-sleep-minutes", value: 7.5, unit: "hours" },
      occurredAt: day.observedAt, recordKey: "sleep-day", source: { source: "garmin", label: "Garmin" } }] },
  ] }] });
  mocks.rooms.mockResolvedValue({ rooms, incomplete: false });
});
afterEach(() => vi.useRealTimers());

it("converts raw own minutes and shared-board normalized minutes to seconds once", async () => {
  const { people: result } = await read();
  expect(result[0].daily).toEqual([{ measureId: "sleep", date: day.date, amount: 25230 }]);
  expect(result[1].daily).toEqual([{ date: day.date, amount: 27000 }]);
  expect(result[2].daily).toBeNull(); // A group-only friend has no pair grant.
  expect(JSON.stringify(result)).not.toContain("heightCm");
  expect(mocks.shared).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ otherId: "leo", otherMetric: "sleep" }));
  expect(mocks.raw.mock.calls[0][2]).toEqual(["sleep"]);
});

it("a private grant never returns its records even when stale bytes remain", async () => {
  const shared = await mocks.shared();
  shared.people[0].projections[1].state = "not_granted";
  mocks.shared.mockResolvedValue(shared);
  expect((await read()).people[1].daily).toBeNull();
});

it("removes numbers if the pair room is no longer eligible after decryption", async () => {
  mocks.rooms.mockResolvedValue({ rooms: [], incomplete: false });
  expect((await read()).people[1].daily).toBeNull();
});

it("marks the result incomplete if the post-decryption room read reaches its cap", async () => {
  mocks.rooms.mockResolvedValue({ rooms: [], incomplete: true });
  expect(await read()).toEqual({ people: [], incomplete: true, rooms: [] });
});

it("reads each of 500 pair rooms once, six shared reads at a time", async () => {
  const friends = Array.from({ length: 500 }, (_, index) => ({ ...people[1], memberId: `friend-${index}` }));
  const maximumRooms = friends.map(person => ({ ...rooms[0], otherMemberId: person.memberId, runtimeMemberId: `room-${person.memberId}` }));
  mocks.rooms.mockResolvedValue({ rooms: maximumRooms, incomplete: false });
  let active = 0, peak = 0;
  mocks.shared.mockImplementation(async () => { peak = Math.max(peak, ++active); await Promise.resolve(); active--; return null; });
  const result = await readFriendHealthSeries({ auth: await requireGameMemberAuth(request), people: [people[0], ...friends],
    rooms: maximumRooms, metric: "sleep", timeZone: "UTC", signal: request.signal });
  expect(result.people).toHaveLength(501);
  expect(result.incomplete).toBe(false);
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(mocks.shared).toHaveBeenCalledTimes(500);
  expect(mocks.rooms).toHaveBeenCalledTimes(1);
  expect(peak).toBe(6);
});
