import type { HostedRuntimeMigrationCheckpointRequest, HostedRuntimeMigrationCheckpointStatus } from "@murphai/hosted-execution/runtime-migration";

/** Called synchronously after parsing the request body. A late request cannot
 * shut down a different attempt; absent is not queued for a future invocation.
 * The caller still needs the canonical checkpoint and outer completion proof.
 */
export function requestContainerMigrationCheckpoint(input: {
  request: HostedRuntimeMigrationCheckpointRequest;
  active: { userId: string; attemptId: string | null; leaseGeneration: string | null } | null;
  shutdown: AbortController;
}): HostedRuntimeMigrationCheckpointStatus {
  const active = input.active;
  if (!active) return "absent";
  if (active.userId !== input.request.userId || active.attemptId !== input.request.attemptId
    || active.leaseGeneration !== input.request.generation) return "stale";
  input.shutdown.abort(new DOMException("Runtime migration requested a checkpoint.", "AbortError"));
  return "accepted";
}
