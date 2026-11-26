import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { createHostedLinqChatLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { blockHostedLinqHandle, hasHostedLinqBlockedHandle, isHostedLinqSenderBlocked, listHostedLinqHandleBlocks, parseHostedLinqBlockContact, rotateHostedLinqHandleBlockBatch, unblockHostedLinqHandle } from "@/src/lib/hosted-routing/linq-handle-block";
import { leaveHostedLinqGroupTx, prepareHostedLinqGroupLeave, readHostedLinqGroupLeave, rotateHostedLinqGroupLeaveBatch } from "@/src/lib/hosted-routing/linq-group-leave";
import { expireHostedLinqGroupRiskBatch, observeHostedLinqGroupRiskTx } from "@/src/lib/hosted-routing/linq-group-risk-ledger";
import { syntheticPhone } from "./support/roster-postgres";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Risk proof requires its isolated local test database.");
function keys(overlap = false, retired = false) {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", overlap ? `v2:${Buffer.alloc(32, 8).toString("base64")}${retired ? "" : `,v1:${Buffer.alloc(32, 7).toString("base64")}`}` : `v1:${Buffer.alloc(32, 7).toString("base64")}`);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", overlap ? "v2" : "v1");
}
describe.skipIf(!enabled)("Linq blinded group evidence and blocks", () => {
  const prisma = getPrisma();
  let chatId: string;
  // Earlier files in the same worker database can leave Linq rows behind; these assertions count whole tables.
  const clear = async () => {
    await prisma.hostedLinqGroupHandle.deleteMany(); await prisma.hostedLinqGroupSighting.deleteMany();
    await prisma.hostedLinqGroupLeave.deleteMany(); await prisma.hostedLinqHandleBlock.deleteMany();
  };
  beforeEach(async () => { await clear(); keys(); chatId = randomUUID(); });
  afterEach(async () => { await clear(); vi.unstubAllEnvs(); });
  const observe = (at: Date, value = "synthetic@example.invalid", via: "sender" | "roster" = "sender") => prisma.$transaction(tx => observeHostedLinqGroupRiskTx({
    chatId, observedAt: at, handles: [{ contact: parseHostedLinqBlockContact(value), via }], prisma: tx,
  }));
  it("commutes duplicate, concurrent and delayed delivery, and rolls back failed work", async () => {
    const early = new Date("2026-11-01T10:00:00Z"), late = new Date("2026-11-02T10:00:00Z");
    await Promise.all([observe(late), observe(late), observe(late)]);
    await observe(early, "synthetic@example.invalid", "roster");
    await observe(early);
    expect(await prisma.hostedLinqGroupSighting.count()).toBe(1);
    const handle = await prisma.hostedLinqGroupHandle.findFirstOrThrow();
    expect(handle).toMatchObject({ firstSeenAt: early, lastSeenAt: late, firstSentAt: early, firstSeenVia: "roster" });
    expect(await prisma.hostedLinqGroupHandle.count()).toBe(1);
    await expect(prisma.$transaction(async tx => {
      await observeHostedLinqGroupRiskTx({ chatId: "synthetic-rollback", observedAt: early,
        handles: [{ contact: parseHostedLinqBlockContact("rollback@example.invalid"), via: "sender" }], prisma: tx });
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");
    expect(await prisma.hostedLinqGroupSighting.count()).toBe(1);
  });
  it("batches a large observation without per-handle datastore calls", async () => {
    const write = vi.fn().mockResolvedValue(1), findFirst = vi.fn().mockResolvedValue(null);
    const tx = { $executeRaw: write, hostedLinqGroupLeave: { findFirst } };
    await observeHostedLinqGroupRiskTx({ chatId, observedAt: new Date(), prisma: tx as never,
      handles: Array.from({ length: 1200 }, (_, index) => ({ contact: parseHostedLinqBlockContact(`synthetic-${index}@example.invalid`), via: "roster" as const })) });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(5); // chat lock, sighting, three bulk inserts
  });
  it("links evidence to departure across marker rotation and expires evidence without authority", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    await observe(at);
    await prisma.$transaction(tx => leaveHostedLinqGroupTx({ expected: null, prepared: prepareHostedLinqGroupLeave(chatId, "oversized"), prisma: tx }));
    const before = await prisma.hostedLinqGroupHandle.findFirstOrThrow({ include: { sighting: { include: { leaveMarker: true } } } });
    expect(before.sighting.leaveMarker?.reason).toBe("oversized");
    expect(before.sighting.leaveMarker?.chatIdEncrypted).not.toContain(chatId);
    keys(true);
    expect(await rotateHostedLinqGroupLeaveBatch(prisma)).toBe(1);
    const after = await prisma.hostedLinqGroupSighting.findFirstOrThrow({ include: { leaveMarker: true } });
    expect(after.leaveMarkerKey).not.toBe(before.sighting.leaveMarkerKey);
    expect(after.leaveMarker?.reason).toBe("oversized");
    const retainedContact = parseHostedLinqBlockContact("retained@example.invalid");
    await blockHostedLinqHandle({ contact: retainedContact, reason: "operator", prisma });
    expect(await expireHostedLinqGroupRiskBatch({ prisma, now: new Date("2026-11-15T00:00:00Z") })).toEqual({ handles: 1, sightings: 1 });
    expect(await readHostedLinqGroupLeave({ chatId, prisma })).not.toBeNull();
    expect(await isHostedLinqSenderBlocked(retainedContact, prisma)).toBe(true);
  });
  it("expires handles by their own clocks even when another sender keeps the room alive", async () => {
    await observe(new Date("2026-01-01T00:00:00Z"));
    await observe(new Date("2026-11-14T00:00:00Z"), "recent@example.invalid");
    expect(await expireHostedLinqGroupRiskBatch({ prisma, now: new Date("2026-11-15T00:00:00Z") })).toEqual({ handles: 1, sightings: 0 });
    expect(await prisma.hostedLinqGroupHandle.count()).toBe(1);
  });
  it("blocks equivalent phones and email across overlap, removal and full key retirement", async () => {
    const phone = syntheticPhone(), contact = parseHostedLinqBlockContact(phone);
    await blockHostedLinqHandle({ contact, reason: "bot_ring", prisma });
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact("Synthetic@Example.invalid"), reason: "spam", prisma });
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact("remove-before-rotation@example.invalid"), reason: "operator", prisma });
    keys(true);
    await unblockHostedLinqHandle({ contact: parseHostedLinqBlockContact("remove-before-rotation@example.invalid"), prisma });
    expect(await isHostedLinqSenderBlocked(parseHostedLinqBlockContact("remove-before-rotation@example.invalid"), prisma)).toBe(false);
    const formatted = `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
    expect(await isHostedLinqSenderBlocked(parseHostedLinqBlockContact(formatted), prisma)).toBe(true);
    await Promise.all([blockHostedLinqHandle({ contact: parseHostedLinqBlockContact(phone), reason: "operator", prisma }), rotateHostedLinqHandleBlockBatch(prisma)]);
    expect(await prisma.hostedLinqHandleBlock.count()).toBe(2);
    const list = await listHostedLinqHandleBlocks({ prisma });
    expect(list.blocks.every(row => Object.keys(row).sort().join(",") === "contact,createdAt,reason")).toBe(true);
    await unblockHostedLinqHandle({ contact: parseHostedLinqBlockContact(formatted), prisma });
    expect(await isHostedLinqSenderBlocked(parseHostedLinqBlockContact(phone), prisma)).toBe(false);
    await rotateHostedLinqHandleBlockBatch(prisma); keys(true, true);
    expect(await isHostedLinqSenderBlocked(parseHostedLinqBlockContact("synthetic@example.invalid"), prisma)).toBe(true);
    expect((await listHostedLinqHandleBlocks({ prisma })).blocks).toHaveLength(1);
  });
  it("finds a blocked handle in a roster under the current and prior key", async () => {
    const value = "blocked@example.invalid";
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact(value), reason: "operator", prisma });
    expect(await hasHostedLinqBlockedHandle([], prisma)).toBe(false);
    expect(await hasHostedLinqBlockedHandle(["other@example.invalid"], prisma)).toBe(false);
    expect(await hasHostedLinqBlockedHandle(["other@example.invalid", value], prisma)).toBe(true);
    keys(true);
    expect(await hasHostedLinqBlockedHandle([value], prisma)).toBe(true);
  });
  it("orders roster metadata by its own observation time, not by sender events", async () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 15, 10, 0, seconds));
    const roster = (handleCount: number, observedAt: Date) => prisma.$transaction(tx => observeHostedLinqGroupRiskTx({
      chatId, observedAt, roster: { observedAt, handlesComplete: true, handleCount, handles: [] }, handles: [], prisma: tx,
    }));
    const sighting = () => prisma.hostedLinqGroupSighting.findUniqueOrThrow({ where: { chatLookupKey: createHostedLinqChatLookupKey(chatId)! } });
    await roster(3, at(0));
    await observe(at(10)); // a newer message commits before the roster read started at 5
    await roster(4, at(5));
    expect(await sighting()).toMatchObject({ rosterHandleCount: 4, rosterObservedAt: at(5), lastObservedAt: at(10) });
    await roster(2, at(1)); // an older roster never overwrites a newer one
    expect(await sighting()).toMatchObject({ rosterHandleCount: 4, rosterObservedAt: at(5) });
  });
});
