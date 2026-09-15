import { Client } from "pg";

function localTestClient(environment: NodeJS.ProcessEnv): Client {
  const url = new URL(environment.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/murph_e2e_[a-z0-9_]+$/u.test(url.pathname)) {
    throw new Error("Runtime fixture requires an isolated local E2E database.");
  }
  return new Client({ connectionString: url.toString() });
}

/** Empty local namespace fixture only. Fleet migration is proved separately
 * through the real freeze/export/import/activate protocol. */
export async function initializeEmptyPostgresRuntimeForTest(environment: NodeJS.ProcessEnv): Promise<void> {
  const client = localTestClient(environment);
  try {
    await client.connect();
    const result = await client.query(`INSERT INTO hosted_runtime_cutover (id, phase, updated_at)
      SELECT 'runtime', 'postgres', now()
      WHERE NOT EXISTS (SELECT 1 FROM hosted_member)
        AND NOT EXISTS (SELECT 1 FROM hosted_runtime_owner)
      ON CONFLICT (id) DO UPDATE SET phase = 'postgres'
        WHERE hosted_runtime_cutover.phase = 'legacy'
      RETURNING id`);
    if (result.rowCount !== 1) throw new Error("Postgres runtime fixture requires an empty legacy database.");
  } finally { await client.end(); }
}

export async function readPostgresRuntimeIdentityForTest(environment: NodeJS.ProcessEnv, userId: string): Promise<{
  generation: string; phase: string; target: string | null;
} | null> {
  const client = localTestClient(environment);
  try {
    await client.connect();
    const result = await client.query<{ generation: string; phase: string; target: string | null }>(
      `SELECT generation::text, phase, runner_container_name AS target FROM hosted_runtime_owner WHERE user_id = $1`, [userId]);
    return result.rows[0] ?? null;
  } finally { await client.end(); }
}
