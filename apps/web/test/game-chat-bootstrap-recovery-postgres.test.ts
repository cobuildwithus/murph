import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { runGameCommand } from "@/src/lib/game/service";
import { handleGameChatBootstrapControl, prepareGameChatBootstrap } from "@/src/lib/game/chat-bootstrap";
import { drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { readHostedMailboxItemByDedupeKey } from "@/src/lib/hosted-mailbox/store";
const m = vi.hoisted(() => ({ create: vi.fn(), capacity: vi.fn(), lineKey: "", firstPlayer: "" }));
// The fixture uses the repository secure-box test codec; no external KMS calls.
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: new Uint8Array(32), envelope: { rootKeyId: "synthetic-control-root" } }),
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-execution/runtime-owner")>(), requireHostedRuntimeCallbackTx: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-mailbox/runtime-access")>(), requireHostedRuntimeActiveAccessForUpdateTx: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId === m.firstPlayer ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: new Date() }) }));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-line-store")>(),
  listHostedLinqHealthyProactiveLines: async () => [{ phoneNumber: "+15555550100", phoneNumberLookupKey: m.lineKey, maxNewConversationsPerDay: 10 }],
  claimHostedLinqProactiveConversationCapacityTx: m.capacity,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  createHostedLinqChat: m.create,
  getHostedLinqChatSummary: async () => ({ isGroup: true, handlesComplete: true, handles: [
    { handle: "+15555550100", isMe: true, status: "active" },
    { handle: "+15555550101", isMe: false, status: "active" },
    { handle: "+15555550102", isMe: false, status: "active" },
  ] }),
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Bootstrap recovery proof requires an isolated local test database.");
const members: string[] = [];
const receiptIds: string[] = [];
describe.skipIf(!enabled)("game bootstrap lifecycle recovery against PostgreSQL", () => {
  afterAll(async () => {
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { id: { in: receiptIds } } });
    await getPrisma().hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
    if (m.lineKey) await getPrisma().hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: m.lineKey } });
  });
  it("supersedes an empty queued proposal and permits one valid replacement after local text rejection", async () => {
    const db = getPrisma();
    const a = randomUUID(), b = randomUUID(), gameId = randomUUID();
    m.firstPlayer = a; m.lineKey = `synthetic-line-${randomUUID()}`;
    members.push(a, b);
    await db.hostedMember.createMany({ data: [a,b].map((id) => ({ id, billingStatus: "not_started" })) });
    await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: m.lineKey, phoneNumberHint: "0100", healthStatus: "healthy" } });
    for (const actorMemberId of [a,b]) await runGameCommand({ actorMemberId, command: { type: "setProfile", firstName: actorMemberId === a ? "Ava" : "Sam", timeZone: "UTC" } });
    const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
      tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0,1,2,3,4] }, stakes: [{ kind: "winner_gets", item: "Choose brunch" }],
    } } });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok || !created.game?.inviteToken) throw new Error("Expected synthetic invite.");
    const firstId = randomUUID(), nextId = randomUUID();
    expect(await runGameCommand({ actorMemberId: b, command: { type: "negotiate", token: created.game.inviteToken, proposalId: firstId, termsVersion: 1, timeZone: "UTC", change: { kind: "edit", lengthDays: 10 } } })).toMatchObject({ ok: true });
    const firstEvent = `game-change:${gameId}:${firstId}`;
    // Model the already-created route-less container from the failed first
    // generation; crypto root provisioning is independently covered elsewhere.
    const room = randomUUID();
    members.push(room);
    await db.hostedMember.create({ data: { id: room, billingStatus: "not_started" } });
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: a } });
    await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
    expect(await prepareGameChatBootstrap(gameId, firstEvent, "Ask whether the proposed duration works.")).toBe(room);
    const firstKey = createHostedLinqDeliveryIdempotencyLookupKey(firstEvent)!;
    const firstReceipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: firstKey } });
    receiptIds.push(firstReceipt.id);
    expect(firstReceipt).toMatchObject({ status: "generation_queued", payloadOwnerMemberId: room, payloadCiphertext: null, payloadSchema: null });
    expect(await runGameCommand({ actorMemberId: b, command: { type: "respondChange", gameId, proposalId: firstId, decision: "cancel" } })).toMatchObject({ ok: true });
    // Run the actual supersession sweep before the failed runtime wake resumes.
    await db.hostedLinqDelivery.update({ where: { id: firstReceipt.id }, data: { retryAfterAt: new Date(0), attemptedAt: new Date(0) } });
    await drainGameChatLifecycle({ prisma: db });
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: firstReceipt.id } })).toMatchObject({ status: "skipped", payloadCiphertext: null, payloadSchema: null });
    expect(await runGameCommand({ actorMemberId: b, command: { type: "proposeChange", gameId, proposalId: nextId, expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 12 } } })).toMatchObject({ ok: true });
    const nextEvent = `game-change:${gameId}:${nextId}`;
    expect(await prepareGameChatBootstrap(gameId, nextEvent, "Ask about the replacement proposal.")).toBe(room);
    const firstWake = await readHostedMailboxItemByDedupeKey({ userId: room, dedupeKey: firstEvent, prisma: db });
    const nextWake = await readHostedMailboxItemByDedupeKey({ userId: room, dedupeKey: nextEvent, prisma: db });
    expect(firstWake?.consumedAt).toBeNull(); expect(nextWake?.consumedAt).toBeNull();
    expect(nextWake?.id).not.toBe(firstWake?.id);
    const control = (eventId: string, text?: string) => handleGameChatBootstrapControl({ memberId: room, runtimeIdentity: null,
      request: { action: "game_chat_bootstrap", gameId, eventId, ...(text === undefined ? { operation: "recover" } : { operation: "send", text }) } });
    await expect(control(firstEvent)).resolves.toMatchObject({ result: { status: "unavailable" } });
    expect(m.create).not.toHaveBeenCalled(); expect(m.capacity).not.toHaveBeenCalled();
    await expect(control(nextEvent)).resolves.toMatchObject({ result: { status: "needs_message" } });
    await expect(control(nextEvent, "Use https://example.org/workout daily. Want reminders?")).rejects.toThrow("cannot include URL text");
    const nextReceipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(nextEvent)! } });
    receiptIds.push(nextReceipt.id);
    expect(nextReceipt).toMatchObject({ status: "generation_queued", payloadCiphertext: null, payloadSchema: null, phoneNumberLookupKey: null });
    expect(m.create).not.toHaveBeenCalled(); expect(m.capacity).not.toHaveBeenCalled();
    m.capacity.mockResolvedValue(true);
    m.create.mockResolvedValue({ chatId: `synthetic-chat-${randomUUID()}`, messageId: `synthetic-message-${randomUUID()}` });
    await expect(control(nextEvent, "Your 12-day challenge proposal is ready. Does that work for you both?")).resolves.toMatchObject({ result: { status: "sent" } });
    expect(m.create).toHaveBeenCalledOnce(); expect(m.capacity).toHaveBeenCalledOnce();
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: nextReceipt.id } })).toMatchObject({ status: "accepted", bootstrapRouteAttachedAt: expect.any(Date) });
    await expect(control(nextEvent)).resolves.toMatchObject({ result: { status: "sent" } });
    expect(m.create).toHaveBeenCalledOnce();
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(1);
  });
});
