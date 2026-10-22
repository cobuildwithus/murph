import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";
import { createHostedPhoneCall } from "@/src/lib/phone-calls/service";
import { accountRetellPhoneCallUsage } from "@/src/lib/phone-calls/usage";
import { processHostedPhoneCallRecoveryById } from "@/src/lib/phone-calls/reconciliation";
import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { readGameChatAllowanceBeneficiary } from "@/src/lib/hosted-onboarding/member-access";
import type { HostedAssistantNotificationDestination } from "@/src/lib/hosted-routing/assistant-notification-destination";
import type { PhoneCallRuntime } from "@/src/lib/phone-calls/types";

const edges = vi.hoisted(() => ({ db: null as PrismaClient | null, accepted: vi.fn(), identity: vi.fn() }));
vi.mock("@/src/lib/prisma", async original => ({
  ...await original<typeof import("@/src/lib/prisma")>(),
  getPrisma: () => { if (!edges.db) throw new Error("Synthetic database missing."); return edges.db; },
}));
// Only trusted message/identity decoding is stubbed. Current membership,
// historical activation, access, reservation, and accounting use PostgreSQL.
vi.mock("@/src/lib/hosted-mailbox/store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-mailbox/store")>(),
  readHostedMailboxConversationWakeByAssistantInputId: edges.accepted,
}));
vi.mock("@/src/lib/hosted-groups/participant-member", async original => ({
  ...await original<typeof import("@/src/lib/hosted-groups/participant-member")>(),
  lookupHostedGroupParticipantMemberByProviderEvidence: edges.identity,
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host") || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Phone allowance proof requires an isolated loopback test database.");
  }
}

const brief: HostedPhoneCallBrief = {
  allowTransferToUser: false, goal: "Ask whether the shop opens on Sunday.",
  instructions: [], shareableFacts: {}, successCriteria: "Confirm Sunday opening hours.",
  timeZone: "UTC", to: { label: "Shop", phoneNumber: "+12125550123" },
};

describe.skipIf(!enabled)("game room phone-call allowance PostgreSQL", () => {
  it.each(["webhook", "reconciliation"] as const)("denies game-only calls and keeps paid calls self-funded through %s replay", async terminal => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    edges.db = db;
    const suffix = randomUUID();
    const primary = `phone_primary_${suffix}`;
    const alternate = `phone_alternate_${suffix}`;
    const first = `phone_player_a_${suffix}`;
    const second = `phone_player_b_${suffix}`;
    const ids = [primary, alternate, first, second];
    const gameId = `phone_game_${suffix}`;
    const groupId = `phone_group_${suffix}`;
    const now = new Date();
    const assistantInputId = `ain_${randomUUID().replaceAll("-", "")}`;
    const requester = { assistantInputId, senderHandle: "+12125550111", source: "linq" as const };
    const authority = { channel: "linq" as const, containerMemberId: alternate,
      accountLookupKey: `phone_account_${suffix}`, threadId: `phone_thread_${suffix}` };
    const destination: HostedAssistantNotificationDestination = {
      conversationShape: "thread-container", externalThreadRouteAuthority: authority,
      route: { actorId: null, channel: "linq", identityId: "synthetic-line", threadId: authority.threadId,
        threadIsDirect: false, delivery: { kind: "thread", target: authority.threadId } },
    };
    const costUsdMicros = 7_500_000;
    const runtime: PhoneCallRuntime = {
      start: vi.fn(async call => ({ providerCallId: `synthetic_${call.id}` })),
      resolveProviderCall: async callId => ({ state: "found", providerCallId: `synthetic_${callId}` }),
      stopIfActive: async () => "already_terminal",
      resolveTerminalUsage: async providerCallId => ({ state: "ready", usage: {
        combinedCostUsdMicros: costUsdMicros, occurredAt: now, providerCallId,
      } }),
    };
    try {
      await db.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "not_started" })) });
      for (const memberId of [primary, alternate]) {
        await db.hostedThreadContainer.create({ data: { memberId, ownerMemberId: first,
          participants: { create: [first, second].map(participantMemberId => ({
            participantMemberId, handleLookupKey: `synthetic_${participantMemberId}`, firstSeenAt: now, lastSeenAt: now,
          })) },
        } });
        await db.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: memberId,
          threadLookupKey: `thread_${memberId}`, threadIdentityLookupKey: `identity_${memberId}` } });
      }
      await db.hostedGroup.create({ data: { id: groupId, ownerMemberId: first, runtimeMemberId: alternate,
        members: { create: [first, second].map(memberId => ({ id: `membership_${memberId}`, memberId, joinedAt: now })) },
      } });
      // Historical activation survives the requester's ordinary paid access.
      await db.hostedMailboxItem.create({ data: { id: `activation_${suffix}`, userId: first,
        kind: "member.activated", lane: "system", laneSeq: 1n, dedupeKey: "synthetic-activation",
        occurredAt: now, payloadSchema: "synthetic-activation", consumedAt: now,
      } });
      await db.gameProfile.createMany({ data: [first, second].map(memberId => ({
        memberId, firstNameEncrypted: "synthetic-name", timeZone: "UTC",
      })) });
      await db.game.create({ data: { id: gameId, createdBy: first, status: "live",
        liveRosterKey: [first, second].sort().join(":"), chatContainerMemberId: primary,
        terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-terms",
        players: { create: [first, second].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: now })) },
      } });
      edges.accepted.mockResolvedValue(buildHostedExecutionLinqConversationMessageWake({
        accountLookupKey: authority.accountLookupKey, contactKind: "phone", contactLookupKey: "synthetic-contact",
        eventId: assistantInputId, occurredAt: now.toISOString(), userId: alternate, routeAuthority: authority,
        linqMessage: { chatId: authority.threadId, from: requester.senderHandle, isFromMe: false,
          messageId: "synthetic-source-message", parts: [{ type: "text", value: "Ask about Sunday hours." }], threadIsDirect: false },
      }));
      edges.identity.mockResolvedValue({ core: { id: first } });
      expect(await readGameChatAllowanceBeneficiary({ memberId: alternate, now, prisma: db })).toBe(primary);
      expect((await readHostedAiUsageGate({ memberId: alternate, now, prisma: db })).allowed).toBe(true);
      const create = () => createHostedPhoneCall({ brief, memberId: alternate, originSessionId: `session_${suffix}`,
        requestKey: `request_${suffix}`, groupRequester: requester,
        notificationDestinationResolver: async () => destination,
        reconciliationWorkflowStarter: async () => undefined, runtime,
        crypto: { encryptBrief: async () => "synthetic-sealed-brief", decryptBrief: async () => brief,
          encryptResult: async () => "synthetic-sealed-result", decryptResult: async () => { throw new Error("Unexpected result read."); } },
      });
      await expect(create()).rejects.toMatchObject({ code: "HOSTED_ACCESS_REQUIRED" });
      expect(edges.accepted).toHaveBeenCalledOnce();
      expect(edges.identity).toHaveBeenCalledOnce();
      expect(runtime.start).not.toHaveBeenCalled();
      expect(await db.hostedPhoneCall.count({ where: { memberId: alternate } })).toBe(0);
      expect(await db.hostedAiUsage.count({ where: { memberId: { in: ids } } })).toBe(0);
      expect(await db.hostedAiUsagePeriod.count({ where: { memberId: { in: ids } } })).toBe(0);

      // Ordinary owner access independently admits phone capability. That same
      // owner access makes the room use its own allowance, not the game's.
      await db.hostedMember.update({ where: { id: first }, data: { billingStatus: "active" } });
      expect(await readGameChatAllowanceBeneficiary({ memberId: alternate, now, prisma: db })).toBeNull();
      edges.accepted.mockClear();
      const created = await create();
      const call = await db.hostedPhoneCall.findUniqueOrThrow({ where: { id: created.phoneCallId } });
      expect(call).toMatchObject({ memberId: alternate, status: "calling" });
      expect(runtime.start).toHaveBeenCalledOnce();
      expect(edges.accepted).toHaveBeenCalledTimes(2); // Initial and provider-entry authority.
      await db.hostedPhoneCall.update({ where: { id: call.id }, data: { status: "ended", endedAt: now } });

      if (terminal === "reconciliation") {
        await db.game.update({ where: { id: gameId }, data: { chatContainerMemberId: alternate } });
        const recover = () => processHostedPhoneCallRecoveryById({ phoneCallId: call.id, runtime,
          signal: AbortSignal.timeout(10_000) });
        await expect(recover()).resolves.toBe("complete");
        await expect(recover()).resolves.toBe("complete");
      } else {
        const payload = { call_id: call.providerCallId!, start_timestamp: now.getTime(), end_timestamp: now.getTime() + 60_000,
          call_cost: { combined_cost: costUsdMicros / 10_000 }, metadata: { murph_phone_call_id: call.id,
            allowanceBeneficiaryMemberId: primary } };
        await expect(accountRetellPhoneCallUsage({ call: payload })).resolves.toBe("accounted");
        await expect(accountRetellPhoneCallUsage({ call: payload })).resolves.toBe("accounted");
      }
      const usage = await db.hostedAiUsage.findMany({ where: { memberId: alternate } });
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ allowanceBeneficiaryMemberId: null, allowanceCostUsdMicros: BigInt(costUsdMicros) });
      expect(await db.hostedAiUsagePeriod.findMany({ where: { memberId: { in: [primary, alternate] } } }))
        .toEqual([expect.objectContaining({ memberId: alternate, spentUsdMicros: BigInt(costUsdMicros) })]);
      expect(await readHostedAiUsageGate({ memberId: alternate, now, prisma: db })).toMatchObject({
        allowed: false, reason: "ai_usage_limit_exceeded", remainingUsdMicros: 0n,
      });
      expect((await readHostedAiUsageGate({ memberId: primary, now, prisma: db })).allowed).toBe(true);
    } finally {
      edges.accepted.mockReset(); edges.identity.mockReset(); edges.db = null;
      await db.game.deleteMany({ where: { id: gameId } });
      await db.hostedGroup.deleteMany({ where: { id: groupId } });
      await db.hostedThreadContainer.deleteMany({ where: { memberId: { in: ids } } });
      await db.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect(); vi.unstubAllEnvs();
    }
  });
});
