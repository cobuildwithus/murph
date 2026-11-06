import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), signal: vi.fn() }));
vi.mock("@/src/lib/prisma", async original => ({ ...await original<typeof import("@/src/lib/prisma")>(), getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: mocks.signal }));
// External root crypto only. Producers, grants, identity, transactions, builders and SQL remain real.
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(),
  unwrapHostedDomainRootForWeb: async () => ({ rootKey: new Uint8Array(32), envelope: { rootKeyId: "synthetic-root" } }),
  prepareHostedDomainRootForWeb: async ({ domain, userId }: { domain: string; userId: string }) => ({ domain, userId, rootKeyId: "synthetic-root" }),
  revalidatePreparedHostedDomainRootForWebTx: async () => ({ rootKeyId: "synthetic-root", root: Promise.resolve({ rootKey: new Uint8Array(32) }) }),
}));
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import { createHostedMailboxAssistantInputId, readHostedConversationAssistantIdentifierSecret } from "@murphai/hosted-execution/assistant-identifiers";
import { createPrismaClient } from "@/src/lib/prisma";
import { ensureHostedMemberChannelWelcome } from "@/src/lib/hosted-onboarding/channel-welcome";
import { welcomeNativeMessagingTelegram } from "@/src/lib/better-auth/native-messaging-telegram-welcome";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { upsertHostedMemberTelegramRoutingBindingTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { appendHostedGroupJoinConfirmationTx, signalHostedGroupJoinConfirmationRuntimeBestEffort } from "@/src/lib/hosted-groups/group-join-confirmation";
import { handleHostedRuntimeGroupTool } from "@/src/lib/hosted-groups/group-tool";
import { handleHostedGroupJoinOfferReaction } from "@/src/lib/hosted-groups/join-offer-reaction";
import { createHostedGroupOfferMessageLookupKey } from "@/src/lib/hosted-groups/offer-message-binding";
import { createHostedExternalThreadIdentityLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { appendHostedMailboxEnvelopeTx } from "@/src/lib/hosted-mailbox/store";
import { runHostedPreferenceHandoffSweeper } from "@/src/lib/hosted-orchestration/preference-handoff-sweeper";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search || url.hash) throw new Error("Producer proof requires an isolated loopback test database.");
}
const logger = { info() {}, warn() {} };
describe.skipIf(!enabled)("committed producer handoff PostgreSQL", () => {
  let db: PrismaClient;
  const ids: string[] = [], groups: string[] = [], events: string[] = [];
  beforeAll(() => { db = createPrismaClient({ databaseUrl, poolMax: 1 }); mocks.getPrisma.mockReturnValue(db); });
  afterEach(async () => {
    await db.hostedLinqProviderEvent.deleteMany({ where: { eventId: { in: events.splice(0) } } });
    await db.hostedGroup.deleteMany({ where: { id: { in: groups.splice(0) } } });
    await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: ids } } });
    await db.hostedMember.deleteMany({ where: { id: { in: ids.splice(0) } } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function member() {
    const id = randomUUID(); ids.push(id);
    await db.hostedMember.create({ data: { id, billingStatus: "active", groupJournalCaptureEnabled: true } });
    await db.hostedConsentGrant.createMany({ data: ["launch.health-data", "launch.legal"].map(scope => ({ memberId: id, scope, status: "granted", grantedAt: new Date(), source: "synthetic", documentVersionsJson: {} })) });
    await db.hostedUserCryptoEnvelope.createMany({ data: (["control", "device", "ingress", "runtime"] as const).map(domain => ({ id: randomUUID(), userId: id, domain, rootKeyId: "synthetic-root", signedEnvelopeJson: { authoritySignature: { alg: "GCP-KMS-EC-P256-SHA256", signedAt: new Date().toISOString(), keyVersionName: "synthetic-key", signature: "synthetic-signature" } } })) });
    await db.hostedWorkspace.create({ data: { userId: id } });
    return id;
  }
  async function group(memberId: string) {
    const room = await member(), id = randomUUID(), membershipId = randomUUID(), chatId = `synthetic-chat-${randomUUID()}`;
    groups.push(id);
    await db.hostedThreadContainer.create({ data: { memberId: room, ownerMemberId: memberId } });
    await db.hostedGroup.create({ data: { id, runtimeMemberId: room, ownerMemberId: memberId, joinCode: randomUUID(), members: { create: { id: membershipId, memberId, joinedAt: new Date() } } } });
    await db.hostedThreadRoute.create({ data: { channel: "linq", accountLookupKey: "synthetic-line", containerMemberId: room, threadLookupKey: randomUUID(), threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId })! } });
    return { room, id, membershipId, chatId };
  }

  it.each(["journal", "channels", "welcome", "join", "sharing"] as const)("recovers the real %s producer's committed row after signal rejection", async producer => {
    const memberId = await member();
    mocks.signal.mockReset().mockRejectedValue(new Error("synthetic signal rejection after commit"));
    let target = memberId;
    let kind = "assistant.notification.requested";
    let replay: (() => Promise<unknown>) | undefined;
    if (producer === "welcome") {
      await upsertHostedMemberEmailAuthorization({ memberId, prisma: db, verifiedEmail: { address: `welcome-${memberId}@example.test`, verifiedAt: new Date() } });
      replay = () => ensureHostedMemberChannelWelcome({ channel: "email", memberId, prisma: db });
      await replay();
    } else if (producer === "channels") {
      kind = "member.channels.updated";
      await db.$transaction(tx => upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId: "1234567", prisma: tx }));
      // Exercise the real Bot API adapter against a synthetic HTTP response; no network is sent.
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, result: { message_id: 1, chat: { id: 1234567, type: "private" } } })));
      replay = () => welcomeNativeMessagingTelegram({ memberId, telegramUserId: "1234567", prisma: db });
      await replay();
    } else if (producer === "join") {
      const g = await group(memberId);
      await db.$transaction(tx => upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId: "1234567", telegramThreadId: "1234567", prisma: tx }));
      const append = await db.$transaction(tx => appendHostedGroupJoinConfirmationTx({ groupDisplayName: "Synthetic group", joinCode: g.id, joinOrigin: "group_chat_reaction", memberId, membershipId: g.membershipId, occurredAt: new Date(), publicBaseUrl: "https://www.withmurph.ai", tx }));
      expect(append.kind).toBe("appended");
      if (append.kind !== "appended") throw new Error("Expected committed confirmation");
      await signalHostedGroupJoinConfirmationRuntimeBestEffort({ ...append.signal, prisma: db });
    } else {
      const email = `sender-${memberId}@example.test`;
      await upsertHostedMemberEmailAuthorization({ memberId, prisma: db, verifiedEmail: { address: email, verifiedAt: new Date() } });
      const g = await group(memberId);
      if (producer === "journal") {
        kind = "journal.group-fact.recorded";
        const wake = buildHostedExecutionLinqConversationMessageWake({ userId: g.room, eventId: randomUUID(), occurredAt: new Date().toISOString(), phoneLookupKey: "synthetic-sender", routeAuthority: { channel: "linq", containerMemberId: g.room, threadId: g.chatId }, linqMessage: {
          chatId: g.chatId, from: email, isFromMe: false, messageId: randomUUID(), parts: [{ type: "text", value: "I spent an hour gardening." }], service: "imessage", threadIsDirect: false,
        } });
        const source = await db.$transaction(tx => appendHostedMailboxEnvelopeTx({ envelope: wake, tx }));
        const assistantInputId = createHostedMailboxAssistantInputId({ eventId: wake.eventId, dedupeKey: source.item.dedupeKey, lane: "conversation", userId: g.room, secret: readHostedConversationAssistantIdentifierSecret(wake) });
        await handleHostedRuntimeGroupTool({ memberId: g.room, logger, scheduleMailboxWake: mocks.signal, request: { action: "record_current_sender_journal_fact", confidence: "high", origin: { kind: "accepted_input", sessionId: "synthetic-session", assistantInputId }, journalFact: { date: "2026-11-06", factIndex: 1, title: "Gardening", note: "Spent an hour gardening.", noteType: "journal-factor" }, privateQuestion: "Save this in your Journal?" } });
      } else {
        target = g.room;
        const messageId = randomUUID();
        await db.hostedGroupJoinOffer.create({ data: { id: randomUUID(), groupId: g.id, messageLookupKey: createHostedGroupOfferMessageLookupKey({ channel: "linq", messageId })!, projectionKindsJson: ["sleep-duration-days.v0"], postedAt: new Date() } });
        const event = parseHostedLinqProviderEvent({ event: { api_version: "v3", created_at: new Date().toISOString(), data: { chat_id: g.chatId, from_handle: { handle: email, service: "iMessage" }, is_from_me: false, message_id: messageId, reacted_at: new Date().toISOString(), reaction_type: "love" }, event_id: randomUUID(), event_type: "reaction.added", webhook_version: "2026-02-03" } });
        if (!event) throw new Error("Expected synthetic reaction");
        await db.$transaction(tx => ingestHostedLinqProviderEventTx({ event, prisma: tx }));
        const storedEvent = await db.hostedLinqProviderEvent.findFirstOrThrow({ where: { messageLookupKey: event.messageLookupKey } }); events.push(storedEvent.eventId);
        replay = () => handleHostedGroupJoinOfferReaction({ event, prisma: db });
        expect(await replay()).toMatchObject({ status: "accepted" });
      }
    }
    const item = await db.hostedMailboxItem.findFirstOrThrow({ where: { userId: target, kind } });
    if (producer === "sharing") {
      // The person's separate projection-maintenance lane has already transferred to its runtime.
      // This proof isolates the room's stranded confirmation without an ordinary room wake.
      const personal = await db.hostedMailboxItem.findFirst({ where: { userId: memberId, lane: "system" }, orderBy: { laneSeq: "desc" } });
      if (personal) await db.hostedWorkspace.update({ where: { userId: memberId }, data: { redactedStatusJson: { hostedMailboxSystemImportedSeq: String(personal.laneSeq) } } });
    }
    expect(mocks.signal).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: target, mailboxItemId: item.id }));
    if (replay) {
      mocks.signal.mockClear();
      await replay();
      expect(mocks.signal).not.toHaveBeenCalled();
    }
    expect(await db.hostedWorkspace.findUnique({ where: { userId: target } })).toMatchObject({ nextWakeAt: null });
    mocks.signal.mockClear().mockResolvedValue({ signalAccepted: true, workflowId: "synthetic" });
    expect((await runHostedPreferenceHandoffSweeper({ logger, now: new Date(item.createdAt.getTime() + 59_999) })).candidateUsers).toBe(0);
    expect(mocks.signal).not.toHaveBeenCalled();
    const now = new Date(item.createdAt.getTime() + 60_001);
    expect((await runHostedPreferenceHandoffSweeper({ logger, now })).handoffAccepted).toBe(1);
    expect(mocks.signal).toHaveBeenCalledExactlyOnceWith({ abortSignal: expect.any(AbortSignal), expectedUserId: target, mailboxItemId: item.id });
    await db.hostedWorkspace.update({ where: { userId: target }, data: { redactedStatusJson: { hostedMailboxSystemImportedSeq: String(item.laneSeq + 1n), hostedMailboxSystemHandledThroughSeq: "0" } } });
    expect((await runHostedPreferenceHandoffSweeper({ logger, now })).candidateUsers).toBe(0);
    expect(mocks.signal).toHaveBeenCalledTimes(1);
  });
});
