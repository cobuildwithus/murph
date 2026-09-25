import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteHostedLegacyPhoneCalls } from "@/src/lib/phone-calls/legacy-private-content-deletion";
import { lockExistingHostedPhoneCallTx } from "@/src/lib/phone-calls/row-lock";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Phone deletion proof requires a loopback PostgreSQL database.");
}

describe.skipIf(!enabled)("legacy phone deletion PostgreSQL boundaries", () => {
  let prisma: PrismaClient;
  let admin: pg.Client;
  let schema: string;

  beforeEach(async () => {
    schema = `phone_delete_${randomUUID().replaceAll("-", "")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    await admin.query(`
      CREATE TYPE "HostedPhoneCallStatus" AS ENUM ('starting','calling','ended','completed','needs_user','failed');
      CREATE TYPE "HostedPhoneCallResultNotificationChannel" AS ENUM ('linq','telegram');
      CREATE TYPE "HostedPhoneCallResultDeliveryStatus" AS ENUM ('pending','queued','sending','delivered','ambiguous');
      CREATE TABLE hosted_member (id text PRIMARY KEY);
      CREATE TABLE hosted_phone_call (
        id text PRIMARY KEY, member_id text NOT NULL REFERENCES hosted_member(id),
        provider text NOT NULL DEFAULT 'retell', provider_call_id text UNIQUE,
        status "HostedPhoneCallStatus" NOT NULL DEFAULT 'completed',
        brief_json jsonb, result_json jsonb, brief_encrypted text, result_encrypted text,
        origin_session_id text, request_key text NOT NULL,
        analyzed_at timestamp(3), ended_at timestamp(3),
        result_delivery_status "HostedPhoneCallResultDeliveryStatus",
        result_notification_channel "HostedPhoneCallResultNotificationChannel",
        updated_at timestamp(3) NOT NULL DEFAULT '2026-01-01',
        UNIQUE (member_id, request_key)
      );
      CREATE TABLE hosted_mailbox_item (
        id text PRIMARY KEY, user_id text NOT NULL, dedupe_key text NOT NULL,
        consumed_at timestamp(3)
      );
      CREATE TABLE hosted_ai_usage (id text PRIMARY KEY, turn_id text NOT NULL);
      INSERT INTO hosted_member VALUES ('member_test'), ('member_other');
    `);
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl, max: 4,
        options: `-c search_path=${schema}`,
      }, { schema }),
      transactionOptions: { timeout: 5000 },
    });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function seed(id = "call_test", providerId: string | null = id === "call_test" ? "provider_test" : `provider_${id}`) {
    await admin.query(`
      INSERT INTO hosted_phone_call
        (id, member_id, request_key, provider_call_id, brief_json, result_json, ended_at, analyzed_at)
      VALUES ($1, 'member_test', $1, $2, '{"synthetic":true}', '{"synthetic":true}', '2026-01-02', '2026-01-02')
    `, [id, providerId]);
  }
  function run(mode: "apply" | "dry-run" = "dry-run", expectedRows?: number, deleteProviderCall: (id: string, options?: { signal?: AbortSignal }) => Promise<void> = vi.fn(async () => {})) {
    return deleteHostedLegacyPhoneCalls({
      options: { mode, ...(expectedRows === undefined ? {} : { expectedRows }) },
      prisma, runtime: { deleteProviderCall },
    });
  }
  async function remaining() {
    return (await admin.query("SELECT count(*)::int AS count FROM hosted_phone_call")).rows[0].count;
  }

  it("excludes SQL/JSON null, ciphertext, current sessions, and scheduled calls without reading private bodies", async () => {
    await seed();
    for (const id of ["sql_null", "json_null", "encrypted", "session", "scheduled"]) await seed(id);
    await admin.query(`
      UPDATE hosted_phone_call SET brief_json = NULL, result_json = NULL WHERE id = 'sql_null';
      UPDATE hosted_phone_call SET brief_json = 'null', result_json = 'null' WHERE id = 'json_null';
      UPDATE hosted_phone_call SET brief_encrypted = 'opaque' WHERE id = 'encrypted';
      UPDATE hosted_phone_call SET origin_session_id = 'session_current' WHERE id = 'session';
      UPDATE hosted_phone_call SET request_key = 'phone_call_scheduled_synthetic' WHERE id = 'scheduled';
    `);
    const runtime = vi.fn(async () => {});
    expect(await run("dry-run", undefined, runtime)).toEqual({
      mode: "dry-run", selectedRows: 1, providerRows: 1, deletedRows: 0, failedRows: 0, failureCode: null,
    });
    expect(runtime).not.toHaveBeenCalled();
    expect(await remaining()).toBe(6);
  });

  it("rejects selection drift and overflow before provider effects", async () => {
    await seed();
    const runtime = vi.fn(async () => {});
    await expect(run("apply", 2, runtime)).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_SELECTION_CHANGED" });
    for (let index = 0; index < 8; index++) await seed(`call_extra_${index}`);
    await expect(run("dry-run", undefined, runtime)).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_SELECTION_CHANGED" });
    expect(runtime).not.toHaveBeenCalled();
  });

  it.each(["starting", "calling", "ended"])("rejects nonterminal status %s", async (status) => {
    await seed();
    await admin.query('UPDATE hosted_phone_call SET status = $1::"HostedPhoneCallStatus"', [status]);
    await expect(run()).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_CALL_NOT_SETTLED" });
  });

  it.each(["pending", "queued", "sending", "ambiguous"])("rejects unsettled result %s", async (status) => {
    await seed();
    await admin.query('UPDATE hosted_phone_call SET result_delivery_status = $1::"HostedPhoneCallResultDeliveryStatus"', [status]);
    await expect(run()).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_CALL_NOT_SETTLED" });
  });

  it("rejects uncertain Telegram state and provider cleanup ownership", async () => {
    await seed();
    await admin.query("UPDATE hosted_phone_call SET result_notification_channel = 'telegram'");
    await expect(run()).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_CALL_NOT_SETTLED" });
    await admin.query("UPDATE hosted_phone_call SET result_notification_channel = NULL, status = 'failed', ended_at = NULL, analyzed_at = NULL");
    await expect(run()).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_CALL_NOT_SETTLED" });
  });

  it.each(["", ":generation:1", ":stop-settled"])("rejects unconsumed notification suffix %s", async (suffix) => {
    await seed();
    await admin.query("INSERT INTO hosted_mailbox_item VALUES ('mailbox_test', 'member_test', $1, NULL)",
      [`assistant.notification.requested:phone-call-result:call_test${suffix}`]);
    await expect(run()).rejects.toMatchObject({ code: "HOSTED_LEGACY_PHONE_CALL_DELETION_NOTIFICATION_PENDING" });
  });

  it("deletes provider-first, preserves usage, and allows consumed notifications or a distinct key prefix", async () => {
    await seed();
    await admin.query("INSERT INTO hosted_ai_usage VALUES ('usage_test', 'turn_phone_call_call_test')");
    await admin.query(`INSERT INTO hosted_mailbox_item VALUES
      ('consumed', 'member_test', 'assistant.notification.requested:phone-call-result:call_test', '2026-01-03'),
      ('distinct', 'member_test', 'assistant.notification.requested:phone-call-result:call_test_other', NULL)`);
    const runtime = vi.fn(async () => { expect(await remaining()).toBe(1); });
    expect(await run("apply", 1, runtime)).toMatchObject({ deletedRows: 1, failedRows: 0 });
    expect(runtime).toHaveBeenCalledWith("provider_test", { signal: expect.any(AbortSignal) });
    expect(await remaining()).toBe(0);
    expect((await admin.query("SELECT count(*)::int AS count FROM hosted_ai_usage")).rows[0].count).toBe(1);
  });

  it("retains provider retry authority after failure or a concurrent row update", async () => {
    await seed();
    expect(await run("apply", 1, vi.fn(async () => { throw new Error("synthetic provider error"); })))
      .toMatchObject({ deletedRows: 0, failedRows: 1, failureCode: "provider_cleanup_failed" });
    expect(await remaining()).toBe(1);
    expect(await run("apply", 1, vi.fn(async () => {
      await admin.query("UPDATE hosted_phone_call SET updated_at = '2026-01-04'");
    }))).toMatchObject({ deletedRows: 0, failedRows: 1 });
    expect((await admin.query("SELECT provider_call_id FROM hosted_phone_call")).rows[0].provider_call_id).toBe("provider_test");
    expect(await run("apply", 1)).toMatchObject({ deletedRows: 1, failedRows: 0 });
  });

  it("rejects mailbox work arriving during provider cleanup", async () => {
    await seed();
    expect(await run("apply", 1, vi.fn(async () => {
      await prisma.$transaction(async (tx) => {
        expect(await lockExistingHostedPhoneCallTx(tx, { id: "call_test", memberId: "member_test" })).toBe(true);
        await tx.$executeRaw`INSERT INTO hosted_mailbox_item VALUES ('late', 'member_test', 'assistant.notification.requested:phone-call-result:call_test', NULL)`;
      });
    }))).toMatchObject({ deletedRows: 0, failedRows: 1 });
    expect(await remaining()).toBe(1);
  });

  it("serializes a racing callback before deletion without locking another member", async () => {
    await seed();
    let releaseCallback!: () => void;
    let reportLocked!: () => void;
    const release = new Promise<void>((resolve) => { releaseCallback = resolve; });
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    let callback: Promise<void> | undefined;
    const deletion = run("apply", 1, vi.fn(async () => {
      callback = prisma.$transaction(async (tx) => {
        expect(await lockExistingHostedPhoneCallTx(tx, { id: "call_test", memberId: "member_test" })).toBe(true);
        reportLocked();
        await release;
        await tx.$executeRaw`INSERT INTO hosted_mailbox_item VALUES ('racing', 'member_test', 'assistant.notification.requested:phone-call-result:call_test', NULL)`;
      });
      await locked;
    }));
    await locked;
    try {
      await prisma.$transaction(async (other) => {
        expect(await lockExistingHostedPhoneCallTx(other, { id: "absent", memberId: "member_other" })).toBe(false);
      });
    } finally {
      releaseCallback();
    }
    await callback;
    expect(await deletion).toMatchObject({ deletedRows: 0, failedRows: 1, failureCode: "row_revalidation_failed" });
    expect(await remaining()).toBe(1);
  });

  it("reports partial progress and retries only the surviving selection", async () => {
    await seed("call_a", "provider_a");
    await seed("call_b", "provider_b");
    const runtime = vi.fn(async (id: string) => {
      if (id === "provider_b") throw new Error("synthetic provider failure");
    });
    expect(await run("apply", 2, runtime)).toMatchObject({
      selectedRows: 2, deletedRows: 1, failedRows: 1, failureCode: "provider_cleanup_failed",
    });
    expect(await run()).toMatchObject({ selectedRows: 1 });
    expect(await run("apply", 1)).toMatchObject({ deletedRows: 1, failedRows: 0 });
  });

  it("a stale callback sees deletion under the shared member lock while another member progresses", async () => {
    await seed("call_test", null);
    const deleted = await run("apply", 1);
    expect(deleted.deletedRows).toBe(1);
    await prisma.$transaction(async (tx) => {
      expect(await lockExistingHostedPhoneCallTx(tx, { id: "call_test", memberId: "member_test" })).toBe(false);
      await prisma.$transaction(async (other) => {
        expect(await lockExistingHostedPhoneCallTx(other, { id: "absent", memberId: "member_other" })).toBe(false);
      });
    });
    expect((await admin.query("SELECT count(*)::int AS count FROM hosted_mailbox_item")).rows[0].count).toBe(0);
  });
});
