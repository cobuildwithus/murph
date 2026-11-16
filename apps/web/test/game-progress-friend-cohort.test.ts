import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ games: vi.fn(), blocks: vi.fn(), profiles: vi.fn(), open: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ game: { findMany: mocks.games },
  gameBlock: { findMany: mocks.blocks }, gameProfile: { findMany: mocks.profiles } }) }));
vi.mock("@/src/lib/game/crypto", async importOriginal => ({ ...await importOriginal<typeof import("@/src/lib/game/crypto")>(), openGameTexts: mocks.open }));
import { readFriendCohort } from "@/src/lib/game/progress/friend-cohort";

const profiles = ["ava", "leo", "sam"].map(memberId => ({ memberId, firstNameEncrypted: `sealed-${memberId}`,
  photoKey: null, createdAt: new Date("2026-10-21T12:00:00Z"), timeZone: "UTC" }));
const game = { id: "played", status: "live", createdBy: "ava", inviteExpiresAt: null, invitees: [],
  players: profiles.map((profile, seat) => ({ memberId: profile.memberId, seat,
    joinedAt: profile.createdAt, leftAt: null as Date | null, departedLabel: null, profile: { member: { suspendedAt: null } } })) };
const invitation = (memberId: string | null = "leo") => ({ ...game, id: "pending", status: "invited", players: [game.players[0]],
  inviteExpiresAt: new Date("2026-11-20T12:00:00Z"), invitees: [{ memberId, seat: 1,
    pendingLabel: { nameEncrypted: "sealed-invite-name", photoKey: null, relationshipEncrypted: null } }] });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
  mocks.games.mockResolvedValue([game]);
  mocks.blocks.mockResolvedValue([]);
  mocks.profiles.mockImplementation(({ where }: { where: { memberId: { in: string[] } } }) =>
    profiles.filter(profile => where.memberId.in.includes(profile.memberId)));
  mocks.open.mockImplementation((rows: { memberId: string; value: string }[]) => rows.map(row => row.value === "sealed-invite-name" ? "Leo" : ({ ava: "Ava", leo: "Jordan", sam: "Sam" })[row.memberId]));
});

afterEach(() => vi.useRealTimers());

it.each(["blocked", "blockedBy"])("does not decrypt names across a %s boundary", async direction => {
  mocks.blocks.mockResolvedValue([{ blockerMemberId: direction === "blocked" ? "ava" : "leo",
    blockedMemberId: direction === "blocked" ? "leo" : "ava" }]);
  const result = await readFriendCohort("ava");
  expect(result.people.map(person => person.memberId)).toEqual(["ava", "sam"]);
  expect(mocks.open.mock.calls[0][0].map((row: { memberId: string }) => row.memberId)).toEqual(["ava", "sam"]);
});

it("rechecks current friendship after decrypting names", async () => {
  mocks.games.mockResolvedValueOnce([game]).mockResolvedValueOnce([{ ...game, players: [game.players[0], game.players[2]] }]);
  expect((await readFriendCohort("ava")).people.map(person => person.memberId)).toEqual(["ava", "sam"]);
  expect(mocks.games.mock.calls[0][0].where.OR[0].players.some).toEqual({ memberId: "ava", leftAt: null, joinedAt: { not: null } });
});

it("marks a limit-plus-one cohort incomplete without exposing truncated rankings", async () => {
  mocks.games.mockResolvedValue(Array.from({ length: 501 }, () => game));
  const result = await readFriendCohort("ava");
  expect(result.incomplete).toBe(true);
  expect(result.people.map(person => person.memberId)).toEqual(["ava"]);
  expect(mocks.games.mock.calls[0][0].take).toBe(501);
});


it.each(["leo", null])("uses Home's sealed pending label for invitee %s, without reading their profile", async memberId => {
  mocks.games.mockResolvedValue([invitation(memberId)]);
  const result = await readFriendCohort("ava");
  expect(result.people).toEqual([
    expect.objectContaining({ memberId: "ava", invited: false }),
    { memberId: memberId ?? "invite:pending:1", firstName: "Leo", avatarUrl: null, me: false, invited: true, joinedOn: null, daily: null },
  ]);
  expect(mocks.profiles.mock.calls[0][0].where.memberId.in).toEqual(["ava"]);
  expect(mocks.open.mock.calls[0][0][1]).toMatchObject({ table: "game_contact_label", memberId: "ava", rowId: "ava", field: "name", value: "sealed-invite-name" });
});

it.each(["invited", "negotiating", "live"])("shows an unjoined invitation in a current %s game", async status => {
  mocks.games.mockResolvedValue([{ ...invitation(), status }]);
  expect((await readFriendCohort("ava")).people).toContainEqual(expect.objectContaining({ memberId: "leo", invited: true }));
});

it.each(["expired", "settled", "void", "someone else's", "joined", "left", "blocked", "blockedBy"])("withholds a pending row that is %s", async reason => {
  const pending = invitation();
  if (reason === "expired") pending.inviteExpiresAt = new Date("2026-11-16T12:00:00Z");
  if (reason === "settled" || reason === "void") pending.status = reason;
  if (reason === "someone else's") pending.createdBy = "sam";
  if (reason === "joined" || reason === "left") pending.players.push({ ...game.players[1], leftAt: reason === "left" ? new Date() : null });
  if (reason === "blocked" || reason === "blockedBy") mocks.blocks.mockResolvedValue([{ blockerMemberId: reason === "blocked" ? "ava" : "leo", blockedMemberId: reason === "blocked" ? "leo" : "ava" }]);
  mocks.games.mockResolvedValue([pending]);
  expect((await readFriendCohort("ava")).people.some(person => person.invited)).toBe(false);
  expect(mocks.open.mock.calls[0][0].some((row: { value: string }) => row.value === "sealed-invite-name")).toBe(false);
  expect(mocks.games.mock.calls[0][0].where.events).toEqual({ none: { type: "cancelled" } });
});

it("a joined invitee becomes one normal friend, even when invited to another game", async () => {
  mocks.games.mockResolvedValue([invitation(), game]);
  const result = await readFriendCohort("ava");
  expect(result.people.filter(person => person.memberId === "leo")).toEqual([
    expect.objectContaining({ firstName: "Jordan", invited: false, joinedOn: "2026-10-21" }),
  ]);
});

it("rechecks invitation authority after decrypting its name", async () => {
  mocks.games.mockResolvedValueOnce([invitation()]).mockResolvedValueOnce([]);
  expect((await readFriendCohort("ava")).people.map(person => person.memberId)).toEqual(["ava"]);
});
