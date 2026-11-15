import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { hostedPaidBillingRefEvidenceSql } from "../hosted-onboarding/member-access-projections";
import { getPrisma } from "../prisma";

export interface HostedOpsFreeIdleMemberUsageRow {
  memberId: string;
  maskedPhoneNumberHint: string | null;
  createdAt: string;
  allTimeUsageUsdMicros: string;
  freeCreditRemainingUsdMicros: string;
  messagesLast7Days: number;
}

export function hostedOpsFreeIdleMemberSql(member: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    ${member}."suspended_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "hosted_thread_container" AS "container"
      WHERE "container"."member_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "hosted_group" AS "legacy_container"
      WHERE "legacy_container"."runtime_member_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "hosted_member_billing_ref" AS "billing"
      WHERE "billing"."member_id" = ${member}."id"
        AND ${hostedPaidBillingRefEvidenceSql(Prisma.sql`"billing"`)})
    AND NOT EXISTS (SELECT 1 FROM "hosted_group_sponsorship_authorization" AS "sponsorship"
      WHERE "sponsorship"."beneficiary_member_id" = ${member}."id"
        AND "sponsorship"."status" = 'active')
    AND NOT EXISTS (SELECT 1 FROM "game_player" AS "player"
      WHERE "player"."member_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "device_connection" AS "device"
      WHERE "device"."user_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "hosted_meal_photo_capture_enrollment" AS "meal_photo"
      WHERE "meal_photo"."member_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "hosted_group_member" AS "group_member"
      WHERE "group_member"."member_id" = ${member}."id")
    -- Any membership excludes the member, including active Family coverage.
    AND NOT EXISTS (SELECT 1 FROM "hosted_account_group_membership" AS "membership"
      WHERE "membership"."member_id" = ${member}."id")
    AND NOT EXISTS (SELECT 1 FROM "hosted_thread_container_participant" AS "participant"
      WHERE "participant"."participant_member_id" = ${member}."id")
  `;
}

export async function readHostedOpsFreeIdleMemberUsage(input: {
  now?: Date;
  prisma?: PrismaClient;
} = {}): Promise<HostedOpsFreeIdleMemberUsageRow[]> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const last7DaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const rows = await prisma.$queryRaw<Array<
    Omit<HostedOpsFreeIdleMemberUsageRow, "createdAt"> & { createdAt: Date }
  >>(Prisma.sql`
    WITH "usage_totals" AS (
      SELECT "member_id", SUM("allowance_cost_usd_micros") AS "spend"
      FROM "hosted_ai_usage"
      WHERE "allowance_counted" = TRUE
      GROUP BY "member_id"
      HAVING SUM("allowance_cost_usd_micros") > 0
    ), "ranked" AS (
      SELECT "member"."id", "member"."created_at",
        "member"."usage_credit_balance_usd_micros", "usage_totals"."spend"
      FROM "hosted_member" AS "member"
      JOIN "usage_totals" ON "usage_totals"."member_id" = "member"."id"
      WHERE ${hostedOpsFreeIdleMemberSql(Prisma.sql`"member"`)}
      ORDER BY "spend" DESC, "member"."id" ASC
      LIMIT 20
    )
    SELECT "ranked"."id" AS "memberId",
      "identity"."masked_phone_number_hint" AS "maskedPhoneNumberHint",
      "ranked"."created_at" AS "createdAt",
      "ranked"."spend"::text AS "allTimeUsageUsdMicros",
      "ranked"."usage_credit_balance_usd_micros"::text AS "freeCreditRemainingUsdMicros",
      (SELECT COUNT(*)::int FROM "hosted_mailbox_item" AS "message"
        WHERE "message"."user_id" = "ranked"."id"
          AND "message"."kind" = 'conversation.message'
          AND "message"."occurred_at" >= ${last7DaysStart}
          AND "message"."occurred_at" < ${now}) AS "messagesLast7Days"
    FROM "ranked"
    LEFT JOIN "hosted_member_identity" AS "identity" ON "identity"."member_id" = "ranked"."id"
    ORDER BY "ranked"."spend" DESC, "ranked"."id" ASC
  `);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
