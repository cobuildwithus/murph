import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { provisionHostedCryptoDomainRootsForUser } from "@/src/lib/hosted-crypto/domain-root-store";
import { runWithHostedDomainRootProviderCallsDisabled, runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadIdentityLookupKeyReadCandidates } from "@/src/lib/hosted-onboarding/contact-privacy";
import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { leaveHostedLinqGroupTx, prepareHostedLinqGroupLeave, readHostedLinqGroupLeave, requestHostedLinqGroupLeaveAfterCommit, rotateHostedLinqGroupLeaveBatch } from "@/src/lib/hosted-routing/linq-group-leave";
import { attachHostedThreadContainerBootstrapRouteTx, ensureHostedThreadContainerRouteTx, prepareHostedThreadContainerCreation, prepareHostedThreadContainerDeliveryRoute, refreshHostedThreadContainerDeliveryRouteTx } from "@/src/lib/hosted-routing/thread-container-service";
import { lockHostedThreadRouteByThreadIdentityTx, readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { bindPairGameChat } from "@/src/lib/game/chat-membership";
import { leaveHostedLinqGroup } from "@/src/lib/hosted-ops/linq-group-line-move";
import { localRosterCrypto, rosterRoute, syntheticPhone } from "./support/roster-postgres";

const provider = vi.hoisted(() => ({ leave: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({ ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { leaveChat: provider.leave }; },
}));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Leave proof requires an isolated local test database.");

describe.skipIf(!enabled)("Linq local departure on migrated PostgreSQL", () => {
  const db = getPrisma();
  let room: string, owner: string, chat: string, account: string;
  const chats: string[] = [];
  beforeEach(async () => {
    localRosterCrypto();
    setHostedSecureBoxStringTestCodecForTests(null);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
    provider.leave.mockReset().mockResolvedValue({ status: "queued" });
    [room, owner, chat] = Array.from({ length: 3 }, () => randomUUID()); chats.push(chat);
    await db.hostedMember.createMany({ data: [room, owner].map(id => ({ id, billingStatus: "active" })) });
    await provisionHostedCryptoDomainRootsForUser({ userId: room, prisma: db });
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: owner } });
    account = await rosterRoute(db, room, chat, syntheticPhone());
  });
  afterEach(async () => {
    await db.game.deleteMany({ where: { wordsOwnerMemberId: owner } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: room } });
    await db.hostedMember.deleteMany({ where: { id: { in: [room, owner] } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: account } });
    // Include both test versions so cleanup also owns fully rekeyed markers.
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64")},v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    await db.hostedLinqGroupLeave.deleteMany({ where: { threadIdentityLookupKey: { in: chats.flatMap(threadId =>
      createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId })) } } });
    chats.length = 0;
    vi.unstubAllEnvs();
  });
  const expected = () => db.hostedThreadRoute.findFirstOrThrow({ where: { containerMemberId: room } });
  const prepare = () => prepareHostedLinqGroupLeave(chat, "operator_cleanup");
  async function leave() {
    const route = await expected(), prepared = prepare();
    return runWithHostedDomainRootProviderCallsDisabled(() => db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma })));
  }
  async function game(status: string) {
    await db.gameProfile.create({ data: { memberId: owner, firstNameEncrypted: "synthetic", timeZone: "UTC" } });
    return db.game.create({ data: { id: randomUUID(), wordsOwnerMemberId: owner, chatContainerMemberId: room,
      status, terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic" } });
  }
  it("concurrent local departures dispatch once, with provider work after commit", async () => {
    const route = await expected(), prepared = prepare();
    provider.leave.mockImplementation(async () => {
      expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).not.toBeNull();
      expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(0);
      return { status: "queued" };
    });
    const results = await Promise.all(Array.from({ length: 4 }, async () => {
      const result = await db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma }));
      if (result.status === "left") await requestHostedLinqGroupLeaveAfterCommit(result.postCommitLinqGroupLeave);
      return result.status;
    }));
    expect(results.filter(status => status === "left")).toHaveLength(1);
    expect(provider.leave).toHaveBeenCalledOnce();
  });
  it("deduplicates overlapping current and prior-version preparations", async () => {
    const route = await expected(), prior = prepare();
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64")},v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    const results = await Promise.all([prior, prepare()].map(prepared => db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma }))));
    expect(results.map(result => result.status).sort()).toEqual(["already_left", "left"]);
    expect(await db.hostedLinqGroupLeave.count({ where: { threadIdentityLookupKey: { in:
      createHostedExternalThreadIdentityLookupKeyReadCandidates({ channel: "linq", threadId: chat }) } } })).toBe(1);
  });
  it("rolls the marker back when the exact delete loses its snapshot", async () => {
    const route = await expected(), prepared = prepare();
    await db.hostedThreadRoute.updateMany({ where: { containerMemberId: room }, data: { updatedAt: new Date(route.updatedAt.getTime() + 1000) } });
    await expect(db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma })))
      .rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEAVE_ROUTE_CHANGED" });
    expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).toBeNull();
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(1);
  });
  it.each(["invited", "negotiating", "live"])("refuses a bound %s game", async status => {
    await game(status);
    expect(await leave()).toEqual({ status: "unavailable", reason: "active_game" });
    expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).toBeNull();
  });
  it.each(["invited", "negotiating", "live", "settled", "void"])("assistant refuses retained %s game history", async status => {
    await game(status);
    const route = await expected(), prepared = prepareHostedLinqGroupLeave(chat, "assistant");
    expect(await db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma }))).toEqual({ status: "unavailable", reason: "game_bound" });
    expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).toBeNull();
  });
  it("serializes a discovered first-game binding behind departure", async () => {
    const first = await game("negotiating");
    await db.game.update({ where: { id: first.id }, data: { chatContainerMemberId: null } });
    await db.gameProfile.create({ data: { memberId: room, firstNameEncrypted: "synthetic", timeZone: "UTC" } });
    await db.gamePlayer.createMany({ data: [owner, room].map((memberId, seat) => ({ gameId: first.id, memberId, seat, timeZone: "UTC", joinedAt: new Date() })) });
    const route = await expected(), prepared = prepareHostedLinqGroupLeave(chat, "assistant");
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { locked = resolve; });
    const leaving = db.$transaction(async prisma => {
      await prisma.$queryRaw`SELECT id FROM hosted_member WHERE id = ${room} FOR UPDATE`;
      const result = await leaveHostedLinqGroupTx({ expected: route, prepared, prisma });
      locked(); await gate; return result;
    });
    await entered;
    const binding = bindPairGameChat(first.id, [owner, room], room);
    release();
    expect(await leaving).toMatchObject({ status: "left" });
    expect(await binding).toBeNull();
    expect((await db.game.findUniqueOrThrow({ where: { id: first.id } })).chatContainerMemberId).toBeNull();
  });
  it("sees a first game committed while departure waits on its route lock", async () => {
    const first = await game("settled");
    await db.game.update({ where: { id: first.id }, data: { chatContainerMemberId: null } });
    const route = await expected(), prepared = prepareHostedLinqGroupLeave(chat, "assistant");
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { locked = resolve; });
    const binding = db.$transaction(async prisma => {
      await prisma.$queryRaw`SELECT id FROM hosted_member WHERE id = ${room} FOR KEY SHARE`;
      await lockHostedThreadRouteByThreadIdentityTx({ authority: { channel: "linq", threadId: chat, containerMemberId: room }, prisma });
      locked(); await gate;
      await prisma.game.update({ where: { id: first.id }, data: { chatContainerMemberId: room } });
    });
    await entered;
    const leaving = db.$transaction(async prisma => {
      await prisma.$queryRaw`SELECT id FROM hosted_member WHERE id = ${room} FOR UPDATE`;
      return leaveHostedLinqGroupTx({ expected: route, prepared, prisma });
    });
    release(); await binding;
    expect(await leaving).toEqual({ status: "unavailable", reason: "game_bound" });
    expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).toBeNull();
  });
  it("persists only the assistant marker reason", async () => {
    const route = await expected(), prepared = prepareHostedLinqGroupLeave(chat, "assistant");
    expect(await db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: route, prepared, prisma }))).toMatchObject({ status: "left" });
    expect(await db.hostedLinqGroupLeave.findUnique({ where: { threadIdentityLookupKey: prepared.threadIdentityLookupKey }, select: { reason: true } })).toEqual({ reason: "assistant" });
  });
  it.each(["reserved", "adopted"])("refuses an owning %s move", async status => {
    await db.hostedLinqGroupLineMove.create({ data: { id: randomUUID(), containerMemberId: room, status,
      ...(status === "adopted" ? { adoptedAt: new Date(), toThreadIdentityLookupKey: "synthetic-destination" } : {}),
      fromAccountLookupKey: account, toAccountLookupKey: "synthetic-target", fromThreadIdentityLookupKey: (await expected()).threadIdentityLookupKey,
      sourceCleanupEncrypted: "synthetic", adoptionDeadlineAt: new Date(Date.now() + 60000) } });
    expect(await leave()).toEqual({ status: "unavailable", reason: "active_move" });
  });
  it("allows a completed move destination and retains its history", async () => {
    const move = await db.hostedLinqGroupLineMove.create({ data: { id: randomUUID(), containerMemberId: room, status: "left",
      fromAccountLookupKey: "synthetic-source", toAccountLookupKey: account, fromThreadIdentityLookupKey: "synthetic-retired",
      adoptedAt: new Date(), toThreadIdentityLookupKey: (await expected()).threadIdentityLookupKey, sourceCleanupEncrypted: "synthetic", adoptionDeadlineAt: new Date() } });
    await game("settled");
    expect(await leave()).toMatchObject({ status: "left" });
    expect(await db.hostedLinqGroupLineMove.findUnique({ where: { id: move.id } })).not.toBeNull();
  });
  it("rejects creation and prepared refresh after leave", async () => {
    const route = await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: chat, prisma: db });
    const preparedDeliveryRoute = await prepareHostedThreadContainerDeliveryRoute({ channel: "linq", accountLookupKey: account,
      containerMemberId: room, observedDeliveryRouteEncrypted: route!.deliveryRouteState!.deliveryRouteEncrypted, threadId: chat, prisma: db });
    const preparedCreation = await runWithHostedDomainRootUnwrapCache(() => prepareHostedThreadContainerCreation({ channel: "linq", accountLookupKey: account, threadId: chat, prisma: db }));
    await leave();
    await expect(db.$transaction(prisma => refreshHostedThreadContainerDeliveryRouteTx({ accountLookupKey: account,
      route: route!, preparedDeliveryRoute, threadId: chat, prisma }))).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEFT" });
    await expect(db.$transaction(prisma => ensureHostedThreadContainerRouteTx({ channel: "linq", accountLookupKey: account,
      ownerMemberId: owner, preparedCreation, occurredAt: new Date(), threadId: chat, prisma }))).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEFT" });
  });
  it("keeps a replayed bootstrap for a closed game from recreating a left route", async () => {
    // Bootstrap recovery can replay an accepted receipt after its game ended.
    // The marker read runs after binding demotion takes chat ownership, so a
    // leave that committed first is always seen before the route is created.
    const closed = await game("settled");
    const prepared = await prepareHostedThreadContainerDeliveryRoute({ channel: "linq", accountLookupKey: account,
      containerMemberId: room, observedDeliveryRouteEncrypted: null, threadId: chat, prisma: db });
    await expect(leave()).resolves.toMatchObject({ status: "left" });
    await expect(db.$transaction(prisma => attachHostedThreadContainerBootstrapRouteTx({ gameId: closed.id, prepared, prisma })))
      .rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEFT" });
    expect(await db.hostedThreadRoute.count({ where: { containerMemberId: room } })).toBe(0);
    expect(await readHostedLinqGroupLeave({ chatId: chat, prisma: db })).not.toBeNull();
  });
  it("serializes an overlapping creation behind departure", async () => {
    const route = await expected(), prepared = prepare();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { locked = resolve; });
    const leaving = db.$transaction(async prisma => {
      await acquireHostedLinqChatOwnershipLockTx({ chatId: chat, tx: prisma }); locked(); await gate;
      return leaveHostedLinqGroupTx({ expected: route, prepared, prisma });
    });
    await entered;
    const creating = db.$transaction(prisma => ensureHostedThreadContainerRouteTx({ channel: "linq", accountLookupKey: account,
      ownerMemberId: owner, occurredAt: new Date(), threadId: chat, prisma }));
    release();
    await expect(leaving).resolves.toMatchObject({ status: "left" });
    await expect(creating).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEFT" });
  });
  it("survives container deletion and full prior-key retirement, including dormant unbound markers", async () => {
    await leave();
    const unbound = randomUUID(); chats.push(unbound);
    await db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: null, prepared: prepareHostedLinqGroupLeave(unbound, "oversized"), prisma }));
    await db.hostedThreadContainer.delete({ where: { memberId: room } });
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64")},v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
    expect(await rotateHostedLinqGroupLeaveBatch(db)).toBe(2);
    expect(await rotateHostedLinqGroupLeaveBatch(db)).toBe(0);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64")}`);
    for (const chatId of chats) {
      expect(await readHostedLinqGroupLeave({ chatId, prisma: db })).toEqual({ threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId }) });
      expect(await db.$transaction(prisma => leaveHostedLinqGroupTx({ expected: null, prepared: prepareHostedLinqGroupLeave(chatId, "oversized"), prisma }))).toEqual({ status: "already_left" });
      await expect(db.$transaction(prisma => ensureHostedThreadContainerRouteTx({ channel: "linq", accountLookupKey: account,
        ownerMemberId: owner, occurredAt: new Date(), threadId: chatId, prisma }))).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_LEFT" });
    }
    expect(provider.leave).not.toHaveBeenCalled();
  });
  it("Ops selects the full opaque ref and replays without another attempt", async () => {
    const ref = (await expected()).threadIdentityLookupKey;
    await expect(leaveHostedLinqGroup({ containerRef: ref.slice(-8), prisma: db })).rejects.toMatchObject({ code: "HOSTED_LINQ_GROUP_MOVE_ROUTE_REQUIRED" });
    expect(await leaveHostedLinqGroup({ containerRef: ref, prisma: db })).toEqual({ local: "left", provider: "accepted" });
    expect(await leaveHostedLinqGroup({ containerRef: ref, prisma: db })).toEqual({ local: "already_left", provider: "not_attempted" });
    expect(provider.leave).toHaveBeenCalledOnce();
  });
});
