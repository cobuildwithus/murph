import { randomUUID } from "node:crypto";
import { HostedBillingStatus } from "@prisma/client";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { readHostedAiUsageGate, reconcileHostedAiUsageAllowancePeriodForMemberTx, resolveHostedAiUsageGate, settleHostedAiUsageForAllowanceTx } from "@/src/lib/hosted-execution/usage-allowance";
import { recordHostedAiUsageRecords, recordHostedAiUsageRecordsAndSendLimitNotices } from "@/src/lib/hosted-execution/usage";
import { appendHostedUsageCreditGrantTx, lockHostedUsageCreditBeneficiaryTx } from "@/src/lib/hosted-execution/usage-credits";
import { readHostedRuntimeAiAccessDecision, readHostedRuntimeAiAllowedMemberIds, readStrictHostedPersonAccess } from "@/src/lib/hosted-onboarding/member-access";
import { readHostedPersonalUsageCreditOfferCodes } from "@/src/lib/hosted-onboarding/personal-usage-credit-eligibility";
import { hostedRuntimeUsageMemberSelect, resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { ensureHostedThreadContainerRouteTx } from "@/src/lib/hosted-routing/thread-container-service";
import { claimHostedRuntime, prepareHostedRuntimeLaunch } from "@/src/lib/hosted-execution/runtime-owner";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "@/src/lib/legal/consent";

vi.mock("@/src/lib/hosted-onboarding/runtime", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/runtime")>(),
  getHostedOnboardingEnvironment: () => ({ stripeUsageCreditPriceIdsByOffer: { usage_5_usd: "price_test" } }),
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/murph_test_") || url.search) {
    throw new Error("Credit proof requires isolated loopback murph_test_* PostgreSQL.");
  }
}
const now = new Date("2026-11-06T12:00:00Z");
const periodStart = new Date("2026-11-01T00:00:00Z");
const periodEnd = new Date("2026-12-01T00:00:00Z");

describe.skipIf(!enabled)("lapsed personal credit on PostgreSQL", () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  const members: string[] = [];
  const groups: string[] = [];
  afterAll(async () => {
    await prisma.hostedThreadContainer.deleteMany({ where: { memberId: { in: members } } });
    await prisma.hostedAccountGroup.deleteMany({ where: { id: { in: groups } } });
    await prisma.hostedUsageCreditGrant.deleteMany({ where: { beneficiaryMemberId: { in: members } } });
    await prisma.hostedUsageCreditEntry.deleteMany({ where: { beneficiaryMemberId: { in: members }, kind: "usage_debit" } });
    await prisma.hostedUsageCreditEntry.deleteMany({ where: { beneficiaryMemberId: { in: members } } });
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: members } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: members } } });
    await prisma.$disconnect();
  });

  async function seed(balance = 1_000_000n, billingStatus: HostedBillingStatus = "canceled") {
    const id = `credit_fixture_${randomUUID()}`;
    members.push(id);
    await prisma.hostedMember.create({ data: { id, billingStatus, billingRef: { create: {
      currentBillingPhase: "paid", currentBillingPlanCode: "launch_max_monthly",
      currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
      stripeSubscriptionLookupKey: `subscription_${id}`, stripeCustomerLookupKey: `customer_${id}`,
    } } } });
    if (balance > 0n) {
      await prisma.$transaction(async tx => {
        const lockedBeneficiary = await lockHostedUsageCreditBeneficiaryTx({ beneficiaryMemberId: id, tx });
        await appendHostedUsageCreditGrantTx({ effectiveAt: periodStart, grantUsdMicros: balance,
          lockedBeneficiary, semanticSourceKey: `fixture/${id}`, source: { kind: "starter", sourceReferenceLookupKey: `fixture/${id}` }, tx });
      });
    }
    return id;
  }

  function usage(memberId: string): AssistantUsageRecord {
    const turnId = `usage_fixture_${randomUUID()}`;
    const usageId = `${turnId}.attempt-1`;
    return { apiKeyEnv: "OPENAI_API_KEY", attemptCount: 1, baseUrl: "https://api.openai.com/v1",
      cacheWriteTokens: null, cachedInputTokens: 0, credentialSource: "platform", featureKey: "chat", gatewayTags: [],
      inputTokens: 1_000_000, memberId, occurredAt: now.toISOString(), outputTokens: 0, provider: "openai", providerName: "OpenAI",
      providerRequestId: usageId, providerRequestOutcome: "succeeded", providerRequestOrdinal: 0,
      rawUsageJson: null, rawUsageJsonHash: null, reasoningTokens: 0, reportingUserId: null,
      requestedModel: "gpt-5.6-luna", routeId: null, schema: "murph.assistant-usage.v1", servedModel: "gpt-5.6-luna",
      sessionId: usageId, surface: "hosted-web", tokenPricingBasis: "standard", totalTokens: 1_000_000,
      triggerKind: "message", turnId, turnProfileJson: null, usageId,
      usageExtractionSourcePath: "openai.responses.usage", usageExtractionVersion: "openai-responses-v1" };
  }

  it.each(["paused", "past_due", "canceled", "unpaid"] as const)("spends only existing credit with stale future paid metadata: %s", async status => {
    const memberId = await seed(1_000_000n, status);
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toEqual({ allowed: true });
    expect(await readHostedRuntimeAiAllowedMemberIds({ memberIds: [memberId], now, prisma })).toEqual(new Set([memberId]));
    for (const gate of [readHostedAiUsageGate, resolveHostedAiUsageGate]) {
      expect(await gate({ memberId, now, prisma })).toMatchObject({ allowed: true, allowanceSource: "direct_starter", limitUsdMicros: 0n, remainingUsdMicros: 1_000_000n });
    }
    expect(await readStrictHostedPersonAccess({ memberId, prisma })).toBe(false);
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma, sponsorshipOnly: true })).toMatchObject({ allowed: false });
    expect(await readHostedRuntimeAiAllowedMemberIds({ memberIds: [memberId], now, prisma, sponsorshipOnly: true })).toEqual(new Set());
    const record = usage(memberId);
    await recordHostedAiUsageRecords({ accountAllowance: true, prisma, trustedUserId: memberId, usage: [record] });
    const settled = await prisma.hostedAiUsage.findUniqueOrThrow({ where: { id: record.usageId } });
    expect(settled.allowanceCostUsdMicros).toBeGreaterThan(0n);
    const member = await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(member.usageCreditBalanceUsdMicros).toBe(1_000_000n - settled.allowanceCostUsdMicros!);
    expect(member.billingStatus).toBe(status);
    await prisma.$transaction(tx => reconcileHostedAiUsageAllowancePeriodForMemberTx({ memberId, now, tx }));
    expect(await prisma.hostedAiUsagePeriod.findMany({ where: { memberId }, select: { limitUsdMicros: true } })).toEqual([{ limitUsdMicros: 0n }]);
    expect(await prisma.hostedUsageCreditEntry.count({ where: { beneficiaryMemberId: memberId, kind: "starter_grant" } })).toBe(1);
    expect(await prisma.hostedMemberBillingRef.findUniqueOrThrow({ where: { memberId } })).toMatchObject({ currentBillingPlanCode: "launch_max_monthly", currentPeriodEnd: periodEnd });
  });

  it("denies zero balance without granting or enrolling and retains billing notice", async () => {
    const memberId = await seed(0n);
    for (const gate of [readHostedAiUsageGate, resolveHostedAiUsageGate]) {
      expect(await gate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive", limitUsdMicros: 0n });
    }
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false, userNotice: { code: "billing_inactive" } });
    expect(await prisma.hostedUsageCreditEntry.count({ where: { beneficiaryMemberId: memberId } })).toBe(0);
    expect(await prisma.hostedAiUsagePeriod.count({ where: { memberId } })).toBe(0);
  });

  it("rejects a negative persisted balance and fails closed on a negative read projection", async () => {
    const memberId = await seed(0n);
    await expect(prisma.hostedMember.update({ where: { id: memberId }, data: { usageCreditBalanceUsdMicros: -1n } })).rejects.toThrow();
    const memberState = { ...await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId }, select: hostedRuntimeUsageMemberSelect }), usageCreditBalanceUsdMicros: -1n };
    expect(await readHostedAiUsageGate({ memberId, memberState, now, prisma })).toMatchObject({ allowed: false, limitUsdMicros: 0n });
    expect(await readHostedRuntimeAiAccessDecision({ memberId, memberState, now, prisma })).toMatchObject({ allowed: false, userNotice: { code: "billing_inactive" } });
  });

  it("serializes competing final-credit spends and returns the billing notice at zero", async () => {
    const memberId = await seed(1n);
    const attempt = () => prisma.$transaction(async tx => {
      const decision = await resolveHostedAiUsageGate({ memberId, now, prisma: tx });
      if (!decision.allowed) return false;
      const record = usage(memberId);
      await recordHostedAiUsageRecords({ prisma: tx, trustedUserId: memberId, usage: [record] });
      expect(await settleHostedAiUsageForAllowanceTx({ memberId, now, record, tx })).toMatchObject({ platformAiUsageAllowedAfter: false, limitNoticeCandidate: null });
      return true;
    }, { timeout: 15_000 });
    expect((await Promise.all([attempt(), attempt()])).sort()).toEqual([false, true]);
    expect(await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } })).toMatchObject({ usageCreditBalanceUsdMicros: 0n });
    expect(await prisma.hostedAiUsage.count({ where: { memberId } })).toBe(1);
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false, userNotice: { code: "billing_inactive" } });
  });

  it("accounts two already-admitted concurrent settlements without double spending the last credit", async () => {
    const memberId = await seed(1n);
    const records = [usage(memberId), usage(memberId)];
    const claim = await claimHostedRuntime({ prisma, userId: memberId, processingMode: "default", now });
    if (claim.status === "blocked" || !claim.owner.attemptId) throw new Error("Synthetic runtime was not admitted.");
    const runtimeIdentity = { userId: memberId, attemptId: claim.owner.attemptId, generation: claim.owner.generation.toString() };
    await prepareHostedRuntimeLaunch({ prisma, identity: runtimeIdentity, runnerContainerName: "synthetic-credit-runner",
      workspaceVersion: "0", providerEgressTokenHash: null, platformAiUsageAllowed: true });
    const results = await Promise.all(records.map(record => recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true, noticeDeliveryTarget: null, prisma, runtimeIdentity, trustedUserId: memberId, usage: [record],
    })));
    expect(results.every(result => result.platformAiUsageAllowedAfter === false)).toBe(true);
    expect(await prisma.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId: memberId } })).toMatchObject({ platformAiUsageAllowed: false });
    const debits = await prisma.hostedUsageCreditEntry.aggregate({ where: { beneficiaryMemberId: memberId, kind: "usage_debit" }, _sum: { amountUsdMicros: true } });
    expect(debits._sum.amountUsdMicros).toBe(-1n);
    expect(await prisma.hostedAiUsage.count({ where: { memberId, allowanceCounted: true } })).toBe(2);
    expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
  });

  it("settles real late spend after lapse even when no credit remains", async () => {
    const memberId = await seed(0n, "active");
    expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: true });
    await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "canceled" } });
    const record = usage(memberId);
    await recordHostedAiUsageRecords({ accountAllowance: true, prisma, trustedUserId: memberId, usage: [record] });
    expect(await prisma.hostedAiUsage.findUniqueOrThrow({ where: { id: record.usageId } })).toMatchObject({ allowanceCounted: true });
    expect(await prisma.hostedUsageCreditEntry.count({ where: { beneficiaryMemberId: memberId } })).toBe(0);
    expect(await readHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false, limitUsdMicros: 0n });
  });

  it("uses valid Family allowance ahead of lapsed personal credit", async () => {
    const memberId = await seed();
    const owner = await seed(0n, "active");
    const groupId = `family_fixture_${randomUUID()}`;
    groups.push(groupId);
    await prisma.hostedAccountGroup.create({ data: { id: groupId, ownerMemberId: owner, billingStatus: "active",
      billingRef: { create: { currentBillingPhase: "paid", currentBillingPlanCode: "launch_family_monthly", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } },
      memberships: { create: { id: `membership_${randomUUID()}`, memberId, role: "member", planCode: "edge" } } } });
    for (const gate of [readHostedAiUsageGate, resolveHostedAiUsageGate]) {
      expect(await gate({ memberId, now, prisma })).toMatchObject({ allowed: true, allowanceSource: "family_sponsored_plan", limitUsdMicros: 15_200_000n });
    }
    await recordHostedAiUsageRecords({ accountAllowance: true, prisma, trustedUserId: memberId, usage: [usage(memberId)] });
    expect(await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } })).toMatchObject({ usageCreditBalanceUsdMicros: 1_000_000n });
  });

  it.each(["linq", "telegram"] as const)("rejects room provisioning from personal credit on %s", async channel => {
    const memberId = await seed();
    await expect(prisma.$transaction(tx => ensureHostedThreadContainerRouteTx({
      accountLookupKey: "synthetic_account", channel, occurredAt: now,
      ownerMemberId: memberId, prisma: tx, threadId: "synthetic_thread",
    }))).rejects.toMatchObject({ code: "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED" });
    expect(await prisma.hostedThreadContainer.count({ where: { ownerMemberId: memberId } })).toBe(0);
  });

  it("never uses lapsed owner or participant credit to fund a room", async () => {
    const owner = await seed();
    const participant = await seed();
    const memberId = await seed(0n, "not_started");
    await prisma.hostedThreadContainer.create({ data: { memberId, ownerMemberId: owner, participants: { create: {
      participantMemberId: participant, handleLookupKey: `handle_${randomUUID()}`, firstSeenAt: now, lastSeenAt: now,
    } } } });
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false });
    expect(await readHostedRuntimeAiAllowedMemberIds({ memberIds: [memberId, owner, participant], now, prisma })).toEqual(new Set([owner, participant]));
    for (const gate of [readHostedAiUsageGate, resolveHostedAiUsageGate]) {
      expect(await gate({ memberId, now, prisma })).toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
    }
  });

  it("accounts late spend once after lapse and restores paid allowance on resubscription", async () => {
    const memberId = await seed(1_000_000n, "active");
    expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: true, allowanceSource: "direct_paid_member_plan" });
    const record = usage(memberId);
    await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "canceled" } });
    for (let replay = 0; replay < 2; replay++) {
      await recordHostedAiUsageRecords({ accountAllowance: true, prisma, trustedUserId: memberId, usage: [record] });
    }
    expect(await prisma.hostedUsageCreditEntry.count({ where: { beneficiaryMemberId: memberId, kind: "usage_debit" } })).toBe(1);
    const balance = (await prisma.hostedMember.findUniqueOrThrow({ where: { id: memberId } })).usageCreditBalanceUsdMicros;
    expect(balance).toBeLessThan(1_000_000n);
    await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "active" } });
    for (const gate of [readHostedAiUsageGate, resolveHostedAiUsageGate]) {
      expect(await gate({ memberId, now, prisma })).toMatchObject({ allowed: true, allowanceSource: "direct_paid_member_plan", usageCreditBalanceUsdMicros: balance });
    }
  });

  it.each(["not_started", "incomplete"] as const)("does not widen %s AI eligibility", async status => {
    const memberId = await seed(1_000_000n, status);
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false });
    expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false });
  });

  it("keeps suspension and consent ahead of spending", async () => {
    const memberId = await seed();
    await prisma.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: now } });
    expect(await readHostedRuntimeAiAccessDecision({ memberId, now, prisma })).toMatchObject({ allowed: false });
    expect(await resolveHostedAiUsageGate({ memberId, now, prisma })).toMatchObject({ allowed: false });
    await prisma.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: null } });
    await prisma.hostedConsentGrant.create({ data: { memberId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "revoked", documentVersionsJson: {}, source: "fixture", grantedAt: periodStart, revokedAt: now } });
    expect(await resolveHostedRuntimeAiUsageGate({ userId: memberId, now, prisma, mode: "mutating" })).toEqual({ status: "health_data_consent_withdrawn" });
    expect(await prisma.hostedAiUsagePeriod.count({ where: { memberId } })).toBe(0);
  });

  it("keeps new purchases restricted to active paid plans", async () => {
    const memberId = await seed();
    expect(await readHostedPersonalUsageCreditOfferCodes({ memberId, prisma })).toEqual([]);
    await prisma.hostedMember.update({ where: { id: memberId }, data: { billingStatus: "active" } });
    expect(await readHostedPersonalUsageCreditOfferCodes({ memberId, prisma })).toEqual(["usage_5_usd"]);
  });
});
