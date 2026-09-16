import { parseLegacyRuntimeExportCursor, type HostedRuntimeMemberMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "../../runtime-migration-client.ts";
import type { WorkerEnvironmentSource, UserRunnerDurableObjectStubLike } from "../../worker-routes/shared.ts";

/** One bounded continuation: either readiness/checkpoint, one immutable page,
 * or activation. The operator retries the same identity after lost replies. */
export async function advanceRuntimeMemberMigration(input: {
  source: WorkerEnvironmentSource; stub: UserRunnerDurableObjectStubLike; identity: HostedRuntimeMemberMigrationIdentity;
}) {
  const { source, stub, identity } = input;
  if (!stub.inspectPostgresMigration || !stub.preparePostgresMemberMigration || !stub.freezeForPostgresMigration || !stub.exportPostgresMigrationPage) {
    throw new Error("Legacy object does not support member migration.");
  }
  const observed = await stub.inspectPostgresMigration();
  if (observed.kind !== "observed" || observed.userId !== identity.userId) throw new Error("Exact object does not match the migration member.");
  const current = await commandHostedRuntimeMigration({ source, command: { ...identity, operation: "quiesce_member" } });
  const phase = memberPhase(current.member);
  if (phase === "postgres") return commandHostedRuntimeMigration({ source, command: { ...identity, operation: "activate_member" } });
  if (phase === "quiescing") {
    const prepared = await stub.preparePostgresMemberMigration(identity);
    if (!prepared.quiesced) return { pending: "readiness" as const };
    const latest = await stub.inspectPostgresMigration();
    if (latest.kind !== "observed" || latest.userId !== identity.userId) throw new Error("Legacy member changed during quiescence.");
    if (latest.activeAttemptId) return { pending: "checkpoint" as const, checkpointStatus: prepared.checkpointStatus };
    await commandHostedRuntimeMigration({ source, command: { ...identity, operation: "freeze_member" } });
  } else if (phase !== "freezing" && phase !== "importing") throw new Error("Member migration phase is invalid.");
  if (!(await stub.freezeForPostgresMigration(identity)).frozen) return { pending: "freeze" as const };
  const receipt = await commandHostedRuntimeMigration({ source, command: { ...identity, operation: "read_object" } });
  const object = importReceipt(receipt.object);
  if (object.completedAt) return commandHostedRuntimeMigration({ source, command: { ...identity, operation: "activate_member" } });
  const page = await stub.exportPostgresMigrationPage(parseLegacyRuntimeExportCursor(object.nextCursor));
  return commandHostedRuntimeMigration({ source, command: { ...identity, operation: "import_member", page } });
}
function memberPhase(value: unknown): string {
  if (!value || typeof value !== "object" || !("migrationPhase" in value) || typeof value.migrationPhase !== "string") throw new Error("Member migration receipt is invalid.");
  return value.migrationPhase;
}

function importReceipt(value: unknown): { completedAt: unknown; nextCursor: unknown } {
  if (!value || typeof value !== "object" || !("completedAt" in value) || !("nextCursor" in value)) throw new Error("Member import receipt is invalid.");
  return { completedAt: value.completedAt, nextCursor: value.nextCursor };
}
