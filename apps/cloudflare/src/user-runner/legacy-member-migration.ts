import type { HostedRuntimeMemberMigrationIdentity, HostedRuntimeMigrationCheckpointStatus } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "../runtime-migration-client.ts";
import { createHostedRunnerContainerNamespaceRouter } from "../standby-runner-contract.ts";
import type { WorkerEnvironmentSource } from "../worker-routes/shared.ts";
import type { DurableObjectStateLike } from "./types.ts";
import { observeLegacyRuntime } from "./legacy-runtime-observation.ts";

export async function requireLegacyMemberMigrationPhase(input: {
  source: WorkerEnvironmentSource; state: DurableObjectStateLike;
  identity: HostedRuntimeMemberMigrationIdentity; phases: readonly string[];
}): Promise<void> {
  const metadata = input.source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || !("id" in metadata) || metadata.id !== input.identity.workerVersion) {
    throw new Error("Legacy object is serving an incompatible migration version.");
  }
  await observeMember(input.state, input.identity.userId);
  const result = await commandHostedRuntimeMigration({ source: input.source, command: { operation: "read_member", ...input.identity } });
  const member = result.member;
  if (!member || typeof member !== "object" || !("userId" in member) || member.userId !== input.identity.userId
    || !("migrationId" in member) || !matchesMigrationToken(member, input.identity.migrationId)
    || !("migrationPhase" in member) || typeof member.migrationPhase !== "string" || !input.phases.includes(member.migrationPhase)) {
    throw new Error("Legacy member migration phase or identity changed.");
  }
}

/** Called with local new-start admission closed and prior launches settled.
 * Old signed URLs drain while the member is still live. A busy old process
 * without the managed-checkpoint protocol is left live for release convergence. */
export async function isLegacyMemberReady(input: {
  source: WorkerEnvironmentSource; state: DurableObjectStateLike; userId: string;
}): Promise<boolean> {
  const observed = await observeLegacyRuntime(input.state);
  // A deletion admitted before closure can legitimately erase the source.
  // Nothing is reserved yet; leave this object for fresh empty-object discovery.
  if (observed.kind === "observed" && observed.userId === null) return false;
  if (observed.kind !== "observed" || observed.userId !== input.userId) throw new Error("Legacy object member or schema does not match migration.");
  if (observed.snapshotPutDrainUntil && Date.parse(observed.snapshotPutDrainUntil) > Date.now()) return false;
  if (observed.replicaPendingWrites > 0) return false;
  if (!observed.activeAttemptId) return true;
  if (!observed.activeRunnerContainerName) return false;
  const target = exactTarget(input.source, observed.activeRunnerContainerName);
  const status = await target?.supportsMigrationCheckpoint?.({ userId: input.userId }) ?? "unsupported";
  // A recorded attempt whose exact process is gone can never clear itself, and
  // the freeze's exact-target stop reconciles it. Waiting would hold the member
  // forever. An unreachable or unsupported running process still waits.
  return status === "ready" || status === "absent";
}

export async function requestLegacyMemberCheckpoint(input: {
  source: WorkerEnvironmentSource; state: DurableObjectStateLike; userId: string;
}): Promise<HostedRuntimeMigrationCheckpointStatus> {
  const observed = await observeMember(input.state, input.userId);
  if (!observed.activeAttemptId) return "absent";
  if (!observed.activeRunnerContainerName) return "unconfirmed";
  const target = exactTarget(input.source, observed.activeRunnerContainerName);
  return await target?.requestMigrationCheckpoint?.({ userId: input.userId,
    attemptId: observed.activeAttemptId, generation: observed.generation }) ?? "unconfirmed";
}

export async function observeMember(state: DurableObjectStateLike, userId: string) {
  const observed = await observeLegacyRuntime(state);
  if (observed.kind !== "observed" || observed.userId !== userId) throw new Error("Legacy object member or schema does not match migration.");
  return observed;
}
function exactTarget(source: WorkerEnvironmentSource, name: string) {
  return createHostedRunnerContainerNamespaceRouter({ exactUser: source.RUNNER_CONTAINER,
    next: source.NEXT_RUNNER_CONTAINER, small: source.SMALL_RUNNER_CONTAINER,
    standby: source.STANDBY_RUNNER_CONTAINER ?? null })?.getByName(name);
}

function matchesMigrationToken(member: object & { migrationId: unknown }, migrationId: string): boolean {
  return member.migrationId === migrationId || (member.migrationId === null && "migrationPhase" in member && (member.migrationPhase === "legacy" || member.migrationPhase === "pending"));
}
