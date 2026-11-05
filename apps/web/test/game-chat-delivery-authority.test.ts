import { describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Game } from "@prisma/client";
import { assertGameProposalDeliveryCurrentTx } from "../src/lib/game/chat-delivery-authority";
const now = new Date("2030-03-04T16:00:00Z");
const row = () => ({
  id: "game", createdBy: "person-a", chatContainerMemberId: "room", pendingChange: { v: 1, id: "proposal", proposedByMemberId: "person-a", expectedTermsVersion: 1, change: { kind: "edit", schedule: { days: [5, 6] } }, effectiveFromDay: 0, startsOn: null, deliveryStatus: "queued" },
  previousGameId: null, invitees: [], maxPlayers: 2, audienceKey: null, wordsOwnerMemberId: "person-a", round: 1, status: "live", terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }] }, termsWordsEncrypted: "synthetic", inviteTokenHash: null, inviteTokenEncrypted: null, inviteExpiresAt: null, lengthDays: 7, startsOn: null, startedAt: now, devClockOffsetMs: null, result: null, recapEncrypted: null, settledAt: null, createdAt: now, updatedAt: now,
  players: ["person-a", "person-b"].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date("2030-03-05T00:00:00Z") })),
} satisfies Game & { invitees: { memberId: string | null }[]; players: Array<{ memberId: string; seat: number; timeZone: string; dayOne: Date }> });
function setup() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://localhost/synthetic_unused" }) });
  const findFirst = vi.spyOn(prisma.game, "findFirst");
  findFirst.mockResolvedValue(row());
  const findMany = vi.spyOn(prisma.game, "findMany").mockResolvedValue([row()]);
  const unique = vi.spyOn(prisma.game, "findUnique").mockResolvedValue(row());
  const setGame = <T extends Game>(game: T | null) => {
    findFirst.mockResolvedValue(game); findMany.mockResolvedValue(game ? [game] : []); unique.mockResolvedValue(game);
  };
  vi.spyOn(prisma.gameEntry, "findMany").mockResolvedValue([]);
  vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ id: "game" }]);
  const event = vi.spyOn(prisma.gameEvent, "findUnique").mockResolvedValue({ id: 1n, gameId: "game", actor: "person-a", createdAt: now,
    type: "change_expired", commandKey: "game-change-resolved:game:proposal", payload: { proposalId: "proposal", reason: "The start date locks once someone checks in." } });
  return { findFirst, findMany, event, setGame, input: { tx: prisma, containerMemberId: "room", deliveryIdempotencyKey: "game-change:game:proposal", playerMemberIds: ["person-a", "person-b"], now } };
}
describe("game proposal provider dispatch authority", () => {
  it("requires the resolved refusal event and exact bound audience", async () => {
    const { input, event, setGame } = setup();
    const refusal={...input,deliveryIdempotencyKey:"game-change-expired:game:proposal"};
    expect(await assertGameProposalDeliveryCurrentTx(refusal)).toBe(true);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ where: { commandKey: "game-change-resolved:game:proposal" } }));
    await expect(assertGameProposalDeliveryCurrentTx({...refusal,playerMemberIds:["person-a","outsider"]})).rejects.toMatchObject({code:"GAME_CHANGE_SUPERSEDED"});
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx(refusal)).rejects.toMatchObject({code:"GAME_CHANGE_SUPERSEDED"});
  });
  it("does not interfere with unrelated runtime deliveries", async () => {
    const { input, findFirst } = setup();
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "ordinary-reply" })).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("allows only the same current proposal in its bound room", async () => {
    const { input, findMany, setGame } = setup();
    await expect(assertGameProposalDeliveryCurrentTx(input)).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["game"] } } }));
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx(input)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("requires a fresh two-player audience proof before granting the exemption", async () => {
    const { input } = setup();
    for (const playerMemberIds of [undefined, ["person-a"], ["person-a", "person-a"]]) {
      await expect(assertGameProposalDeliveryCurrentTx({ ...input, playerMemberIds })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    }
  });
  it("rejects an old game whose players differ from the current provider-proven pair", async () => {
    const { input } = setup();
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, playerMemberIds: ["person-a", "person-c"] })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("rejects replaced or expired proposals before provider dispatch", async () => {
    const { input, setGame } = setup();
    setGame({ ...row(), pendingChange: { ...row().pendingChange, id: "replacement" } });
    await expect(assertGameProposalDeliveryCurrentTx(input)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame(row());
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, now: new Date("2030-03-06T16:00:00Z") })).resolves.toBe(true);
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, now: new Date("2030-03-13T16:00:00Z") })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("allows a live kickoff only in its primary room with the exact audience", async () => {
    const { input, findFirst, setGame } = setup();
    const kickoff = { ...input, deliveryIdempotencyKey: "game-started:game" };
    await expect(assertGameProposalDeliveryCurrentTx(kickoff)).resolves.toBe(true);
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "game", chatContainerMemberId: "room", status: "live" } }));
    await expect(assertGameProposalDeliveryCurrentTx({ ...kickoff, playerMemberIds: ["person-a", "stranger"] })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx(kickoff)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("authorizes an older settled recap for its bound pair without consulting the newest game", async () => {
    const { input, findFirst, setGame } = setup();
    findFirst.mockResolvedValueOnce({ ...row(), status: "settled" }).mockResolvedValue({ ...row(), id: "newer" });
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-recap:game" })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "game", chatContainerMemberId: "room", status: "settled",
      OR: [{ maxPlayers: 10 }, { maxPlayers: 2, players: { none: { leftAt: { not: null } } } }],
    }) }));
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-recap:game", playerMemberIds: ["person-a", "outsider"] }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-recap:game" }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("allows any bound live game for missed-day delivery, with exact player authority", async () => {
    const { input, findFirst, setGame } = setup();
    setGame(row());
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-missed:game:person-a:2030-03-04" })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    findFirst.mockReset();
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-missed:game:person-a:2030-03-04" }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    findFirst.mockReset();
    setGame(row());
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "game-missed:game:outsider:2030-03-04" }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("allows a rematch only while its addressed pair is still invited in the inherited room", async () => {
    const { input, findFirst, setGame } = setup();
    const invited = { ...row(), status: "invited", invitees: [{ memberId: "person-b" }], pendingChange: null,
      players: [row().players[0]!] };
    setGame(invited);
    const rematch = { ...input, deliveryIdempotencyKey: "game-rematch:game" };
    await expect(assertGameProposalDeliveryCurrentTx(rematch)).resolves.toBe(true);
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
      id: "game", chatContainerMemberId: "room", status: "invited",
    } }));
    await expect(assertGameProposalDeliveryCurrentTx({ ...rematch, playerMemberIds: ["person-a", "stranger"] }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame({ ...invited, inviteExpiresAt: now });
    await expect(assertGameProposalDeliveryCurrentTx(rematch)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame({ ...row(), status: "live" });
    await expect(assertGameProposalDeliveryCurrentTx(rematch)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
  it("allows a negotiating proposal without inventing an already-started Day 1", async () => {
    const { input, setGame } = setup();
    setGame({ ...row(), status: "negotiating", players: row().players.map(player => ({ ...player, dayOne: null })), inviteExpiresAt: new Date("2031-01-02T12:00:00Z") });
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, now: new Date("2031-01-01T12:00:00Z") })).resolves.toBe(true);
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, now: new Date("2031-01-02T12:00:00Z") }))
      .rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it("authorizes only the cancelled invite and original pair in its bound room", async () => {
    const { input, findFirst, setGame } = setup();
    setGame({ ...row(), status: "void", pendingChange: null });
    const cancelled = { ...input, deliveryIdempotencyKey: "game-cancelled:game" };
    await expect(assertGameProposalDeliveryCurrentTx(cancelled)).resolves.toBe(true);
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
      id: "game", chatContainerMemberId: "room", status: "void", events: { some: { type: "cancelled" } },
    } }));
    for (const playerMemberIds of [undefined, ["person-a", "stranger"], ["person-a"]]) {
      await expect(assertGameProposalDeliveryCurrentTx({ ...cancelled, playerMemberIds })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    }
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx(cancelled)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await expect(assertGameProposalDeliveryCurrentTx({ ...cancelled, deliveryIdempotencyKey: "game-cancelled:game:extra" })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

  it.each(["live", "negotiating"])("checks cancellation history and the exact audience for %s games", async (status) => {
    const { input, event, setGame } = setup();
    setGame({ ...row(), status, pendingChange: null });
    event.mockResolvedValue({ id: 1n, gameId: "game", actor: "person-a", createdAt: now,
      type: "change_cancelled", commandKey: "game-change-resolved:game:proposal", payload: { proposalId: "proposal" } });
    const cancelled = { ...input, deliveryIdempotencyKey: "game-change-cancelled:game:proposal" };
    await expect(assertGameProposalDeliveryCurrentTx(cancelled)).resolves.toBe(true);
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ where: { commandKey: "game-change-resolved:game:proposal" } }));
    await expect(assertGameProposalDeliveryCurrentTx({ ...cancelled, playerMemberIds: ["person-a", "stranger"] })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    setGame(null);
    await expect(assertGameProposalDeliveryCurrentTx(cancelled)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    await expect(assertGameProposalDeliveryCurrentTx({ ...cancelled, deliveryIdempotencyKey: "game-change-cancelled:game:" })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });

});

it("chooses the same addressed seat independent of row order and never uses a bound contact key for another person", async () => {
  const { addressedGameInvite } = await import("@/src/lib/game/audience");
  const rows = [{ seat: 3, memberId: null, recipientLookupKey: "email" }, { seat: 2, memberId: null, recipientLookupKey: "phone" },
    { seat: 1, memberId: "actor", recipientLookupKey: "obsolete" }];
  expect(addressedGameInvite(rows, "actor", ["phone", "email"])?.seat).toBe(1);
  expect(addressedGameInvite([...rows].reverse(), "new", ["phone", "email"])?.seat).toBe(2);
  expect(addressedGameInvite(rows, "new", ["obsolete"])).toBeUndefined();
  expect(addressedGameInvite(rows, "new", [])).toBeUndefined();
});

it("retains a redacted group's accepted-note quota metadata and rejects unsupported payload versions", async () => {
  const { parseGameTalkPayload } = await import("@/src/lib/game/talk");
  const payload = { v: 2, proposalId: "note_synthetic", invitationSeat: 3, termsVersion: 1, noteEncrypted: null };
  expect(parseGameTalkPayload(payload)).toEqual(payload);
  for (const change of [{ v: 3 }, { invitationSeat: 10 }, { termsVersion: 0 }, { noteEncrypted: "" }]) expect(parseGameTalkPayload({ ...payload, ...change })).toBeNull();
});
