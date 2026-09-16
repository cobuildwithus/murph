import type { HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE } from "@murphai/hosted-execution/workspace-snapshot-store";
import type { HostedRuntimeManagedSnapshotUpload } from "@murphai/hosted-execution/runtime-resources";
import type { R2BucketLike } from "./bundle-store.ts";
import { completeManagedSnapshotUpload, prepareManagedSnapshotUpload } from "./managed-snapshot-upload.ts";
import { commandHostedRuntimeSnapshot } from "./runtime-resource-client.ts";
import { createHostedR2PresignedSnapshotPartUrl, readHostedR2PresignEnvironment } from "./r2-presigned-url.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";

type SnapshotSource = Readonly<Record<string, unknown>> & { BUNDLES: R2BucketLike };

export async function presignManagedSnapshot(input: {
  source: SnapshotSource; session: HostedWorkspaceSnapshotUploadSession;
  encryptedByteSize: number; encryptedSha256: string; expiresSeconds: number;
}) {
  const receipt = await prepareManagedSnapshotUpload({
    bucket: input.source.BUNDLES, session: input.session,
    encryptedByteSize: input.encryptedByteSize, encryptedSha256: input.encryptedSha256,
    admit: async proposed => {
      const result = await commandHostedRuntimeSnapshot({ source: input.source, userId: input.session.userId, command: {
        operation: "snapshot_managed_admit", expectedSession: input.session, uploadId: proposed.uploadId,
        encryptedByteSize: proposed.encryptedByteSize, encryptedSha256: proposed.encryptedSha256,
      } });
      return result.applied ? result.managedUpload ?? null : null;
    },
    settle: (receipt, verified) => settle(input.source, receipt, verified),
  });
  if (receipt.completedAt !== null) throw new Error("Managed snapshot upload is terminal; start a fresh snapshot session.");
  const signed = await createHostedR2PresignedSnapshotPartUrl({
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(input.source)),
    key: receipt.objectKey, uploadId: receipt.uploadId, encryptedByteSize: receipt.encryptedByteSize,
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE, expiresSeconds: input.expiresSeconds,
  });
  return { putUrl: signed.url, expiresAt: signed.expiresAt, managedUploadId: receipt.uploadId };
}

export async function completeManagedSnapshotForSession(input: {
  source: SnapshotSource; session: HostedWorkspaceSnapshotUploadSession; part: unknown;
  encryptedByteSize: number; encryptedSha256: string;
}): Promise<string> {
  const { uploadId, etag } = parseManagedPart(input.part);
  const result = await commandHostedRuntimeSnapshot({ source: input.source, userId: input.session.userId, command: {
    operation: "snapshot_managed_read", snapshotId: input.session.snapshotId,
    attemptId: input.session.attemptId, generation: input.session.leaseGeneration,
  } });
  const receipt = result.managedUpload;
  if (!result.applied || !receipt || receipt.uploadId !== uploadId || receipt.objectKey !== input.session.objectKey
    || receipt.userId !== input.session.userId || receipt.snapshotId !== input.session.snapshotId
    || receipt.attemptId !== input.session.attemptId || receipt.generation !== input.session.leaseGeneration
    || receipt.encryptedByteSize !== input.encryptedByteSize || receipt.encryptedSha256 !== input.encryptedSha256) {
    throw new Error("Managed snapshot completion does not match its admitted bytes.");
  }
  await completeManagedSnapshotUpload({ bucket: input.source.BUNDLES, receipt, etag,
    settle: (receipt, verified) => settle(input.source, receipt, verified) });
  return receipt.encryptedSha256;
}

function parseManagedPart(part: unknown): { uploadId: string; etag: string } {
  if (!part || typeof part !== "object" || !("uploadId" in part) || !("etag" in part)
    || typeof part.uploadId !== "string" || !part.uploadId || part.uploadId.length > 1024
    || typeof part.etag !== "string" || !part.etag || part.etag.length > 1024) throw new TypeError("Managed snapshot part is invalid.");
  return { uploadId: part.uploadId, etag: part.etag };
}

async function settle(source: SnapshotSource, receipt: HostedRuntimeManagedSnapshotUpload, verified: boolean): Promise<boolean> {
  const result = await commandHostedRuntimeSnapshot({ source, userId: receipt.userId, command: {
    operation: "snapshot_managed_settled", snapshotId: receipt.snapshotId, uploadId: receipt.uploadId,
    attemptId: receipt.attemptId, generation: receipt.generation, verified,
  } });
  return result.applied;
}
