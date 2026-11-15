import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { isHostedLinqWebhookSenderBlocked } from "@/src/lib/hosted-onboarding/linq-sender-block";
import { observeHostedLinqGroupRiskWebhook } from "@/src/lib/hosted-onboarding/linq-group-risk-webhook";
import { blockHostedLinqHandle, parseHostedLinqBlockContact } from "@/src/lib/hosted-routing/linq-handle-block";
import { prepareHostedLinqGroupLeave } from "@/src/lib/hosted-routing/linq-group-leave";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq-webhook";
import { syntheticPhone } from "./support/roster-postgres";
const effects = vi.hoisted(() => ({ generation: vi.fn(), claim: vi.fn(), mailbox: vi.fn(), wake: vi.fn(), reaction: vi.fn(), poll: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/linq-instant-first-turn", async original => ({ ...await original<typeof import("@/src/lib/hosted-onboarding/linq-instant-first-turn")>(), startHostedLinqInstantFirstTurnGeneration: effects.generation, claimHostedLinqInstantFirstTurn: effects.claim }));
vi.mock("@/src/lib/hosted-mailbox/store", async original => ({ ...await original<typeof import("@/src/lib/hosted-mailbox/store")>(), appendPreparedHostedMailboxEnvelopeTx: effects.mailbox }));
vi.mock("@/src/lib/hosted-onboarding/webhook-service-wake", () => ({ maybeHandoffHostedExecutionWebhookWake: effects.wake }));
vi.mock("@/src/lib/hosted-polls/linq-webhook", () => ({ handleHostedLinqPollWebhook: effects.poll }));
vi.mock("@/src/lib/hosted-groups/join-offer-reaction", async original => ({ ...await original<typeof import("@/src/lib/hosted-groups/join-offer-reaction")>(), handleHostedGroupJoinOfferReaction: effects.reaction }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Webhook proof requires its isolated local test database.");
describe.skipIf(!enabled)("authenticated risk ingress", () => {
  const prisma = getPrisma();
  let chatId: string, line: string, sender: string;
  beforeEach(() => {
    vi.clearAllMocks(); chatId = randomUUID(); line = syntheticPhone(); sender = syntheticPhone();
    vi.stubEnv("LINQ_WEBHOOK_SECRET", "synthetic-risk-secret");
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider work permitted."); }));
  });
  afterEach(async () => {
    await prisma.hostedLinqGroupSighting.deleteMany(); await prisma.hostedLinqGroupLeave.deleteMany(); await prisma.hostedLinqHandleBlock.deleteMany();
    await prisma.hostedThreadContainer.deleteMany({ where: { memberId: "synthetic-risk-bound" } });
    await prisma.hostedMember.deleteMany({ where: { id: "synthetic-risk-bound" } });
    await prisma.hostedLinqLine.deleteMany({ where: { phoneNumberHint: "synthetic-risk-bound" } });
    vi.unstubAllEnvs();
  });
  function event(type: string, group = false): HostedLinqWebhookEvent {
    const now = new Date().toISOString(), chat = { id: chatId, is_group: group, owner_handle: { handle: line, is_me: true } };
    const data = type === "message.received" ? { chat, id: randomUUID(), direction: "inbound", sender_handle: { handle: sender, is_me: false },
      recipient_handle: { handle: line, is_me: true }, sent_at: now, parts: [{ type: "text", value: "Synthetic test reply" }], service: "iMessage" }
      : type === "message.edited" ? { chat, id: "synthetic-accepted-message", direction: "inbound", sender_handle: { handle: sender, is_me: false }, edited_at: now, part: { index: 0, text: "Synthetic edit" } }
      : type.startsWith("participant.") ? { chat_id: chatId, participant: { handle: sender, is_me: false }, ...(type === "participant.added" ? { added_at: now } : { removed_at: now }) }
      : { chat, message_id: "synthetic-accepted-message", from: sender, is_from_me: false, reaction_type: "like", part_index: 0 };
    return { api_version: "v3", webhook_version: "2026-02-03", event_id: randomUUID(), event_type: type, created_at: now, data };
  }
  async function ingress(event: HostedLinqWebhookEvent) {
    const rawBody = JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "synthetic-risk-secret").update(`${timestamp}.${rawBody}`).digest("hex");
    return handleHostedOnboardingLinqWebhook({ rawBody, timestamp, signature, prisma });
  }
  function quiet() {
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
  async function mark() {
    const { chatId: ignored, ...prepared } = prepareHostedLinqGroupLeave(chatId, "oversized"); void ignored;
    await prisma.hostedLinqGroupLeave.create({ data: prepared });
  }
  it.each(["message.received", "message.edited", "reaction.added", "reaction.removed"])("blocks %s before all work; unblocked contacts pass the predicate", async type => {
    const input = event(type);
    expect(await isHostedLinqWebhookSenderBlocked(input, prisma)).toBe(false);
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact(sender), reason: "operator", prisma });
    expect(await ingress(input)).toEqual({ ok: true, ignored: true, reason: "sender-blocked" }); quiet();
  });
  it("blocks both second and third opening replies without generation or claims", async () => {
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact(sender), reason: "spam", prisma });
    for (let reply = 2; reply <= 3; reply++) expect((await ingress(event("message.received"))).reason).toBe("sender-blocked");
    quiet();
  });
  it("suppresses a bound-room sender while preserving the route", async () => {
    await prisma.hostedMember.create({ data: { id: "synthetic-risk-bound", billingStatus: "active" } });
    await prisma.hostedThreadContainer.create({ data: { memberId: "synthetic-risk-bound", ownerMemberId: "synthetic-risk-bound" } });
    const accountLookupKey = createHostedPhoneLookupKey(line)!;
    await prisma.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: "synthetic-risk-bound", accountLookupKey,
      threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({ channel: "linq", threadId: chatId })!,
      threadLookupKey: createHostedExternalThreadLookupKey({ channel: "linq", threadId: chatId, accountLookupKey })!, deliveryRouteEncrypted: "synthetic" } });
    await blockHostedLinqHandle({ contact: parseHostedLinqBlockContact(sender), reason: "operator", prisma });
    expect((await ingress(event("message.received", true))).reason).toBe("sender-blocked");
    expect(await prisma.hostedThreadRoute.count({ where: { containerMemberId: "synthetic-risk-bound" } })).toBe(1);
    expect(await prisma.hostedLinqGroupLeave.count()).toBe(0); quiet();
  });
  it("observes duplicate marked-room messages, additions and self-removal without other work", async () => {
    await mark();
    const message = event("message.received", true);
    for (const input of [message, message, event("message.received", true), event("participant.added", true)]) {
      expect((await ingress(input)).reason).toBe("group-left");
    }
    const removed = event("participant.removed", true);
    removed.data = { chat_id: chatId, participant: { handle: line, is_me: true }, removed_at: removed.created_at };
    expect((await ingress(removed)).reason).toBe("group-left");
    expect(await prisma.hostedLinqGroupHandle.count()).toBe(1);
    expect((await prisma.hostedLinqGroupHandle.findFirstOrThrow()).firstSentAt).not.toBeNull();
    expect((await prisma.hostedLinqGroupLeave.findFirstOrThrow()).providerRemovedAt).toEqual(new Date(removed.created_at)); quiet();
  });
  it("records unbound, bound and marked group evidence without any provider read", async () => {
    for (const type of ["message.received", "message.received", "participant.added"]) {
      await observeHostedLinqGroupRiskWebhook({ event: event(type, true), prisma });
    }
    expect(fetch).not.toHaveBeenCalled();
    // A participant event carries no group flag; an unknown room is not guessed into the ledger.
    expect(await prisma.hostedLinqGroupSighting.count()).toBe(1);
    expect(await prisma.hostedLinqGroupHandle.findFirstOrThrow()).toMatchObject({ firstSeenVia: "sender" });
  });
  it("never lets a ledger failure stop the webhook, unless the request was aborted", async () => {
    await mark();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transaction = vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("synthetic ledger failure"));
    try {
      await expect(observeHostedLinqGroupRiskWebhook({ event: event("message.received", true), prisma })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("Hosted Linq group risk observation failed.", { code: "observation_failed" });
      const aborted = new AbortController(); aborted.abort();
      await expect(observeHostedLinqGroupRiskWebhook({ event: event("message.received", true), prisma, signal: aborted.signal })).rejects.toThrow();
    } finally { transaction.mockRestore(); warn.mockRestore(); }
    expect(await prisma.hostedLinqGroupSighting.count()).toBe(0);
  });
  it("keeps typing and delivery callbacks outside evidence", async () => {
    await mark();
    for (const type of ["chat.typing_indicator.started", "message.delivered"]) {
      const input = event(type, true); input.data = { chat_id: chatId };
      expect((await ingress(input)).reason).toBe("group-left");
    }
    expect(await prisma.hostedLinqGroupSighting.count()).toBe(0); quiet();
  });
});
