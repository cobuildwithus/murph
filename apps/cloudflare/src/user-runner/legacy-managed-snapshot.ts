import {
  parseHostedRuntimeManagedSnapshotUpload, parseHostedRuntimeSnapshotCommand,
  type HostedRuntimeManagedSnapshotCommand, type HostedRuntimeManagedSnapshotUpload, type HostedRuntimeSnapshotResponse,
} from "@murphai/hosted-execution/runtime-resources";
import type { HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import type { R2BucketLike } from "../bundle-store.ts";
import { abortRuntimeMultipartUpload } from "../runtime-object-upload.ts";
import type { DurableObjectStateLike } from "./types.ts";

export const LEGACY_MANAGED_SNAPSHOT_PREFIX = "workspace-snapshot-managed-upload:v1:";
const SCHEMA = "murph.legacy-managed-snapshot-upload.v1";
type Upload = HostedRuntimeManagedSnapshotUpload;

/** Caller serializes this with direct PUT admission, cleanup and member deletion.
 * Receipts survive current-session replacement; terminal IDs are never reopened. */
export async function commandLegacyManagedSnapshot(input: {
  state: DurableObjectStateLike; userId: string; command: HostedRuntimeManagedSnapshotCommand;
  currentSession: HostedWorkspaceSnapshotUploadSession | null; ownsCurrentAttempt: boolean;
}): Promise<HostedRuntimeSnapshotResponse> {
  const command = parseHostedRuntimeSnapshotCommand(input.command);
  if (command.operation !== "snapshot_managed_admit" && command.operation !== "snapshot_managed_read" && command.operation !== "snapshot_managed_settled") {
    throw new TypeError("Legacy managed snapshot command is invalid.");
  }
  const snapshotId = command.operation === "snapshot_managed_admit" ? command.expectedSession.snapshotId : command.snapshotId;
  const current = await readLegacyManagedSnapshot(input.state, input.userId, snapshotId);
  const response = (applied: boolean, upload = current): HostedRuntimeSnapshotResponse => ({
    cutover: "legacy", applied, session: input.currentSession, managedUpload: upload,
  });
  if (command.operation === "snapshot_managed_settled") {
    const settled = await settleLegacyManagedSnapshot(input.state, current, command);
    return response(settled !== null, settled ?? current);
  }
  const session = input.currentSession;
  if (!input.ownsCurrentAttempt || !session || session.userId !== input.userId || session.snapshotId !== snapshotId) return response(false);
  if (command.operation === "snapshot_managed_read") return response(current === null || uploadBelongsToSession(current, session));
  if (session.r2PutExpiresAt || Date.parse(session.expiresAt) <= Date.now()) return response(false);
  if (current) return response(uploadBelongsToSession(current, session)
    && current.encryptedByteSize === command.encryptedByteSize && current.encryptedSha256 === command.encryptedSha256);
  const upload = parseHostedRuntimeManagedSnapshotUpload({
    userId: input.userId, snapshotId, objectKey: session.objectKey, attemptId: session.attemptId, generation: session.leaseGeneration,
    uploadId: command.uploadId, encryptedByteSize: command.encryptedByteSize, encryptedSha256: command.encryptedSha256,
    completedAt: null, verifiedAt: null,
  });
  await writeLegacyManagedSnapshot(input.state, upload);
  return response(true, upload);
}

async function settleLegacyManagedSnapshot(state: DurableObjectStateLike, current: Upload | null,
  command: Extract<HostedRuntimeManagedSnapshotCommand, { operation: "snapshot_managed_settled" }>): Promise<Upload | null> {
  if (!current || current.uploadId !== command.uploadId || current.attemptId !== command.attemptId || current.generation !== command.generation) return null;
  const now = new Date().toISOString();
  const settled = { ...current, completedAt: current.completedAt ?? now,
    verifiedAt: current.verifiedAt ?? (command.verified ? now : null) };
  await writeLegacyManagedSnapshot(state, settled);
  return settled;
}

function uploadBelongsToSession(upload: Upload, session: HostedWorkspaceSnapshotUploadSession): boolean {
  return upload.objectKey === session.objectKey && upload.attemptId === session.attemptId && upload.generation === session.leaseGeneration;
}

export function parseLegacyManagedSnapshot(value: unknown): Upload {
  if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== SCHEMA) throw new Error("Legacy managed snapshot receipt is invalid.");
  return parseHostedRuntimeManagedSnapshotUpload(value);
}

export async function readLegacyManagedSnapshot(state: DurableObjectStateLike, userId: string, snapshotId: string): Promise<Upload | null> {
  const value = await state.storage.get<unknown>(`${LEGACY_MANAGED_SNAPSHOT_PREFIX}${snapshotId}`);
  if (value === undefined) return null;
  const upload = parseLegacyManagedSnapshot(value);
  if (upload.userId !== userId || upload.snapshotId !== snapshotId) throw new Error("Legacy managed snapshot identity mismatch.");
  return upload;
}

function writeLegacyManagedSnapshot(state: DurableObjectStateLike, upload: Upload): Promise<void> {
  return state.storage.put(`${LEGACY_MANAGED_SNAPSHOT_PREFIX}${upload.snapshotId}`, { schema: SCHEMA, ...upload });
}

/** Must hold admission closure/cleanup serialization. An elapsed deadline never
 * settles a capability: only an exact abort or NoSuchUpload acknowledgment does. */
export async function abortLegacyManagedSnapshot(input: {
  state: DurableObjectStateLike; bucket: R2BucketLike; userId: string; snapshotId: string;
}): Promise<void> {
  const upload = await readLegacyManagedSnapshot(input.state, input.userId, input.snapshotId);
  if (!upload || upload.completedAt !== null) return;
  if (!input.bucket.resumeMultipartUpload) throw new Error("Legacy managed upload recovery is unavailable.");
  await abortRuntimeMultipartUpload(input.bucket.resumeMultipartUpload(upload.objectKey, upload.uploadId));
  await writeLegacyManagedSnapshot(input.state, { ...upload, completedAt: new Date().toISOString() });
}

export async function scanLegacyManagedSnapshots(input: {
  state: DurableObjectStateLike; userId: string;
  visit?: (upload: Upload) => Promise<void>;
}): Promise<{ pending: number }> {
  if (!input.state.storage.list) throw new Error("Legacy managed uploads require bounded storage listing.");
  let after = "";
  let pending = 0;
  for (;;) {
    const page = await input.state.storage.list<unknown>({ prefix: LEGACY_MANAGED_SNAPSHOT_PREFIX, limit: 50, ...(after ? { startAfter: after } : {}) });
    for (const [key, value] of page) {
      const upload = parseLegacyManagedSnapshot(value);
      if (upload.userId !== input.userId || key !== `${LEGACY_MANAGED_SNAPSHOT_PREFIX}${upload.snapshotId}`) throw new Error("Legacy managed snapshot identity mismatch.");
      if (upload.completedAt === null) pending++;
      await input.visit?.(upload);
    }
    if (page.size < 50) return { pending };
    const next = [...page.keys()].at(-1)!;
    if (next <= after) throw new Error("Legacy upload listing did not advance.");
    after = next;
  }
}

export async function abortAllLegacyManagedSnapshots(input: { state: DurableObjectStateLike; bucket: R2BucketLike; userId: string }): Promise<void> {
  await scanLegacyManagedSnapshots({ ...input, visit: async upload => {
    if (upload.completedAt === null) await abortLegacyManagedSnapshot({ ...input, snapshotId: upload.snapshotId });
  } });
}
