import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { provisionHostedCryptoDomainRootsForUser } from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithHostedDomainRootProviderCallsDisabled } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { createHostedExternalThreadIdentityLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { prepareHostedLinqGroupMoveCleanup, openHostedLinqGroupMoveCleanup, linqGroupMoveSelect, readHostedLinqGroupMoveServicePhones } from "@/src/lib/hosted-routing/linq-group-line-move-store";
import { prepareHostedLinqGroupMoveIngress } from "@/src/lib/hosted-routing/linq-group-line-move-ingress";
import { replaceHostedLinqGroupLineMoveRouteTx } from "@/src/lib/hosted-routing/thread-container-service";
import { prepareHostedLinqGroupMoveEgressAlias, assertHostedLinqRecentInboundEngagementForRuntime } from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import { encryptHostedLinqLinePhoneNumber } from "@/src/lib/hosted-onboarding/linq-line-phone-codec";
import { sha256Hex } from "@/src/lib/primitives";
import { localRosterCrypto, rosterPhoneIdentity, rosterRoute, syntheticPhone } from "./support/roster-postgres";

const provider = vi.hoisted(() => ({ retrieve: vi.fn(), send: vi.fn(), signal: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({ ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { retrieve: provider.retrieve, messages: { send: provider.send } }; },
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: provider.signal }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Move proof requires an isolated local test database.");
const held = { retryable: true, httpStatus: 503 };

describe.skipIf(!enabled)("Linq group line move consumers on migrated PostgreSQL", () => {
  const db = getPrisma();
  let room: string, owner: string, sender: string, fromChat: string, toChat: string, source: string, target: string, phone: string, moveId: string, sourceKey: string, targetKey: string;
  const notice = "This group is moving. Reference synthetic-move-7d92.";
  let ids: string[];
  beforeEach(async () => {
    localRosterCrypto();
    setHostedSecureBoxStringTestCodecForTests(null);
    provider.retrieve.mockReset(); provider.send.mockReset().mockImplementation(async () => ({ message: { id: randomUUID() } })); provider.signal.mockReset().mockResolvedValue({ workflowId: "synthetic-wake" });
    [room, owner, sender, fromChat, toChat, moveId] = Array.from({ length: 6 }, () => randomUUID()); ids = [room, owner, sender];
    source = syntheticPhone(); target = syntheticPhone(); phone = syntheticPhone();
    await db.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "active" })) });
    for (const userId of ids) await provisionHostedCryptoDomainRootsForUser({ userId, prisma: db });
    await rosterPhoneIdentity(db, sender, phone);
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: owner,
      participants: { create: { participantMemberId: sender, handleLookupKey: createHostedPhoneLookupKey(phone)!, firstSeenAt: new Date(), lastSeenAt: new Date() } } } });
    sourceKey = await rosterRoute(db, room, fromChat, source);
    await db.hostedLinqLine.update({ where: { phoneNumberLookupKey: sourceKey }, data: { providerInventoryConfirmedAt: new Date(), providerPhoneNumberId: randomUUID() } });
    targetKey = createHostedPhoneLookupKey(target)!;
    await db.hostedLinqLine.create({ data: { phoneNumberLookupKey: targetKey, phoneNumberHint: "synthetic", phoneNumberEncrypted: encryptHostedLinqLinePhoneNumber(target),
      providerInventoryConfirmedAt: new Date(), providerPhoneNumberId: randomUUID(), configuredAt: new Date(), healthStatus: "healthy", egressPolicy: "enabled", providerServiceStatus: "ACTIVE", providerReputationStatus: "HEALTHY" } });
    provider.retrieve.mockImplementation(async (id: string) => roster(id));
  });
  afterEach(async () => {
    const rooms = await db.hostedThreadContainer.findMany({ where: { ownerMemberId: { in: ids } }, select: { memberId: true } });
    const allIds = [...new Set([...ids, ...rooms.map(row => row.memberId)])];
    await db.game.deleteMany({ where: { wordsOwnerMemberId: { in: allIds } } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: allIds } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: allIds } } });
    await db.hostedMember.deleteMany({ where: { id: { in: allIds } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: { in: [sourceKey, targetKey] } } });
    vi.unstubAllEnvs();
  });
  function roster(chat: string, extra: string[] = []) {
    return { is_group: true, handles: [
      { handle: source, is_me: chat === fromChat, status: "active" },
      { handle: target, is_me: chat !== fromChat, status: "active" },
      { handle: phone, is_me: false, status: "active" },
      ...extra.map(handle => ({ handle, is_me: false, status: "active" })),
    ] };
  }
  async function reserve() {
    const sourceCleanupEncrypted = await prepareHostedLinqGroupMoveCleanup({ id: moveId, containerMemberId: room, fromAccountLookupKey: sourceKey, toAccountLookupKey: targetKey, sourceChatId: fromChat, prisma: db });
    return db.hostedLinqGroupLineMove.create({ data: { id: moveId, containerMemberId: room, fromAccountLookupKey: sourceKey, toAccountLookupKey: targetKey,
      fromThreadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: fromChat })!, sourceCleanupEncrypted,
      noticeTextHash: sha256Hex(notice), adoptionDeadlineAt: new Date(Date.now() + 60_000) }, select: linqGroupMoveSelect });
  }
  function delivery(chatId = toChat, from = source, text = notice, line = target, prisma = db) {
    const id = randomUUID(), occurredAt = new Date().toISOString();
    const rawBody = JSON.stringify({ api_version: "v3", webhook_version: "2026-02-03", created_at: occurredAt, event_id: id, event_type: "message.received",
      data: { chat: { id: chatId, is_group: true, owner_handle: { handle: line, id: "synthetic-self", is_me: true, service: "iMessage" } }, direction: "inbound", id: `message-${id}`,
        parts: [{ type: "text", value: text }], sender_handle: { handle: from, id: "synthetic-sender", service: "iMessage" }, sent_at: occurredAt, service: "iMessage" } });
    return async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return handleHostedOnboardingLinqWebhook({ prisma, rawBody, timestamp,
        signature: createHmac("sha256", "synthetic-roster-secret").update(`${timestamp}.${rawBody}`).digest("hex"), scheduleAfterResponse: () => undefined });
    };
  }
  const row = () => db.hostedLinqGroupLineMove.findUniqueOrThrow({ where: { id: moveId }, select: linqGroupMoveSelect });
  const messages = () => db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } });
  async function assertSource() {
    expect(await db.hostedThreadRoute.findMany({ where: { containerMemberId: room }, select: { threadIdentityLookupKey: true } }))
      .toEqual([{ threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: fromChat }) }]);
  }
  async function preparedAdoption() {
    const prepared = await prepareHostedLinqGroupMoveIngress({ service: "iMessage", threadId: toChat, sender: source, recipientPhone: target, text: notice, isFromMe: false, route: null, prisma: db });
    if (!prepared.adoption) throw new Error("Synthetic adoption was not prepared.");
    return prepared.adoption;
  }
  it("adds exactly two bounded move reads to ordinary group ingress and to a source hold", async () => {
    const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: [{ emit: "event", level: "query" }] });
    const queries: string[] = [];
    measured.$on("query", ({ query }) => { if (query.includes('"hosted_linq_group_line_move"')) queries.push(query); });
    try {
      await delivery(fromChat, phone, "Ordinary group input", source, measured)();
      expect(queries).toHaveLength(2);
      for (const query of queries) expect(query).toContain("LIMIT");
      await reserve(); queries.length = 0; provider.retrieve.mockClear();
      await expect(delivery(fromChat, phone, "Held group input", source, measured)()).rejects.toMatchObject(held);
      expect(queries).toHaveLength(2); expect(provider.retrieve).not.toHaveBeenCalled();
    } finally { await measured.$disconnect(); }
  });
  it("bounds reserved preparation and adoption SQL with real encryption", async () => {
    await reserve();
    const measured = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: [{ emit: "event", level: "query" }] });
    const queries: string[] = [];
    measured.$on("query", ({ query }) => queries.push(query));
    try {
      const heldPreparation = await prepareHostedLinqGroupMoveIngress({ service: "iMessage", threadId: toChat, sender: phone, recipientPhone: target, text: "Human input", isFromMe: false, route: null, prisma: measured });
      expect(heldPreparation.action).toBe("hold");
      const heldStatements = queries.length;
      queries.length = 0; provider.retrieve.mockClear();
      const prepared = await prepareHostedLinqGroupMoveIngress({ service: "iMessage", threadId: toChat, sender: source, recipientPhone: target, text: notice, isFromMe: false, route: null, prisma: measured });
      expect(provider.retrieve).toHaveBeenCalledTimes(2);
      if (!prepared.adoption) throw new Error("Synthetic adoption preparation missing.");
      const adoption = prepared.adoption;
      const adoptionPreparationStatements = queries.length;
      queries.length = 0; provider.retrieve.mockClear();
      await runWithHostedDomainRootProviderCallsDisabled(() => measured.$transaction(prisma => replaceHostedLinqGroupLineMoveRouteTx({ prepared: adoption, prisma })));
      const adoptionStatements = queries.filter(query => !/^\s*(BEGIN|COMMIT|ROLLBACK)\b/u.test(query)).length;
      expect({ heldStatements, adoptionPreparationStatements, adoptionStatements }).toEqual({
        heldStatements: 2, adoptionPreparationStatements: 5, adoptionStatements: 16,
      });
      expect(provider.retrieve).not.toHaveBeenCalled();
    } finally { await measured.$disconnect(); }
  });
  it("binds encrypted cleanup to both the move and retained container", async () => {
    const move = await reserve();
    await expect(openHostedLinqGroupMoveCleanup({ ...move, id: randomUUID() }, db)).rejects.toThrow();
    await expect(openHostedLinqGroupMoveCleanup({ ...move, containerMemberId: sender }, db)).rejects.toThrow();
  });
  it("protects reservation uniqueness on both source thread and target line", async () => {
    const move = await reserve();
    await expect(db.hostedLinqGroupLineMove.create({ data: { ...move, id: randomUUID() } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.hostedLinqGroupLineMove.create({ data: { ...move, id: randomUUID(), fromThreadIdentityLookupKey: "synthetic-other-source" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.hostedLinqGroupLineMove.create({ data: { ...move, id: randomUUID(), toAccountLookupKey: "synthetic-other-target" } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("preserves the group, game audience and queued game target across adoption", async () => {
    const secondPhone = syntheticPhone();
    await rosterPhoneIdentity(db, owner, secondPhone);
    provider.retrieve.mockImplementation(async (id: string) => roster(id, [secondPhone]));
    await db.hostedGroup.create({ data: { id: randomUUID(), ownerMemberId: owner, runtimeMemberId: room, displayName: "Synthetic room" } });
    await db.gameProfile.createMany({ data: [owner, sender].map(memberId => ({ memberId, firstNameEncrypted: "synthetic-name", timeZone: "UTC" })) });
    const { gameAudienceKeys } = await import("@/src/lib/game/audience");
    const audienceKey = gameAudienceKeys([phone, secondPhone].map(value => ({ kind: "phone" as const, value }))).current;
    const gameId = randomUUID();
    await db.game.create({ data: { id: gameId, createdBy: owner, wordsOwnerMemberId: owner, chatContainerMemberId: room,
      maxPlayers: 10, audienceKey, status: "settled", settledAt: new Date(), terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-words",
      players: { create: [owner, sender].map((memberId, seat) => ({ memberId, seat, joinedAt: new Date(), timeZone: "UTC" })) } } });
    const before = await db.game.findUniqueOrThrow({ where: { id: gameId } });
    const groupBefore = await db.hostedGroup.findUniqueOrThrow({ where: { runtimeMemberId: room }, include: { members: true } });
    const { readGameProposalDeliveryPlayers } = await import("@/src/lib/game/chat-delivery");
    const key = `game-recap:${gameId}`;
    await reserve();
    expect(await readGameProposalDeliveryPlayers(key, room, fromChat)).toMatchObject({ threadId: fromChat });
    await delivery()();
    const alias = await prepareHostedLinqGroupMoveEgressAlias({ memberId: room, target: fromChat, prisma: db });
    expect(alias).not.toBeNull();
    await expect(readGameProposalDeliveryPlayers(key, room, fromChat)).rejects.toThrow("audience changed");
    expect(await readGameProposalDeliveryPlayers(key, room, alias!.authority.threadId)).toMatchObject({ threadId: toChat, keys: { current: audienceKey } });
    expect(await db.game.findUnique({ where: { id: gameId } })).toEqual(before);
    expect(await db.hostedGroup.findUnique({ where: { runtimeMemberId: room }, include: { members: true } })).toEqual(groupBefore);
  });
  it("adopts before diagnostic send progress, clears context, preserves identity, and consumes marker replay and delayed source replies", async () => {
    await reserve();
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { pendingGroupReactionContextEncrypted: "synthetic-pending", pendingParticipantAddition: true } });
    const marker = delivery();
    await marker(); await marker(); await delivery(toChat, source, "A delayed source reply")();
    expect((await row()).status).toBe("adopted");
    expect(await db.hostedThreadRoute.findMany({ where: { containerMemberId: room }, select: { accountLookupKey: true, pendingGroupReactionContextEncrypted: true, pendingParticipantAddition: true } }))
      .toEqual([{ accountLookupKey: targetKey, pendingGroupReactionContextEncrypted: null, pendingParticipantAddition: false }]);
    expect(await db.hostedThreadContainer.findUnique({ where: { memberId: room }, select: { ownerMemberId: true, participants: { select: { participantMemberId: true } } } }))
      .toEqual({ ownerMemberId: owner, participants: [{ participantMemberId: sender }] });
    expect(await messages()).toBe(0); expect(provider.send).not.toHaveBeenCalled();
    expect(await openHostedLinqGroupMoveCleanup(await row(), db)).toMatchObject({ sourceChatId: fromChat, sourcePhone: source, targetPhone: target });
    await delivery(fromChat, phone, "Delayed human source copy", source)();
    expect(await messages()).toBe(0);
  });
  it.each([false, true])("holds both physical copies before adoption and accepts one target copy after, targetFirst=%s", async targetFirst => {
    await reserve();
    const oldCopy = delivery(fromChat, phone, "One physical message", source), newCopy = delivery(toChat, phone, "One physical message");
    for (const copy of targetFirst ? [newCopy, oldCopy] : [oldCopy, newCopy]) await expect(copy()).rejects.toMatchObject(held);
    expect(await messages()).toBe(0);
    await delivery()();
    for (const copy of targetFirst ? [oldCopy, newCopy] : [newCopy, oldCopy]) await copy();
    await oldCopy(); await newCopy();
    expect(await messages()).toBe(1); expect(provider.send).not.toHaveBeenCalled();
  });
  it("requires the exact notice bytes, not trimmed display text", async () => {
    await reserve();
    await expect(delivery(toChat, source, ` ${notice} `)()).rejects.toMatchObject(held);
    expect((await row()).status).toBe("reserved"); await assertSource();
    await delivery()(); expect((await row()).status).toBe("adopted");
  });
  it("does not adopt a second identical room or fail the move for unrelated source speech", async () => {
    await reserve();
    await expect(delivery(randomUUID(), source, "An unrelated source reply")()).rejects.toMatchObject(held);
    expect(await db.hostedLinqGroupLineMove.findUnique({ where: { id: moveId }, select: { status: true, lastErrorCode: true } })).toEqual({ status: "reserved", lastErrorCode: null });
    await assertSource();
    await delivery()(); expect((await row()).toThreadIdentityLookupKey).toBe(createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: toChat }));
  });
  it("leaves unrelated source-line and target-line rooms unchanged", async () => {
    await reserve();
    const unrelated = randomUUID();
    provider.retrieve.mockImplementation(async (id: string) => id === unrelated
      ? { is_group: true, handles: [{ handle: target, is_me: true }, { handle: phone, is_me: false }] } : roster(id));
    await delivery(unrelated, phone, "Normal group input")();
    expect((await row()).status).toBe("reserved");
    expect(await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: unrelated, prisma: db })).not.toBeNull();
    await assertSource();
  });
  it.each(["deadline", "partial", "unavailable", "mismatch"])("holds without dedupe poison on %s", async problem => {
    await reserve();
    if (problem === "deadline") await db.hostedLinqGroupLineMove.update({ where: { id: moveId }, data: { adoptionDeadlineAt: new Date(0) } });
    if (problem === "partial") provider.retrieve.mockResolvedValue({ is_group: true, handles: [{ handle: null }] });
    if (problem === "unavailable") provider.retrieve.mockRejectedValue(new Error("Synthetic provider read failure"));
    if (problem === "mismatch") provider.retrieve.mockImplementation(async (id: string) => roster(id, id === toChat ? ["unknown@example.test"] : []));
    const marker = delivery();
    await expect(marker()).rejects.toMatchObject(held); await assertSource(); expect(await messages()).toBe(0);
    expect((await row()).status).toBe("reserved");
    await db.hostedLinqGroupLineMove.update({ where: { id: moveId }, data: { adoptionDeadlineAt: new Date(Date.now() + 60_000) } });
    provider.retrieve.mockImplementation(async (id: string) => roster(id));
    await marker(); expect((await row()).status).toBe("adopted");
  });
  it("compares complete unknown phone/email handles, ignoring only inactive people and the two service numbers", async () => {
    await reserve();
    const samePersonSecondPhone = syntheticPhone();
    await rosterPhoneIdentity(db, sender, samePersonSecondPhone);
    const extra = ["unknown@example.test", "+15555550987", samePersonSecondPhone];
    provider.retrieve.mockImplementation(async (id: string) => ({ ...roster(id, extra),
      handles: [...roster(id, extra).handles, { handle: id === fromChat ? "inactive@example.test" : "gone@example.test", status: "inactive", is_me: false }] }));
    await delivery()(); expect((await row()).status).toBe("adopted");
  });
  it("a cancelled marker and a marker on the wrong receiving line have no move authority", async () => {
    await reserve();
    const wrongLine = await prepareHostedLinqGroupMoveIngress({ service: "iMessage", threadId: toChat, recipientPhone: source, sender: source, text: notice, isFromMe: false, route: null, prisma: db });
    expect(wrongLine).toMatchObject({ action: "continue" }); expect(wrongLine.adoption).toBeUndefined();
    expect((await row()).status).toBe("reserved"); await assertSource();
    await db.hostedLinqGroupLineMove.update({ where: { id: moveId }, data: { status: "cancelled" } });
    const cancelled = await prepareHostedLinqGroupMoveIngress({ service: "iMessage", threadId: toChat, recipientPhone: target, sender: source, text: notice, isFromMe: false, route: null, prisma: db });
    expect(cancelled).toMatchObject({ action: "continue" }); expect(cancelled.adoption).toBeUndefined();
    expect((await row()).status).toBe("cancelled"); await assertSource();
  });
  it("rolls back route and move together, then commits with provider and KMS work disabled", async () => {
    await reserve(); const prepared = await preparedAdoption(); provider.retrieve.mockClear();
    await expect(db.$transaction(async tx => { await replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma: tx }); throw new Error("Synthetic rollback"); })).rejects.toThrow("Synthetic rollback");
    await assertSource(); expect((await row()).status).toBe("reserved");
    await runWithHostedDomainRootProviderCallsDisabled(() => db.$transaction(tx => replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma: tx })));
    expect(provider.retrieve).not.toHaveBeenCalled(); expect((await row()).status).toBe("adopted");
    await expect(db.$transaction(tx => replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma: tx }))).rejects.toMatchObject(held);
  });
  it("rejects a destination that becomes bound after preparation without deleting either workspace", async () => {
    await reserve(); const prepared = await preparedAdoption();
    const other = randomUUID(); ids.push(other); await db.hostedMember.create({ data: { id: other } });
    await db.hostedThreadContainer.create({ data: { memberId: other, ownerMemberId: owner } });
    await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: other, accountLookupKey: targetKey,
      threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: toChat })!, threadLookupKey: "synthetic-other-route" } });
    await expect(db.$transaction(tx => replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma: tx }))).rejects.toMatchObject(held);
    await assertSource(); expect(await db.hostedThreadContainer.count({ where: { memberId: { in: [room, other] } } })).toBe(2);
  });
  it.each(["expired-proof", "changed-source", "previous-overlap"])("rejects stale or conflicting adoption: %s", async problem => {
    await reserve(); const prepared = await preparedAdoption();
    if (problem === "expired-proof") prepared.verifiedAt = new Date(Date.now() - 30_001);
    if (problem === "changed-source") await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { deliveryRouteEncrypted: "synthetic-changed-route" } });
    if (problem === "previous-overlap") await db.hostedLinqGroupLineMove.create({ data: {
      ...await row(), id: randomUUID(), status: "adopted", adoptedAt: new Date(),
      fromThreadIdentityLookupKey: "synthetic-prior-source", toThreadIdentityLookupKey: prepared.move.fromThreadIdentityLookupKey,
    } });
    await expect(db.$transaction(prisma => replaceHostedLinqGroupLineMoveRouteTx({ prepared, prisma }))).rejects.toMatchObject(held);
    await assertSource(); expect((await row()).status).toBe("reserved");
  });
  it("does not adopt an exact marker over SMS", async () => {
    await reserve();
    const prepared = await prepareHostedLinqGroupMoveIngress({ service: "SMS", threadId: toChat,
      sender: source, recipientPhone: target, text: notice, isFromMe: false, route: null, prisma: db });
    expect(prepared.action).toBe("hold"); expect(prepared.adoption).toBeUndefined();
    await assertSource();
  });
  it("keeps tombstones, alias ownership and overlap evidence readable across privacy-key rotation", async () => {
    await reserve();
    const oldKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `${oldKeys},v2:${Buffer.alloc(32, 9).toString("base64url")}`); vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    await delivery()();
    expect(await readHostedLinqGroupMoveServicePhones({ containerMemberId: room, threadId: toChat, prisma: db })).toEqual([source, target]);
    expect(await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: fromChat, prisma: db })).toBeNull();
    const alias = await prepareHostedLinqGroupMoveEgressAlias({ memberId: room, target: fromChat, prisma: db });
    expect(alias?.authority.threadId).toBe(toChat);
    const resolved = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({ memberId: room, target: fromChat, authorityCheckOnly: true, groupMoveAlias: alias, prisma }));
    expect(resolved.resolvedRoute.fromPhoneNumber).toBe(target);
    expect(await prepareHostedLinqGroupMoveEgressAlias({ memberId: sender, target: fromChat, prisma: db })).toBeNull();
    await delivery(fromChat, phone, "Delayed copy", source)(); expect(await messages()).toBe(0);
  });
  it("resolves a saved target with a conversation locator and preserves the exact dispatch fence", async () => {
    await reserve(); await delivery()();
    const alias = await prepareHostedLinqGroupMoveEgressAlias({ memberId: room, target: fromChat, prisma: db });
    const result = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({ memberId: room, target: fromChat, targetKind: "thread", authorityCheckOnly: true, groupMoveAlias: alias, prisma }));
    expect(result.resolvedRoute).toMatchObject({ target: toChat, threadIsDirect: false, conversationThreadId: expect.any(String) });
    const sent = await db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({ memberId: room, target: toChat, targetKind: "thread", authorityCheckOnly: false, expectedResolvedRoute: result.resolvedRoute, prisma }));
    expect(sent.resolvedRoute).toEqual(result.resolvedRoute);
    await expect(db.$transaction(prisma => assertHostedLinqRecentInboundEngagementForRuntime({ memberId: room, target: fromChat, authorityCheckOnly: false, groupMoveAlias: alias, prisma }))).rejects.toMatchObject({ code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH" });
    await db.hostedLinqGroupLineMove.update({ where: { id: moveId }, data: { status: "left", leaveConfirmedAt: new Date() } });
    expect(await prepareHostedLinqGroupMoveEgressAlias({ memberId: room, target: fromChat, prisma: db })).not.toBeNull();
  });
});
