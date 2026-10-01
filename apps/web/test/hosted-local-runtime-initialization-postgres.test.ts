import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agePostgresRuntimeForTest, startStuckPostgresRuntimeForTest } from "./support/hosted-runtime-owner-testkit";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search) throw new Error("Runtime initialization proof requires an isolated loopback test database.");
}

describe.skipIf(!enabled)("local Postgres runtime initialization", () => {
  const name = `murph_e2e_runtime_init_${randomUUID().replaceAll("-", "")}`;
  let admin: Client;
  let db: Client;
  let environment: NodeJS.ProcessEnv;
  let initialize: string;
  let created = false;
  beforeAll(async () => {
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(databaseUrl); url.pathname = `/${name}`;
    environment = { NODE_ENV: "test", DATABASE_URL: url.toString() };
    db = new Client({ connectionString: url.toString() }); await db.connect();
    await db.query(await readFile(new URL("../prisma/migrations/20260915151000_hosted_runtime_owner/migration.sql", import.meta.url), "utf8"));
    await db.query("ALTER TABLE hosted_runtime_owner ADD COLUMN migration_phase TEXT NOT NULL DEFAULT 'legacy'; CREATE TABLE hosted_member (id TEXT PRIMARY KEY)");
    initialize = await readFile(new URL("../scripts/initialize-local-runtime-cutover.sql", import.meta.url), "utf8");
  });
  afterAll(async () => {
    await db?.end();
    if (created) await admin.query(`DROP DATABASE ${name}`);
    await admin?.end();
  });

  it("refuses to reinterpret an existing legacy namespace from empty SQL tables", async () => {
    await expect(db.query(initialize)).rejects.toThrow("Complete its migration");
    expect((await db.query("SELECT phase FROM hosted_runtime_cutover")).rows).toEqual([{ phase: "legacy" }]);
  });
  it("selects Postgres for a new local schema and preserves that decision", async () => {
    await db.query("DELETE FROM hosted_runtime_cutover");
    await db.query(initialize); await db.query(initialize);
    expect((await db.query("SELECT phase FROM hosted_runtime_cutover")).rows).toEqual([{ phase: "postgres" }]);
  });
  it("injects and ages a stale attempt without replacing a retained physical target or a live attempt", async () => {
    await db.query("INSERT INTO hosted_member (id) VALUES ('synthetic-local-member')");
    await db.query(`INSERT INTO hosted_runtime_owner (user_id, migration_phase, phase, generation, allocation_id, runner_container_name, updated_at)
      VALUES ('synthetic-local-member', 'postgres', 'idle', 5, 'synthetic-existing-allocation', 'synthetic-retained-target', now())`);
    const stuck = await startStuckPostgresRuntimeForTest(environment, "synthetic-local-member", 35_000);
    const [row] = (await db.query("SELECT generation::text, attempt_id, phase, runner_container_name, allocation_id FROM hosted_runtime_owner")).rows;
    expect(row).toEqual({ generation: "6", attempt_id: stuck.attemptId, phase: "starting", runner_container_name: "synthetic-retained-target", allocation_id: "synthetic-existing-allocation" });
    await expect(startStuckPostgresRuntimeForTest(environment, "synthetic-local-member")).rejects.toThrow("idle Postgres member");
    const aged = await agePostgresRuntimeForTest(environment, "synthetic-local-member", 60_000);
    expect(aged.attemptId).toBe(stuck.attemptId);
    expect(Date.now() - Date.parse(aged.startedAt)).toBeGreaterThanOrEqual(60_000);
    expect((await db.query("SELECT generation::text FROM hosted_runtime_owner")).rows).toEqual([{ generation: "6" }]);
  });
});

it("rejects hosted databases and libpq host overrides before fault injection", async () => {
  for (const DATABASE_URL of ["postgresql://localhost/murph_primary", "postgresql://remote.invalid/murph_e2e_test", "postgresql://localhost/murph_e2e_test?host=remote.invalid"]) {
    await expect(startStuckPostgresRuntimeForTest({ NODE_ENV: "test", DATABASE_URL }, "synthetic-member")).rejects.toThrow("isolated local E2E database");
  }
});
