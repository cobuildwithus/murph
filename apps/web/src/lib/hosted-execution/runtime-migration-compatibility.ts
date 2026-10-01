import { Prisma } from "@prisma/client";
import { HOSTED_RUNTIME_ROLLING_PROTOCOL, type HostedRuntimeMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";

/** Repository-owned gate alias; used by read-only routing/acknowledgement
 * statements. The transactional effect still rechecks the same identity.
 */
export function runtimeMigrationReleaseSql(identity: HostedRuntimeMigrationIdentity): Prisma.Sql {
  if (!identity.compatibility) return Prisma.sql`gate.worker_version = ${identity.workerVersion}`;
  return Prisma.sql`gate.namespace_probe_id = ${identity.compatibility.namespaceProbeId}
    AND ${identity.compatibility.protocol} = ${HOSTED_RUNTIME_ROLLING_PROTOCOL}`;
}
