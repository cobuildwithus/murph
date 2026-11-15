import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { readHostedOpsFreeIdleMemberUsage } from "@/src/lib/hosted-ops/free-idle-member-usage";
import { hasHostedPaidBillingRefEvidence } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedPaidBillingRefEvidenceSql } from "@/src/lib/hosted-onboarding/member-access-projections";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host") || !url.pathname.startsWith("/murph_test")) {
    throw new Error("Free idle member proof requires an isolated local murph_test database.");
  }
}

describe.skipIf(!runPostgresProof)("Ops free idle members PostgreSQL", () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const prefix = `hbm_idle_${randomUUID()}_`;
  const id = (label: string) => `${prefix}${label}`;
  const now = new Date("2026-11-15T12:00:00.000Z");
  const joined = new Date("2026-10-01T12:00:00.000Z");
  const exclusions = [
    "paid", "legacy_paid", "legacy_standard", "lapsed_paid", "family", "former_family",
    "sponsored", "suspended", "container", "legacy_container", "game", "device",
    "revoked_device", "meal_photo", "revoked_meal_photo", "group", "thread", "removed_thread",
    "zero", "uncounted", "no_usage",
  ];

  async function usage(memberId: string, cost: bigint, counted = true) {
    const usageId = randomUUID();
    await prisma.hostedAiUsage.create({ data: {
      id: usageId, memberId, sessionId: usageId, turnId: usageId, attemptCount: 1,
      provider: "synthetic", occurredAt: joined,
      allowanceCounted: counted, allowanceCostUsdMicros: cost,
    } });
  }

  beforeAll(async () => {
    for (const label of ["owner", ...exclusions]) {
      await prisma.hostedMember.create({ data: { id: id(label), billingStatus: "active" } });
      if (label !== "no_usage") await usage(id(label), label === "zero" ? 0n : 100_000_000n, label !== "uncounted");
    }
    // The fixture owner itself is paid and cannot enter the results.
    for (const label of ["owner", "paid", "lapsed_paid"]) {
      await prisma.hostedMemberBillingRef.create({ data: { memberId: id(label), currentBillingPhase: "paid" } });
    }
    await prisma.hostedMember.update({ where: { id: id("lapsed_paid") }, data: { billingStatus: "canceled" } });
    for (const label of ["legacy_paid", "legacy_standard"]) {
      await prisma.hostedMemberBillingRef.create({ data: {
        memberId: id(label), stripeSubscriptionLookupKey: id(label),
        currentCheckoutOffer: label === "legacy_standard" ? "standard" : null,
      } });
    }
    await prisma.hostedMember.update({ where: { id: id("suspended") }, data: { suspendedAt: now } });
    await prisma.hostedAccountGroup.create({ data: {
      id: id("family_group"), ownerMemberId: id("owner"), billingStatus: "active",
      memberships: { create: [
        { id: id("family_seat"), memberId: id("family"), role: "member", status: "active" },
        { id: id("former_seat"), memberId: id("former_family"), role: "member", status: "removed", removedAt: now },
      ] },
    } });
    await prisma.hostedGroupSponsorshipAuthorization.create({ data: {
      id: id("sponsorship"), beneficiaryMemberId: id("sponsored"), payerMemberId: id("owner"),
      status: "active", monthlyCapMinor: 1000, periodStartedAt: joined, periodEndsAt: now,
      anchorDay: 1, anchorEndOfMonth: false,
    } });
    await prisma.hostedThreadContainer.create({ data: {
      memberId: id("container"), ownerMemberId: id("owner"), participants: { create: [
        { participantMemberId: id("thread"), handleLookupKey: id("thread"), firstSeenAt: joined, lastSeenAt: now },
        { participantMemberId: id("removed_thread"), handleLookupKey: id("removed_thread"), firstSeenAt: joined, lastSeenAt: joined, removedAt: now },
      ] },
    } });
    await prisma.hostedGroup.create({ data: {
      id: id("group"), ownerMemberId: id("owner"), runtimeMemberId: id("legacy_container"),
      members: { create: { id: id("group_member"), memberId: id("group") } },
    } });
    await prisma.gameProfile.create({ data: { memberId: id("game"), firstNameEncrypted: "synthetic", timeZone: "UTC" } });
    await prisma.game.create({ data: {
      id: id("game"), wordsOwnerMemberId: id("game"), status: "settled", terms: {}, termsWordsEncrypted: "synthetic",
      players: { create: { memberId: id("game"), seat: 1, joinedAt: joined, timeZone: "UTC", leftAt: now } },
    } });
    for (const label of ["device", "revoked_device"]) {
      await prisma.deviceConnection.create({ data: {
        id: id(label), userId: id(label), provider: label === "device" ? "apple_health" : "oura",
        providerAccountBlindIndex: id(label), connectedAt: joined,
        status: label === "device" ? "active" : "revoked",
      } });
    }
    for (const label of ["meal_photo", "revoked_meal_photo"]) {
      await prisma.hostedMealPhotoCaptureEnrollment.create({ data: {
        id: id(label), memberId: id(label), installationIdHash: id(label),
        revokedAt: label === "meal_photo" ? null : now,
      } });
    }
    for (let rank = 1; rank <= 25; rank++) {
      const memberId = id(`rank_${rank.toString().padStart(2, "0")}`);
      await prisma.hostedMember.create({ data: {
        id: memberId, createdAt: joined, billingStatus: "active", usageCreditBalanceUsdMicros: 250_000n,
        identity: rank === 25 ? { create: { maskedPhoneNumberHint: "*** 0101", phoneNumberEncrypted: "must-not-be-read" } } : undefined,
      } });
      await usage(memberId, BigInt(rank) * 100_000n);
      await usage(memberId, BigInt(rank) * 100_000n);
    }
    const topId = id("rank_25");
    // Explicit non-paid phases and retired trial subscriptions remain free.
    await prisma.hostedMemberBillingRef.create({ data: { memberId: topId, currentBillingPhase: "starter", stripeSubscriptionLookupKey: topId } });
    await prisma.hostedMemberBillingRef.create({ data: { memberId: id("rank_24"), currentCheckoutOffer: "pulse_trial", stripeSubscriptionLookupKey: id("rank_24") } });
    await prisma.hostedGroupSponsorshipAuthorization.create({ data: {
      id: id("canceled_sponsorship"), beneficiaryMemberId: topId, payerMemberId: id("owner"), status: "canceled", canceledAt: now, monthlyCapMinor: 1000,
      periodStartedAt: joined, periodEndsAt: now, anchorDay: 1, anchorEndOfMonth: false,
    } });
    await usage(topId, 500_000_000n, false);
    for (const [index, kind, occurredAt] of [
      [1, "conversation.message", new Date("2026-11-08T12:00:00.000Z")],
      [2, "conversation.message", new Date("2026-11-15T11:59:59.999Z")],
      [3, "conversation.message", new Date("2026-11-08T11:59:59.999Z")],
      [4, "conversation.message", now],
      [5, "member.activated", new Date("2026-11-14T12:00:00.000Z")],
    ] as const) {
      await prisma.hostedMailboxItem.create({ data: {
        id: id(`message_${index}`), userId: topId, lane: "conversation", laneSeq: BigInt(index),
        dedupeKey: id(`message_${index}`), kind, occurredAt, payloadSchema: "synthetic",
        payloadInlineCiphertext: "must-not-be-read",
      } });
    }
    // Representative local scale: 435 synthetic members and 32,000 usage rows.
    // These low-spend members must never displace the expected top 20.
    await prisma.$executeRaw`
      INSERT INTO "hosted_member" ("id", "created_at", "updated_at")
      SELECT ${prefix} || 'extra_' || n, ${joined}, ${joined}
      FROM generate_series(1, 388) AS n
    `;
    await prisma.$executeRaw`
      INSERT INTO "hosted_ai_usage" (
        "id", "member_id", "session_id", "turn_id", "attempt_count", "provider",
        "occurred_at", "allowance_counted", "allowance_cost_usd_micros", "created_at", "updated_at"
      )
      SELECT ${prefix} || 'usage_' || n, ${prefix} || 'extra_' || (1 + n % 388),
        ${prefix} || 'session', ${prefix} || 'turn_' || n, 1, 'synthetic',
        ${joined}, TRUE, 1, ${joined}, ${joined}
      FROM generate_series(1, 31928) AS n
    `;
    await prisma.$executeRaw`ANALYZE
      "hosted_member", "hosted_ai_usage", "hosted_member_billing_ref", "hosted_member_identity",
      "hosted_thread_container", "hosted_group", "hosted_group_sponsorship_authorization",
      "game_player", "device_connection", "hosted_meal_photo_capture_enrollment",
      "hosted_group_member", "hosted_account_group_membership", "hosted_thread_container_participant",
      "hosted_mailbox_item"
    `;
  });

  afterAll(async () => {
    await prisma.hostedGroupSponsorshipAuthorization.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.hostedAccountGroup.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.hostedThreadContainer.deleteMany({ where: { memberId: { startsWith: prefix } } });
    await prisma.hostedGroup.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.game.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.deviceConnection.deleteMany({ where: { userId: { startsWith: prefix } } });
    await prisma.hostedMember.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it.each(exclusions)("excludes %s before ranking and limiting", async (label) => {
    const rows = await readHostedOpsFreeIdleMemberUsage({ now, prisma });
    expect(rows.map((row) => row.memberId)).not.toContain(id(label));
  });

  it("returns empty when only zero-spend, uncounted, and no-usage members remain", async () => {
    const positiveMembers = {
      id: { startsWith: prefix, notIn: [id("zero"), id("uncounted"), id("no_usage"), id("suspended")] },
    };
    try {
      await prisma.hostedMember.updateMany({ where: positiveMembers, data: { suspendedAt: now } });
      expect(await readHostedOpsFreeIdleMemberUsage({ now, prisma })).toEqual([]);
    } finally {
      await prisma.hostedMember.updateMany({ where: positiveMembers, data: { suspendedAt: null } });
    }
  });

  it("returns exactly the top 20 by all-time counted spend with only the requested fields", async () => {
    const query = vi.spyOn(prisma, "$queryRaw");
    try {
      const rows = await readHostedOpsFreeIdleMemberUsage({ now, prisma });
      expect(query).toHaveBeenCalledOnce();
      expect(rows.map((row) => row.memberId)).toEqual(Array.from({ length: 20 }, (_, index) => id(`rank_${(25 - index).toString().padStart(2, "0")}`)));
      expect(rows[0]).toEqual({
        memberId: id("rank_25"), createdAt: joined.toISOString(), maskedPhoneNumberHint: "*** 0101",
        allTimeUsageUsdMicros: "5000000", freeCreditRemainingUsdMicros: "250000", messagesLast7Days: 2,
      });
      expect(rows[1]!.maskedPhoneNumberHint).toBeNull();
      const statement = query.mock.calls[0]![0];
      if (!("values" in statement)) throw new Error("Expected a composed SQL statement.");
      const plan = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${statement}`);
      console.info(plan.map((line) => line["QUERY PLAN"]).join("\n"));
    } finally {
      query.mockRestore();
    }
  });

  it("keeps the paid SQL projection equal to the canonical predicate across null, legacy, and explicit phases", async () => {
    for (const currentBillingPhase of [null, "paid", "starter", "trial"]) {
      for (const currentCheckoutOffer of [null, "standard", "pulse_trial", "other"]) {
        for (const stripeSubscriptionLookupKey of [null, "", "synthetic_subscription"]) {
          const [row] = await prisma.$queryRaw<Array<{ paid: boolean }>>(Prisma.sql`
            SELECT COALESCE(${hostedPaidBillingRefEvidenceSql(Prisma.sql`"billing"`)}, FALSE) AS "paid"
            FROM (SELECT ${currentBillingPhase}::text AS "current_billing_phase",
              ${currentCheckoutOffer}::text AS "current_checkout_offer",
              ${stripeSubscriptionLookupKey}::text AS "stripe_subscription_lookup_key") AS "billing"
          `);
          expect(row!.paid).toBe(hasHostedPaidBillingRefEvidence({ currentBillingPhase, currentCheckoutOffer, stripeSubscriptionLookupKey }));
        }
      }
    }
  });
});
