import { cleanupGameFixtures } from "./support/game-fixture-cleanup";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { linqRoster } from "./support/linq-roster";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { runGameCommand } from "@/src/lib/game/service";
import { handleGameChatBootstrapControl, prepareGameChatBootstrap } from "@/src/lib/game/chat-bootstrap";
import { deliverGameChangeProposal } from "@/src/lib/game/chat-delivery";
import { requireHostedRuntimeMailboxActiveAccess } from "@/src/lib/hosted-mailbox/runtime-access";
import { drainGameChatLifecycle } from "@/src/lib/game/chat-lifecycle";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { advanceHostedMailboxConsumedSeqByLane, readHostedMailboxItemByDedupeKey, readHostedMailboxWakeByDedupeKey } from "@/src/lib/hosted-mailbox/store";
const m = vi.hoisted(() => ({ create: vi.fn(), capacity: vi.fn(), activeAccess: vi.fn(), signal: vi.fn(), lineKey: "", firstPlayer: "" }));
// The fixture uses the repository secure-box test codec; no external KMS calls.
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: new Uint8Array(32), envelope: { rootKeyId: "synthetic-control-root" } }),
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-execution/runtime-owner")>(), requireHostedRuntimeCallbackTx: vi.fn() }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-mailbox/runtime-access")>(), requireHostedRuntimeActiveAccessForUpdateTx: m.activeAccess }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: async ({ memberId }: { memberId: string }) => ({ phoneNumber: memberId === m.firstPlayer ? "+15555550101" : "+15555550102", phoneNumberVerifiedAt: new Date() }) }));
vi.mock("@/src/lib/hosted-onboarding/linq-line-store", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-line-store")>(),
  listHostedLinqHealthyProactiveLines: async () => [{ phoneNumber: "+15555550100", phoneNumberLookupKey: m.lineKey, maxNewConversationsPerDay: 10 }],
  claimHostedLinqProactiveConversationCapacityTx: m.capacity,
  readHostedLinqIncomingLineState: async () => ({ kind: "assignable", phoneNumberLookupKey: m.lineKey }),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (original) => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  createHostedLinqChat: m.create,
  getHostedLinqChatSummary: async () => linqRoster({ isGroup: true, handlesComplete: true, handles: [
    { handle: "+15555550100", isMe: true, status: "active" },
    { handle: "+15555550101", isMe: false, status: "active" },
    { handle: "+15555550102", isMe: false, status: "active" },
  ] }),
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Bootstrap recovery proof requires an isolated local test database.");
const members: string[] = [];
const receiptIds: string[] = [];
const lineKeys: string[] = [];
describe.skipIf(!enabled)("game bootstrap lifecycle recovery against PostgreSQL", () => {
  afterAll(async () => {
    await getPrisma().hostedLinqDelivery.deleteMany({ where: { id: { in: receiptIds } } });
    await getPrisma().hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await cleanupGameFixtures(getPrisma(), members);
    await getPrisma().hostedMember.deleteMany({ where: { id: { in: members } } });
    await getPrisma().hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: lineKeys } } });
    await getPrisma().hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: { in: ["+15555550101", "+15555550102"].map(phone => createHostedPhoneLookupKey(phone)!) } } });
  });
  it("supersedes an empty queued proposal and permits one valid replacement after local text rejection", async () => {
    const db = getPrisma();
    const a = randomUUID(), b = randomUUID(), gameId = randomUUID();
    m.firstPlayer = a; m.lineKey = `synthetic-line-${randomUUID()}`;
    lineKeys.push(m.lineKey);
    members.push(a, b);
    await db.hostedMember.createMany({ data: [a,b].map((id) => ({ id, billingStatus: "not_started" })) });
    await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: m.lineKey, phoneNumberHint: "0100", healthStatus: "healthy" } });
    for (const actorMemberId of [a,b]) await runGameCommand({ actorMemberId, command: { type: "setProfile", firstName: actorMemberId === a ? "Ava" : "Sam", timeZone: "UTC" } });
    const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
      tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0,1,2,3,4] }, stakes: [{ kind: "prize", item: "Choose brunch" }],
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
    // Imported progress alone does not finish the notice. Only the consumed floor does.
    await db.hostedWorkspace.upsert({ where: { userId: room }, create: { userId: room, redactedStatusJson: { hostedMailboxSystemImportedSeq: "100" } }, update: { redactedStatusJson: { hostedMailboxSystemImportedSeq: "100" } } });
    const queued = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(nextEvent)! } });
    if (!receiptIds.includes(queued.id)) receiptIds.push(queued.id);
    await db.hostedLinqDelivery.update({ where: { id: queued.id }, data: { retryAfterAt: new Date(0), attemptedAt: new Date(0) } });
    m.signal.mockClear();
    await drainGameChatLifecycle({ prisma: db });
    expect(m.signal).toHaveBeenCalledWith({ expectedUserId: room, mailboxItemId: nextWake!.id });
    await advanceHostedMailboxConsumedSeqByLane({ userId: room, prisma: db, lanes: [{ lane: "system", consumedSeq: nextWake!.laneSeq }] });
    await db.hostedLinqDelivery.update({ where: { id: queued.id }, data: { retryAfterAt: new Date(0), attemptedAt: new Date(0) } });
    m.signal.mockClear();
    await drainGameChatLifecycle({ prisma: db });
    expect(m.signal).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findUnique({ where: { id: queued.id } })).toMatchObject({ retryAfterAt: null });
    expect(await db.hostedMailboxItem.findUnique({ where: { id: nextWake!.id } })).toMatchObject({ consumedAt: null });
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
  it("bootstraps the newer game before draining the deferred older proposal through one route", async () => {
    const db = getPrisma(), now = new Date();
    const a = randomUUID(), b = randomUUID(), older = randomUUID(), newer = randomUUID(), room = randomUUID();
    members.push(a, b, room);
    m.firstPlayer = a; m.lineKey = `synthetic-line-${randomUUID()}`;
    lineKeys.push(m.lineKey);
    await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: m.lineKey, phoneNumberHint: "0100", healthStatus: "healthy" } });
    m.create.mockClear(); m.capacity.mockClear();
    const access = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/runtime-access")>("@/src/lib/hosted-mailbox/runtime-access");
    m.activeAccess.mockImplementation(access.requireHostedRuntimeActiveAccessForUpdateTx);
    await db.hostedMember.createMany({ data: [a, b, room].map(id => ({ id, billingStatus: "not_started" })) });
    await db.hostedMemberIdentity.createMany({ data: [a, b].map((memberId, index) => ({ memberId, phoneLookupKey: createHostedPhoneLookupKey(index === 0 ? "+15555550101" : "+15555550102") })) });
    for (const actorMemberId of [a, b]) await runGameCommand({ actorMemberId, command: { type: "setProfile", firstName: actorMemberId === a ? "Ava" : "Sam", timeZone: "UTC" } });
    const tokens = new Map<string, string>();
    for (const [index, gameId] of [older, newer].entries()) {
      const created = await runGameCommand({ actorMemberId: a, command: { type: "createGame", gameId, inviteeFirstName: "Sam", terms: {
        tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }], schedule: { days: [0,1,2,3,4] }, stakes: [{ kind: "prize", item: "Choose brunch" }],
      } } });
      if (!created.ok || !created.game?.inviteToken) throw new Error("Expected synthetic invite.");
      tokens.set(gameId, created.game.inviteToken);
      await db.game.update({ where: { id: gameId }, data: { createdAt: new Date(now.getTime() - 2_000 + index * 1_000) } });
    }
    // Reuse the prepared-container fixture; provider routing remains absent.
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: a, participants: {
      create: [a, b].map(participantMemberId => ({ participantMemberId, handleLookupKey: participantMemberId, firstSeenAt: now, lastSeenAt: now })),
    } } });
    const proposals = new Map<string, string>();
    for (const gameId of [newer, older]) {
      const proposalId = randomUUID(), eventId = `game-change:${gameId}:${proposalId}`;
      proposals.set(gameId, proposalId);
      expect(await runGameCommand({ actorMemberId: b, command: { type: "negotiate", token: tokens.get(gameId)!, proposalId, termsVersion: 1, timeZone: "UTC", change: { kind: "edit", lengthDays: 10 } } })).toMatchObject({ ok: true });
      if (gameId === newer) await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: room } });
      expect(await prepareGameChatBootstrap(gameId, eventId, "Ask about the proposed duration.")).toBe(gameId === newer ? room : null);
      const receipt = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)! } });
      receiptIds.push(receipt.id);
      expect(receipt).toMatchObject({ status: gameId === newer ? "generation_queued" : "awaiting_generation", payloadSchema: null });
      expect(await db.game.findUnique({ where: { id: gameId } })).toMatchObject({ chatContainerMemberId: room });
    }
    const newerEvent = `game-change:${newer}:${proposals.get(newer)}`;
    const olderEvent = `game-change:${older}:${proposals.get(older)}`;
    expect(await readHostedMailboxItemByDedupeKey({ userId: room, dedupeKey: olderEvent, prisma: db })).toBeNull();
    expect(await readHostedMailboxItemByDedupeKey({ userId: room, dedupeKey: newerEvent, prisma: db })).toMatchObject({ consumedAt: null });
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(0);
    await expect(requireHostedRuntimeMailboxActiveAccess(room, { prisma: db })).resolves.toEqual({ isThreadContainer: true });
    expect(await readHostedMailboxWakeByDedupeKey({ userId: room, dedupeKey: newerEvent, prisma: db })).toMatchObject({ notification: { gameChatBootstrap: { gameId: newer } } });
    const control = (text?: string) => handleGameChatBootstrapControl({ memberId: room, runtimeIdentity: null,
      request: { action: "game_chat_bootstrap", gameId: newer, eventId: newerEvent, ...(text === undefined ? { operation: "recover" } : { operation: "send", text }) } });
    await expect(control()).resolves.toMatchObject({ result: { status: "needs_message" } });
    m.capacity.mockResolvedValue(true);
    m.create.mockResolvedValue({ chatId: `synthetic-chat-${randomUUID()}`, messageId: `synthetic-message-${randomUUID()}` });
    await expect(control("Your 10-day challenge proposal is ready. Does that work for you both?")).resolves.toMatchObject({ result: { status: "sent" } });
    await expect(control()).resolves.toMatchObject({ result: { status: "sent" } });
    expect(await db.hostedLinqDelivery.findUnique({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(newerEvent)! } })).toMatchObject({
      status: "accepted", payloadSchema: "game_chat_bootstrap_v1", bootstrapRouteAttachedAt: expect.any(Date),
    });
    const consumed = await readHostedMailboxItemByDedupeKey({ userId: room, dedupeKey: newerEvent, prisma: db });
    // The old fixture stamped a timestamp that system checkpoints never write.
    await advanceHostedMailboxConsumedSeqByLane({ userId: room, prisma: db, lanes: [{ lane: "system", consumedSeq: consumed!.laneSeq }] });
    await expect(deliverGameChangeProposal(older, proposals.get(older)!)).resolves.toBe(true);
    await expect(deliverGameChangeProposal(older, proposals.get(older)!)).resolves.toBe(true);
    const wake = await readHostedMailboxWakeByDedupeKey({ userId: room, dedupeKey: olderEvent, prisma: db });
    expect(wake).toMatchObject({ notification: { deliveryDispatchMode: "queue-only", deliveryIdempotencyKey: olderEvent, route: { delivery: { kind: "thread" } } } });
    if (wake?.kind !== "assistant.notification.requested") throw new Error("Expected proposal wake.");
    expect(wake.notification.gameChatBootstrap).toBeUndefined();
    expect(await db.hostedMailboxItem.count({ where: { userId: room, dedupeKey: olderEvent } })).toBe(1);
    expect(m.create).toHaveBeenCalledOnce(); expect(m.capacity).toHaveBeenCalledOnce();
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(1);
  });
});
