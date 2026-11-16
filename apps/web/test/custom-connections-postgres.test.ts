import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimActionRequestTx } from "../src/lib/custom-connections/action-confirm";
import { admitActionRequestTx, type ActionAdmission } from "../src/lib/custom-connections/action-requests";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/murph_test")) throw new Error("Custom connection SQL proof requires an isolated local test database.");
}
const migration = (name: string) => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
const MIGRATIONS = ["20261116000000_custom_connections", "20261116130000_custom_connection_action_requests"];

describe.skipIf(!enabled)("custom connection PostgreSQL migration", () => {
  it("applies the exact migrations in a temporary namespace and cascades deletion", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE mcp_marker (id int)");
      await client.query("SET LOCAL search_path TO pg_temp");
      await client.query("CREATE TABLE hosted_member (id TEXT PRIMARY KEY)");
      for (const name of MIGRATIONS) await client.query(await migration(name));
      await client.query("INSERT INTO hosted_member VALUES ('member-a')");
      await client.query("INSERT INTO hosted_mcp_connection (id, member_id, slug, name, server_url, catalog) VALUES ('cc_synthetic', 'member-a', 'notes', 'Notes', 'https://notes.example.com/mcp', 'catalog')");
      await client.query("INSERT INTO hosted_mcp_pending_authorization VALUES ('cc_synthetic', 'member-a', 'binding', 1, 'state-hash', 'encrypted', CURRENT_TIMESTAMP + interval '10 minutes')");
      await client.query(`INSERT INTO hosted_mcp_action_request (id, member_id, connection_id, generation, tool_name, digest, lookup_key, arguments_encrypted, expires_at)
        VALUES ('car_a', 'member-a', 'cc_synthetic', 1, 'add_note', 'digest', 'key', 'sealed', CURRENT_TIMESTAMP + interval '1 hour')`);
      await client.query("DELETE FROM hosted_member WHERE id = 'member-a'");
      for (const table of ["hosted_mcp_connection", "hosted_mcp_pending_authorization", "hosted_mcp_action_request"]) {
        expect((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
      }
    } finally { await client.query("ROLLBACK"); await client.end(); }
  });
  it("classifies existing accounts once, only from records a later sign-in change can't produce", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE first_sign_in_marker (id int)");
      await client.query("SET LOCAL search_path TO pg_temp");
      await client.query("CREATE TABLE hosted_member (id TEXT PRIMARY KEY)");
      await client.query("CREATE TABLE hosted_auth_record (model TEXT, id TEXT, member_id TEXT, created_at TIMESTAMP(3))");
      await client.query("CREATE TABLE hosted_member_identity (member_id TEXT PRIMARY KEY, phone_number_verified_at TIMESTAMP(3))");
      const signedUp = "2026-10-01 12:00:00";
      // [member, Telegram account created at, phone verified at]; every member but "never" has a user record at signedUp.
      const members: [string, string | null, string | null][] = [
        ["telegram", signedUp, null],
        ["telegram-later", "2026-10-02 12:00:00", null],
        ["telegram-then-phone", signedUp, "2026-10-03 12:00:00"],
        ["phone", null, "2026-10-01 12:00:04"],
        ["phone-imported", null, "2026-09-01 12:00:00"],
        ["phone-later", null, "2026-10-01 12:00:11"],
        ["email-only", null, null],
      ];
      for (const [id, telegram, phone] of members) {
        await client.query("INSERT INTO hosted_member VALUES ($1)", [id]);
        await client.query("INSERT INTO hosted_auth_record VALUES ('user', $1, $1, $2)", [id, signedUp]);
        if (telegram) await client.query("INSERT INTO hosted_auth_record VALUES ('account', $1, $2, $3)", [`account-${id}`, id, telegram]);
        await client.query("INSERT INTO hosted_member_identity VALUES ($1, $2)", [id, phone]);
      }
      await client.query("INSERT INTO hosted_member VALUES ('never')");
      await client.query(await migration("20261116130100_member_first_sign_in_method"));
      const rows = (await client.query("SELECT id, first_sign_in_method FROM hosted_member ORDER BY id")).rows;
      expect(Object.fromEntries(rows.map((row) => [row.id, row.first_sign_in_method]))).toEqual({
        "email-only": null, never: null, phone: "phone", "phone-imported": "phone", "phone-later": null,
        telegram: "telegram", "telegram-later": null, "telegram-then-phone": "telegram",
      });
      await expect(client.query("UPDATE hosted_member SET first_sign_in_method = 'passkey' WHERE id = 'never'")).rejects.toThrow(/check constraint/u);
    } finally { await client.query("ROLLBACK"); await client.end(); }
  });
  it("cascades account deletion and admits only one refresh owner and one pending-state consumer", async () => {
    const schema = `mcp_test_${randomUUID().replaceAll("-", "")}`;
    const setup = new pg.Client({ connectionString: databaseUrl });
    const a = new pg.Client({ connectionString: databaseUrl });
    const b = new pg.Client({ connectionString: databaseUrl });
    await setup.connect(); await a.connect(); await b.connect();
    try {
      await setup.query(`CREATE SCHEMA "${schema}"`);
      for (const client of [setup, a, b]) await client.query(`SET search_path TO "${schema}"`);
      await setup.query('CREATE TABLE hosted_member (id TEXT PRIMARY KEY)');
      await setup.query(await migration(MIGRATIONS[0]!));
      await setup.query("INSERT INTO hosted_member VALUES ('member-a')");
      await setup.query("INSERT INTO hosted_mcp_connection (id, member_id, slug, name, server_url, catalog, status) VALUES ('cc_synthetic', 'member-a', 'notes', 'Notes', 'https://notes.example.com/mcp', 'catalog', 'on')");
      const claims = await Promise.all([a, b].map((client, index) => client.query(`UPDATE hosted_mcp_connection SET refresh_claim = $1
        WHERE id = 'cc_synthetic' AND generation = 1 AND token_version = 0 AND status = 'on' AND refresh_claim IS NULL RETURNING id`, [`claim-${index}`])));
      expect(claims.map((result) => result.rowCount).sort()).toEqual([0, 1]);
      await setup.query("INSERT INTO hosted_mcp_pending_authorization VALUES ('cc_synthetic', 'member-a', 'binding', 1, 'state-hash', 'encrypted', CURRENT_TIMESTAMP + interval '10 minutes')");
      const consumed = await Promise.all([a, b].map((client) => client.query("DELETE FROM hosted_mcp_pending_authorization WHERE connection_id = 'cc_synthetic' AND state_hash = 'state-hash' RETURNING connection_id")));
      expect(consumed.map((result) => result.rowCount).sort()).toEqual([0, 1]);
      await setup.query("INSERT INTO hosted_mcp_pending_authorization VALUES ('cc_synthetic', 'member-a', 'binding', 1, 'state-hash', 'encrypted', CURRENT_TIMESTAMP + interval '10 minutes')");
      await setup.query("DELETE FROM hosted_member WHERE id = 'member-a'");
      expect((await setup.query("SELECT count(*)::int AS count FROM hosted_mcp_connection")).rows[0].count).toBe(0);
      expect((await setup.query("SELECT count(*)::int AS count FROM hosted_mcp_pending_authorization")).rows[0].count).toBe(0);
    } finally {
      await a.end(); await b.end();
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.end();
    }
  });
});

describe.skipIf(!enabled)("custom connection action requests in PostgreSQL", () => {
  const schema = `mcp_action_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  let prisma: PrismaClient;
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    // Prisma keeps timestamp columns in UTC, as production's database does; seeded CURRENT_TIMESTAMP must match.
    await admin.query(`SET search_path TO "${schema}"; SET TIME ZONE 'UTC'`);
    await admin.query("CREATE TABLE hosted_member (id TEXT PRIMARY KEY)");
    for (const name of MIGRATIONS) await admin.query(await migration(name));
    // The production functions, through Prisma, against only this namespace.
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4, options: `-c search_path="${schema}" -c TimeZone=UTC` }, { schema }) });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query("DELETE FROM hosted_member");
    await admin.query("INSERT INTO hosted_member VALUES ('member-a')");
    await admin.query("INSERT INTO hosted_mcp_connection (id, member_id, slug, name, server_url, catalog, status) VALUES ('cc_synthetic', 'member-a', 'notes', 'Notes', 'https://notes.example.com/mcp', 'catalog', 'on')");
  });
  const admission = (id: string, key: string, now = new Date()): ActionAdmission => ({ id, memberId: "member-a", connectionId: "cc_synthetic", generation: 1,
    toolName: "add_note", digest: "digest", lookupKey: key, lookupCandidates: [key], argumentsEncrypted: "sealed", now });
  async function seed(count: number, expiresIn: string, key = (index: number) => `seed-${index}`) {
    for (let index = 0; index < count; index += 1) {
      await admin.query(`INSERT INTO hosted_mcp_action_request (id, member_id, connection_id, generation, tool_name, digest, lookup_key, arguments_encrypted, expires_at)
        VALUES ($1, 'member-a', 'cc_synthetic', 1, 'add_note', 'digest', $2, 'sealed', CURRENT_TIMESTAMP + $3::interval)`, [`car_seed_${index}`, key(index), expiresIn]);
    }
  }
  /** Runs the first transaction to its decision and holds it open, so the second must wait for its lock. */
  async function race<T>(first: (tx: never) => Promise<T>, second: (tx: never) => Promise<T>): Promise<[T, T]> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let decided!: () => void;
    const firstDecided = new Promise<void>((resolve) => { decided = resolve; });
    const one = prisma.$transaction(async (tx) => { const result = await first(tx as never); decided(); await held; return result; }, { timeout: 10_000 });
    await firstDecided;
    let secondDone = false;
    const two = prisma.$transaction((tx) => second(tx as never), { timeout: 10_000 }).finally(() => { secondDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(secondDone).toBe(false);
    release();
    return [await one, await two];
  }
  it("rejects stored running or expired states, and decided rows without a decision time", async () => {
    for (const [status, decided] of [["running", "CURRENT_TIMESTAMP"], ["expired", "CURRENT_TIMESTAMP"], ["done", "NULL"], ["waiting", "CURRENT_TIMESTAMP"]]) {
      await expect(admin.query(`INSERT INTO hosted_mcp_action_request (id, member_id, connection_id, generation, tool_name, digest, lookup_key, arguments_encrypted, status, expires_at, decided_at)
        VALUES ('car_bad', 'member-a', 'cc_synthetic', 1, 'add_note', 'digest', 'key', 'sealed', $1, CURRENT_TIMESTAMP, ${decided})`, [status])).rejects.toThrow(/check constraint/u);
    }
  });
  it("lets exactly one of two racing confirmations consume a request", async () => {
    await seed(1, "1 hour");
    const now = new Date();
    const [first, second] = await race(
      (tx) => claimActionRequestTx(tx, "car_seed_0", "member-a", "unknown", now),
      (tx) => claimActionRequestTx(tx, "car_seed_0", "member-a", "unknown", now),
    );
    expect([first, second]).toEqual([true, false]);
    expect((await admin.query("SELECT status, decided_at IS NOT NULL AS decided FROM hosted_mcp_action_request")).rows).toEqual([{ status: "unknown", decided: true }]);
  });
  it("never consumes an expired request or another member's", async () => {
    await seed(1, "-1 minute");
    expect(await prisma.$transaction((tx) => claimActionRequestTx(tx, "car_seed_0", "member-a", "unknown", new Date()))).toBe(false);
    await admin.query("UPDATE hosted_mcp_action_request SET expires_at = CURRENT_TIMESTAMP + interval '1 hour'");
    expect(await prisma.$transaction((tx) => claimActionRequestTx(tx, "car_seed_0", "member-b", "declined", new Date()))).toBe(false);
    expect((await admin.query("SELECT status FROM hosted_mcp_action_request")).rows).toEqual([{ status: "waiting" }]);
  });
  it("creates one request for identical concurrent calls, and both get it", async () => {
    const [first, second] = await race(
      (tx) => admitActionRequestTx(tx, admission("car_first", "same-key")),
      (tx) => admitActionRequestTx(tx, admission("car_second", "same-key")),
    );
    expect(first?.id).toBe("car_first");
    expect(second?.id).toBe("car_first");
    expect((await admin.query("SELECT id FROM hosted_mcp_action_request")).rows).toEqual([{ id: "car_first" }]);
  });
  it("admits one of two different calls racing for the last of 20 places", async () => {
    await seed(19, "1 hour");
    const [first, second] = await race(
      (tx) => admitActionRequestTx(tx, admission("car_first", "key-a")),
      (tx) => admitActionRequestTx(tx, admission("car_second", "key-b")),
    );
    expect(first?.id).toBe("car_first");
    expect(second).toBeNull();
    expect((await admin.query("SELECT count(*)::int AS count FROM hosted_mcp_action_request WHERE status = 'waiting'")).rows[0].count).toBe(20);
  });
  it("reuses a waiting request at the cap and doesn't count expired ones", async () => {
    await seed(20, "1 hour");
    expect((await prisma.$transaction((tx) => admitActionRequestTx(tx, admission("car_new", "seed-7"))))?.id).toBe("car_seed_7");
    expect(await prisma.$transaction((tx) => admitActionRequestTx(tx, admission("car_new", "other")))).toBeNull();
    await admin.query("UPDATE hosted_mcp_action_request SET expires_at = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = 'car_seed_0'");
    expect((await prisma.$transaction((tx) => admitActionRequestTx(tx, admission("car_new", "other"))))?.id).toBe("car_new");
  });
  it("cascades a removed connection's requests", async () => {
    await seed(2, "1 hour");
    await admin.query("DELETE FROM hosted_mcp_connection WHERE id = 'cc_synthetic'");
    expect((await admin.query("SELECT count(*)::int AS count FROM hosted_mcp_action_request")).rows[0].count).toBe(0);
  });
});
