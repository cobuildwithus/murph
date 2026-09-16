import type { HostedRuntimeMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "../../runtime-migration-client.ts";
import type { WorkerEnvironmentSource } from "../../worker-routes/shared.ts";

/** Pure namespace addressing, not get/getByName: census cannot materialize a
 * source or start a runner. One call enrolls at most one bounded canonical page.
 */
export async function enrollRuntimeMembers(source: WorkerEnvironmentSource, identity: HostedRuntimeMigrationIdentity) {
  if (!source.USER_RUNNER.idFromName) throw new Error("Canonical enrollment requires deterministic source addressing.");
  const result = await commandHostedRuntimeMigration({ source, command: { operation: "list_unenrolled", ...identity } });
  if (!Array.isArray(result.userIds) || result.userIds.length > 100
    || result.userIds.some(id => typeof id !== "string" || !id)) throw new Error("Canonical enrollment page is invalid.");
  const userIds = result.userIds as string[];
  const pending = result.cleanupPending === true ? { cleanupPending: true } : {};
  if (!userIds.length) return { enrolled: 0, ...pending };
  const bindings = userIds.map(userId => ({ userId, objectId: source.USER_RUNNER.idFromName!(userId).toString() }));
  return { ...await commandHostedRuntimeMigration({ source, command: { operation: "enroll_sources", ...identity, bindings } }), ...pending };
}
