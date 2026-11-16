import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ games: vi.fn(), blocks: vi.fn(), profiles: vi.fn(), open: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ game: { findMany: mocks.games },
  gameBlock: { findMany: mocks.blocks }, gameProfile: { findMany: mocks.profiles } }) }));
vi.mock("@/src/lib/game/crypto", () => ({ openGameTexts: mocks.open }));
import { readFriendCohort } from "@/src/lib/game/progress/friend-cohort";

const profiles = ["ava", "leo", "sam"].map(memberId => ({ memberId, firstNameEncrypted: `sealed-${memberId}`,
  photoKey: null, createdAt: new Date("2026-10-21T12:00:00Z"), timeZone: "UTC" }));
const game = { players: profiles.map(profile => ({ memberId: profile.memberId })) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.games.mockResolvedValue([game]);
  mocks.blocks.mockResolvedValue([]);
  mocks.profiles.mockImplementation(({ where }: { where: { memberId: { in: string[] } } }) =>
    profiles.filter(profile => where.memberId.in.includes(profile.memberId)));
  mocks.open.mockImplementation((rows: { memberId: string }[]) => rows.map(row => ({ ava: "Ava", leo: "Leo", sam: "Sam" })[row.memberId]));
});

it.each(["blocked", "blockedBy"])("does not decrypt names across a %s boundary", async direction => {
  mocks.blocks.mockResolvedValue([{ blockerMemberId: direction === "blocked" ? "ava" : "leo",
    blockedMemberId: direction === "blocked" ? "leo" : "ava" }]);
  const result = await readFriendCohort("ava");
  expect(result.people.map(person => person.memberId)).toEqual(["ava", "sam"]);
  expect(mocks.open.mock.calls[0][0].map((row: { memberId: string }) => row.memberId)).toEqual(["ava", "sam"]);
});

it("rechecks current friendship after decrypting names", async () => {
  mocks.games.mockResolvedValueOnce([game]).mockResolvedValueOnce([{ players: [{ memberId: "ava" }, { memberId: "sam" }] }]);
  expect((await readFriendCohort("ava")).people.map(person => person.memberId)).toEqual(["ava", "sam"]);
  expect(mocks.games.mock.calls[0][0].where.players.some).toEqual({ memberId: "ava", leftAt: null, joinedAt: { not: null } });
});

it("marks a limit-plus-one cohort incomplete without exposing truncated rankings", async () => {
  mocks.games.mockResolvedValue(Array.from({ length: 501 }, () => game));
  const result = await readFriendCohort("ava");
  expect(result.incomplete).toBe(true);
  expect(result.people.map(person => person.memberId)).toEqual(["ava"]);
  expect(mocks.games.mock.calls[0][0].take).toBe(501);
});
