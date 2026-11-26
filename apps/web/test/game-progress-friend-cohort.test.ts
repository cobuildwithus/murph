import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ partners: vi.fn(), blocks: vi.fn(), profiles: vi.fn(), open: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ $queryRaw: mocks.partners,
  gamePlayer: { findFirst: async () => null }, gameBlock: { findMany: mocks.blocks }, gameProfile: { findMany: mocks.profiles } }) }));
vi.mock("@/src/lib/game/crypto", async importOriginal => ({ ...await importOriginal<typeof import("@/src/lib/game/crypto")>(), openGameTexts: mocks.open }));
import { readFriendCohort } from "@/src/lib/game/progress/friend-cohort";

const profiles = ["ava", "leo", "sam"].map(memberId => ({ memberId, firstNameEncrypted: `sealed-${memberId}`,
  photoKey: null, createdAt: new Date("2026-10-21T12:00:00Z"), timeZone: "UTC" }));
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.partners.mockResolvedValue(profiles.slice(1).map(({ memberId }) => ({ memberId })));
  mocks.blocks.mockResolvedValue([]);
  mocks.profiles.mockImplementation(({ where }: { where: { memberId: { in: string[] } } }) =>
    profiles.filter(profile => where.memberId.in.includes(profile.memberId)));
  mocks.open.mockImplementation((rows: { memberId: string }[]) => rows.map(row => ({ ava: "Ava", leo: "Leo", sam: "Sam" })[row.memberId]));
});

afterEach(() => vi.useRealTimers());

it.each(["blocked", "blockedBy"])("does not decrypt names across a %s boundary", async direction => {
  mocks.blocks.mockResolvedValue([{ blockerMemberId: direction === "blocked" ? "ava" : "leo",
    blockedMemberId: direction === "blocked" ? "leo" : "ava" }]);
  const result = await readFriendCohort("ava");
  expect(result.people.map(person => person.memberId)).toEqual(["ava", "sam"]);
  expect(mocks.open.mock.calls[0][0].map((row: { memberId: string }) => row.memberId)).toEqual(["ava", "sam"]);
});

it("opens the admitted names with one cohort and block read before the caller's final check", async () => {
  expect((await readFriendCohort("ava")).people.map(person => person.memberId)).toEqual(["ava", "leo", "sam"]);
  expect(mocks.partners).toHaveBeenCalledOnce();
  expect(mocks.blocks).toHaveBeenCalledOnce();
});
