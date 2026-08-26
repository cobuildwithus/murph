import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  recordHostedGrowthGroupPrivateRosterConversions,
} from "@/src/lib/hosted-ops/growth-group-private-observations";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The group participant attribution proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "group participant attribution PostgreSQL proof",
  () => {
    it("marks only real members observed before first private activation", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observedAt = new Date("2026-08-25T08:00:00.000Z");
      const trackedAt = new Date("2026-08-26T12:00:00.000Z");
      const expiresAt = new Date("2026-09-08T08:00:00.000Z");

      try {
        await prisma.$transaction(async (tx) => {
          await createProofTables(tx);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_member (id, group_private_conversion_tracked_at, updated_at)
            VALUES
              ('member_phone', NULL, ${observedAt}),
              ('member_email', NULL, ${observedAt}),
              ('member_before', NULL, ${observedAt}),
              ('member_expired', NULL, ${observedAt}),
              ('member_unverified', NULL, ${observedAt}),
              ('member_runtime', NULL, ${observedAt}),
              ('member_container', NULL, ${observedAt})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_group_participant_observation (
              contact_lookup_key,
              first_observed_at,
              expires_at
            )
            VALUES
              ('phone_live', ${observedAt}, ${expiresAt}),
              ('email_live', ${observedAt}, ${expiresAt}),
              ('phone_before', ${new Date("2026-08-25T11:00:00.000Z")}, ${expiresAt}),
              ('phone_expired', ${observedAt}, ${trackedAt}),
              ('email_unverified', ${observedAt}, ${expiresAt}),
              ('phone_runtime', ${observedAt}, ${expiresAt}),
              ('phone_container', ${observedAt}, ${expiresAt})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_member_identity (member_id, phone_lookup_key)
            VALUES
              ('member_phone', 'phone_live'),
              ('member_before', 'phone_before'),
              ('member_expired', 'phone_expired'),
              ('member_runtime', 'phone_runtime'),
              ('member_container', 'phone_container')
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_member_email_authorization (
              member_id,
              verified_email_lookup_key,
              verified_email_verified_at
            )
            VALUES
              ('member_email', 'email_live', ${observedAt}),
              ('member_unverified', 'email_unverified', NULL)
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_mailbox_item (id, user_id, kind, created_at)
            VALUES
              ('activation_phone', 'member_phone', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_email', 'member_email', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_before', 'member_before', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_expired', 'member_expired', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_unverified', 'member_unverified', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_runtime', 'member_runtime', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")}),
              ('activation_container', 'member_container', 'member.activated', ${new Date("2026-08-25T10:00:00.000Z")})
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_group (runtime_member_id)
            VALUES ('member_runtime')
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_thread_container (member_id)
            VALUES ('member_container')
          `);

          await expect(recordHostedGrowthGroupPrivateRosterConversions({
            prisma: tx,
            trackedAt,
          })).resolves.toBe(2);

          const rows = await tx.$queryRaw<Array<{
            groupPrivateConversionTrackedAt: Date | null;
            id: string;
          }>>(Prisma.sql`
            SELECT
              id,
              group_private_conversion_tracked_at AS "groupPrivateConversionTrackedAt"
            FROM hosted_member
            ORDER BY id
          `);
          expect(rows.filter((row) =>
            row.groupPrivateConversionTrackedAt !== null
          ).map((row) => row.id)).toEqual([
            "member_email",
            "member_phone",
          ]);
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

async function createProofTables(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_member (
      id TEXT PRIMARY KEY,
      group_private_conversion_tracked_at TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_group_participant_observation (
      contact_lookup_key TEXT PRIMARY KEY,
      first_observed_at TIMESTAMP(3) NOT NULL,
      expires_at TIMESTAMP(3) NOT NULL
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_member_identity (
      member_id TEXT PRIMARY KEY,
      phone_lookup_key TEXT
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_member_email_authorization (
      member_id TEXT PRIMARY KEY,
      verified_email_lookup_key TEXT,
      verified_email_verified_at TIMESTAMP(3)
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_mailbox_item (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TIMESTAMP(3) NOT NULL
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_group (
      runtime_member_id TEXT
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_thread_container (
      member_id TEXT PRIMARY KEY
    ) ON COMMIT DROP
  `);
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
