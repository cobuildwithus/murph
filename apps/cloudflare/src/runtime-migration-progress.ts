import { readRuntimeMigrationCompatibility } from "./runtime-migration-compatibility.ts";
import { matchesHostedRuntimeMigrationRelease } from "@murphai/hosted-execution/runtime-migration";
import { createHash } from "node:crypto";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "./runtime-migration-client.ts";
import { supportsPostgresRuntimeOwner } from "./runtime-cutover.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import type { WorkerEnvironmentSource } from "./worker-routes/shared.ts";
import { advanceRuntimeEmptyMigration, advanceRuntimeMemberMigration } from "./worker/route-handlers/runtime-member-migration.ts";
import { runRuntimeProcessingCommandStep, type RuntimeProcessingCommandBudget } from "./user-runner/runtime-command-budget.ts";

type Source = Pick<WorkerEnvironmentSource, "USER_RUNNER"> & Readonly<Record<string, unknown>>;

/** Existing processing retries own progress; no timer or second scheduler.
 * Register the caller without touching its source, then advance one continuation
 * of the durable selection (possibly an earlier paused member). Automatic selection
 * cannot start another baseline member after a canary. Each external
 * step shares the original request budget. A lost reply leaves the same source
 * selected; ordinary processing retries re-read authority before starting work.
 */
export async function progressRuntimeMigrationForMember(input: { source: Source; userId: string; budget: RuntimeProcessingCommandBudget }) {
  const { source, userId, budget } = input;
  if (!supportsPostgresRuntimeOwner(source)) return;
  const env = readHostedExecutionEnvironment(asWorkerStringEnvironment(source));
  const step = <T>(operation: () => Promise<T>) => runRuntimeProcessingCommandStep({ budget, operation, stepTimeoutMs: env.webControlTimeoutMs });
  const send = (command: HostedRuntimeMigrationCommand) => step(() => commandHostedRuntimeMigration({ source, command }));
  const status = await send({ operation: "status" });
  const identity = readReadyCampaignIdentity(status.gate, source);
  if (!identity) return;
  const namespace = source.USER_RUNNER;
  if (!namespace.idFromName || !namespace.idFromString || !namespace.get) throw new Error("Runtime migration requires exact source addressing.");
  const objectId = namespace.idFromName(userId).toString();
  await send({ operation: "enroll_sources", ...identity, bindings: [{ userId, objectId }] });
  const selected = await send({ operation: "select_first_use", ...identity, userId, objectId });
  if (selected.objectId === null) return;
  if (typeof selected.objectId !== "string" || !/^[a-f0-9]{64}$/u.test(selected.objectId)) throw new Error("Runtime migration selection is invalid.");
  const selectedIdentity = { ...identity, objectId: selected.objectId };
  const stub = namespace.get(namespace.idFromString(selected.objectId));
  if (!stub.inspectPostgresMigration) throw new Error("Runtime migration source cannot be inspected.");
  const observed = await step(() => stub.inspectPostgresMigration!());
  if (observed.kind !== "observed") throw new Error("Runtime migration source requires schema recovery.");
  if (observed.userId === null) return advanceRuntimeEmptyMigration({ source, stub, identity: selectedIdentity, step });
  const migrationId = createHash("sha256").update(JSON.stringify([identity.namespaceId, selected.objectId, observed.userId])).digest("hex");
  return advanceRuntimeMemberMigration({ source, stub, identity: { ...selectedIdentity, userId: observed.userId, migrationId }, step });
}

function readReadyCampaignIdentity(gate: unknown, source: Source) {
  const metadata = source.CF_VERSION_METADATA;
  if (!gate || typeof gate !== "object" || !("phase" in gate)) throw new Error("Runtime migration status is invalid.");
  if (gate.phase !== "rolling") return null;
  if (!("creationClosedAt" in gate) || !gate.creationClosedAt || !("inventorySealedAt" in gate) || !gate.inventorySealedAt) return null;
  if (!metadata || typeof metadata !== "object" || !("id" in metadata) || typeof metadata.id !== "string"
    || !("workerVersion" in gate) || typeof gate.workerVersion !== "string"
    || !("namespaceProbeId" in gate) || typeof gate.namespaceProbeId !== "string"
    || !("namespaceId" in gate) || typeof gate.namespaceId !== "string") throw new Error("Runtime migration serving identity changed.");
  if (!matchesHostedRuntimeMigrationRelease({ workerVersion: gate.workerVersion, namespaceProbeId: gate.namespaceProbeId },
    { workerVersion: metadata.id, compatibility: readRuntimeMigrationCompatibility(source) })) throw new Error("Runtime migration serving identity changed.");
  return { namespaceId: gate.namespaceId, workerVersion: metadata.id };
}
