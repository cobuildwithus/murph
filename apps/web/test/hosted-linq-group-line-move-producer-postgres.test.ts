import { sendHostedLinqChatMessage } from "@/src/lib/hosted-onboarding/linq-client";
import { assertHostedLinqRecentInboundEngagementForRuntime } from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import { APIError } from "@linqapp/sdk";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { readHostedMailboxProgress } from "@/src/lib/hosted-mailbox/projection";
import { advanceHostedMailboxConsumedSeqByLane } from "@/src/lib/hosted-mailbox/store";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { provisionHostedCryptoDomainRootsForUser } from "@/src/lib/hosted-crypto/domain-root-store";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadLookupKey, createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import { startHostedLinqGroupLineMove, operateHostedLinqGroupLineMove } from "@/src/lib/hosted-ops/linq-group-line-move";
import { readHostedLinqGroupLineMoveOverview } from "@/src/lib/hosted-ops/linq-group-line-move-overview";
import { claimHostedLinqDeliveryProviderDispatchTx } from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { prepareHostedLinqGroupMoveCleanup } from "@/src/lib/hosted-routing/linq-group-line-move-store";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { buildHostedThreadDeliveryRoute, sealHostedThreadDeliveryRoute } from "@/src/lib/hosted-routing/thread-delivery-route";
import { localRosterCrypto, rosterPhoneIdentity, rosterRoute, syntheticPhone } from "./support/roster-postgres";

const provider = vi.hoisted(() => ({ retrieve: vi.fn(), add: vi.fn(), remove: vi.fn(), leave: vi.fn(), send: vi.fn(), signal: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({ ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { retrieve: provider.retrieve, participants: { add: provider.add, remove: provider.remove },
    leaveChat: provider.leave, messages: { send: provider.send } }; },
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: provider.signal }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Producer proof requires an isolated local test database.");

describe.skipIf(!enabled)("group move producer on migrated PostgreSQL with a fake Linq SDK", () => {
  const db = getPrisma();
  let room: string, owner: string, sender: string, sourceChat: string, targetChat: string, source: string, target: string, person: string;
  let sourceKey: string, targetKey: string, containerRef: string, targetPresent: boolean, sourcePresent: boolean, humans: number;
  let callbacks: (() => Promise<void>)[];
  let extraRooms: string[];
  const eventBodies = new Map<string, string>();
  beforeEach(async () => {
    localRosterCrypto(); setHostedSecureBoxStringTestCodecForTests(null);
    [room, owner, sender, sourceChat, targetChat] = Array.from({ length: 5 }, () => randomUUID());
    source = syntheticPhone(); target = syntheticPhone(); person = syntheticPhone(); targetPresent = false; sourcePresent = true; humans = 2;
    callbacks = []; extraRooms = []; eventBodies.clear();
    for (const mock of Object.values(provider)) mock.mockReset();
    provider.retrieve.mockImplementation(async (id: string) => ({ is_group: true, service: "iMessage", handles: [
      ...(sourcePresent ? [{ handle: source, is_me: id === sourceChat, status: "active" }] : []),
      ...(targetPresent ? [{ handle: target, is_me: id === targetChat, status: "active" }] : []),
      { handle: person, is_me: false, status: "active" },
      ...(humans > 1 ? [{ handle: "synthetic-person@example.test", is_me: false, status: "active" }] : []),
    ] }));
    provider.add.mockImplementation(async () => { targetPresent = true; return { status: "queued" }; });
    provider.remove.mockImplementation(async () => { targetPresent = false; return { status: "queued" }; });
    provider.leave.mockImplementation(async () => { sourcePresent = false; return { status: "queued" }; });
    provider.send.mockResolvedValue({ message: { id: randomUUID() } });
    provider.signal.mockResolvedValue({ workflowId: "synthetic-wake" });
    const ids = [room, owner, sender];
    await db.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "active" })) });
    for (const userId of ids) await provisionHostedCryptoDomainRootsForUser({ userId, prisma: db });
    await rosterPhoneIdentity(db, sender, person);
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: owner } });
    sourceKey = await rosterRoute(db, room, sourceChat, source);
    await db.hostedLinqLine.update({ where: { phoneNumberLookupKey: sourceKey }, data: { providerInventoryConfirmedAt: new Date(), providerPhoneNumberId: randomUUID() } });
    targetKey = createHostedPhoneLookupKey(target)!;
    await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: targetKey, phoneNumberHint: "synthetic", phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(target),
      providerInventoryConfirmedAt: new Date(), providerPhoneNumberId: randomUUID(), configuredAt: new Date(), healthStatus: "healthy", egressPolicy: "enabled", providerServiceStatus: "ACTIVE", providerReputationStatus: "HEALTHY" } });
    containerRef = createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: sourceChat })!;
  });
  afterEach(async () => {
    await db.hostedLinqDelivery.deleteMany({ where: { phoneNumberLookupKey: { in: [sourceKey, targetKey] } } });
    await db.hostedLinqProviderEvent.deleteMany({ where: { phoneNumberLookupKey: { in: [sourceKey, targetKey] } } });
    await db.hostedRuntimeOwner.deleteMany({ where: { userId: room } });
    await db.game.deleteMany({ where: { chatContainerMemberId: room } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: [owner, sender] } } });
    await db.hostedThreadContainer.deleteMany({ where: { ownerMemberId: { in: [owner, sender] } } });
    await db.hostedMember.deleteMany({ where: { id: { in: [room, owner, sender, ...extraRooms] } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: [sourceKey, targetKey] } } });
    vi.useRealTimers(); vi.unstubAllEnvs();
  });
  const start = () => startHostedLinqGroupLineMove({ containerRef, targetLineLookupKey: targetKey, prisma: db });
  const operate = (moveId: string, operation: "resume" | "cancel" | "retry_leave" = "resume") => operateHostedLinqGroupLineMove({ moveId, operation, prisma: db });
  const row = (id: string) => db.hostedLinqGroupLineMove.findUniqueOrThrow({ where: { id } });
  async function admissionCounts() {
    const containers = await db.hostedThreadContainer.findMany({ where: { ownerMemberId: { in: [owner, sender] } }, select: { memberId: true } });
    const members = containers.map(container => container.memberId);
    return {
      containers: containers.length,
      routes: await db.hostedThreadRoute.count({ where: { containerMemberId: { in: members } } }),
      mailbox: await db.hostedMailboxItem.groupBy({ by: ["kind"], where: { userId: { in: members } }, _count: true, orderBy: { kind: "asc" } }),
    };
  }
  async function settleSourceWork() {
    await db.hostedMailboxItem.updateMany({ where: { userId: room }, data: { consumedAt: new Date() } });
    const progress = await readHostedMailboxProgress({ userId: room, prisma: db });
    await advanceHostedMailboxConsumedSeqByLane({ userId: room, prisma: db,
      lanes: progress.maxSeqByLane.map(row => ({ lane: row.lane, consumedSeq: row.maxSeq })) });
    vi.setSystemTime(Date.now() + 60_001);
  }
  async function reserve(step: "reserved" | "add_started" | "add_confirmed") {
    const id = randomUUID();
    const sourceCleanupEncrypted = await prepareHostedLinqGroupMoveCleanup({ id, containerMemberId: room,
      fromAccountLookupKey: sourceKey, toAccountLookupKey: targetKey, sourceChatId: sourceChat, prisma: db });
    await db.hostedLinqGroupLineMove.create({ data: { id, containerMemberId: room, sourceCleanupEncrypted,
      fromAccountLookupKey: sourceKey, toAccountLookupKey: targetKey, fromThreadIdentityLookupKey: containerRef,
      adoptionDeadlineAt: new Date(Date.now() + 86_400_000),
      addStartedAt: step === "reserved" ? null : new Date(),
      addConfirmedAt: step === "add_confirmed" ? new Date() : null,
    } });
    targetPresent = step !== "reserved";
    return id;
  }
  async function webhook(chat = targetChat, from = source, text = "Synthetic ordinary service reply", line = target, eventId = randomUUID(), media = false, occurredAt = new Date().toISOString()) {
    const rawBody = eventBodies.get(eventId) ?? JSON.stringify({ api_version: "v3", webhook_version: "2026-02-03", created_at: occurredAt,
      event_id: eventId, event_type: "message.received", data: {
        chat: { id: chat, is_group: true, owner_handle: { handle: line, id: "synthetic-self", is_me: true, service: "iMessage" } },
        direction: "inbound", id: randomUUID(), parts: media ? [{ type: "media", attachment_id: "synthetic-photo", mime_type: "image/jpeg", url: "https://attachments.example.test/synthetic-photo" }] : [{ type: "text", value: text }],
        sender_handle: { handle: from, id: "synthetic-sender", service: "iMessage" }, sent_at: occurredAt, service: "iMessage",
      } });
    eventBodies.set(eventId, rawBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return handleHostedOnboardingLinqWebhook({ prisma: db, rawBody, timestamp,
      signature: createHmac("sha256", "synthetic-roster-secret").update(`${timestamp}.${rawBody}`).digest("hex"),
      scheduleAfterResponse: work => { callbacks.push(work); } });
  }
  it.each([false, true])("starts, holds, adopts and leaves with missing account projection=%s", async missingProjection => {
    if (missingProjection) await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { accountLookupKey: null } });
    const result = await start(); expect(result.status).toBe("reserved"); expect(result.addConfirmedAt).not.toBeNull();
    expect((await db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } })).accountLookupKey).toBe(sourceKey);
    expect(result.adoptionDeadlineAt).toBeDefined();
    expect(provider.send).not.toHaveBeenCalled();
    await expect(webhook(sourceChat, person, "Synthetic human handoff message", source)).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    expect(await db.hostedMailboxItem.count({ where: { userId: room } })).toBe(0);
    await webhook(); expect((await row(result.moveId)).status).toBe("adopted"); expect(provider.leave).not.toHaveBeenCalled();
    const routes = await db.hostedThreadRoute.findMany({ where: { containerMemberId: room } });
    expect(routes).toHaveLength(1); expect(routes[0]?.accountLookupKey).toBe(targetKey);
    for (const callback of callbacks) await callback();
    expect((await row(result.moveId)).status).toBe("left"); expect(provider.leave).toHaveBeenCalledOnce();
    expect((await operate(result.moveId, "retry_leave")).status).toBe("left"); expect(provider.leave).toHaveBeenCalledOnce();
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
  });
  it("adopts a person's photo as the first event and preserves it for normal redelivery", async () => {
    const result = await start(), eventId = randomUUID();
    const photo = () => webhook(targetChat, person, "", target, eventId, true);
    await expect(photo()).rejects.toMatchObject({ httpStatus: 503 });
    expect((await row(result.moveId)).status).toBe("adopted");
    await photo(); await photo();
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("cannot cancel a concurrent in-flight add from absence alone, then verifies cleanup", async () => {
    let releaseAdd: (() => void) | undefined;
    provider.add.mockImplementation(async () => {
      await new Promise<void>(resolve => { releaseAdd = resolve; });
      targetPresent = true;
      return { status: "queued" };
    });
    const starting = start();
    await vi.waitFor(() => expect(releaseAdd).toBeDefined());
    const move = await db.hostedLinqGroupLineMove.findFirstOrThrow({ where: { containerMemberId: room } });
    expect(await operate(move.id, "cancel")).toMatchObject({ status: "reserved", adoptionExpired: true, code: "add_outcome_unknown" });
    releaseAdd!(); await starting;
    expect((await row(move.id)).status).toBe("reserved");
    expect(await operate(move.id, "cancel")).toMatchObject({ status: "cancelled" });
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.remove).toHaveBeenCalledOnce();
  });
  it.each([false, true])("start, human on both lines, one normal target reply and leave; targetFirst=%s", async targetFirst => {
    const result = await start(), sourceEvent = randomUUID(), targetEvent = randomUUID();
    const oldCopy = () => webhook(sourceChat, person, "Synthetic group question", source, sourceEvent);
    const newCopy = () => webhook(targetChat, person, "Synthetic group question", target, targetEvent);
    if (!targetFirst) await expect(oldCopy()).rejects.toMatchObject({ httpStatus: 503 });
    await expect(newCopy()).rejects.toMatchObject({ httpStatus: 503 });
    expect((await row(result.moveId)).status).toBe("adopted");
    await oldCopy(); await newCopy(); await oldCopy(); await newCopy();
    const input = await db.hostedMailboxItem.findMany({ where: { userId: room, kind: "conversation.message" } });
    expect(input).toHaveLength(1);
    // Synthetic runtime answers the one accepted input through real egress authority and the fake SDK.
    const { resolvedRoute } = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: room, target: targetChat, targetKind: "thread", authorityCheckOnly: true, prisma,
    }));
    expect(resolvedRoute.fromPhoneNumber).toBe(target);
    await sendHostedLinqChatMessage({ chatId: resolvedRoute.target, message: "Synthetic normal group answer", idempotencyKey: input[0]!.id });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send.mock.calls[0]?.[0]).toBe(targetChat);
    expect(provider.leave).not.toHaveBeenCalled();
    for (const callback of callbacks) await callback();
    expect((await row(result.moveId)).status).toBe("left"); expect(provider.leave).toHaveBeenCalledOnce();
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])("bounds the source hold and disarms adoption before source admission; heldTargetFirst=%s; replayBeforeRestart=%s", async (heldTargetFirst, replayBeforeRestart) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = Date.now(); vi.setSystemTime(at);
    const result = await start(), oldId = randomUUID(), newId = randomUUID();
    const oldCopy = () => webhook(sourceChat, person, "Synthetic held question", source, oldId);
    const newCopy = () => webhook(targetChat, person, "Synthetic held question", target, newId);
    if (heldTargetFirst) {
      const readRoster = provider.retrieve.getMockImplementation()!;
      provider.retrieve.mockImplementation(async (chatId: string) => {
        if (chatId === targetChat) throw new Error("synthetic incomplete read");
        return readRoster(chatId);
      });
      await expect(newCopy()).rejects.toMatchObject({ httpStatus: 503 });
      provider.retrieve.mockImplementation(readRoster);
    }
    await expect(oldCopy()).rejects.toMatchObject({ httpStatus: 503 });
    vi.setSystemTime(at + 60_001);
    await oldCopy(); await oldCopy();
    expect((await row(result.moveId))).toMatchObject({ status: "reserved", lastErrorCode: "source_hold_expired", adoptionDeadlineAt: new Date(0) });
    const { resolvedRoute } = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({ memberId: room,
      target: sourceChat, targetKind: "thread", authorityCheckOnly: true, prisma }));
    expect(resolvedRoute.fromPhoneNumber).toBe(source);
    await sendHostedLinqChatMessage({ chatId: resolvedRoute.target, message: "Synthetic source answer", idempotencyKey: oldId });
    await expect(newCopy()).rejects.toMatchObject({ httpStatus: 503 });
    await expect(webhook(targetChat, person, "Synthetic later question")).rejects.toMatchObject({ httpStatus: 503 });
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect(provider.send).toHaveBeenCalledOnce();
    expect((await operate(result.moveId)).adoptionExpired).toBe(true);
    expect((await operate(result.moveId, "cancel")).status).toBe("cancelled");
    const admitted = await admissionCounts();
    expect(targetPresent).toBe(false);
    // The complete provider roster now lacks target/self. The old event still
    // must not create a container, route, activation or conversation input.
    if (replayBeforeRestart) { await newCopy(); await newCopy(); }
    expect(await admissionCounts()).toEqual(admitted);
    await settleSourceWork();
    const restarted = await start();
    expect(targetPresent).toBe(true);
    await newCopy(); await newCopy();
    expect((await row(restarted.moveId)).status).toBe("reserved");
    expect(await admissionCounts()).toEqual(admitted);
    vi.setSystemTime(Date.now() + 1);
    const freshId = randomUUID();
    const fresh = () => webhook(targetChat, person, "Synthetic fresh question", target, freshId);
    await expect(fresh()).rejects.toMatchObject({ httpStatus: 503 });
    await fresh(); await fresh(); await newCopy();
    expect((await row(restarted.moveId)).status).toBe("adopted");
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(2);
    expect((await admissionCounts()).containers).toBe(admitted.containers);
    expect((await admissionCounts()).routes).toBe(admitted.routes);
    for (const callback of callbacks) await callback();
    expect((await row(restarted.moveId)).status).toBe("left");
    expect(provider.leave).toHaveBeenCalledOnce(); expect(provider.add).toHaveBeenCalledTimes(2);
  });
  it("stops a delayed positive-roster cancellation after another cancel settles and a new move adopts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const result = await start();
    const read = provider.retrieve.getMockImplementation()!;
    let releaseRoster!: () => void;
    provider.retrieve.mockImplementationOnce(async (chatId: string) => {
      const positiveRoster = await read(chatId);
      await new Promise<void>(resolve => { releaseRoster = resolve; });
      return positiveRoster;
    });
    const delayed = operate(result.moveId, "cancel");
    await vi.waitFor(() => expect(releaseRoster).toBeDefined());
    expect((await row(result.moveId)).adoptionDeadlineAt).toEqual(new Date(0));
    try {
      expect((await operate(result.moveId, "cancel")).status).toBe("cancelled");
      vi.setSystemTime(Date.now() + 1);
      const restarted = await start();
      await webhook();
      expect((await row(restarted.moveId)).status).toBe("adopted");
    } finally { releaseRoster(); await delayed; }
    expect(provider.remove).toHaveBeenCalledOnce(); expect(targetPresent).toBe(true);
  });
  it("keeps the source and target reserved while the removal owner can still dispatch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const result = await start();
    let releaseRemoval!: () => void;
    provider.remove.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseRemoval = resolve; });
      targetPresent = false;
      return { status: "queued" };
    });
    const removing = operate(result.moveId, "cancel");
    await vi.waitFor(() => expect(releaseRemoval).toBeDefined());
    try {
      expect((await operate(result.moveId, "cancel")).status).toBe("reserved");
      expect(provider.remove).toHaveBeenCalledOnce();
      // An intervening roster absence cannot release an outstanding dispatch.
      targetPresent = false;
      expect((await operate(result.moveId, "cancel")).status).toBe("reserved");
      await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_MOVE_CONFLICT" });
      await expect(webhook()).rejects.toMatchObject({ httpStatus: 503 });
      expect(provider.remove).toHaveBeenCalledOnce();
    } finally { releaseRemoval(); await removing; }
    expect((await row(result.moveId)).status).toBe("cancelled");
    vi.setSystemTime(Date.now() + 1);
    const restarted = await start(); await webhook();
    expect((await row(restarted.moveId)).status).toBe("adopted");
    await operate(result.moveId, "cancel");
    expect(provider.remove).toHaveBeenCalledOnce(); expect(targetPresent).toBe(true);
  });
  it("lets the source continue on expiry while holding the unbound target copy", async () => {
    const result = await start();
    await db.hostedLinqGroupLineMove.update({ where: { id: result.moveId }, data: { adoptionDeadlineAt: new Date(1) } });
    await webhook(sourceChat, person, "Synthetic source after expiry", source);
    await expect(webhook(targetChat, person, "Synthetic source after expiry")).rejects.toMatchObject({ httpStatus: 503 });
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect((await operate(result.moveId)).status).toBe("reserved");
  });
  it.each(["reserved", "add_started", "add_confirmed"] as const)("resumes an interrupted %s without repeating an effect", async step => {
    const id = await reserve(step); await operate(id); await operate(id);
    expect(provider.add).toHaveBeenCalledTimes(step === "reserved" ? 1 : 0);
    expect((await row(id)).status).toBe("reserved");
  });
  it("disarms an interrupted unknown add without repeating or falsely settling it", async () => {
    const id = await reserve("add_started"); targetPresent = false;
    expect(await operate(id)).toMatchObject({ status: "reserved", code: "add_unconfirmed", adoptionExpired: true });
    expect(await operate(id, "cancel")).toMatchObject({ status: "reserved", code: "add_unconfirmed" });
    targetPresent = true;
    expect(await operate(id, "cancel")).toMatchObject({ status: "cancelled" });
    expect(provider.add).not.toHaveBeenCalled();
  });
  it("reports a rejected sibling add and releases the reservation after an absence read", async () => {
    provider.add.mockRejectedValue(new APIError(403, {}, "synthetic rejection", new Headers()));
    expect(await start()).toMatchObject({ status: "cancelled", code: "add_rejected_http_403", holdActive: false });
    expect(provider.send).not.toHaveBeenCalled(); expect(provider.retrieve).toHaveBeenCalledTimes(3);
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room, accountLookupKey: sourceKey } })).toBe(1);
  });
  it("keeps bound groups live and replay fenced after five rejected moves, then adopts a fresh move", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const oldTime = new Date(Date.now() - 1_000).toISOString();
    const otherRoom = randomUUID(), otherChat = randomUUID(); extraRooms.push(otherRoom);
    await db.hostedMember.create({ data: { id: otherRoom, billingStatus: "active" } });
    await provisionHostedCryptoDomainRootsForUser({ userId: otherRoom, prisma: db });
    await db.hostedThreadContainer.create({ data: { memberId: otherRoom, ownerMemberId: owner } });
    await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: otherRoom, accountLookupKey: targetKey,
      threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: otherChat })!,
      threadLookupKey: createHostedExternalThreadLookupKey({ channel: "linq", threadId: otherChat, accountLookupKey: targetKey })!,
      deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({ containerMemberId: otherRoom, prisma: db,
        route: buildHostedThreadDeliveryRoute({ channel: "linq", threadId: otherChat, accountLookupKey: targetKey }) }),
    } });
    const retrieve = provider.retrieve.getMockImplementation()!;
    provider.retrieve.mockImplementation(async (id: string) => id === otherChat ? {
      is_group: true, service: "iMessage", handles: [
        { handle: target, is_me: true, status: "active" },
        { handle: person, is_me: false, status: "active" },
        { handle: "synthetic-person@example.test", is_me: false, status: "active" },
      ],
    } : retrieve(id));
    provider.add.mockRejectedValue(new APIError(403, {}, "synthetic rejection", new Headers()));
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await start()).toMatchObject({ status: "cancelled", code: "add_rejected_http_403" });
      vi.setSystemTime(Date.now() + 1_000);
    }
    expect(await db.hostedLinqGroupLineMove.count({ where: { toAccountLookupKey: targetKey, status: "cancelled" } })).toBe(5);
    const boundId = randomUUID();
    await webhook(otherChat, person, "Synthetic unrelated group question", target, boundId);
    await webhook(otherChat, person, "Synthetic unrelated group question", target, boundId);
    const messages = await db.hostedMailboxItem.findMany({ where: { userId: otherRoom, kind: "conversation.message" } });
    expect(messages).toHaveLength(1);
    const { resolvedRoute } = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({
      memberId: otherRoom, target: otherChat, targetKind: "thread", authorityCheckOnly: true, prisma,
    }));
    await sendHostedLinqChatMessage({ chatId: resolvedRoute.target, message: "Synthetic unrelated group answer", idempotencyKey: messages[0]!.id });
    expect(provider.send).toHaveBeenCalledOnce(); expect(provider.send.mock.calls[0]?.[0]).toBe(otherChat);
    const admitted = await admissionCounts();
    const oldId = randomUUID();
    await webhook(targetChat, person, "Synthetic old input", target, oldId, false, oldTime);
    expect(await admissionCounts()).toEqual(admitted);
    provider.add.mockImplementation(async () => { targetPresent = true; return { status: "queued" }; });
    vi.setSystemTime(Date.now() + 60_001);
    const freshMove = await start(), freshId = randomUUID();
    await webhook(targetChat, person, "Synthetic old input", target, oldId);
    expect((await row(freshMove.moveId)).status).toBe("reserved");
    await expect(webhook(targetChat, person, "Synthetic fresh input", target, freshId)).rejects.toMatchObject({ httpStatus: 503 });
    await webhook(targetChat, person, "Synthetic fresh input", target, freshId);
    expect((await row(freshMove.moveId)).status).toBe("adopted");
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect((await admissionCounts()).containers).toBe(admitted.containers);
  });
  it("disarms an ambiguous add without sending a fallback", async () => {
    provider.add.mockRejectedValue(new Error("synthetic timeout"));
    expect(await start()).toMatchObject({ status: "reserved", code: "add_unconfirmed", adoptionExpired: true });
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
  });
  it("does not falsely settle a queued add whose complete confirmation read is absent", async () => {
    provider.add.mockResolvedValue({ status: "queued" });
    expect(await start()).toMatchObject({ status: "reserved", code: "add_unconfirmed", adoptionExpired: true });
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "incomplete"])("disarms adoption when the add confirmation roster is %s", async failure => {
    const read = provider.retrieve.getMockImplementation()!;
    provider.add.mockImplementation(async () => {
      targetPresent = true;
      provider.retrieve.mockImplementation(async () => {
        if (failure === "unavailable") throw new Error("Synthetic roster outage");
        return { is_group: true, service: "iMessage" };
      });
      return { status: "queued" };
    });
    const result = await start();
    expect(result).toMatchObject({ status: "reserved", adoptionExpired: true, holdActive: true, sourceHoldActive: false });
    expect(result.code).not.toBeNull();
    expect(await operate(result.moveId)).toMatchObject({ status: "reserved", adoptionExpired: true });
    provider.retrieve.mockImplementation(read);
    expect(await operate(result.moveId, "cancel")).toMatchObject({ status: "cancelled", holdActive: false });
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.remove).toHaveBeenCalledOnce();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it("cancels before the add, without a provider mutation", async () => {
    const id = await reserve("reserved"); expect(await operate(id, "cancel")).toMatchObject({ status: "cancelled", holdActive: false });
    expect(provider.remove).not.toHaveBeenCalled(); expect(provider.send).not.toHaveBeenCalled();
  });
  it("verifies removal, disarms adoption, retains the hold until absent, and then releases it", async () => {
    const result = await start(); provider.remove.mockResolvedValue({ status: "queued" });
    expect(await operate(result.moveId, "cancel")).toMatchObject({ status: "reserved", code: "remove_pending", holdActive: true });
    expect(await operate(result.moveId, "cancel")).toMatchObject({ status: "reserved", code: "remove_pending", holdActive: true });
    expect(provider.remove).toHaveBeenCalledOnce();
    await expect(webhook()).rejects.toMatchObject({ retryable: true });
    targetPresent = false;
    expect(await operate(result.moveId, "cancel")).toMatchObject({ status: "cancelled", holdActive: false });
    expect(provider.remove).toHaveBeenCalledOnce();
  });
  it("retains an interrupted removal claim even on absence, without redispatch", async () => {
    const id = await reserve("add_confirmed");
    await db.hostedLinqGroupLineMove.update({ where: { id }, data: { adoptionDeadlineAt: new Date(0), removeStartedAt: new Date() } });
    targetPresent = false;
    expect(await operate(id, "cancel")).toMatchObject({ status: "reserved", code: "remove_outcome_unknown" });
    await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_MOVE_CONFLICT" });
    expect(provider.remove).not.toHaveBeenCalled();
  });
  it("recovers after accepted removal and interruption before cancellation commits", async () => {
    const id = await reserve("add_confirmed");
    await db.hostedLinqGroupLineMove.update({ where: { id }, data: { adoptionDeadlineAt: new Date(0),
      removeStartedAt: new Date(), removeAcceptedAt: new Date() } });
    targetPresent = false;
    expect(await operate(id, "cancel")).toMatchObject({ status: "cancelled" });
    expect(provider.remove).not.toHaveBeenCalled();
  });
  it("keeps adoption permanent when leave is rejected or the group is too small", async () => {
    const result = await start(); await webhook(); humans = 1;
    expect(await operate(result.moveId, "retry_leave")).toMatchObject({ status: "adopted", code: "leave_requires_four_participants" });
    expect(provider.leave).not.toHaveBeenCalled();
    await expect(operate(result.moveId, "cancel")).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_ALREADY_ADOPTED" });
    humans = 2; provider.leave.mockRejectedValueOnce(new Error("synthetic failure"));
    expect(await operate(result.moveId, "retry_leave")).toMatchObject({ status: "adopted", code: "leave_unconfirmed" });
    expect(await operate(result.moveId, "retry_leave")).toMatchObject({ status: "left", code: null });
  });
  it("does not mark left for queued departure; a later absence settles without another leave", async () => {
    const result = await start(); await webhook(); provider.leave.mockResolvedValue({ status: "queued" });
    expect(await operate(result.moveId, "retry_leave")).toMatchObject({ status: "adopted", code: "leave_pending" });
    sourcePresent = false;
    expect((await operate(result.moveId, "retry_leave")).status).toBe("left"); expect(provider.leave).toHaveBeenCalledOnce();
  });
  it("never renews an expired adoption deadline or performs an overdue add", async () => {
    const id = await reserve("add_confirmed"); await db.hostedLinqGroupLineMove.update({ where: { id }, data: { adoptionDeadlineAt: new Date(1) } });
    expect(await operate(id)).toMatchObject({ status: "reserved", code: "adoption_deadline_elapsed" });
    expect(provider.send).not.toHaveBeenCalled(); expect((await operate(id, "cancel")).status).toBe("cancelled");
  });
  it("serializes concurrent starts and rejects another reservation on the same source/target", async () => {
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { accountLookupKey: null } });
    const results = await Promise.allSettled([start(), start()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.hostedLinqGroupLineMove.count({ where: { containerMemberId: room } })).toBe(1);
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
  });
  it.each(["inbound", "runtime", "delivery"])("rejects %s work before reservation or add", async kind => {
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { accountLookupKey: null } });
    if (kind === "inbound") await db.hostedLinqProviderEvent.create({ data: { eventId: randomUUID(), eventType: "message.received",
      receivedAt: new Date(), providerCreatedAt: new Date(), linqChatLookupKey: createHostedLinqChatLookupKey(sourceChat), phoneNumberLookupKey: sourceKey } });
    if (kind === "runtime") await db.hostedRuntimeOwner.create({ data: { userId: room, phase: "starting", attemptId: randomUUID(), allocationId: randomUUID(), processingMode: "default" } });
    if (kind === "delivery") await claimHostedLinqDeliveryProviderDispatchTx({ idempotencyKey: randomUUID(), source: "synthetic", linqChatId: sourceChat, phoneNumber: source, prisma: db });
    await expect(start()).rejects.toMatchObject({ httpStatus: 409 }); expect(provider.add).not.toHaveBeenCalled();
    expect(await db.hostedLinqGroupLineMove.count({ where: { containerMemberId: room } })).toBe(0);
    expect((await db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } })).accountLookupKey).toBeNull();
  });
  it.each(["runtime accepted", "webhook accepted", "runtime dispatch"])("starts past historical %s metadata without rewriting it", async kind => {
    const earlier = new Date(Date.now() - 86_400_000), id = randomUUID();
    const status = kind === "runtime dispatch" ? "provider_dispatch_started" : "accepted";
    await db.hostedLinqDelivery.create({ data: { id, source: kind === "webhook accepted"
      ? "hosted_webhook_side_effect" : "hosted_runtime_linq_delivery",
      status, attemptedAt: earlier, updatedAt: earlier, acceptedAt: status === "accepted" ? earlier : null,
      targetKind: "explicit", threadIsDirect: null,
      linqChatLookupKey: createHostedLinqChatLookupKey(sourceChat), phoneNumberLookupKey: sourceKey } });
    const before = await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id } });
    const move = await start();
    expect(move).toMatchObject({ status: "reserved", code: null });
    expect(provider.add).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
    const eventId = randomUUID();
    const incoming = () => webhook(targetChat, person, "Synthetic handoff", target, eventId);
    await expect(incoming()).rejects.toMatchObject({ httpStatus: 503 });
    await incoming(); await incoming();
    for (const callback of callbacks) await callback();
    expect((await row(move.moveId)).status).toBe("left");
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect((await db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } })).accountLookupKey).toBe(targetKey);
    expect(provider.leave).toHaveBeenCalledOnce(); expect(provider.send).not.toHaveBeenCalled();
    expect(await db.hostedLinqDelivery.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
  it.each(["recent attempt", "recent update", "recent acceptance", "missing acceptance", "payload", "drain window", "recent dispatch",
    "payload owner", "payload schema", "other source", "generation", "dispatch receipt", "dispatch failure"])
  ("keeps the delivery veto for %s", async kind => {
    const earlier = new Date(Date.now() - 86_400_000), now = new Date();
    const dispatch = kind.includes("dispatch");
    await db.hostedLinqDelivery.create({ data: { id: randomUUID(),
      source: kind === "other source" ? "game_lifecycle" : "hosted_runtime_linq_delivery",
      status: kind === "generation" ? "generation_queued" : dispatch ? "provider_dispatch_started" : "accepted",
      attemptedAt: kind === "recent attempt" || kind === "recent dispatch" ? now
        : kind === "drain window" ? new Date(Date.now() - 14 * 60_000) : earlier,
      updatedAt: kind === "recent update" ? now : earlier,
      acceptedAt: dispatch || kind === "missing acceptance" ? null : kind === "recent acceptance" ? now : earlier,
      payloadCiphertext: kind === "payload" ? "synthetic-sealed-obligation" : null,
      payloadOwnerMemberId: kind === "payload owner" ? room : null,
      payloadSchema: kind === "payload schema" ? "synthetic-obligation" : null,
      messageLookupKey: kind === "dispatch receipt" ? randomUUID() : null,
      failureCode: kind === "dispatch failure" ? "synthetic-partial-send" : null,
      linqChatLookupKey: createHostedLinqChatLookupKey(sourceChat), phoneNumberLookupKey: sourceKey } });
    await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_WORK_PENDING" });
    expect(provider.add).not.toHaveBeenCalled();
    expect(await db.hostedLinqGroupLineMove.count({ where: { containerMemberId: room } })).toBe(0);
  });
  it.each(["acknowledged", "unacknowledged", "expired"])("uses canonical lane progress for %s system work", async state => {
    const id = randomUUID(), earlier = new Date(Date.now() - 120_000);
    await db.hostedMailboxItem.create({ data: { id, userId: room, lane: "system", laneSeq: 1n,
      dedupeKey: randomUUID(), kind: "assistant.notification.requested", occurredAt: earlier,
      createdAt: earlier, payloadSchema: "synthetic", expiresAt: state === "expired" ? earlier : null } });
    await db.hostedMailboxLaneCounter.create({ data: { userId: room, lane: "system", nextSeq: 2n } });
    if (state === "acknowledged") await advanceHostedMailboxConsumedSeqByLane({ userId: room, prisma: db,
      lanes: [{ lane: "system", consumedSeq: "1" }] });
    expect((await db.hostedMailboxItem.findUniqueOrThrow({ where: { id } })).consumedAt).toBeNull();
    if (state === "unacknowledged") {
      await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_WORK_PENDING" });
      expect(provider.add).not.toHaveBeenCalled();
    } else {
      expect(await start()).toMatchObject({ status: "reserved", code: null });
      expect(provider.add).toHaveBeenCalledOnce();
    }
    expect((await db.hostedMailboxItem.findUniqueOrThrow({ where: { id } })).consumedAt).toBeNull();
  });
  it("keeps the quietness window for an acknowledged recent conversation", async () => {
    await db.hostedMailboxItem.create({ data: { id: randomUUID(), userId: room, lane: "conversation", laneSeq: 1n,
      dedupeKey: randomUUID(), kind: "conversation.message", occurredAt: new Date(), payloadSchema: "synthetic" } });
    await db.hostedMailboxLaneCounter.create({ data: { userId: room, lane: "conversation", nextSeq: 2n } });
    await advanceHostedMailboxConsumedSeqByLane({ userId: room, prisma: db,
      lanes: [{ lane: "conversation", consumedSeq: "1" }] });
    await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_WORK_PENDING" });
    expect(provider.add).not.toHaveBeenCalled();
  });
  it.each(["projection", "thread"])("rejects inconsistent %s authority without repairing or adding", async kind => {
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: kind === "projection"
      ? { accountLookupKey: targetKey } : { accountLookupKey: null, threadLookupKey: "synthetic-mismatched-thread" } });
    await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_ROUTE_CHANGED" });
    expect(provider.retrieve).not.toHaveBeenCalled(); expect(provider.add).not.toHaveBeenCalled();
    expect(await db.hostedLinqGroupLineMove.count({ where: { containerMemberId: room } })).toBe(0);
    expect((await db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } })).accountLookupKey)
      .toBe(kind === "projection" ? targetKey : null);
  });
  it("does not overwrite a legacy projection changed during roster preparation", async () => {
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { accountLookupKey: null } });
    const retrieve = provider.retrieve.getMockImplementation()!;
    provider.retrieve.mockImplementationOnce(async (id: string) => {
      await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { accountLookupKey: targetKey } });
      return retrieve(id);
    });
    await expect(start()).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_ROUTE_CHANGED" });
    expect(provider.add).not.toHaveBeenCalled();
    expect(await db.hostedLinqGroupLineMove.count({ where: { containerMemberId: room } })).toBe(0);
    expect((await db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } })).accountLookupKey).toBe(targetKey);
  });
  it.each(["sms", "target_disabled", "source_flagged", "target_present"])("fails closed for %s", async kind => {
    if (kind === "sms") provider.retrieve.mockResolvedValue({ is_group: true, service: "SMS", handles: [
      { handle: source, is_me: true, status: "active" }, { handle: person, is_me: false, status: "active" },
      { handle: "synthetic-person@example.test", is_me: false, status: "active" },
    ] });
    if (kind === "target_disabled") await db.hostedLinqLine.update({ where: { phoneNumberLookupKey: targetKey }, data: { egressPolicy: "disabled" } });
    if (kind === "source_flagged") await db.hostedLinqLine.update({ where: { phoneNumberLookupKey: sourceKey }, data: { providerServiceStatus: "FLAGGED" } });
    if (kind === "target_present") targetPresent = true;
    await expect(start()).rejects.toMatchObject({ httpStatus: 409 }); expect(provider.add).not.toHaveBeenCalled();
  });
  it("lists bounded hints and opaque candidate refs without raw identities", async () => {
    const result = await start();
    const overview = await readHostedLinqGroupLineMoveOverview({ status: "reserved", sourceLineLookupKey: sourceKey, prisma: db });
    expect(overview.moves[0]?.moveId).toBe(result.moveId);
    expect(overview.candidates).toEqual([{ containerRef, containerHint: room.slice(-8), lastActivityAt: null, hasLiveGame: false }]);
    for (const raw of [room, owner, sender, sourceChat, targetChat, source, target, person]) expect(JSON.stringify(overview)).not.toContain(raw);
  });
});
