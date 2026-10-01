import { randomUUID } from "node:crypto";
import { Client } from "pg";

function localTestClient(environment: NodeJS.ProcessEnv): Client {
  const url = new URL(environment.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.searchParams.has("host")
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
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
        WHERE hosted_runtime_cutover.phase IN ('legacy', 'postgres')
      RETURNING id`);
    if (result.rowCount !== 1) throw new Error("Postgres runtime fixture requires an empty local database.");
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

/** Deliberate fault injection into the actual admission owner. The local-only
 * database guard prevents this test API from targeting a hosted database. */
export async function startStuckPostgresRuntimeForTest(environment: NodeJS.ProcessEnv, userId: string, startedAgoMs = 0) {
  if (!Number.isSafeInteger(startedAgoMs) || startedAgoMs < 0) throw new TypeError("Invalid synthetic runtime age.");
  const client = localTestClient(environment);
  const attemptId = `runtime-write-${randomUUID()}`;
  try {
    await client.connect();
    const result = await client.query(`INSERT INTO hosted_runtime_owner
      (user_id, migration_phase, generation, attempt_id, phase, processing_mode, allocation_id, started_at, updated_at)
      SELECT $1, 'postgres', 1, $2, 'starting', 'default', $3, $4, now()
      WHERE EXISTS (SELECT 1 FROM hosted_runtime_cutover WHERE id = 'runtime' AND phase = 'postgres')
        AND EXISTS (SELECT 1 FROM hosted_member WHERE id = $1)
      ON CONFLICT (user_id) DO UPDATE SET generation = hosted_runtime_owner.generation + 1,
        attempt_id = EXCLUDED.attempt_id, phase = 'starting', processing_mode = 'default',
        allocation_id = COALESCE(hosted_runtime_owner.allocation_id, EXCLUDED.allocation_id), workspace_version = NULL,
        provider_egress_token_hash = NULL, custom_inference_envelope = NULL, platform_ai_usage_allowed = false,
        started_at = EXCLUDED.started_at, accepted_at = NULL, completed_at = NULL, updated_at = now()
      WHERE hosted_runtime_owner.phase = 'idle'
      RETURNING attempt_id`, [userId, attemptId, `standby-claim-${randomUUID()}`, new Date(Date.now() - startedAgoMs)]);
    if (result.rowCount !== 1) throw new Error("Stuck runtime fixture requires an idle Postgres member.");
    return { attemptId, nextWakeAt: null, ok: true as const };
  } finally { await client.end(); }
}

export async function agePostgresRuntimeForTest(environment: NodeJS.ProcessEnv, userId: string, startedAgoMs: number) {
  if (!Number.isSafeInteger(startedAgoMs) || startedAgoMs <= 0) throw new TypeError("Invalid synthetic runtime age.");
  const client = localTestClient(environment);
  const startedAt = new Date(Date.now() - startedAgoMs).toISOString();
  try {
    await client.connect();
    const result = await client.query<{ attemptId: string }>(`UPDATE hosted_runtime_owner SET started_at = $2, updated_at = now()
      WHERE user_id = $1 AND phase <> 'idle' AND attempt_id IS NOT NULL
      RETURNING attempt_id AS "attemptId"`, [userId, startedAt]);
    if (!result.rows[0]) throw new Error("Synthetic runtime has no active attempt to age.");
    return { attemptId: result.rows[0].attemptId, startedAt, ok: true as const };
  } finally { await client.end(); }
}
