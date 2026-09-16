import { parseLegacyRuntimeExportCursor, type HostedRuntimeMemberMigrationIdentity, type HostedRuntimeMigrationCommand, type HostedRuntimeObjectMigrationIdentity } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "../../runtime-migration-client.ts";
import type { UserRunnerDurableObjectStubLike } from "../../worker-routes/shared.ts";

export type RuntimeMigrationStep = <T>(operation: () => Promise<T>) => Promise<T>;

/** One bounded continuation: either readiness/checkpoint, one immutable page,
 * or activation. The operator retries the same identity after lost replies. */
export async function advanceRuntimeMemberMigration(input: {
  source: Readonly<Record<string, unknown>>; step?: RuntimeMigrationStep; stub: UserRunnerDurableObjectStubLike; identity: HostedRuntimeMemberMigrationIdentity;
}) {
  const { source, stub, identity } = input;
  const step: RuntimeMigrationStep = input.step ?? (operation => operation());
  const send = (command: HostedRuntimeMigrationCommand) => step(() => commandHostedRuntimeMigration({ source, command }));
  if (!stub.inspectPostgresMigration || !stub.preparePostgresMemberMigration || !stub.freezeForPostgresMigration || !stub.exportPostgresMigrationPage) {
    throw new Error("Legacy object does not support member migration.");
  }
  const observed = await step(() => stub.inspectPostgresMigration!());
  if (observed.kind !== "observed" || observed.userId !== identity.userId) throw new Error("Exact object does not match the migration member.");
  const current = await send({ ...identity, operation: "read_member" });
  const phase = memberPhase(current.member);
  if (phase === "postgres") return send({ ...identity, operation: "activate_member" });
  if (phase === "legacy" || phase === "pending" || phase === "quiescing") {
    const prepared = await step(() => stub.preparePostgresMemberMigration!(identity));
    if (!prepared.quiesced) return { pending: "readiness" as const };
    const latest = await step(() => stub.inspectPostgresMigration!());
    if (latest.kind !== "observed" || latest.userId !== identity.userId) throw new Error("Legacy member changed during quiescence.");
    if (attemptMayStillComplete(latest.activeAttemptId, prepared.checkpointStatus)) return { pending: "checkpoint" as const, checkpointStatus: prepared.checkpointStatus };
    await send({ ...identity, operation: "freeze_member" });
  } else if (phase !== "freezing" && phase !== "importing") throw new Error("Member migration phase is invalid.");
  if (!(await step(() => stub.freezeForPostgresMigration!(identity))).frozen) return { pending: "freeze" as const };
  const receipt = await send({ ...identity, operation: "read_object" });
  const object = importReceipt(receipt.object);
  if (object.completedAt) return send({ ...identity, operation: "activate_member" });
  const page = await step(() => stub.exportPostgresMigrationPage!(parseLegacyRuntimeExportCursor(object.nextCursor)));
  return send({ ...identity, operation: "import_member", page });
}
/** A recorded attempt whose exact target reports no such invocation can never
 * clear itself; the freeze's stop reconciles it instead of waiting forever. */
function attemptMayStillComplete(activeAttemptId: unknown, checkpointStatus: unknown): boolean {
  return Boolean(activeAttemptId) && checkpointStatus !== "absent";
}
function memberPhase(value: unknown): string {
  if (!value || typeof value !== "object" || !("migrationPhase" in value) || typeof value.migrationPhase !== "string") throw new Error("Member migration receipt is invalid.");
  return value.migrationPhase;
}

function importReceipt(value: unknown): { completedAt: unknown; nextCursor: unknown } {
  if (!value || typeof value !== "object" || !("completedAt" in value) || !("nextCursor" in value)) throw new Error("Member import receipt is invalid.");
  return { completedAt: value.completedAt, nextCursor: value.nextCursor };
}

export async function advanceRuntimeEmptyMigration(input: {
  source: Readonly<Record<string, unknown>>; step?: RuntimeMigrationStep; stub: UserRunnerDurableObjectStubLike; identity: HostedRuntimeObjectMigrationIdentity;
}) {
  const { source, stub, identity } = input;
  const step: RuntimeMigrationStep = input.step ?? (operation => operation());
  const send = (command: HostedRuntimeMigrationCommand) => step(() => commandHostedRuntimeMigration({ source, command }));
  if (!stub.freezeEmptyForPostgresMigration || !stub.exportPostgresMigrationPage) throw new Error("Legacy object does not support empty migration.");
  const receipt = await send({ ...identity, operation: "read_object" });
  const object = importReceipt(receipt.object);
  if (object.completedAt) return send({ ...identity, operation: "activate_empty" });
  if (!(await step(() => stub.freezeEmptyForPostgresMigration!(identity))).frozen) return { pending: "source_changed" as const };
  const page = await step(() => stub.exportPostgresMigrationPage!(parseLegacyRuntimeExportCursor(object.nextCursor)));
  return send({ ...identity, operation: "import_empty", page });
}
