import { parseAllowedString, requireObject, requireString } from "./parsers/assertions.ts";
import { parseHostedRuntimeMigrationCompatibility, type HostedRuntimeMigrationCompatibility, parseHostedRuntimeOwnerIdentity } from "./runtime-owner.ts";

export const HOSTED_RUNTIME_MIGRATION_CHECKPOINT_PATH = "/internal/workspace-invocation/migration-checkpoint";
export const HOSTED_RUNTIME_MIGRATION_CHECKPOINT_CAPABILITY_HEADER = "x-runtime-migration-checkpoint-capability";
export const HOSTED_RUNTIME_MIGRATION_CHECKPOINT_PROTOCOL = "managed-snapshot-v1";
export const HOSTED_RUNTIME_MIGRATION_CHECKPOINT_STATUS_HEADER = "x-runtime-migration-checkpoint-status";
export interface HostedRuntimeMigrationCheckpointRequest { userId: string; attemptId: string; generation: string }
/** Acceptance requests a graceful checkpoint; it is never a stop or durability receipt. */
export type HostedRuntimeMigrationCheckpointStatus = "accepted" | "stale" | "absent" | "unconfirmed";
export function parseHostedRuntimeMigrationCheckpointRequest(value: unknown): HostedRuntimeMigrationCheckpointRequest {
  const record = requireObject(value, "Runtime migration checkpoint");
  return { ...parseHostedRuntimeOwnerIdentity(record), userId: requireString(record.userId, "Runtime migration member") };
}

export const HOSTED_RUNTIME_MEMBER_MIGRATION_PHASES = [
  "legacy", "pending", "quiescing", "freezing", "importing", "postgres",
] as const;
export type HostedRuntimeMemberMigrationPhase =
  (typeof HOSTED_RUNTIME_MEMBER_MIGRATION_PHASES)[number];
export type HostedRuntimeBackend = "legacy" | "draining" | "postgres";

export function parseHostedRuntimeMemberMigrationPhase(value: unknown): HostedRuntimeMemberMigrationPhase {
  return parseAllowedString(value, "Member runtime migration phase", HOSTED_RUNTIME_MEMBER_MIGRATION_PHASES);
}

/** A route is a hint, not admission. Quiescing keeps the legacy backend for
 * the current attempt's checkpoint; local admission rejects new attempts.
 * Missing member state remains legacy throughout the rolling campaign.
 */
export function resolveHostedRuntimeMemberBackend(
  campaignPhase: string,
  memberPhase: string | null,
): HostedRuntimeBackend {
  if (campaignPhase === "legacy" || campaignPhase === "draining" || campaignPhase === "postgres") {
    return campaignPhase;
  }
  if (campaignPhase !== "rolling") throw new Error("Unknown runtime migration campaign phase.");
  const phase = memberPhase === null ? "legacy" : parseHostedRuntimeMemberMigrationPhase(memberPhase);
  if (phase === "legacy" || phase === "quiescing") return "legacy";
  return phase === "postgres" ? "postgres" : "draining";
}

/** Finite fleet migration protocol; never carries live runtime authority. */
export const HOSTED_RUNTIME_MIGRATION_PATH = "/api/internal/hosted-runtime/migration";
export const LEGACY_RUNTIME_EXPORT_SCHEMA = "murph.legacy-runtime-export.v1";
export const LEGACY_RUNTIME_EXPORT_PAGE_SIZE = 50;
export type LegacyRuntimeExportCursor = { section: number; after: string };
export interface LegacyRuntimeExportPage {
  schema: typeof LEGACY_RUNTIME_EXPORT_SCHEMA;
  userId: string | null;
  generation: string;
  cursor: LegacyRuntimeExportCursor;
  next: LegacyRuntimeExportCursor | null;
  records: Array<{ kind: "media" | "resource"; key: string; value: Record<string, unknown> }>;
  hash: string;
}
export interface HostedRuntimeMigrationIdentity { namespaceId: string; workerVersion: string; compatibility?: HostedRuntimeMigrationCompatibility }
/** Observational only: a live scan does not establish a handoff barrier. */
export type LegacyRuntimeObservation =
  | { kind: "unsupported_schema"; schemaVersion: number | null }
  | {
    kind: "observed";
    schemaVersion: number | null;
    userId: string | null;
    generation: string;
    activeAttemptId: string | null;
    activeRunnerContainerName: string | null;
    workspaceVersion: string | null;
    snapshotPutDrainUntil: string | null;
    replicaPendingWrites: number;
    replicaRecoveryDrainUntil: string | null;
    managedSnapshotPendingUploads: number;
    observedAt: string;
  };
export type LegacyRuntimeInspection = LegacyRuntimeObservation & {
  freeze: { phase: "quiescing" | "freezing" | "frozen" | null; pendingOperations: number };
};
export interface HostedRuntimeObjectMigrationIdentity extends HostedRuntimeMigrationIdentity { objectId: string }
export interface HostedRuntimeMemberMigrationIdentity extends HostedRuntimeMigrationIdentity {
  objectId: string; userId: string; migrationId: string;
}
export type HostedRuntimeMemberMigrationCommand =
  | ({ operation: "quiesce_member" | "read_member" | "freeze_member" | "activate_member" } & HostedRuntimeMemberMigrationIdentity)
  | ({ operation: "import_member"; page: LegacyRuntimeExportPage } & HostedRuntimeMemberMigrationIdentity);
export type HostedRuntimeMigrationCommand =
  | HostedRuntimeMemberMigrationCommand
  | ({ operation: "advance_empty" | "activate_empty" } & HostedRuntimeObjectMigrationIdentity)
  | ({ operation: "import_empty"; page: LegacyRuntimeExportPage } & HostedRuntimeObjectMigrationIdentity)
  | ({ operation: "advance_member" } & HostedRuntimeMemberMigrationIdentity)
  | ({ operation: "select_first_use"; userId: string } & HostedRuntimeObjectMigrationIdentity)
  | ({ operation: "list_unenrolled" | "enroll_members" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "enroll_sources"; bindings: Array<{ userId: string; objectId: string }> } & HostedRuntimeMigrationIdentity)
  | { operation: "status" }
  | ({ operation: "begin" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "begin_rolling" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "close_legacy_creation" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "settle_unmaterialized" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "next_object" } & HostedRuntimeMigrationIdentity)
  | ({ operation: "select_member"; userId: string } & HostedRuntimeMigrationIdentity)
  | ({ operation: "discover"; objectIds: string[]; complete: boolean } & HostedRuntimeMigrationIdentity)
  | ({ operation: "list_inventory"; after: string } & HostedRuntimeMigrationIdentity)
  | ({ operation: "inventory"; after: string; objectIds: string[]; complete: boolean } & HostedRuntimeMigrationIdentity)
  | ({ operation: "read_object"; objectId: string } & HostedRuntimeMigrationIdentity)
  | ({ operation: "inspect_object"; objectId: string } & HostedRuntimeMigrationIdentity)
  | ({ operation: "import"; objectId: string; page: LegacyRuntimeExportPage } & HostedRuntimeMigrationIdentity)
  | ({ operation: "activate"; inventoryHash: string; inventoryCount: number } & HostedRuntimeMigrationIdentity);

export function parseLegacyRuntimeExportCursor(value: unknown): LegacyRuntimeExportCursor {
  const record = requireObject(value, "Legacy export cursor");
  if (!Number.isInteger(record.section) || typeof record.section !== "number" || record.section < 0 || record.section > 3
    || typeof record.after !== "string" || record.after.length > 2048) throw new TypeError("Legacy export cursor is invalid.");
  return { section: record.section, after: record.after };
}
export function parseLegacyRuntimeExportPage(value: unknown): LegacyRuntimeExportPage {
  const record = requireObject(value, "Legacy export page");
  if (record.schema !== LEGACY_RUNTIME_EXPORT_SCHEMA || !Array.isArray(record.records)
    || record.records.length > LEGACY_RUNTIME_EXPORT_PAGE_SIZE) throw new TypeError("Legacy export page is invalid.");
  const generation = requireString(record.generation, "Legacy generation");
  if (!/^(0|[1-9][0-9]{0,18})$/u.test(generation) || BigInt(generation) >= 9_223_372_036_854_775_807n) throw new TypeError("Legacy generation is invalid.");
  const records = record.records.map<LegacyRuntimeExportPage["records"][number]>(value => {
    const row = requireObject(value, "Legacy export record");
    if (row.kind !== "media" && row.kind !== "resource") throw new TypeError("Legacy export record kind is invalid.");
    return { kind: row.kind, key: requireString(row.key, "Legacy export key"), value: requireObject(row.value, "Legacy export value") };
  });
  return { schema: LEGACY_RUNTIME_EXPORT_SCHEMA,
    userId: record.userId === null ? null : requireString(record.userId, "Legacy member"), generation,
    cursor: parseLegacyRuntimeExportCursor(record.cursor), next: record.next === null ? null : parseLegacyRuntimeExportCursor(record.next),
    records, hash: migrationDigest(record.hash) };
}
export function parseHostedRuntimeMigrationCommand(value: unknown): HostedRuntimeMigrationCommand {
  const record = requireObject(value, "Runtime migration command");
  if (record.operation === "status") return { operation: "status" };
  const identity = { namespaceId: migrationIdentifier(record.namespaceId), workerVersion: migrationIdentifier(record.workerVersion), ...parseHostedRuntimeMigrationCompatibility(record.compatibility) };
  const member = parseMemberMigrationCommand(record, identity);
  if (member) return member;
  const campaign = parseCampaignMigrationCommand(record, identity);
  if (campaign) return campaign;
  switch (record.operation) {
    case "select_member": return { operation: "select_member", ...identity, userId: migrationIdentifier(record.userId) };
    case "select_first_use": return { operation: "select_first_use", ...identity, objectId: migrationDigest(record.objectId), userId: requireString(record.userId, "Migration member") };
    case "advance_member": return { operation: "advance_member", ...identity, ...memberMigrationIdentity(record) };
    case "advance_empty":
    case "activate_empty":
    case "read_object":
    case "inspect_object": return { operation: record.operation, ...identity, objectId: migrationDigest(record.objectId) };
    case "import_empty":
    case "import": return { operation: record.operation, ...identity, objectId: migrationDigest(record.objectId), page: parseLegacyRuntimeExportPage(record.page) };
    default: throw new TypeError("Runtime migration operation is invalid.");
  }
}
function parseCampaignMigrationCommand(record: Record<string, unknown>, identity: HostedRuntimeMigrationIdentity): HostedRuntimeMigrationCommand | null {
  switch (record.operation) {
    case "list_unenrolled":
    case "enroll_members":
    case "begin":
    case "close_legacy_creation":
    case "settle_unmaterialized":
    case "next_object":
    case "begin_rolling": return { operation: record.operation, ...identity };
    case "enroll_sources": return { operation: "enroll_sources", ...identity, bindings: parseEnrollmentBindings(record.bindings) };
    case "inventory": return parseInventoryCommand(record, identity);
    case "discover": {
      const page = parseInventoryCommand({ ...record, after: "" }, identity);
      return { operation: "discover", ...identity, objectIds: page.objectIds, complete: page.complete };
    }
    case "list_inventory": return { operation: "list_inventory", ...identity, after: record.after === "" ? "" : migrationDigest(record.after) };
    case "activate": {
      if (typeof record.inventoryCount !== "number" || !Number.isSafeInteger(record.inventoryCount) || record.inventoryCount < 0) throw new TypeError("Migration inventory count is invalid.");
      return { operation: "activate", ...identity, inventoryHash: migrationDigest(record.inventoryHash), inventoryCount: record.inventoryCount };
    }
    default: return null;
  }
}
function migrationIdentifier(value: unknown): string {
  const text = requireString(value, "Migration identity");
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(text)) throw new TypeError("Migration identity is invalid.");
  return text;
}
function migrationDigest(value: unknown): string {
  const text = requireString(value, "Migration digest");
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError("Migration digest is invalid.");
  return text;
}

function memberMigrationIdentity(record: Record<string, unknown>) {
  return { objectId: migrationDigest(record.objectId), userId: requireString(record.userId, "Migration member"), migrationId: migrationIdentifier(record.migrationId) };
}

function parseMemberMigrationCommand(record: Record<string, unknown>, identity: HostedRuntimeMigrationIdentity): HostedRuntimeMemberMigrationCommand | null {
  switch (record.operation) {
    case "quiesce_member":
    case "read_member":
    case "freeze_member":
    case "activate_member": return { operation: record.operation, ...identity, ...memberMigrationIdentity(record) };
    case "import_member": return { operation: "import_member", ...identity, ...memberMigrationIdentity(record), page: parseLegacyRuntimeExportPage(record.page) };
    default: return null;
  }
}

function parseInventoryCommand(record: Record<string, unknown>, identity: HostedRuntimeMigrationIdentity): Extract<HostedRuntimeMigrationCommand, { operation: "inventory" }> {
  if (!Array.isArray(record.objectIds) || record.objectIds.length > 100 || typeof record.complete !== "boolean"
    || typeof record.after !== "string") throw new TypeError("Migration inventory page is invalid.");
  return { operation: "inventory", ...identity, after: record.after === "" ? "" : migrationDigest(record.after),
    objectIds: record.objectIds.map(migrationDigest), complete: record.complete };
}

function parseEnrollmentBindings(value: unknown): Array<{ userId: string; objectId: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new TypeError("Source enrollment requires one to 100 bindings.");
  const bindings = value.map(item => {
    const row = requireObject(item, "Source enrollment binding");
    return { userId: requireString(row.userId, "Enrollment member"), objectId: migrationDigest(row.objectId) };
  });
  if (new Set(bindings.map(row => row.userId)).size !== bindings.length
    || new Set(bindings.map(row => row.objectId)).size !== bindings.length) throw new TypeError("Source enrollment bindings must be unique.");
  return bindings;
}

export { HOSTED_RUNTIME_ROLLING_PROTOCOL, HOSTED_RUNTIME_NAMESPACE_PROBE_NAME, matchesHostedRuntimeMigrationRelease, type HostedRuntimeMigrationCompatibility } from "./runtime-owner.ts";
