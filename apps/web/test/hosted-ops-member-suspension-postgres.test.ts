import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import * as prismaModule from "@/src/lib/prisma";
import { createHostedEmailLookupKey, createHostedLinqChatLookupKey, createHostedPhoneLookupKey, createHostedTelegramUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { lookupHostedMemberIdentityByPhoneNumber } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberRoutingByHomeLinqChatId, resolveHostedMemberCoreByTelegramUserId } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";
import { ensureHostedStarterUsageEnrollment } from "@/src/lib/hosted-onboarding/starter-usage-enrollment-service";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { planHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import { parseHostedTelegramWebhookUpdate } from "@/src/lib/hosted-onboarding/telegram";
import { planHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-provider-telegram";
import { readHostedRuntimeAiAccessDecision, readStrictHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { requireHostedRuntimeMailboxActiveAccess } from "@/src/lib/hosted-mailbox/runtime-access";
import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readHostedRuntimeReconciliationFacts } from "@/src/lib/hosted-orchestration/runtime-reconciliation-facts";
import { sendHostedEmailPublicBootstrapChallenge } from "@/src/lib/hosted-onboarding/hosted-email-public-bootstrap";
import { POST } from "../app/api/ops/member-suspension/route";

const recheck = vi.hoisted(() => vi.fn(async () => ({ signalAccepted: true })));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: vi.fn() }));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedRuntimeRecheckRuntime: recheck }));

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/murph_test(?:_|$)/u.test(url.pathname) || url.searchParams.has("host")) {
    throw new Error("Suspension proof requires a local murph_test database.");
  }
}

describe.skipIf(!enabled)("Ops suspension composed PostgreSQL proof", () => {
  it("retains channel identity, silently denies admission and signup, and restores the same member", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    vi.spyOn(prismaModule, "getPrisma").mockReturnValue(prisma);
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    const memberId = `hbm_suspend_${randomUUID()}`;
    const chatId = `chat_${memberId}`;
    const phone = "+12025550177";
    const telegramUserId = "5550177";
    const email = "suspension-proof@example.test";
    const now = new Date();
    const fetchMock = vi.fn<typeof fetch>(() => { throw new Error("No provider call is permitted."); });
    vi.stubGlobal("fetch", fetchMock);
    const mutate = (operation: "suspend" | "restore") => POST(new Request("https://www.withmurph.ai/api/ops/member-suspension", {
      method: "POST", body: JSON.stringify({ memberId, operation }),
      headers: { "content-type": "application/json" },
    }));
    try {
      await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
      await prisma.hostedMemberIdentity.create({ data: { memberId, phoneLookupKey: createHostedPhoneLookupKey(phone), phoneNumberVerifiedAt: now } });
      await prisma.hostedMemberRouting.create({ data: { memberId, linqChatLookupKey: createHostedLinqChatLookupKey(chatId), telegramUserLookupKey: createHostedTelegramUserLookupKey(telegramUserId) } });
      await prisma.hostedMemberEmailAuthorization.create({ data: { memberId, verifiedEmailLookupKey: createHostedEmailLookupKey(email), verifiedEmailVerifiedAt: now } });
      await prisma.hostedInvite.create({ data: { id: `invite_${memberId}`, memberId, inviteCode: memberId, expiresAt: new Date(now.getTime() + 3_600_000) } });
      await prisma.hostedWorkspace.create({ data: { userId: memberId, nextWakeAt: now, nextWakeReason: "assistant_due" } });
      expect(await readStrictHostedMemberAccess({ memberId, prisma })).toBe(true);
      expect((await mutate("suspend")).status).toBe(200);
      const suspended = await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } });
      expect(suspended.suspendedAt).toBeInstanceOf(Date);
      expect((await mutate("suspend")).status).toBe(200);
      expect((await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } })).suspendedAt).toEqual(suspended.suspendedAt);

      expect(await lookupHostedMemberIdentityByPhoneNumber({ phoneNumber: phone, prisma, projection: "core" })).toMatchObject({ core: { id: memberId, suspendedAt: suspended.suspendedAt } });
      expect(await lookupHostedMemberRoutingByHomeLinqChatId({ linqChatId: chatId, prisma, projection: "core" })).toMatchObject({ core: { id: memberId } });
      expect(await resolveHostedMemberCoreByTelegramUserId({ telegramUserId, prisma })).toMatchObject({ status: "found", core: { id: memberId, suspendedAt: suspended.suspendedAt } });
      expect(await lookupHostedMemberByVerifiedEmailAddress({ address: email, prisma, projection: "core" })).toMatchObject({ core: { id: memberId, suspendedAt: suspended.suspendedAt } });

      // Both existing and new chat IDs must resolve the banned phone before first contact.
      for (const incomingChatId of [chatId, `new_${chatId}`]) {
        const event = parseHostedLinqWebhookEvent(JSON.stringify({
          api_version: "v3", webhook_version: "2026-02-03", event_id: `event_${incomingChatId}`, event_type: "message.received", created_at: now.toISOString(),
          data: { chat: { id: incomingChatId, is_group: false }, direction: "inbound", id: `message_${incomingChatId}`,
            sender_handle: { handle: phone, service: "iMessage" }, recipient_phone: "+12025550178", sent_at: now.toISOString(), service: "iMessage", parts: [{ type: "text", value: "Hello" }] },
        }));
        const plan = await prisma.$transaction(tx => planHostedOnboardingLinqWebhook({ event, prisma: tx, requireFirstContactAdmission: true }));
        expect(plan.response).toMatchObject({ ignored: true, reason: "suspended-member" });
        expect(plan.firstContactAdmissionRequest).toBeUndefined();
        expect(plan.desiredSideEffects ?? []).toEqual([]);
        expect(plan.wakeHandoffs ?? []).toEqual([]);
      }
      for (const type of ["private", "group"] as const) {
        const update = parseHostedTelegramWebhookUpdate(JSON.stringify({ update_id: 5550177, message: {
          chat: { id: type === "private" ? 5550177 : -5550177, type }, from: { id: 5550177, first_name: "Synthetic" },
          date: Math.floor(now.getTime() / 1000), message_id: 1, text: "Hello",
        } }));
        const plan = await prisma.$transaction(tx => planHostedOnboardingTelegramWebhook({ update, prisma: tx }));
        expect(plan.response).toMatchObject({ ignored: true, reason: "suspended-member" });
        expect(plan.desiredSideEffects ?? []).toEqual([]);
        expect(plan.wakeHandoffs ?? []).toEqual([]);
      }
      expect((await getHostedInviteStatus({ inviteCode: memberId, prisma, authenticatedMember: suspended })).stage).toBe("blocked");
      expect(deriveHostedPostVerificationStage(suspended)).toBe("blocked");
      // A session created before suspension cannot reactivate through an old /join invite.
      await expect(ensureHostedStarterUsageEnrollment({
        inviteCode: memberId, member: { id: memberId, suspendedAt: null }, prisma, source: "web_onboarding",
      })).rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });
      expect(await readStrictHostedMemberAccess({ memberId, prisma })).toBe(false);
      const sendEmail = vi.fn();
      expect(await sendHostedEmailPublicBootstrapChallenge({ candidateAddress: email, prisma, sendEmail, env: {
        RESEND_API_KEY: "test-key", HOSTED_SIGNUP_WELCOME_EMAIL_FROM: "Murph <hello@example.test>",
        HOSTED_EMAIL_DOMAIN: "mail.example.test", HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SIGNING_SECRET: "test-signing-secret",
      } })).toMatchObject({ status: "suppressed", reason: "inactive" });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await readHostedRuntimeAiAccessDecision({ memberId, prisma })).toMatchObject({ allowed: false, userNotice: null });
      for (const mode of ["read_only", "read_first", "mutating"] as const) {
        expect(await resolveHostedRuntimeAiUsageGate({ mode, userId: memberId, prisma })).toMatchObject({ status: "denied" });
      }
      await expect(requireHostedRuntimeMailboxActiveAccess(memberId, { prisma })).rejects.toMatchObject({ code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE" });
      expect((await readHostedRuntimeReconciliationFacts({ userId: memberId })).blocked).toMatchObject({ reason: "user_not_active" });
      expect(await prisma.hostedRuntimeOwner.count({ where: { userId: memberId } })).toBe(0);
      expect(await prisma.hostedMailboxItem.count({ where: { userId: memberId } })).toBe(0);
      expect(await prisma.hostedInvite.count({ where: { memberId } })).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();

      expect((await mutate("restore")).status).toBe(200);
      expect((await mutate("restore")).status).toBe(200);
      expect((await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } })).suspendedAt).toBeNull();
      expect(await readStrictHostedMemberAccess({ memberId, prisma })).toBe(true);
      expect(await readHostedRuntimeAiAccessDecision({ memberId, prisma })).toMatchObject({ allowed: true });
      expect(await lookupHostedMemberIdentityByPhoneNumber({ phoneNumber: phone, prisma, projection: "core" })).toMatchObject({ core: { id: memberId, suspendedAt: null } });
    } finally {
      await prisma.hostedMember.deleteMany({ where: { id: memberId } });
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
});
