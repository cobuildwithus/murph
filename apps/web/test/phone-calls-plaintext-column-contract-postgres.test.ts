import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Phone column contract proof requires loopback PostgreSQL.");
}
const migration = new URL(
  "../prisma/contract-migrations/20260910220000_drop_hosted_phone_call_plaintext/migration.sql",
  import.meta.url,
);

describe.skipIf(!enabled)("phone plaintext column contract", () => {
  it.each([
    "missing_guard", "unfinished_guard", "rolled_back_guard",
    "retained_brief", "retained_result", "retained_scalar", "empty_sql", "empty_json",
  ])(
    "rejects unsafe state or removes only empty legacy columns: %s",
    async (state) => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TEMP TABLE "_prisma_migrations" (
            migration_name text, finished_at timestamp, rolled_back_at timestamp
          );
          CREATE TEMP TABLE hosted_phone_call (
            id text PRIMARY KEY, brief_json jsonb, result_json jsonb,
            brief_encrypted text, result_encrypted text
          );
          INSERT INTO hosted_phone_call VALUES ('call_synthetic', NULL, 'null', 'sealed_brief', 'sealed_result');
        `);
        if (state !== "missing_guard") {
          await client.query(`INSERT INTO "_prisma_migrations"
            VALUES ('20260910210000_require_hosted_phone_call_encrypted_private_content', $1, $2)`, [
            state === "unfinished_guard" ? null : new Date("2026-09-10T00:00:00Z"),
            state === "rolled_back_guard" ? new Date("2026-09-10T00:00:00Z") : null,
          ]);
        }
        if (state === "retained_brief") {
          await client.query(`UPDATE hosted_phone_call SET brief_json = '{"synthetic":true}'`);
        } else if (state === "retained_result") {
          await client.query(`UPDATE hosted_phone_call SET result_json = '{"synthetic":true}'`);
        } else if (state === "retained_scalar") {
          await client.query("UPDATE hosted_phone_call SET result_json = 'false'");
        } else if (state === "empty_sql") {
          await client.query("UPDATE hosted_phone_call SET result_json = NULL");
        } else if (state === "empty_json") {
          await client.query("UPDATE hosted_phone_call SET brief_json = 'null'");
        }
        const sql = await readFile(migration, "utf8");
        if (!state.startsWith("empty_")) {
          await expect(client.query(sql)).rejects.toThrow(
            state.endsWith("guard") ? "predeploy guard has not completed" : "still contain private content",
          );
        } else {
          await client.query(sql);
          const columns = await client.query(
            "SELECT attname AS column_name FROM pg_attribute WHERE attrelid = 'pg_temp.hosted_phone_call'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum",
          );
          expect(columns.rows.map((row) => row.column_name)).toEqual(["id", "brief_encrypted", "result_encrypted"]);
          expect((await client.query("SELECT * FROM hosted_phone_call")).rows).toEqual([{
            id: "call_synthetic", brief_encrypted: "sealed_brief", result_encrypted: "sealed_result",
          }]);
        }
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    },
  );

  it("keeps the prepared encrypted-only Prisma client readable and writable after DROP", async () => {
    const schema = `phone_contract_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema }),
    });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(`SET search_path TO "${schema}"`);
      await admin.query(`
        CREATE TABLE "_prisma_migrations" (
          migration_name text, finished_at timestamp, rolled_back_at timestamp
        );
        CREATE TYPE "HostedPhoneCallStatus" AS ENUM ('starting','calling','ended','completed','needs_user','failed');
        CREATE TYPE "HostedPhoneCallResultNotificationChannel" AS ENUM ('linq','telegram');
        CREATE TYPE "HostedPhoneCallResultDeliveryStatus" AS ENUM ('pending','queued','sending','delivered','ambiguous');
        CREATE TABLE hosted_phone_call (
          id text PRIMARY KEY, member_id text NOT NULL, request_key text NOT NULL,
          provider text NOT NULL DEFAULT 'retell', provider_call_id text, origin_session_id text,
          status "HostedPhoneCallStatus" NOT NULL DEFAULT 'completed',
          brief_json jsonb, result_json jsonb, brief_encrypted text, result_encrypted text,
          stop_requested_at timestamp(3), ended_at timestamp(3), analyzed_at timestamp(3),
          result_notification_channel "HostedPhoneCallResultNotificationChannel",
          result_delivery_status "HostedPhoneCallResultDeliveryStatus",
          result_delivery_generation integer NOT NULL DEFAULT 0,
          result_delivery_terminal_at timestamp(3),
          created_at timestamp(3) NOT NULL DEFAULT '2026-01-01',
          updated_at timestamp(3) NOT NULL DEFAULT '2026-01-01'
        );
        INSERT INTO hosted_phone_call (id, member_id, request_key, brief_encrypted, result_encrypted)
          VALUES ('call_synthetic', 'member_synthetic', 'request_synthetic', 'sealed_brief', 'sealed_result');
      `);
      const before = await prisma.hostedPhoneCall.findUniqueOrThrow({ where: { id: "call_synthetic" } });
      await admin.query("BEGIN");
      await admin.query(await readFile(new URL(
        "../prisma/migrations/20260910210000_require_hosted_phone_call_encrypted_private_content/migration.sql",
        import.meta.url,
      ), "utf8"));
      await admin.query(`INSERT INTO "_prisma_migrations" VALUES
        ('20260910210000_require_hosted_phone_call_encrypted_private_content', CURRENT_TIMESTAMP, NULL)`);
      await admin.query(await readFile(migration, "utf8"));
      await admin.query("COMMIT");
      expect(await prisma.hostedPhoneCall.findUniqueOrThrow({ where: { id: "call_synthetic" } })).toEqual(before);
      expect(await prisma.hostedPhoneCall.update({
        where: { id: "call_synthetic" }, data: { resultEncrypted: "updated_sealed_result" },
      })).toMatchObject({ briefEncrypted: "sealed_brief", resultEncrypted: "updated_sealed_result" });
    } finally {
      await prisma.$disconnect();
      await admin.query("ROLLBACK");
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
