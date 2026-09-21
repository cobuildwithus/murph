import { parseHostedWorkspaceSnapshotUploadSession, type HostedWorkspaceSnapshotUploadSession } from "./workspace-snapshot-store.ts";
import { parseHostedRuntimeOwnerIdentity, type HostedRuntimeOwnerIdentity } from "./runtime-owner.ts";
import { requireObject, requireString } from "./parsers/assertions.ts";
import { HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES } from "./workspace-snapshot-v2.ts";
export { HOSTED_CHECKPOINT_RECOVERY_PATH, fingerprintRecoveryReplica, parseHostedCheckpointRecoveryRequest,
  type HostedCheckpointRecoveryRequest } from "./checkpoint-recovery.ts";

export const HOSTED_RUNTIME_RESOURCES_PATH = "/api/internal/hosted-runtime/resources";
export const HOSTED_RUNTIME_ORPHAN_GRACE_MS = 65 * 60_000;
// Accepted snapshots remain recoverable beyond the ordinary upload/orphan
// drain window. Their complete encrypted reference is retained by Web.
export const HOSTED_RUNTIME_SNAPSHOT_RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const HOSTED_RUNTIME_REPLICA_POST_STOP_DRAIN_MS = 60_000;

export type HostedRuntimeSnapshotCommand =
  | HostedRuntimeManagedSnapshotCommand
  | { operation: "snapshot_create"; session: HostedWorkspaceSnapshotUploadSession }
  | ({ operation: "snapshot_read" | "snapshot_heartbeat" | "snapshot_complete" | "snapshot_delete"; snapshotId: string } & HostedRuntimeOwnerIdentity)
  | { operation: "snapshot_admit_put"; expectedSession: HostedWorkspaceSnapshotUploadSession; expiresAt: string; drainUntil: string }
  | { operation: "snapshot_record_replaced"; expectedSession: HostedWorkspaceSnapshotUploadSession; replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]> };

export interface HostedRuntimeSnapshotResponse {
  cutover: "legacy" | "draining" | "postgres";
  applied: boolean;
  session: HostedWorkspaceSnapshotUploadSession | null;
  managedUpload?: HostedRuntimeManagedSnapshotUpload | null;
}

export interface HostedRuntimeManagedSnapshotUpload extends HostedRuntimeOwnerIdentity {
  userId: string;
  snapshotId: string;
  objectKey: string;
  uploadId: string;
  encryptedByteSize: number;
  encryptedSha256: string;
  /** Hex MD5 of the encrypted bytes, declared by the runner at admission so
   * completion can verify publication through R2's own ETag without a read-back. */
  encryptedMd5?: string;
  completedAt: string | null;
  verifiedAt: string | null;
}
export type HostedRuntimeManagedSnapshotCommand =
  | { operation: "snapshot_managed_admit"; expectedSession: HostedWorkspaceSnapshotUploadSession; uploadId: string; encryptedByteSize: number; encryptedSha256: string; encryptedMd5?: string }
  | ({ operation: "snapshot_managed_read"; snapshotId: string } & HostedRuntimeOwnerIdentity)
  | ({ operation: "snapshot_managed_settled"; snapshotId: string; uploadId: string; verified: boolean } & HostedRuntimeOwnerIdentity);

export function parseHostedRuntimeManagedSnapshotUpload(value: unknown): HostedRuntimeManagedSnapshotUpload {
  const record = requireObject(value, "Managed snapshot upload");
  const completedAt = record.completedAt === null ? null : canonicalDate(record.completedAt);
  const verifiedAt = record.verifiedAt === null ? null : canonicalDate(record.verifiedAt);
  if (verifiedAt !== null && completedAt === null) throw new TypeError("Snapshot verification requires a terminal upload.");
  return { ...parseHostedRuntimeOwnerIdentity(record), ...parseManagedSnapshotBytes(record), ...parseManagedSnapshotMd5(record),
    userId: requireString(record.userId, "Snapshot member"), snapshotId: snapshotIdentity(record.snapshotId),
    objectKey: boundedUploadString(record.objectKey), uploadId: boundedUploadString(record.uploadId), completedAt, verifiedAt };
}

function parseManagedSnapshotBytes(record: Record<string, unknown>): { encryptedByteSize: number; encryptedSha256: string } {
  if (typeof record.encryptedByteSize !== "number" || !Number.isSafeInteger(record.encryptedByteSize)
    || record.encryptedByteSize <= 0 || record.encryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES
    || typeof record.encryptedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.encryptedSha256)) {
    throw new TypeError("Managed snapshot byte identity is invalid.");
  }
  return { encryptedByteSize: record.encryptedByteSize, encryptedSha256: record.encryptedSha256 };
}
function parseManagedSnapshotMd5(record: Record<string, unknown>): { encryptedMd5?: string } {
  if (record.encryptedMd5 === undefined || record.encryptedMd5 === null) return {};
  if (typeof record.encryptedMd5 !== "string" || !/^[a-f0-9]{32}$/u.test(record.encryptedMd5)) throw new TypeError("Managed snapshot MD5 is invalid.");
  return { encryptedMd5: record.encryptedMd5 };
}
function boundedUploadString(value: unknown): string {
  const text = requireString(value, "Snapshot upload identity");
  if (text.length > 1024) throw new TypeError("Snapshot upload identity is too long.");
  return text;
}
function snapshotIdentity(value: unknown): string {
  const text = requireString(value, "Snapshot identity");
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(text)) throw new TypeError("Snapshot identity is invalid.");
  return text;
}

export function parseHostedRuntimeSnapshotCommand(value: unknown): HostedRuntimeSnapshotCommand {
  const record = requireObject(value, "Runtime snapshot command");
  const operation = requireString(record.operation, "Runtime resource operation");
  if (operation === "snapshot_managed_admit") {
    return { operation, expectedSession: parseHostedWorkspaceSnapshotUploadSession(record.expectedSession),
      uploadId: boundedUploadString(record.uploadId), ...parseManagedSnapshotBytes(record), ...parseManagedSnapshotMd5(record) };
  }
  if (operation === "snapshot_managed_read") return { operation, snapshotId: snapshotIdentity(record.snapshotId), ...parseHostedRuntimeOwnerIdentity(record) };
  if (operation === "snapshot_managed_settled") {
    if (typeof record.verified !== "boolean") throw new TypeError("Snapshot verification outcome is invalid.");
    return { operation, snapshotId: snapshotIdentity(record.snapshotId), uploadId: boundedUploadString(record.uploadId), verified: record.verified, ...parseHostedRuntimeOwnerIdentity(record) };
  }
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
  return { cutover: record.cutover, applied: record.applied, session: record.session === null ? null : parseHostedWorkspaceSnapshotUploadSession(record.session),
    ...(record.managedUpload === undefined ? {} : { managedUpload: record.managedUpload === null ? null : parseHostedRuntimeManagedSnapshotUpload(record.managedUpload) }) };
}

function canonicalDate(value: unknown): string {
  const text = requireString(value, "Snapshot date");
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) throw new TypeError("Snapshot date is invalid.");
  return text;
}

export const HOSTED_RUNTIME_REPLICA_PUT_PATH = "/api/internal/hosted-runtime/replica-put";
// One root, three shards, and 32 metric buckets; never a general-purpose bulk API.
export const HOSTED_RUNTIME_REPLICA_PUT_BATCH_LIMIT = 36;
export interface HostedRuntimeReplicaUpload {
  writeId: string;
  objectKey: string;
  uploadId: string;
}
export type HostedRuntimeReplicaPutCommand =
  | ({ operation: "admit"; writeId: string; objectKey: string; multipart?: { objectKey: string; uploadId: string } } & HostedRuntimeOwnerIdentity)
  | { operation: "release"; writeId: string }
  | ({ operation: "admit_batch"; objectKey: string; uploads: HostedRuntimeReplicaUpload[] } & HostedRuntimeOwnerIdentity)
  | { operation: "release_batch"; writeIds: string[] };

function replicaWriteIdentity(value: unknown): string {
  const writeId = requireString(value, "Replica write identity");
  if (!/^[a-zA-Z0-9._:-]{1,200}$/u.test(writeId)) throw new TypeError("Replica write identity is invalid.");
  return writeId;
}
function replicaMultipart(value: unknown): { objectKey: string; uploadId: string } {
  const upload = requireObject(value, "Replica multipart upload");
  return { objectKey: boundedUploadString(upload.objectKey), uploadId: boundedUploadString(upload.uploadId) };
}
function replicaBatch(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > HOSTED_RUNTIME_REPLICA_PUT_BATCH_LIMIT) {
    throw new TypeError("Replica upload batch must contain between 1 and 36 entries.");
  }
  return value;
}
function requireUniqueReplicaValues(values: string[]): void {
  if (new Set(values).size !== values.length) throw new TypeError("Replica upload batch contains duplicate identities.");
}
export function parseHostedRuntimeReplicaPutCommand(value: unknown): HostedRuntimeReplicaPutCommand {
  const record = requireObject(value, "Runtime replica PUT command");
  if (record.operation === "release_batch") {
    const writeIds = replicaBatch(record.writeIds).map(replicaWriteIdentity);
    requireUniqueReplicaValues(writeIds);
    return { operation: "release_batch", writeIds };
  }
  if (record.operation === "admit_batch") {
    const uploads = replicaBatch(record.uploads).map(value => {
      const upload = requireObject(value, "Replica multipart upload");
      return { writeId: replicaWriteIdentity(upload.writeId), ...replicaMultipart(upload) };
    });
    requireUniqueReplicaValues(uploads.map(upload => upload.writeId));
    requireUniqueReplicaValues(uploads.map(upload => upload.objectKey));
    return { operation: "admit_batch", objectKey: boundedUploadString(record.objectKey), uploads, ...parseHostedRuntimeOwnerIdentity(record) };
  }
  const writeId = replicaWriteIdentity(record.writeId);
  if (record.operation === "release") return { operation: "release", writeId };
  if (record.operation !== "admit") throw new TypeError("Replica PUT operation is invalid.");
  return { operation: "admit", writeId, ...(record.multipart === undefined ? {} : { multipart: replicaMultipart(record.multipart) }),
    objectKey: requireString(record.objectKey, "Replica object key"), ...parseHostedRuntimeOwnerIdentity(record) };
}

export function buildHostedRuntimeReplicaBatchProtocolProbe() {
  const uploads = Array.from({ length: HOSTED_RUNTIME_REPLICA_PUT_BATCH_LIMIT }, (_, index) => ({
    writeId: `probe-write-${index}`, objectKey: `probe-object-${index}`, uploadId: `probe-upload-${index}`,
  }));
  return {
    admission: { operation: "admit_batch", objectKey: "probe-root", attemptId: "probe-attempt", generation: "1", uploads },
    settlement: { operation: "release_batch", writeIds: uploads.map(upload => upload.writeId) },
  };
}
