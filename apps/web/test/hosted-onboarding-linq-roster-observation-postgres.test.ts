import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionHostedCryptoDomainRootsForUser } from "@/src/lib/hosted-crypto/domain-root-store";
import { getPrisma } from "@/src/lib/prisma";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { armHostedPendingGroupSetupTx } from "@/src/lib/hosted-groups/pending-group-setup";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { upsertHostedMemberHomeLinqRecipientPhoneTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { localRosterCrypto, rosterPhoneIdentity, rosterRoute, syntheticPhone } from "./helpers/roster-postgres";

const provider = vi.hoisted(() => ({ retrieve: vi.fn(), send: vi.fn(async () => ({ message: { id: crypto.randomUUID() } })), signal: vi.fn() }));
vi.mock("@linqapp/sdk", async original => ({
  ...await original<typeof import("@linqapp/sdk")>(),
  default: class { chats = { retrieve: provider.retrieve, messages: { send: provider.send } }; },
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: provider.signal }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Ingress proof requires its isolated local test database.");
const unavailable = { code: "HOSTED_LINQ_GROUP_ROSTER_UNAVAILABLE", httpStatus: 502, retryable: true };

describe.skipIf(!enabled)("Linq roster admission and replay on migrated PostgreSQL", () => {
  const db = getPrisma();
  let room: string, owner: string, sender: string, chat: string, phone: string, line: string, lineKey: string;
  let extraRooms: string[];
  beforeEach(async () => {
    localRosterCrypto();
    provider.send.mockClear();
    provider.retrieve.mockReset(); provider.signal.mockReset().mockResolvedValue({ workflowId: "synthetic-wake" });
    [room, owner, sender, chat] = Array.from({ length: 4 }, () => randomUUID());
    phone = syntheticPhone(); line = syntheticPhone(); extraRooms = [];
    await db.hostedMember.createMany({ data: [room, owner, sender].map(id => ({ id, billingStatus: id === sender ? "active" : "not_started" })) });
    for (const userId of [room, owner, sender]) await provisionHostedCryptoDomainRootsForUser({ prisma: db, userId });
    await rosterPhoneIdentity(db, sender, phone);
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: owner,
      participants: { create: { participantMemberId: sender, handleLookupKey: createHostedPhoneLookupKey(phone)!,
        firstSeenAt: new Date(Date.now() - 9 * 86_400_000), lastSeenAt: new Date(Date.now() - 8 * 86_400_000), removedAt: new Date(Date.now() - 7 * 86_400_000) } } } });
    lineKey = await rosterRoute(db, room, chat, line);
  });
  afterEach(async () => {
    const rooms = await db.hostedThreadContainer.findMany({ where: { ownerMemberId: { in: [owner, sender] } }, select: { memberId: true } });
    extraRooms = rooms.map(r => r.memberId);
    await db.hostedLinqProviderEvent.deleteMany({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(chat) } });
    await db.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(chat) } });
    await db.hostedGroup.deleteMany({ where: { ownerMemberId: { in: [owner, sender] } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: [room, ...extraRooms] } } });
    await db.hostedMember.deleteMany({ where: { id: { in: [room, owner, sender, ...extraRooms] } } });
    await db.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: lineKey } });
    await db.hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: createHostedPhoneLookupKey(phone)! } });
    vi.unstubAllEnvs();
  });
  function roster(present: boolean, partial = false, empty = false) {
    provider.retrieve.mockResolvedValue({ is_group: true, handles: empty ? [] : [
      { handle: line, is_me: true }, ...(present ? [{ handle: phone, is_me: false }] : []), ...(partial ? [{ handle: null }] : []),
    ] });
  }
  function delivery(from = phone) {
    const id = randomUUID(), occurredAt = new Date().toISOString();
    const rawBody = JSON.stringify({ api_version: "v3", webhook_version: "2026-02-03", created_at: occurredAt,
      event_id: id, event_type: "message.received", data: { chat: { id: chat, is_group: true,
        owner_handle: { handle: line, id: "synthetic-owner", is_me: true, service: "iMessage" } },
        direction: "inbound", id: `message-${id}`, parts: [{ type: "text", value: "Please help our group get started." }],
        sender_handle: { handle: from, id: "synthetic-sender", service: "iMessage" }, sent_at: occurredAt, service: "iMessage" } });
    return async () => {
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const tasks: Array<() => Promise<void>> = [];
      const result = await handleHostedOnboardingLinqWebhook({ prisma: db, rawBody, timestamp,
        signature: createHmac("sha256", "synthetic-roster-secret").update(`${timestamp}.${rawBody}`).digest("hex"),
        scheduleAfterResponse: task => { tasks.push(task); },
      });
      // Exercise the handler's committed wake, with only its external signal replaced.
      for (const task of tasks) await task();
      return result;
    };
  }
  async function noAdmission() {
    expect(await db.hostedMailboxItem.count({ where: { userId: room } })).toBe(0);
    expect(await db.hostedLinqProviderEvent.count({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(chat) } })).toBe(0);
    expect(provider.signal).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  }
  it("retries a failed roster read without dedupe poison, then admits the same event exactly once", async () => {
    provider.retrieve.mockRejectedValue(new Error("Synthetic 1500 ms roster timeout"));
    const admit = delivery();
    await expect(admit()).rejects.toMatchObject(unavailable);
    await noAdmission();
    roster(true);
    await admit();
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect(provider.signal).toHaveBeenCalledOnce();
  });
  it("retries parse-incomplete absence but admits positive sender evidence from that partial roster", async () => {
    const admit = delivery();
    roster(false, true);
    await expect(admit()).rejects.toMatchObject(unavailable);
    await noAdmission();
    roster(true, true);
    await admit();
    expect(await db.hostedMailboxItem.count({ where: { userId: room, kind: "conversation.message" } })).toBe(1);
    expect(provider.signal).toHaveBeenCalledOnce();
  });
  it.each(["absent", "withdrawn", "inactive", "unresolved"])("keeps %s sender conclusive", async kind => {
    roster(false);
    if (kind === "withdrawn") await db.hostedConsentGrant.create({ data: { memberId: sender, scope: "launch.health-data", status: "revoked", source: "synthetic", documentVersionsJson: {}, grantedAt: new Date(), revokedAt: new Date() } });
    if (kind === "inactive") await db.hostedMember.update({ where: { id: sender }, data: { billingStatus: "not_started" } });
    const result = await delivery(kind === "unresolved" ? syntheticPhone() : phone)();
    expect(result).toMatchObject({ reason: kind === "withdrawn" ? "health-data-consent-withdrawn" : "thread-container-inactive" });
    expect(await db.hostedMailboxItem.count({ where: { userId: room } })).toBe(0);
    if (kind !== "absent") expect(provider.retrieve).not.toHaveBeenCalled();
  });
  it.each(["partial-missing", "partial-present", "complete-missing", "empty"])("unbound first speaker with %s pending-owner proof", async kind => {
    await db.hostedThreadRoute.deleteMany({ where: { containerMemberId: room } });
    await db.$transaction(async tx => {
      await upsertHostedMemberHomeLinqRecipientPhoneTx({ memberId: sender, recipientPhone: line, prisma: tx });
      await armHostedPendingGroupSetupTx({ ownerMemberId: sender, setup: { roomContextMarkdown: "A synthetic shared room." }, tx });
    });
    roster(kind === "partial-present", kind.startsWith("partial"), kind === "empty");
    const admit = delivery(syntheticPhone());
    if (kind === "partial-missing" || kind === "empty") {
      await expect(admit()).rejects.toMatchObject(unavailable);
      await noAdmission();
      expect(await db.hostedPendingGroupSetup.count({ where: { ownerMemberId: sender } })).toBe(1);
      expect(await db.hostedLinqDelivery.count({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(chat) } })).toBe(0);
    } else {
      const result = await admit();
      if (kind === "partial-present") {
        expect(await db.hostedPendingGroupSetup.count({ where: { ownerMemberId: sender } })).toBe(0);
        expect(await db.hostedThreadRoute.count({ where: { container: { ownerMemberId: sender } } })).toBe(1);
      } else {
        expect(result).toMatchObject({ reason: "sent-group-setup" });
        expect(await db.hostedPendingGroupSetup.count({ where: { ownerMemberId: sender } })).toBe(1);
      }
    }
  });
});
