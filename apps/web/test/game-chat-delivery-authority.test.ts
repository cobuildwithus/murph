import { describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Game } from "@prisma/client";
import { assertGameProposalDeliveryCurrentTx } from "../src/lib/game/chat-delivery-authority";
const now = new Date("2030-03-04T16:00:00Z");
const row = () => ({
  id: "game", createdBy: "person-a", chatContainerMemberId: "room", pendingChange: { v: 1, id: "proposal", proposedByMemberId: "person-a", expectedTermsVersion: 1, change: { kind: "edit", schedule: { days: [5, 6] } }, effectiveFromDay: 0, startsOn: null, deliveryStatus: "queued" },
  previousGameId: null, inviteeMemberId: null, round: 1, status: "live", terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] }] }, termsWordsEncrypted: "synthetic", inviteTokenHash: null, inviteTokenEncrypted: null, inviteExpiresAt: null, pendingLabel: null, lengthDays: 7, startsOn: null, startedAt: now, liveRosterKey: "synthetic", devClockOffsetMs: null, result: null, settledAt: null, createdAt: now, updatedAt: now,
  players: ["person-a", "person-b"].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: new Date("2030-03-05T00:00:00Z") })),
} satisfies Game & { players: Array<{ memberId: string; seat: number; timeZone: string; dayOne: Date }> });
function setup() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://localhost/synthetic_unused" }) });
  const findFirst = vi.spyOn(prisma.game, "findFirst");
  findFirst.mockResolvedValue(row());
  return { findFirst, input: { tx: prisma, containerMemberId: "room", deliveryIdempotencyKey: "game-change:game:proposal", playerMemberIds: ["person-a", "person-b"], now } };
}
describe("game proposal provider dispatch authority", () => {
  it("does not interfere with unrelated runtime deliveries", async () => {
    const { input, findFirst } = setup();
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, deliveryIdempotencyKey: "ordinary-reply" })).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("allows only the same current proposal in its bound room", async () => {
    const { input, findFirst } = setup();
    await expect(assertGameProposalDeliveryCurrentTx(input)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "game", chatContainerMemberId: "room", status: "live" } }));
    findFirst.mockResolvedValue(null);
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
    const { input, findFirst } = setup();
    findFirst.mockResolvedValue({ ...row(), pendingChange: { ...row().pendingChange, id: "replacement" } });
    await expect(assertGameProposalDeliveryCurrentTx(input)).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
    findFirst.mockResolvedValue(row());
    await expect(assertGameProposalDeliveryCurrentTx({ ...input, now: new Date("2030-03-06T16:00:00Z") })).rejects.toMatchObject({ code: "GAME_CHANGE_SUPERSEDED" });
  });
});
