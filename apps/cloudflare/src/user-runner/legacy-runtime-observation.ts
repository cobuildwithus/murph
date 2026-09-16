import type { LegacyRuntimeObservation } from "@murphai/hosted-execution/runtime-migration";
import type { DurableObjectStateLike, DurableObjectSqlStorageLike } from "./types.ts";
import { RUNNER_STATE_SCHEMA_VERSION } from "./runner-state-schema.ts";
import { readLegacyRuntimeMigrationIdentity, requireLegacyRuntimeStorageCoverage } from "./legacy-runtime-export.ts";
import { observeHostedBrowserVaultReplicaDirectPuts, readHostedWorkspaceSnapshotR2PutDrainUntil } from "./workspace-snapshot-sessions.ts";

/** Read supported existing storage directly. Never construct RunnerStateStore:
 * its schema initialization would mutate dormant objects during discovery.
 * Fields can change across awaits and must be rechecked under local admission
 * closure before treating them as handoff evidence.
 */
export async function observeLegacyRuntime(state: DurableObjectStateLike): Promise<LegacyRuntimeObservation> {
  const sql = state.storage.sql;
  if (!sql) throw new Error("Legacy runtime inspection requires SQLite storage.");
  const { version, empty, supported } = readExistingSchema(sql);
  if (!supported) return { kind: "unsupported_schema", schemaVersion: version };
  const resourceMembers = await requireLegacyRuntimeStorageCoverage(state);
  const identity = await readLegacyRuntimeMigrationIdentity(state);
  if (identity.userId) resourceMembers.add(identity.userId);
  if (resourceMembers.size > 1) throw new Error("Legacy runtime contains conflicting member identities.");
  const meta = empty ? undefined : sql.exec<{
    active_attempt_id: string | null; active_runner_container_name: string | null; active_workspace_version: string | null;
  }>("SELECT active_attempt_id, active_runner_container_name, active_workspace_version FROM runner_meta WHERE singleton = 1").toArray()[0];
  const snapshotPutDrainUntil = identity.userId === null ? null
    : await readHostedWorkspaceSnapshotR2PutDrainUntil({ state, userId: identity.userId });
  const replica = identity.userId === null ? null
    : await observeHostedBrowserVaultReplicaDirectPuts({ state, userId: identity.userId });
  return {
    kind: "observed", schemaVersion: version, ...identity,
    activeAttemptId: meta?.active_attempt_id ?? null,
    activeRunnerContainerName: meta?.active_runner_container_name ?? null,
    workspaceVersion: meta?.active_workspace_version ?? null,
    snapshotPutDrainUntil, replicaPendingWrites: replica?.pendingWrites ?? 0,
    replicaRecoveryDrainUntil: replica?.recoveryDrainUntil ?? null,
    observedAt: new Date().toISOString(),
  };
}

function readExistingSchema(sql: DurableObjectSqlStorageLike) {
  const tables = sql.exec<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name != '__cf_kv' ORDER BY name LIMIT 5",
  ).toArray().map(row => row.name);
  const storedVersion = tables.includes("runner_schema_meta")
    ? sql.exec<{ value: number }>("SELECT value FROM runner_schema_meta WHERE key = 'runner_state_schema_version'").toArray()[0]?.value
    : undefined;
  const version = typeof storedVersion === "number" && Number.isSafeInteger(storedVersion) ? storedVersion : null;
  const empty = tables.length === 0;
  const supported = empty || (version === RUNNER_STATE_SCHEMA_VERSION && tables.length === 3
    && tables.includes("runner_meta") && tables.includes("runner_hosted_media_asset"));
  return { version, empty, supported };
}
