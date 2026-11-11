import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";

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
  it("drops only the old delivery attempt while retaining canonical identity, including on replay", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE TEMP TABLE hosted_member_identity (
        member_id text PRIMARY KEY, phone_number_encrypted text,
        signup_phone_number_encrypted text, phone_number_verified_at timestamp,
        signup_phone_code_sent_at timestamp, signup_phone_code_send_attempt_id text,
        signup_phone_code_send_attempt_started_at timestamp
      )`);
      await client.query(`INSERT INTO hosted_member_identity VALUES (
        'synthetic-member', 'synthetic-ciphertext', 'synthetic-signup-ciphertext',
        '2026-11-10 00:00:00', '2026-11-10 00:00:00', 'retired-attempt', '2026-11-10 00:00:00'
      )`);
      const sql = await readFile(new URL(
        "../prisma/contract-migrations/20261110180000_drop_invite_phone_code_state/migration.sql",
        import.meta.url,
      ), "utf8");
      await client.query(sql);
      await client.query(sql);
      const result = await client.query(`SELECT member_id, phone_number_encrypted,
        signup_phone_number_encrypted, phone_number_verified_at::text FROM hosted_member_identity`);
      expect(result.rows).toEqual([{
        member_id: "synthetic-member", phone_number_encrypted: "synthetic-ciphertext",
        signup_phone_number_encrypted: "synthetic-signup-ciphertext",
        phone_number_verified_at: "2026-11-10 00:00:00",
      }]);
      const columns = await client.query(`SELECT attname FROM pg_attribute
        WHERE attrelid = 'pg_temp.hosted_member_identity'::regclass AND attnum > 0 AND NOT attisdropped`);
      expect(columns.rows.map(({ attname }) => attname)).toEqual([
        "member_id", "phone_number_encrypted", "signup_phone_number_encrypted", "phone_number_verified_at",
      ]);
    } finally {
      await client.end();
    }
  });
});
