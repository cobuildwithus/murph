import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search) {
    throw new Error("Invite code retirement proof requires an isolated local test database.");
  }
}

describe.skipIf(!enabled)("retired invite phone-code state", () => {
  it("retains the old full identity projection for deployment-pinned Stripe Workflows", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    await client.connect();
    try {
      // Match the old generated client's full projection. These nullable columns
      // outlive the ordinary function drain because Stripe Workflows can retry later.
      const oldRead = await client.query(`SELECT member_id, linq_email_handle_lookup_key,
        linq_email_handle_encrypted, masked_phone_number_hint, phone_lookup_key,
        phone_number_encrypted, phone_number_verified_at, signup_phone_number_encrypted,
        signup_phone_code_sent_at, signup_phone_code_send_attempt_id,
        signup_phone_code_send_attempt_started_at, created_at, updated_at
        FROM hosted_member_identity WHERE member_id = $1`, [`synthetic-${randomUUID()}`]);
      expect(oldRead.rows).toEqual([]);
      expect(oldRead.fields.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "signup_phone_code_sent_at", "signup_phone_code_send_attempt_id",
        "signup_phone_code_send_attempt_started_at",
      ]));
      await expect(prisma.hostedMemberIdentity.findUnique({
        where: { memberId: `synthetic-${randomUUID()}` },
      })).resolves.toBeNull();
    } finally {
      await client.end();
      await prisma.$disconnect();
    }
  });
});
