import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), audience: vi.fn(), add: vi.fn(), current: vi.fn(), blocked: vi.fn(),
  game: vi.fn(), route: vi.fn(), finish: vi.fn(), verified: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: async () => ({ member: { id: "ava" } }),
  assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/hosted-groups/group-store", () => ({ addHostedGroupPairBoardSharingTx: mocks.add, lockHostedGroupRow: vi.fn() }));
vi.mock("@/src/lib/hosted-groups/join-post-commit", () => ({ finishHostedGroupJoin: mocks.finish }));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({ readHostedThreadRouteByThreadIdentity: mocks.route }));
vi.mock("@/src/lib/game/blocks", () => ({ lockGamePair: vi.fn() }));
vi.mock("@/src/lib/game/chat-membership", async original => ({
  ...await original<typeof import("@/src/lib/game/chat-membership")>(), readGameChatAudience: mocks.audience, hasGameChatRestriction: mocks.blocked,
}));
vi.mock("@/src/lib/game/audience", () => ({ verifiedGameContactKeys: mocks.verified }));
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { shareWithFriends, type FriendRoom } from "@/src/lib/game/progress/friend-sharing";

const people = [
  { memberId: "leo", firstName: "Leo", avatarUrl: null },
  { memberId: "sam", firstName: "Sam", avatarUrl: null },
];
const rooms: FriendRoom[] = people.map(person => ({ gameId: `game-${person.memberId}`, groupId: `group-${person.memberId}`,
  runtimeMemberId: `room-${person.memberId}`, otherMemberId: person.memberId, membershipId: "membership", shared: ["sleep"] }));
const request = new Request("https://example.test/progress/friends/sharing");
async function run(overrides: Partial<Parameters<typeof shareWithFriends>[0]> = {}) {
  return shareWithFriends({ auth: await requireGameMemberAuth(request), body: { metrics: ["steps", "sleep"], share: true, audience: ["leo", "sam"] },
    rooms, audience: people, signal: request.signal, ...overrides });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(run => run({ game: { findFirst: mocks.game }, $executeRaw: vi.fn() }));
  mocks.audience.mockImplementation((room: string) => Promise.resolve({ threadId: room,
    contacts: [{}, {}], memberIds: ["ava", room.slice(5)] }));
  mocks.route.mockImplementation(({ threadId }: { threadId: string }) => Promise.resolve({ containerMemberId: threadId }));
  mocks.game.mockResolvedValue({ id: "game" });
  mocks.add.mockResolvedValue({ membershipId: "membership" });
  mocks.blocked.mockResolvedValue(false);
  mocks.verified.mockResolvedValue(["synthetic-key"]);
});

it("checks every provider pair, commits additive grants and reports the exact audience", async () => {
  expect(await run()).toEqual({ ok: true, sharedWith: people.map(person => ({ ...person, metrics: ["steps", "sleep"] })) });
  expect(mocks.audience).toHaveBeenCalledTimes(2);
  expect(mocks.current).toHaveBeenCalledTimes(2);
  expect(mocks.add).toHaveBeenCalledTimes(2);
  expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ memberId: "ava", otherMemberId: "leo", metrics: ["steps", "sleep"] }));
});

it("does not grant a newly discovered person who was absent from the consent prompt", async () => {
  await expect(run({ body: { metrics: ["steps"], share: true, audience: ["leo"] } })).rejects.toMatchObject({ code: "PROGRESS_SHARING_AUDIENCE_CHANGED" });
  expect(mocks.audience).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
});

it("refuses a third human before any grant, even for an existing membership", async () => {
  mocks.audience.mockResolvedValueOnce({ threadId: "room-leo", contacts: [{}, {}, {}], memberIds: ["ava", "leo", "maya"] });
  await expect(run()).rejects.toMatchObject({ code: "PROGRESS_SHARING_AUDIENCE_CHANGED", details: { sharedWith: [] } });
  expect(mocks.add).not.toHaveBeenCalled();
});

it.each(["block", "game departed", "session revoked"])("rechecks %s inside the granting transaction", async changed => {
  if (changed === "block") mocks.blocked.mockResolvedValueOnce(true);
  if (changed === "game departed") mocks.game.mockResolvedValueOnce(null);
  if (changed === "session revoked") mocks.current.mockRejectedValueOnce(hostedOnboardingError({
    code: "UNAUTHENTICATED", httpStatus: 401, message: "Sign in to continue." }));
  await expect(run()).rejects.toMatchObject({ details: { sharedWith: [] } });
  expect(mocks.add).not.toHaveBeenCalled();
});

it("returns the first committed outcome when a later room fails", async () => {
  mocks.add.mockResolvedValueOnce({ membershipId: "membership" }).mockRejectedValueOnce(new Error("Synthetic provider failure."));
  await expect(run()).rejects.toMatchObject({ httpStatus: 503, retryable: true,
    details: { sharedWith: [{ ...people[0], metrics: ["steps", "sleep"] }] } });
  expect(mocks.transaction).toHaveBeenCalledTimes(2);
});

it("declining makes no mutations and reports only existing grants", async () => {
  expect(await run({ body: { metrics: ["steps", "sleep"], share: false, audience: ["leo", "sam"] } })).toEqual({ ok: true,
    sharedWith: people.map(person => ({ ...person, metrics: ["sleep"] })) });
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.audience).not.toHaveBeenCalled();
});

it("rechecks verified contact identity before sharing", async () => {
  mocks.verified.mockResolvedValueOnce([]);
  await expect(run()).rejects.toMatchObject({ code: "PROGRESS_SHARING_AUDIENCE_CHANGED", details: { sharedWith: [] } });
  expect(mocks.add).not.toHaveBeenCalled();
});

it("processes the 500-room maximum sequentially and proves every recipient", async () => {
  const audience = Array.from({ length: 500 }, (_, index) => ({ memberId: `friend-${index}`, firstName: "Leo", avatarUrl: null }));
  const maximumRooms: FriendRoom[] = audience.map(person => ({ ...rooms[0], gameId: `game-${person.memberId}`,
    groupId: `group-${person.memberId}`, runtimeMemberId: `room-${person.memberId}`, otherMemberId: person.memberId }));
  let active = 0, peak = 0;
  mocks.transaction.mockImplementation(async run => {
    peak = Math.max(peak, ++active);
    const result = await run({ game: { findFirst: mocks.game }, $executeRaw: vi.fn() });
    active--; return result;
  });
  const result = await run({ rooms: maximumRooms, audience, body: { metrics: ["steps"], share: true, audience: audience.map(person => person.memberId) } });
  expect(result.sharedWith).toHaveLength(500);
  expect(mocks.audience).toHaveBeenCalledTimes(500);
  expect(mocks.transaction).toHaveBeenCalledTimes(500);
  expect(mocks.verified).toHaveBeenCalledTimes(1000);
  expect(mocks.current).toHaveBeenCalledTimes(500);
  expect(peak).toBe(1);
});
