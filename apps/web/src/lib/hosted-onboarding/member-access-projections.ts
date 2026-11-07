import { Prisma } from "@prisma/client";

/** Set-based equivalent of hasHostedMemberActivationProof; no subscription ref is proof. */
export function hostedMemberActivationProofWhere(): Prisma.HostedMemberWhereInput {
  return { OR: [
    { hostedMailboxItems: { some: { kind: "member.activated" } } },
    { AND: (["control", "device", "ingress", "runtime"] as const).map(domain => ({
      hostedCryptoEnvelopes: { some: { domain, status: "active" } },
    })) },
  ] };
}

/** The memberId expression is supplied only by internal query composition. */
export function hostedMemberActivationProofSql(memberId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM "hosted_mailbox_item" AS "activation"
      WHERE "activation"."user_id" = ${memberId} AND "activation"."kind" = 'member.activated')
    OR (SELECT COUNT(DISTINCT "root"."domain") FROM "hosted_user_crypto_envelope" AS "root"
      WHERE "root"."user_id" = ${memberId} AND "root"."status" = 'active'
        AND "root"."domain" IN ('control', 'device', 'ingress', 'runtime')) = 4
  )`;
}

/** Strict own-active or Family eligibility for funding, welcomes and referrals. */
export function strictHostedPersonAccessWhere(): Prisma.HostedMemberWhereInput {
  return { suspendedAt: null, threadContainer: null, OR: [
    { billingStatus: "active" },
    {
      accountGroupMemberships: {
        some: {
          group: {
            billingStatus: "active",
            suspendedAt: null,
          },
          status: "active",
        },
      },
    },
  ] };
}

/** Real-person product projection; never use this as room sponsorship. */
export function activeHostedPersonAccessWhere(): Prisma.HostedMemberWhereInput {
  return { suspendedAt: null, threadContainer: null, OR: [
    strictHostedPersonAccessWhere(),
    { billingStatus: { in: ["canceled", "paused", "unpaid", "past_due"] } },
    { billingStatus: "incomplete", AND: [hostedMemberActivationProofWhere()] },
  ] };
}

/** Same strict real-person rule for raw SQL, before any page limit. */
export function strictHostedPersonAccessSql(member: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${member}."suspended_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "hosted_thread_container" AS "person_container"
      WHERE "person_container"."member_id" = ${member}."id")
    AND (${member}."billing_status" = 'active' OR EXISTS (
      SELECT 1 FROM "hosted_account_group_membership" AS "membership"
      JOIN "hosted_account_group" AS "account_group" ON "account_group"."id" = "membership"."group_id"
      WHERE "membership"."member_id" = ${member}."id" AND "membership"."status" = 'active'
        AND "account_group"."billing_status" = 'active' AND "account_group"."suspended_at" IS NULL
    ))
  )`;
}

/** Real-person product SQL; identifiers must be static internal SQL fragments. */
export function activeHostedPersonAccessSql(member: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${member}."suspended_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "hosted_thread_container" AS "product_container"
      WHERE "product_container"."member_id" = ${member}."id")
    AND (${strictHostedPersonAccessSql(member)}
      OR ${member}."billing_status" IN ('canceled', 'paused', 'unpaid', 'past_due')
      OR (${member}."billing_status" = 'incomplete'
        AND ${hostedMemberActivationProofSql(Prisma.sql`${member}."id"`)}))
  )`;
}

