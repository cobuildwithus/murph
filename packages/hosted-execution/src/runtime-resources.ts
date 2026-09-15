import { parseHostedWorkspaceSnapshotUploadSession, type HostedWorkspaceSnapshotUploadSession } from "./workspace-snapshot-store.ts";
import { parseHostedRuntimeOwnerIdentity, type HostedRuntimeOwnerIdentity } from "./runtime-owner.ts";
import { requireObject, requireString } from "./parsers/assertions.ts";

export const HOSTED_RUNTIME_RESOURCES_PATH = "/api/internal/hosted-runtime/resources";
export const HOSTED_RUNTIME_ORPHAN_GRACE_MS = 65 * 60_000;
export const HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS = 60_000;

export type HostedRuntimeSnapshotCommand =
  | { operation: "snapshot_create"; session: HostedWorkspaceSnapshotUploadSession }
  | ({ operation: "snapshot_read" | "snapshot_heartbeat" | "snapshot_complete" | "snapshot_delete"; snapshotId: string } & HostedRuntimeOwnerIdentity)
  | { operation: "snapshot_admit_put"; expectedSession: HostedWorkspaceSnapshotUploadSession; expiresAt: string; drainUntil: string }
  | { operation: "snapshot_record_replaced"; expectedSession: HostedWorkspaceSnapshotUploadSession; replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]> };

export interface HostedRuntimeSnapshotResponse {
  cutover: "legacy" | "draining" | "postgres";
  applied: boolean;
  session: HostedWorkspaceSnapshotUploadSession | null;
}

export function parseHostedRuntimeSnapshotCommand(value: unknown): HostedRuntimeSnapshotCommand {
  const record = requireObject(value, "Runtime snapshot command");
  const operation = requireString(record.operation, "Runtime resource operation");
  if (operation === "snapshot_create") return { operation, session: parseHostedWorkspaceSnapshotUploadSession(record.session) };
  if (operation === "snapshot_admit_put" || operation === "snapshot_record_replaced") {
    const expectedSession = parseHostedWorkspaceSnapshotUploadSession(record.expectedSession);
    if (operation === "snapshot_admit_put") {
      const expiresAt = canonicalDate(record.expiresAt);
      const drainUntil = canonicalDate(record.drainUntil);
      if (Date.parse(drainUntil) < Date.parse(expiresAt)) throw new TypeError("Snapshot PUT drain precedes expiry.");
      return { operation, expectedSession, expiresAt, drainUntil };
    }
    const updated = parseHostedWorkspaceSnapshotUploadSession({ ...expectedSession, replacedSnapshotRef: record.replacedSnapshotRef });
    if (!updated.replacedSnapshotRef) throw new TypeError("Replaced snapshot reference is required.");
    return { operation, expectedSession, replacedSnapshotRef: updated.replacedSnapshotRef };
  }
  const identity = parseHostedRuntimeOwnerIdentity(record);
  if (operation !== "snapshot_read" && operation !== "snapshot_heartbeat" && operation !== "snapshot_complete" && operation !== "snapshot_delete") {
    throw new TypeError("Unsupported runtime snapshot operation.");
  }
  const snapshotId = requireString(record.snapshotId, "Snapshot identity");
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(snapshotId)) throw new TypeError("Snapshot identity is invalid.");
  return { operation, snapshotId, attemptId: identity.attemptId, generation: identity.generation };
}

export function parseHostedRuntimeSnapshotResponse(value: unknown): HostedRuntimeSnapshotResponse {
  const record = requireObject(value, "Runtime snapshot response");
  if (record.cutover !== "legacy" && record.cutover !== "draining" && record.cutover !== "postgres") throw new TypeError("Invalid runtime cutover.");
  if (typeof record.applied !== "boolean") throw new TypeError("Invalid snapshot outcome.");
  return { cutover: record.cutover, applied: record.applied, session: record.session === null ? null : parseHostedWorkspaceSnapshotUploadSession(record.session) };
}

function canonicalDate(value: unknown): string {
  const text = requireString(value, "Snapshot date");
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) throw new TypeError("Snapshot date is invalid.");
  return text;
}

export const HOSTED_RUNTIME_REPLICA_PUT_PATH = "/api/internal/hosted-runtime/replica-put";
export type HostedRuntimeReplicaPutCommand =
  | ({ operation: "admit"; writeId: string; objectKey: string } & HostedRuntimeOwnerIdentity)
  | { operation: "release"; writeId: string };
export function parseHostedRuntimeReplicaPutCommand(value: unknown): HostedRuntimeReplicaPutCommand {
  const record = requireObject(value, "Runtime replica PUT command");
  const writeId = requireString(record.writeId, "Replica write identity");
  if (!/^[a-zA-Z0-9._:-]{1,200}$/u.test(writeId)) throw new TypeError("Replica write identity is invalid.");
  if (record.operation === "release") return { operation: "release", writeId };
  if (record.operation !== "admit") throw new TypeError("Replica PUT operation is invalid.");
  return { operation: "admit", writeId, objectKey: requireString(record.objectKey, "Replica object key"), ...parseHostedRuntimeOwnerIdentity(record) };
}
