import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/murph_test")) throw new Error("Custom connection SQL proof requires an isolated local test database.");
}

describe.skipIf(!enabled)("custom connection PostgreSQL migration", () => {
  it("applies the exact migration in a temporary namespace and cascades deletion", async () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE mcp_marker (id int)");
      await client.query("SET LOCAL search_path TO pg_temp");
      await client.query("CREATE TABLE hosted_member (id TEXT PRIMARY KEY)");
      await client.query(await readFile(new URL("../prisma/migrations/20261116000000_custom_connections/migration.sql", import.meta.url), "utf8"));
      await client.query("INSERT INTO hosted_member VALUES ('member-a')");
      await client.query("INSERT INTO hosted_mcp_connection (id, member_id, slug, name, server_url, catalog) VALUES ('cc_synthetic', 'member-a', 'notes', 'Notes', 'https://notes.example.com/mcp', 'catalog')");
      await client.query("INSERT INTO hosted_mcp_pending_authorization VALUES ('cc_synthetic', 'member-a', 'binding', 1, 'state-hash', 'encrypted', CURRENT_TIMESTAMP + interval '10 minutes')");
      await client.query("DELETE FROM hosted_member WHERE id = 'member-a'");
      expect((await client.query("SELECT count(*)::int AS count FROM hosted_mcp_connection")).rows[0].count).toBe(0);
      expect((await client.query("SELECT count(*)::int AS count FROM hosted_mcp_pending_authorization")).rows[0].count).toBe(0);
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
      await setup.query(await readFile(new URL("../prisma/migrations/20261116000000_custom_connections/migration.sql", import.meta.url), "utf8"));
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
