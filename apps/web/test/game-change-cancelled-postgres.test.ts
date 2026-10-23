import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { runGameCommand } from "@/src/lib/game/service";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: vi.fn(async () => {}) }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Cancellation proof needs an isolated local test database.");
const members: string[] = [];

async function setup() {
  const db = getPrisma();
  const a = `game_a_${randomUUID()}`, b = `game_b_${randomUUID()}`;
  members.push(a, b);
  await db.hostedMember.createMany({ data: [a, b].map((id) => ({ id, billingStatus: "not_started" })) });
  for (const [id, firstName] of [[a, "Maya"], [b, "Sam"]]) {
    expect((await runGameCommand({ actorMemberId: id, command: { type: "setProfile", firstName, timeZone: "UTC" } })).ok).toBe(true);
  }
  const gameId = randomUUID();
  const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: { tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "Choose a film" }] } } });
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  expect((await runGameCommand({ actorMemberId: b, command: { type: "join", token: created.game.inviteToken, termsVersion: 1, timeZone: "UTC" } })).ok).toBe(true);
  return { a, b, gameId };
}

describe.skipIf(!enabled)("game cancellation lifecycle transaction", () => {
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } }); });
  it("rolls back cancellation and its announcement when history cannot commit", async () => {
    const { a, gameId } = await setup();
    const db = getPrisma(), proposalId = randomUUID();
    const pendingChange = { v: 1, id: proposalId, proposedByMemberId: a, expectedTermsVersion: 1,
      change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "queued" };
    await db.game.update({ where: { id: gameId }, data: { status: "live", pendingChange } });
    // Force the final history insert to fail after reservation and clearing.
    await db.gameEvent.create({ data: { gameId, actor: a, type: "change_declined",
      commandKey: `game-change-resolved:${gameId}:${proposalId}`, payload: { v: 1, proposalId } } });
    await expect(runGameCommand({ actorMemberId: a, command: { type: "respondChange", gameId, proposalId, decision: "cancel" } })).rejects.toMatchObject({ code: "P2002" });
    expect((await db.game.findUniqueOrThrow({ where: { id: gameId }, select: { pendingChange: true } })).pendingChange).toEqual(pendingChange);
    expect(await db.gameEvent.count({ where: { gameId, type: "change_cancelled" } })).toBe(0);
    expect(await db.hostedLinqDelivery.count({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-change-cancelled:${gameId}:${proposalId}`)! } })).toBe(0);
  });
  it.each([
    { origin: "app", deliveryStatus: "queued", eligible: true },
    { origin: "app", deliveryStatus: "sent", eligible: true },
    { origin: "app", deliveryStatus: "pending", eligible: false },
    { origin: "app", deliveryStatus: "failed", eligible: false },
    { origin: "chat", deliveryStatus: "conversation", eligible: false },
    { origin: "chat", deliveryStatus: "queued", eligible: false },
  ].flatMap((scenario) => ["live", "negotiating"].map((status) => ({ ...scenario, status }))))("reserves once only for eligible cancellation: $status $origin $deliveryStatus", async ({ origin, deliveryStatus, eligible, status }) => {
    const { a, b, gameId } = await setup();
    const db = getPrisma();
    const proposalId = randomUUID();
    const pendingChange = { v: 1, id: proposalId, proposedByMemberId: a, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin, deliveryStatus };
    await db.game.update({ where: { id: gameId }, data: { status, pendingChange } });
    const before = await db.game.findUniqueOrThrow({ where: { id: gameId }, select: { terms: true, lengthDays: true } });
    const command = { type: "respondChange" as const, gameId, proposalId, decision: "cancel" as const };
    expect((await runGameCommand({ actorMemberId: b, command })).ok).toBe(false);
    const results = await Promise.all([1, 2].map(() => runGameCommand({ actorMemberId: a, command })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await db.gameEvent.count({ where: { gameId, type: "change_cancelled" } })).toBe(1);
    const receipts = await db.hostedLinqDelivery.findMany({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(`game-change-cancelled:${gameId}:${proposalId}`)! }, select: { template: true, status: true, sourceRef: true, payloadCiphertext: true } });
    expect(receipts).toEqual(eligible ? [{ template: "game_change_cancelled", status: "awaiting_generation", sourceRef: `${gameId}:${proposalId}`, payloadCiphertext: null }] : []);
    expect(await db.game.findUniqueOrThrow({ where: { id: gameId }, select: { terms: true, lengthDays: true, pendingChange: true } })).toEqual({ ...before, pendingChange: null });
  });
});
