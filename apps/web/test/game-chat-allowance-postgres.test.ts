import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { describe, expect, it, vi } from "vitest";
import { claimHostedRuntime, retireHostedRuntime, releaseHostedRuntimeAfterRetirement } from "@/src/lib/hosted-execution/runtime-owner";
import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { recordHostedAiUsageRecordsAndSendLimitNotices } from "@/src/lib/hosted-execution/usage";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host") || !url.pathname.startsWith("/murph_test")) {
    throw new Error("Game allowance proof requires a loopback murph_test database.");
  }
}

describe.skipIf(!enabled)("shared game allowance PostgreSQL", () => {
  it("charges concurrent rooms once to their frozen primary even after the game ends, and preserves later paid room funding", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true");
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const suffix = randomUUID();
    const [primary, alternate, first, second] = ["primary", "alternate", "first", "second"].map(role => `funding_${role}_${suffix}`);
    const ids = [primary, alternate, first, second];
    const gameId = `funding_game_${suffix}`;
    const now = new Date();
    const previous = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: "postgres" } });
    try {
      await prisma.hostedMember.createMany({ data: ids.map(id => ({ id, billingStatus: "not_started" })) });
      for (const memberId of [primary, alternate]) {
        await prisma.hostedThreadContainer.create({ data: { memberId, ownerMemberId: first,
          participants: { create: [first, second].map(participantMemberId => ({ participantMemberId,
            handleLookupKey: `synthetic_${participantMemberId}`, firstSeenAt: now, lastSeenAt: now })) },
        } });
        await prisma.hostedThreadRoute.create({ data: { channel: "linq", containerMemberId: memberId,
          threadLookupKey: `synthetic_${memberId}`, threadIdentityLookupKey: `synthetic_${memberId}` } });
      }
      await prisma.gameProfile.createMany({ data: [first, second].map(memberId => ({
        memberId, firstNameEncrypted: "synthetic-sealed", timeZone: "UTC",
      })) });
      await prisma.game.create({ data: { id: gameId, createdBy: first, status: "live",
        chatContainerMemberId: primary, liveRosterKey: [first, second].sort().join(":"),
        terms: { v: 1, versions: [] }, termsWordsEncrypted: "synthetic-sealed",
        players: { create: [first, second].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC" })) },
      } });
      const claims = await Promise.all([primary, alternate].map(userId => claimHostedRuntime({ prisma, userId, now, processingMode: "default" })));
      const owners = claims.map(claim => {
        if (claim.status === "blocked" || !claim.owner.attemptId) throw new Error("Expected admitted game room.");
        expect(claim.owner.allowanceBeneficiaryMemberId).toBe(primary);
        return { userId: claim.owner.userId, attemptId: claim.owner.attemptId, generation: claim.owner.generation.toString() };
      });
      const records = [primary, alternate].map(memberId => usage(memberId, now));
      const record = (index: number) => recordHostedAiUsageRecordsAndSendLimitNotices({
        accountAllowance: true, noticeDeliveryTarget: null, prisma, runtimeIdentity: owners[index],
        trustedUserId: records[index].memberId, usage: [records[index]],
      });
      await Promise.all([record(0), record(1)]);
      const initial = await prisma.hostedAiUsagePeriod.findMany({ where: { memberId: { in: [primary, alternate] } } });
      expect(initial).toHaveLength(1);
      expect(initial[0].memberId).toBe(primary);
      expect(initial[0].spentUsdMicros).toBe(154n);
      await expect(readHostedAiUsageGate({ memberId: alternate, now, prisma })).resolves.toMatchObject({
        allowed: true, spentUsdMicros: 154n, remainingUsdMicros: 7_499_846n,
      });
      await prisma.hostedAiUsagePeriod.update({ where: { memberId_periodStart: {
        memberId: primary, periodStart: initial[0].periodStart,
      } }, data: { spentUsdMicros: 7_499_923n } });
      records[0] = usage(primary, now);
      records[1] = usage(alternate, now);
      await Promise.all([record(0), record(1)]);
      for (const memberId of [primary, alternate]) {
        await expect(readHostedAiUsageGate({ memberId, now, prisma })).resolves.toMatchObject({
          allowed: false, reason: "ai_usage_limit_exceeded", spentUsdMicros: 7_500_077n, remainingUsdMicros: 0n,
        });
      }
      await prisma.game.update({ where: { id: gameId }, data: { status: "settled", liveRosterKey: null,
        settledAt: new Date(now.getTime() - 8 * 86_400_000), chatContainerMemberId: null } });
      await prisma.hostedThreadContainerParticipant.updateMany({ where: { containerMemberId: alternate }, data: { removedAt: now } });
      await expect(readHostedAiUsageGate({ memberId: alternate, now, prisma })).resolves.toMatchObject({ allowed: false });
      records[1] = usage(alternate, now);
      await record(1);
      await record(1); // Exact callback replay must not spend twice.
      const period = await prisma.hostedAiUsagePeriod.findUniqueOrThrow({ where: { memberId_periodStart: {
        memberId: primary, periodStart: initial[0].periodStart,
      } } });
      expect(period.spentUsdMicros).toBe(7_500_154n);
      await expect(prisma.hostedAiUsage.findUniqueOrThrow({ where: { id: records[1].usageId } })).resolves.toMatchObject({
        memberId: alternate, allowanceBeneficiaryMemberId: primary, allowanceCostUsdMicros: 77n,
      });
      // Ordinary room sponsorship is still independent on the next invocation.
      await prisma.hostedMember.update({ where: { id: first }, data: { billingStatus: "active" } });
      await retireHostedRuntime({ prisma, identity: owners[1], completed: true });
      await releaseHostedRuntimeAfterRetirement({ prisma, identity: owners[1], runnerContainerName: null });
      const paid = await claimHostedRuntime({ prisma, userId: alternate, now, processingMode: "default" });
      if (paid.status === "blocked") throw new Error("Expected ordinarily sponsored room.");
      expect(paid.owner.allowanceBeneficiaryMemberId).toBeNull();
      await expect(readHostedAiUsageGate({ memberId: alternate, now, prisma })).resolves.toMatchObject({ allowed: true, spentUsdMicros: 0n });
    } finally {
      await prisma.game.deleteMany({ where: { id: gameId } });
      await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: ids } } });
      await prisma.hostedThreadContainer.deleteMany({ where: { memberId: { in: ids } } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: previous.phase } });
      await prisma.$disconnect();
      vi.unstubAllEnvs();
    }
  });
});

function usage(memberId: string, now: Date): AssistantUsageRecord {
  const turnId = `funding_turn_${randomUUID()}`;
  return {
    schema: "murph.assistant-usage.v1", usageId: `${turnId}.attempt-1`, memberId,
    turnId, sessionId: turnId, attemptCount: 1, occurredAt: now.toISOString(), provider: "openai",
    providerName: "OpenAI", requestedModel: "gpt-5.6-luna", servedModel: "gpt-5.6-luna",
    providerRequestId: null, providerRequestOrdinal: 0, providerRequestOutcome: "succeeded",
    routeId: null, rawUsageJson: null, rawUsageJsonHash: null, turnProfileJson: null,
    usageExtractionVersion: "openai-responses-v1", usageExtractionSourcePath: "openai.responses.usage",
    apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", credentialSource: "platform",
    featureKey: null, surface: "linq", triggerKind: "conversation", reportingUserId: null,
    gatewayTags: [], stripeMeterSource: "murph", tokenPricingBasis: "standard",
    inputTokens: 120, cachedInputTokens: 12, outputTokens: 45, reasoningTokens: 0,
    cacheWriteTokens: null, totalTokens: 165,
  };
}
