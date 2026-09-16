import { commandHostedRuntimeOwner } from "./runtime-owner-client.ts";
import { HostedRuntimeMemberMigratingError, supportsPostgresRuntimeOwner } from "./runtime-cutover.ts";
import type { WorkerUserRunnerNamespaceLike, WorkerUserRunnerStubLike } from "./worker-contracts.ts";

type Source<T extends WorkerUserRunnerStubLike> = Readonly<Record<string, unknown>> & { USER_RUNNER: WorkerUserRunnerNamespaceLike<T> };

/** Never obtain a source stub before the durable intent acknowledges admission.
 * A stale legacy routing hint is retried by the caller; it is not permission to
 * fall back to another runtime inside the same operation.
 */
export async function resolveAdmittedLegacyUserRunner<T extends WorkerUserRunnerStubLike>(source: Source<T>, userId: string): Promise<T> {
  if (supportsPostgresRuntimeOwner(source)) {
    if (!source.USER_RUNNER.idFromName) throw new Error("Legacy admission requires deterministic source addressing.");
    await requireLegacyMaterialization(source, userId, source.USER_RUNNER.idFromName(userId).toString());
  }
  return source.USER_RUNNER.getByName(userId);
}

/** The source also rechecks on first ordinary RPC after activation, protecting
 * it from older Worker requests that did not register before obtaining a stub.
 */
export async function requireLegacyMaterialization(source: Readonly<Record<string, unknown>>, userId: string, objectId: string): Promise<void> {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || !("id" in metadata) || typeof metadata.id !== "string") throw new Error("Legacy admission requires serving version metadata.");
  const result = await commandHostedRuntimeOwner({ source, userId, command: { operation: "resolve_legacy", objectId, workerVersion: metadata.id } });
  if (result.cutover !== "legacy") throw new HostedRuntimeMemberMigratingError();
}
